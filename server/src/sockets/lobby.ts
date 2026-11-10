import { randomBytes } from "crypto";
import mongoose from "mongoose";
import type { Server, Socket } from "socket.io";
import type { RoomState } from "../services/game.service.js";
import { loadPlayerStats } from "../services/game.service.js";
import { getGrade } from "../shared/grades.js";
import {
  registerGameSocket,
  cleanupRoomInputs,
  sendGameSnapshot,
} from "./game.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { User, isMuted } from "../models/User.js";
import { recordDesertion, saveGameRecord } from "../services/match.service.js";
import { sanitizeChatMessage } from "../services/identity.service.js";
import {
  disconnectUserSockets,
  socketCountForUser,
  trackSocket,
  untrackSocket,
} from "./registry.js";

interface ConnectedPlayer {
  socketId: string;
  userId: string;
  username: string;
  level: number;
  status: "idle" | "in-game" | "spectating";
  activeShip: string;
  activeBullet: string;
  activeBulletSecondary: string;
  currentRoomId?: string;
  lastChatAt?: number;
}

const CHAT_MIN_INTERVAL_MS = 750;
const MAX_ROOMS_PER_USER = 1;
const MAX_TOTAL_ROOMS = 500;

const EVENT_LIMITS: Record<string, { max: number; windowMs: number }> = {
  "user:join": { max: 5, windowMs: 10_000 },
  "user:updateLoadout": { max: 10, windowMs: 10_000 },
  "game:create": { max: 10, windowMs: 60_000 },
  "game:cancel": { max: 20, windowMs: 60_000 },
  "game:join": { max: 20, windowMs: 60_000 },
  "game:spectate": { max: 20, windowMs: 60_000 },
  "game:spectateReady": { max: 30, windowMs: 60_000 },
  "game:leave": { max: 30, windowMs: 60_000 },
  "chat:message": { max: 20, windowMs: 30_000 },
};

const eventCounters = new Map<string, Map<string, { n: number; reset: number }>>();

function allowEvent(socketId: string, event: string): boolean {
  const limit = EVENT_LIMITS[event];
  if (!limit) return true;

  let perSocket = eventCounters.get(socketId);
  if (!perSocket) {
    perSocket = new Map();
    eventCounters.set(socketId, perSocket);
  }

  const now = Date.now();
  const entry = perSocket.get(event);
  if (!entry || entry.reset <= now) {
    perSocket.set(event, { n: 1, reset: now + limit.windowMs });
    return true;
  }
  if (entry.n >= limit.max) return false;
  entry.n++;
  return true;
}

function clearEventCounters(socketId: string) {
  eventCounters.delete(socketId);
}

function guard<T extends unknown[]>(
  socket: Socket,
  event: string,
  handler: (...args: T) => void | Promise<void>,
) {
  socket.on(event, (...args: T) => {
    if (!allowEvent(socket.id, event)) return;
    try {
      const result = handler(...args);
      if (result instanceof Promise) {
        result.catch((err) => console.error(`[${event}] erreur:`, err));
      }
    } catch (err) {
      console.error(`[${event}] erreur:`, err);
    }
  });
}

const connectedPlayers = new Map<string, ConnectedPlayer>();
export const rooms = new Map<string, RoomState>();

function roomsOwnedBy(userId: string): number {
  let count = 0;
  for (const room of rooms.values()) {
    if (room.ownerUserId === userId) count++;
  }
  return count;
}

let pendingBroadcast: NodeJS.Immediate | null = null;
function broadcastLobbyState(io: Server) {
  if (pendingBroadcast) return;
  pendingBroadcast = setImmediate(() => {
    pendingBroadcast = null;
    doBroadcastLobbyState(io);
  });
}

function doBroadcastLobbyState(io: Server) {
  const players = Array.from(connectedPlayers.values()).map(
    ({ socketId, username, level, status }) => ({
      socketId,
      username,
      level,
      status,
    }),
  );

  const roomList = Array.from(rooms.values()).map((r) => {
    const waitingUsernames = (r.waitingPlayers ?? [])
      .map((id) => connectedPlayers.get(id)?.username)
      .filter(Boolean) as string[];
    const playingUsernames = Array.from(r.players.values()).map(
      (p) => p.username,
    );
    const usernames =
      r.status === "waiting" ? waitingUsernames : playingUsernames;
    return {
      roomId: r.roomId,
      players: usernames.map((username) => ({ username })),
      spectatorCount: r.spectators.size,
      status: r.status,
    };
  });

  io.emit("lobby:state", { players, rooms: roomList });
}

const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRoomId(): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = randomBytes(6);
    let id = "";
    for (const byte of bytes) id += ROOM_ID_ALPHABET[byte % 32];
    if (!rooms.has(id)) return id;
  }
  return randomBytes(8).toString("hex").toUpperCase();
}

async function handlePlayerLeave(io: Server, socketId: string, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const player = connectedPlayers.get(socketId);

  if (room.status === "waiting") {
    const waitingPlayers = room.waitingPlayers ?? [];
    if (waitingPlayers.includes(socketId)) {
      rooms.delete(roomId);
      if (player) player.status = "idle";
      io.to(roomId).emit("game:cancelled", { roomId });
    }
    return;
  }

  if (room.status === "playing" || room.status === "roundEnd") {
    room.status = "matchEnd";
    if (room.intervalId) clearInterval(room.intervalId);

    const opponentEntry = Array.from(room.players.entries()).find(
      ([id]) => id !== socketId,
    );
    const leaverEntry = room.players.get(socketId);

    if (opponentEntry && leaverEntry) {
      const [opponentSocketId, opponent] = opponentEntry;

      const desertion = await recordDesertion({
        deserter: { userId: leaverEntry.userId },
        opponent: { userId: opponent.userId },
      });

      io.sockets.sockets.get(opponentSocketId)?.emit("game:abandoned", {
        deserter: leaverEntry.username,
        creditsRecovered: desertion?.penalty ?? 0,
        newPoints: desertion?.opponentPoints ?? null,
      });
      for (const spectatorId of room.spectators) {
        io.sockets.sockets.get(spectatorId)?.emit("game:abandoned", {
          deserter: leaverEntry.username,
          creditsRecovered: 0,
          newPoints: null,
        });
      }

      const allPlayers = Array.from(room.players.values());
      await saveGameRecord({
        roomId,
        players: allPlayers.map((p) => ({
          userId: p.userId,
          username: p.username,
          score: room.scores.get(p.id) ?? 0,
        })),
        winnerUserId: opponent.userId,
      });
    }

    cleanupRoomInputs(io, room);
    if (player) player.status = "idle";
    rooms.delete(roomId);
    return;
  }

  if (room.spectators.has(socketId)) {
    room.spectators.delete(socketId);
    if (player) player.status = "idle";
  }
}

// Keeps the lobby list in sync after a match and tells everyone when someone reaches a new grade
export function announceLevelChange(
  io: Server,
  userId: string,
  username: string,
  oldLevel: number,
  newLevel: number,
) {
  for (const p of connectedPlayers.values()) {
    if (p.userId === userId) p.level = newLevel;
  }
  broadcastLobbyState(io);

  const grade = getGrade(newLevel);
  if (grade.label === getGrade(oldLevel).label) return;
  const now = Date.now();
  const message = `${username} passe ${grade.label} !`;
  const _id = new mongoose.Types.ObjectId();
  ChatMessage.create({
    _id,
    username,
    message,
    timestamp: new Date(now),
    level: newLevel,
    system: true,
  }).catch(() => {});
  io.emit("chat:message", {
    id: String(_id),
    username,
    message,
    timestamp: now,
    level: newLevel,
    system: true,
  });
}

export function registerLobbySocket(io: Server, socket: Socket) {
  const userId = socket.data.userId as string | undefined;
  if (!userId) {
    socket.disconnect(true);
    return;
  }

  if (socketCountForUser(userId) > 0) {
    disconnectUserSockets(userId, "Connexion depuis un autre appareil");
  }
  trackSocket(socket, userId);

  guard(socket, "user:join", async () => {
    const user = await User.findById(userId)
      .select("username level activeShip activeBullet activeBulletSecondary")
      .lean();
    if (!user) return;
    connectedPlayers.set(socket.id, {
      socketId: socket.id,
      userId,
      username: user.username,
      level: user.level ?? 1,
      status: "idle",
      activeShip: user.activeShip ?? "spaceship-01",
      activeBullet: user.activeBullet ?? "bullet1",
      activeBulletSecondary: user.activeBulletSecondary ?? "bullet1",
    });
    broadcastLobbyState(io);
  });

  guard(socket, "game:create", () => {
    const player = connectedPlayers.get(socket.id);
    if (!player || player.status !== "idle") return;

    if (rooms.size >= MAX_TOTAL_ROOMS) {
      socket.emit("game:error", { message: "Serveur saturé, réessaie plus tard" });
      return;
    }
    if (roomsOwnedBy(player.userId) >= MAX_ROOMS_PER_USER) {
      socket.emit("game:error", { message: "Tu as déjà une partie en attente" });
      return;
    }

    const roomId = generateRoomId();
    const room: RoomState = {
      roomId,
      players: new Map(),
      bullets: [],
      scores: new Map(),
      spectators: new Set(),
      status: "waiting",
      roundStartTime: 0,
      ownerUserId: player.userId,
      playerUserIds: new Set([player.userId]),
      createdAt: Date.now(),
    };

    room.waitingPlayers = [socket.id];

    rooms.set(roomId, room);
    socket.join(roomId);
    player.status = "in-game";
    player.currentRoomId = roomId;

    socket.emit("game:created", { roomId });
    broadcastLobbyState(io);
  });

  guard(socket, "game:cancel", (data: { roomId?: string }) => {
    const roomId = validRoomId(data?.roomId);
    if (!roomId) return;
    const player = connectedPlayers.get(socket.id);
    const room = rooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    if (!(room.waitingPlayers ?? []).includes(socket.id)) return;

    rooms.delete(roomId);
    socket.leave(roomId);
    if (player) player.status = "idle";
    socket.emit("game:cancelled", { roomId });
    broadcastLobbyState(io);
  });

  guard(socket, "game:join", async (data: { roomId?: string }) => {
    const roomId = validRoomId(data?.roomId);
    if (!roomId) return;
    const player = connectedPlayers.get(socket.id);
    const room = rooms.get(roomId);
    if (!player || !room || player.status !== "idle") return;

    const waitingPlayers = room.waitingPlayers ?? [];
    if (room.status !== "waiting" || waitingPlayers.length >= 2) return;

    if (room.playerUserIds?.has(player.userId)) {
      socket.emit("game:error", {
        message: "Tu ne peux pas rejoindre ta propre partie",
      });
      return;
    }

    waitingPlayers.push(socket.id);
    room.playerUserIds?.add(player.userId);
    room.waitingPlayers = waitingPlayers;
    socket.join(roomId);
    player.status = "in-game";
    player.currentRoomId = roomId;

    const abortJoin = (message: string) => {
      socket.emit("game:error", { message });
      socket.leave(roomId);
      player.status = "idle";
      player.currentRoomId = undefined;
      room.playerUserIds?.delete(player.userId);
      rooms.delete(roomId);
      broadcastLobbyState(io);
    };

    const player1SocketId = waitingPlayers[0];
    const player1Socket = io.sockets.sockets.get(player1SocketId);
    const player1 = connectedPlayers.get(player1SocketId);

    if (!player1Socket || !player1) {
      abortJoin("Le créateur de la partie s'est déconnecté");
      return;
    }

    let profile1, profile2;
    try {
      [profile1, profile2] = await Promise.all([
        loadPlayerStats(player1.userId),
        loadPlayerStats(player.userId),
      ]);
    } catch (err) {
      console.error("[game:join] erreur chargement loadout:", err);
      abortJoin("Erreur serveur au lancement de la partie");
      return;
    }

    if (!rooms.has(roomId) || room.status !== "waiting") {
      abortJoin("La partie n'est plus disponible");
      return;
    }

    registerGameSocket(io, roomId, room, [
      { socket: player1Socket, player: { ...player1, ...profile1 } },
      { socket, player: { ...player, ...profile2 } },
    ]);

    broadcastLobbyState(io);
  });

  guard(socket, "game:spectate", (data: { roomId?: string }) => {
    const roomId = validRoomId(data?.roomId);
    if (!roomId) return;
    const player = connectedPlayers.get(socket.id);
    const room = rooms.get(roomId);
    if (!player || !room || room.status === "matchEnd") return;
    if (player.status !== "idle") return;
    if (room.playerUserIds?.has(player.userId)) return;

    socket.join(roomId);
    room.spectators.add(socket.id);
    player.status = "spectating";
    player.currentRoomId = roomId;

    socket.emit("game:spectating", { roomId });
    broadcastLobbyState(io);
  });

  guard(socket, "game:spectateReady", (data: { roomId?: string }) => {
    const roomId = validRoomId(data?.roomId);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || !room.spectators.has(socket.id)) return;
    if (room.status !== "playing" && room.status !== "roundEnd") return;
    sendGameSnapshot(socket, room);
  });

  guard(socket, "game:leave", (data: { roomId?: string }) => {
    const roomId = validRoomId(data?.roomId);
    if (!roomId) return;
    const player = connectedPlayers.get(socket.id);
    if (player?.currentRoomId !== roomId) return;
    return handlePlayerLeave(io, socket.id, roomId);
  });

  socket.on("disconnect", () => {
    const player = connectedPlayers.get(socket.id);
    if (player) {
      if (player.currentRoomId)
        handlePlayerLeave(io, socket.id, player.currentRoomId).catch((err) =>
          console.error("[disconnect] erreur:", err),
        );
      connectedPlayers.delete(socket.id);
    }
    untrackSocket(socket, userId);
    clearEventCounters(socket.id);
    broadcastLobbyState(io);
  });

  guard(socket, "user:updateLoadout", async () => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;
    if (player.status !== "idle") return;

    const user = await User.findById(player.userId)
      .select("activeShip activeBullet activeBulletSecondary")
      .lean();
    if (!user) return;
    player.activeShip = user.activeShip ?? player.activeShip;
    player.activeBullet = user.activeBullet ?? player.activeBullet;
    player.activeBulletSecondary =
      user.activeBulletSecondary ?? player.activeBulletSecondary;
  });

  guard(socket, "chat:message", async (data: { message?: string }) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    const sanitized = sanitizeChatMessage(data?.message);
    if (!sanitized) return;

    const now = Date.now();
    if (player.lastChatAt && now - player.lastChatAt < CHAT_MIN_INTERVAL_MS)
      return;
    player.lastChatAt = now;

    const account = await User.findById(player.userId)
      .select("mutedUntil level")
      .lean();
    if (account && isMuted(account)) {
      socket.emit("chat:blocked", { reason: "Tu es réduit au silence" });
      return;
    }
    if (account?.level) player.level = account.level;

    // The id is chosen here so moderators can delete the message from every open chat
    const _id = new mongoose.Types.ObjectId();
    ChatMessage.create({
      _id,
      username: player.username,
      message: sanitized,
      timestamp: new Date(now),
      level: player.level,
    }).catch(() => {});
    io.emit("chat:message", {
      id: String(_id),
      username: player.username,
      message: sanitized,
      timestamp: now,
      level: player.level,
    });
  });
}

export interface OnlinePlayerView {
  userId: string;
  username: string;
  level: number;
  status: ConnectedPlayer["status"];
  roomId: string | null;
}

export function listOnlinePlayers(): OnlinePlayerView[] {
  return Array.from(connectedPlayers.values()).map((p) => ({
    userId: p.userId,
    username: p.username,
    level: p.level,
    status: p.status,
    roomId:
      p.currentRoomId && rooms.has(p.currentRoomId) ? p.currentRoomId : null,
  }));
}

export function findOnlinePlayer(userId: string): OnlinePlayerView | null {
  return listOnlinePlayers().find((p) => p.userId === userId) ?? null;
}

export function listLiveRooms() {
  return Array.from(rooms.values()).map((r) => {
    const players =
      r.status === "waiting"
        ? (r.waitingPlayers ?? [])
            .map((id) => connectedPlayers.get(id))
            .filter((p): p is ConnectedPlayer => !!p)
            .map((p) => ({
              userId: p.userId,
              username: p.username,
              level: p.level,
              score: 0,
            }))
        : Array.from(r.players.values()).map((p) => ({
            userId: p.userId,
            username: p.username,
            level: p.level,
            score: r.scores.get(p.id) ?? 0,
          }));
    return {
      roomId: r.roomId,
      status: r.status,
      players,
      spectatorCount: r.spectators.size,
      createdAt: r.createdAt ?? null,
    };
  });
}

export type CloseRoomResult = "closed" | "not-found" | "ending";

// Nobody wins and nothing is saved: no rewards, no desertion penalty
export function closeRoomByAdmin(
  io: Server,
  roomId: string,
  reason: string,
): CloseRoomResult {
  const room = rooms.get(roomId);
  if (!room) return "not-found";
  // Rewards are already being written, cutting now would leave a half-saved match
  if (room.status === "matchEnd") return "ending";

  if (room.intervalId) clearInterval(room.intervalId);
  room.status = "matchEnd";
  cleanupRoomInputs(io, room);
  rooms.delete(roomId);

  io.to(roomId).emit("game:closed", { roomId, reason });

  const members = new Set([
    ...(room.waitingPlayers ?? []),
    ...room.players.keys(),
    ...room.spectators,
  ]);
  for (const socketId of members) {
    const p = connectedPlayers.get(socketId);
    if (p && p.currentRoomId === roomId) {
      p.status = "idle";
      p.currentRoomId = undefined;
    }
    io.sockets.sockets.get(socketId)?.leave(roomId);
  }
  broadcastLobbyState(io);
  return "closed";
}

export async function postAnnouncement(
  io: Server,
  author: string,
  message: string,
): Promise<string> {
  const now = Date.now();
  const doc = await ChatMessage.create({
    username: author,
    message,
    timestamp: new Date(now),
    system: true,
    announcement: true,
  });
  const id = String(doc._id);
  io.emit("chat:message", {
    id,
    username: author,
    message,
    timestamp: now,
    system: true,
    announcement: true,
  });
  return id;
}

function validRoomId(raw: unknown): string | null {
  return typeof raw === "string" && /^[A-Z0-9]{6,16}$/.test(raw) ? raw : null;
}
