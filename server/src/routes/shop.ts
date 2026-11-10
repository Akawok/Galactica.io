import type { FastifyInstance } from "fastify";
import { Item, type IItem } from "../models/Item.js";
import { User } from "../models/User.js";
import { withImages } from "../services/item-assets.service.js";

export async function shopRoutes(app: FastifyInstance) {
  app.get("/shop/items", async (_req, reply) => {
    const items = await Item.find().lean();
    return reply.send({ items: await withImages(items) });
  });

  app.get(
    "/shop/inventory",
    {
      onRequest: [app.authenticate],
    },
    async (req, reply) => {
      const id = req.account!.id;
      const user = await User.findById(id)
        .select(
          "inventory activeShip activeBullet activeBulletSecondary points",
        )
        .populate<{ inventory: IItem[] }>("inventory");
      if (!user)
        return reply.code(404).send({ error: "Utilisateur non trouvé" });
      return reply.send({
        inventory: await withImages(user.inventory.map((i) => i.toObject())),
        activeShip: user.activeShip,
        activeBullet: user.activeBullet,
        activeBulletSecondary: user.activeBulletSecondary ?? "bullet1",
        points: user.points,
      });
    },
  );

  app.post<{ Body: { itemId: string } }>(
    "/shop/buy",
    {
      onRequest: [app.authenticate],
      schema: {
        body: {
          type: "object",
          required: ["itemId"],
          additionalProperties: false,
          properties: {
            itemId: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          },
        },
      },
    },
    async (req, reply) => {
      const id = req.account!.id;
      const { itemId } = req.body;

      const item = await Item.findById(itemId)
        .select("price priceGalactics")
        .lean();
      if (!item) return reply.code(404).send({ error: "Item non trouvé" });
      const galacticsCost = item.priceGalactics ?? 0;

      const updated = await User.findOneAndUpdate(
        {
          _id: id,
          points: { $gte: item.price },
          galactics: { $gte: galacticsCost },
          inventory: { $ne: item._id },
        },
        {
          $inc: { points: -item.price, galactics: -galacticsCost },
          $addToSet: { inventory: item._id },
        },
        { new: true },
      ).select("points galactics inventory");

      if (!updated) {
        const user = await User.findById(id)
          .select("points galactics inventory")
          .lean();
        if (!user)
          return reply.code(404).send({ error: "Utilisateur non trouvé" });
        if (user.inventory.some((ref: any) => ref.toString() === itemId))
          return reply.code(400).send({ error: "Item déjà possédé" });
        if (user.points < item.price)
          return reply.code(400).send({ error: "Crédits insuffisants" });
        return reply.code(400).send({ error: "Galactics insuffisants" });
      }

      return reply.send({
        points: updated.points,
        galactics: updated.galactics ?? 0,
        inventory: updated.inventory,
      });
    },
  );

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
      const id = req.account!.id;
      const { type, sprite } = req.body;

      const user = await User.findById(id);
      if (!user)
        return reply.code(404).send({ error: "Utilisateur non trouvé" });

      const item = await Item.findOne({ sprite, type })
        .select("price priceGalactics bulletRole")
        .lean();
      if (!item) return reply.code(404).send({ error: "Item non trouvé" });

      const isFree = item.price === 0 && (item.priceGalactics ?? 0) === 0;
      const owned =
        isFree ||
        user.inventory.some((ref) => ref.toString() === item._id.toString());
      if (!owned) return reply.code(403).send({ error: "Item non possédé" });

      if (type === "ship") {
        user.activeShip = sprite;
      } else if (item.bulletRole === "secondary") {
        user.activeBulletSecondary = sprite;
      } else {
        user.activeBullet = sprite;
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
