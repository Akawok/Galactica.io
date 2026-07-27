import type { FastifyInstance } from "fastify";
import { User } from "../models/User.js";

export async function leaderboardRoutes(app: FastifyInstance) {
  app.get(
    "/leaderboard",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (_req, reply) => {
      const players = await User.find({
        $or: [{ bannedUntil: null }, { bannedUntil: { $lte: new Date() } }],
      })
        .select("username level stats -_id")
        .sort({ points: -1 })
        .limit(50)
        .lean();

      return reply.send({ players });
    },
  );
}
