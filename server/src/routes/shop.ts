import type { FastifyInstance } from "fastify";
import { Item } from "../models/Item.js";
import { User } from "../models/User.js";

export async function shopRoutes(app: FastifyInstance) {
  // Catalogue complet
  app.get("/shop/items", async (_req, reply) => {
    const items = await Item.find().lean();
    return reply.send({ items });
  });

  // Inventaire du joueur connecté (items possédés + sélection active)
  app.get(
    "/shop/inventory",
    {
      onRequest: [app.authenticate],
    },
    async (req, reply) => {
      const { id } = req.user as { id: string };
      const user = await User.findById(id)
        .select(
          "inventory activeShip activeBullet activeBulletSecondary points",
        )
        .populate("inventory");
      if (!user)
        return reply.code(404).send({ error: "Utilisateur non trouvé" });
      return reply.send({
        inventory: user.inventory,
        activeShip: user.activeShip,
        activeBullet: user.activeBullet,
        activeBulletSecondary: user.activeBulletSecondary ?? "bullet1",
        points: user.points,
      });
    },
  );

  // Acheter un item
  app.post<{ Body: { itemId: string } }>(
    "/shop/buy",
    {
      onRequest: [app.authenticate],
      schema: {
        body: {
          type: "object",
          required: ["itemId"],
          properties: { itemId: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.user as { id: string };
      const { itemId } = req.body;

      const item = await Item.findById(itemId).select("price").lean();
      if (!item) return reply.code(404).send({ error: "Item non trouvé" });

      const updated = await User.findOneAndUpdate(
        { _id: id, points: { $gte: item.price }, inventory: { $ne: item._id } },
        { $inc: { points: -item.price }, $addToSet: { inventory: item._id } },
        { new: true },
      ).select("points inventory");

      if (!updated) {
        const user = await User.findById(id).select("points inventory").lean();
        if (!user)
          return reply.code(404).send({ error: "Utilisateur non trouvé" });
        if (user.inventory.some((ref: any) => ref.toString() === itemId))
          return reply.code(400).send({ error: "Item déjà possédé" });
        return reply.code(400).send({ error: "Points insuffisants" });
      }

      return reply.send({ points: updated.points, inventory: updated.inventory });
    },
  );

  // Changer vaisseau/missile actif
  app.post<{
    Body: {
      type: "ship" | "bullet";
      sprite: string;
      role?: "primary" | "secondary";
    };
  }>(
    "/shop/equip",
    {
      onRequest: [app.authenticate],
      schema: {
        body: {
          type: "object",
          required: ["type", "sprite"],
          properties: {
            type: { type: "string", enum: ["ship", "bullet"] },
            sprite: { type: "string" },
            role: { type: "string", enum: ["primary", "secondary"] },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.user as { id: string };
      const { type, sprite, role } = req.body;

      const user = await User.findById(id);
      if (!user)
        return reply.code(404).send({ error: "Utilisateur non trouvé" });

      if (type === "ship") {
        user.activeShip = sprite;
      } else if (type === "bullet") {
        if (role === "secondary") user.activeBulletSecondary = sprite;
        else user.activeBullet = sprite;
      }

      await user.save();
      return reply.send({
        activeShip: user.activeShip,
        activeBullet: user.activeBullet,
        activeBulletSecondary: user.activeBulletSecondary ?? "bullet1",
      });
    },
  );
}
