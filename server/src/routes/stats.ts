import type { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { User, serializeUserFull } from "../models/User.js";
import { Game } from "../models/Game.js";
import type { IItem } from "../models/Item.js";
import { withImages } from "../services/item-assets.service.js";

export async function statsRoutes(app: FastifyInstance) {
  app.get(
    "/stats/me",
    {
      onRequest: [app.authenticate],
    },
    async (req, reply) => {
      const id = req.account!.id;
      const user = await User.findById(id)
        .select("-email -createdAt -tokenVersion -usernameCanonical")
        .populate("inventory");
      if (!user) return reply.code(404).send({ error: "Joueur non trouvé" });
      const inventory = await withImages(
        // An item deleted from the admin can leave a dangling reference for a moment
        (user.inventory as unknown as (IItem | null)[])
          .filter((i): i is IItem => i !== null)
          .map((i) => i.toObject()),
      );
      return reply.send({ user: { ...serializeUserFull(user), inventory } });
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/stats/:userId",
    {
      onRequest: [app.authenticate],
      schema: {
        params: {
          type: "object",
          required: ["userId"],
          additionalProperties: false,
          properties: {
            userId: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          },
        },
      },
    },
    async (req, reply) => {
      const { userId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return reply.code(400).send({ error: "Identifiant invalide" });
      }

      const [user, games] = await Promise.all([
        User.findById(userId).select("username level stats points").lean(),
        Game.find({ "players.userId": userId })
          .select("roomId players winner createdAt endedAt")
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
      ]);
      if (!user) return reply.code(404).send({ error: "Joueur non trouvé" });
      return reply.send({ user, games });
    },
  );
}
