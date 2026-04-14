import type { FastifyInstance } from "fastify";
import { User } from "../models/User.js";

export async function leaderboardRoutes(app: FastifyInstance) {
  app.get("/leaderboard", async (_req, reply) => {
    const players = await User.find()
      .select("username level stats")
      .sort({ points: -1 })
      .limit(50)
      .lean();

    return reply.send({ players });
  });
}
