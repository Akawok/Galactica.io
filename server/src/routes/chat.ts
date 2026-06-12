import type { FastifyInstance } from "fastify";
import { ChatMessage } from "../models/ChatMessage.js";

export async function chatRoutes(app: FastifyInstance) {
  app.get("/chat/history", async (_req, reply) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const messages = await ChatMessage.find({ timestamp: { $gte: since } })
      .sort({ timestamp: 1 })
      .limit(100)
      .select("username message timestamp");
    return reply.send({ messages });
  });
}
