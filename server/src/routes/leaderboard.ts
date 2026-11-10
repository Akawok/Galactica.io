import type { FastifyInstance } from "fastify";
import { User } from "../models/User.js";

const SORTS = {
  wins: { "stats.wins": -1, level: -1 },
  losses: { "stats.losses": -1 },
  level: { level: -1, xp: -1 },
  desertions: { "stats.desertions": -1 },
} as const;
type LeaderboardSort = keyof typeof SORTS;

export async function leaderboardRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { sort?: LeaderboardSort } }>(
    "/leaderboard",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { sort: { type: "string", enum: Object.keys(SORTS) } },
        },
      },
    },
    async (req, reply) => {
      const players = await User.find({
        $or: [{ bannedUntil: null }, { bannedUntil: { $lte: new Date() } }],
      })
        .select("username level stats -_id")
        .sort({ ...SORTS[req.query.sort ?? "wins"], _id: 1 })
        .limit(50)
        .lean();

      return reply.send({ players });
    },
  );
}
