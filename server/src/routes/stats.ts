import type { FastifyInstance } from "fastify";
import { User, serializeUserFull } from "../models/User.js";
import { Game } from "../models/Game.js";

export async function statsRoutes(app: FastifyInstance) {
  app.get(
    "/stats/me",
    {
      onRequest: [app.authenticate],
    },
    async (req, reply) => {
      const id = (req.user as { id: string }).id;
      const user = await User.findById(id)
        .select("-passwordHash -email -createdAt")
        .populate("inventory");
      if (!user) return reply.code(404).send({ error: "Joueur non trouvé" });
      return reply.send({ user: serializeUserFull(user) });
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/stats/:userId",
    {
      onRequest: [app.authenticate],
    },
    async (req, reply) => {
      const { userId } = req.params;
      const [user, games] = await Promise.all([
        User.findById(userId).select("username stats points"),
        Game.find({ "players.userId": userId })
          .sort({ createdAt: -1 })
          .limit(20),
      ]);
      if (!user) return reply.code(404).send({ error: "Joueur non trouvé" });
      return reply.send({ user, games });
    },
  );
}
