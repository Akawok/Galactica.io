import type { FastifyInstance } from "fastify";
import { User } from "../models/User.js";
import { Game } from "../models/Game.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { AuditLog, recordAudit } from "../models/AuditLog.js";
import { getIO } from "../sockets/registry.js";
import {
  closeRoomByAdmin,
  listLiveRooms,
  listOnlinePlayers,
  postAnnouncement,
} from "../sockets/lobby.js";
import { sanitizeChatMessage } from "../services/identity.service.js";
import { escapeRegex, serializeGame } from "./admin.js";

const DAY_MS = 24 * 60 * 60_000;

export async function adminSiteRoutes(app: FastifyInstance) {
  const moderator = {
    onRequest: [app.authenticate],
    preHandler: [app.requireRole("moderator")],
  };
  const admin = {
    onRequest: [app.authenticate],
    preHandler: [app.requireRole("admin")],
  };

  app.get("/admin/overview", moderator, async (req, reply) => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

    const [
      players,
      newToday,
      newWeek,
      banned,
      muted,
      unverified,
      gamesTotal,
      gamesToday,
      gamesWeek,
      chatToday,
      topPlayers,
      latestSignups,
      recentActions,
    ] = await Promise.all([
      User.estimatedDocumentCount(),
      User.countDocuments({ createdAt: { $gte: dayAgo } }),
      User.countDocuments({ createdAt: { $gte: weekAgo } }),
      User.countDocuments({ bannedUntil: { $gt: now } }),
      User.countDocuments({ mutedUntil: { $gt: now } }),
      User.countDocuments({ emailVerified: { $ne: true } }),
      Game.estimatedDocumentCount(),
      Game.countDocuments({ endedAt: { $gte: dayAgo } }),
      Game.countDocuments({ endedAt: { $gte: weekAgo } }),
      ChatMessage.countDocuments({
        timestamp: { $gte: dayAgo },
        system: { $ne: true },
      }),
      User.find({
        $or: [{ bannedUntil: null }, { bannedUntil: { $lte: now } }],
      })
        .select("username level points stats")
        .sort({ points: -1 })
        .limit(5)
        .lean(),
      User.find()
        .select("username level createdAt")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      req.account!.role === "admin"
        ? AuditLog.find().sort({ createdAt: -1 }).limit(8).lean()
        : Promise.resolve([]),
    ]);

    const online = listOnlinePlayers();
    const rooms = listLiveRooms();

    return reply.send({
      players: { total: players, newToday, newWeek, banned, muted, unverified },
      live: {
        online: new Set(online.map((p) => p.userId)).size,
        inGame: online.filter((p) => p.status === "in-game").length,
        spectating: online.filter((p) => p.status === "spectating").length,
        roomsWaiting: rooms.filter((r) => r.status === "waiting").length,
        roomsPlaying: rooms.filter((r) => r.status !== "waiting").length,
      },
      games: { total: gamesTotal, today: gamesToday, week: gamesWeek },
      chat: { today: chatToday },
      topPlayers: topPlayers.map((u) => ({
        id: String(u._id),
        username: u.username,
        level: u.level ?? 1,
        points: u.points ?? 0,
        wins: u.stats?.wins ?? 0,
        totalGames: u.stats?.totalGames ?? 0,
      })),
      latestSignups: latestSignups.map((u) => ({
        id: String(u._id),
        username: u.username,
        level: u.level ?? 1,
        createdAt: u.createdAt,
      })),
      recentActions,
    });
  });

  app.get("/admin/games/live", moderator, async (_req, reply) => {
    return reply.send({ rooms: listLiveRooms(), online: listOnlinePlayers() });
  });

  app.post<{ Params: { roomId: string }; Body: { reason?: string } }>(
    "/admin/games/:roomId/close",
    {
      ...moderator,
      schema: {
        params: {
          type: "object",
          required: ["roomId"],
          additionalProperties: false,
          properties: { roomId: { type: "string", pattern: "^[A-Z0-9]{6,16}$" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: { reason: { type: "string", maxLength: 120 } },
        },
      },
    },
    async (req, reply) => {
      const io = getIO();
      if (!io) return reply.code(503).send({ error: "Serveur de jeu indisponible" });

      const { roomId } = req.params;
      const room = listLiveRooms().find((r) => r.roomId === roomId);
      const reason =
        req.body?.reason?.trim() || "Partie arrêtée par la modération";
      const result = closeRoomByAdmin(io, roomId, reason);
      if (result === "not-found")
        return reply.code(404).send({ error: "Cette partie n'existe plus" });
      if (result === "ending")
        return reply
          .code(409)
          .send({ error: "La partie est déjà en train de se terminer" });

      await recordAudit({
        action: "game-close",
        actorId: req.account!.id,
        actorUsername: req.account!.username,
        details: {
          roomId,
          reason,
          players: room?.players.map((p) => p.username) ?? [],
        },
        ip: req.ip,
      });
      return reply.send({ ok: true });
    },
  );

  app.get<{ Querystring: { username?: string; page?: number; limit?: number } }>(
    "/admin/games",
    {
      ...moderator,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            username: { type: "string", maxLength: 40 },
            page: { type: "integer", minimum: 1, maximum: 10_000 },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const { username, page = 1, limit = 25 } = req.query;
      const query = username?.trim()
        ? {
            "players.username": {
              $regex: `^${escapeRegex(username.trim())}`,
              $options: "i",
            },
          }
        : {};
      const [games, total] = await Promise.all([
        Game.find(query)
          .select("roomId players winner createdAt endedAt")
          .sort({ endedAt: -1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Game.countDocuments(query),
      ]);
      return reply.send({
        games: games.map((g) => serializeGame(g)),
        total,
        page,
        limit,
      });
    },
  );

  app.get<{ Querystring: { username?: string; limit?: number } }>(
    "/admin/chat",
    {
      ...moderator,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            username: { type: "string", maxLength: 40 },
            limit: { type: "integer", minimum: 1, maximum: 300 },
          },
        },
      },
    },
    async (req, reply) => {
      const { username, limit = 150 } = req.query;
      const query: Record<string, unknown> = {};
      if (username?.trim()) {
        query.username = {
          $regex: `^${escapeRegex(username.trim())}`,
          $options: "i",
        };
      }
      const messages = await ChatMessage.find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();
      return reply.send({
        messages: messages.map((m) => ({
          id: String(m._id),
          username: m.username,
          message: m.message,
          timestamp: m.timestamp,
          level: m.level ?? null,
          system: !!m.system,
          announcement: !!m.announcement,
        })),
      });
    },
  );

  app.post<{ Params: { messageId: string } }>(
    "/admin/chat/:messageId/delete",
    {
      ...moderator,
      schema: {
        params: {
          type: "object",
          required: ["messageId"],
          additionalProperties: false,
          properties: { messageId: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
        },
      },
    },
    async (req, reply) => {
      const message = await ChatMessage.findByIdAndDelete(
        req.params.messageId,
      ).lean();
      if (!message)
        return reply.code(404).send({ error: "Message déjà supprimé" });

      getIO()?.emit("chat:removed", { ids: [String(message._id)] });
      await recordAudit({
        action: "chat-delete",
        actorId: req.account!.id,
        actorUsername: req.account!.username,
        targetUsername: message.username,
        details: { message: message.message },
        ip: req.ip,
      });
      return reply.send({ ok: true });
    },
  );

  app.post<{ Body: { message: string } }>(
    "/admin/announce",
    {
      ...admin,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["message"],
          additionalProperties: false,
          properties: { message: { type: "string", maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const io = getIO();
      if (!io) return reply.code(503).send({ error: "Serveur de jeu indisponible" });
      const message = sanitizeChatMessage(req.body.message);
      if (!message) return reply.code(400).send({ error: "Message vide" });

      const id = await postAnnouncement(io, req.account!.username, message);
      await recordAudit({
        action: "announce",
        actorId: req.account!.id,
        actorUsername: req.account!.username,
        details: { message },
        ip: req.ip,
      });
      return reply.send({ id });
    },
  );
}
