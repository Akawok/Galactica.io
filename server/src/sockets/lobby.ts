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
import {
  BOT_DIFFICULTIES,
  type BotDifficulty,
  botShipFor,
  botStats,
} from "../services/bot.service.js";
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
// Counted apart from duels so practice games can never block real matches
const MAX_TRAINING_ROOMS = 100;

const EVENT_LIMITS: Record<string, { max: number; windowMs: number }> = {
  "user:join": { max: 5, windowMs: 10_000 },
  "user:updateLoadout": { max: 10, windowMs: 10_000 },
  "game:create": { max: 10, windowMs: 60_000 },
  "game:quickplay": { max: 10, windowMs: 60_000 },
  "game:rematch": { max: 20, windowMs: 60_000 },
  "game:challenge": { max: 10, windowMs: 60_000 },
  "game:challengeAnswer": { max: 20, windowMs: 60_000 },
  "game:challengeCancel": { max: 20, windowMs: 60_000 },
  "game:training": { max: 10, windowMs: 60_000 },
  "game:cancel": { max: 20, windowMs: 60_000 },
  "game:join": { max: 20, windowMs: 60_000 },
  "game:spectate": { max: 20, windowMs: 60_000 },
  "game:ready": { max: 30, windowMs: 60_000 },
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

// Training rooms hold a single real player: nobody can join or watch them
function publicRooms(): RoomState[] {
  return Array.from(rooms.values()).filter((r) => !r.training);
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

  const roomList = publicRooms().map((r) => {
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

// Puts the given players in a new waiting room; a disconnect before the match starts cancels it
function openRoom(
  io: Server,
  members: ConnectedPlayer[],
  opts: { training?: boolean } = {},
): RoomState {
  const roomId = generateRoomId();
  const room: RoomState = {
    roomId,
    players: new Map(),
    bullets: [],
    scores: new Map(),
    spectators: new Set(),
    status: "waiting",
    roundStartTime: 0,
    ownerUserId: members[0].userId,
    playerUserIds: new Set(members.map((m) => m.userId)),
    createdAt: Date.now(),
    waitingPlayers: members.map((m) => m.socketId),
    training: opts.training,
  };
  rooms.set(roomId, room);
  for (const member of members) {
    cancelChallengesOf(io, member.socketId);
    io.sockets.sockets.get(member.socketId)?.join(roomId);
    member.status = "in-game";
    member.currentRoomId = roomId;
  }
  return room;
}

function createDuelRoom(io: Server, socket: Socket, player: ConnectedPlayer) {
  if (publicRooms().length >= MAX_TOTAL_ROOMS) {
    socket.emit("game:error", { message: "Serveur saturé, réessaie plus tard" });
    return;
  }
  if (roomsOwnedBy(player.userId) >= MAX_ROOMS_PER_USER) {
    socket.emit("game:error", { message: "Tu as déjà une partie en attente" });
    return;
  }
  const { roomId } = openRoom(io, [player]);
  socket.emit("game:created", { roomId });
  broadcastLobbyState(io);
}

async function joinDuelRoom(
  io: Server,
  socket: Socket,
  player: ConnectedPlayer,
  room: RoomState,
) {
  const { roomId } = room;
  const waitingPlayers = room.waitingPlayers ?? [];
  if (room.status !== "waiting" || waitingPlayers.length >= 2) return;

  if (room.playerUserIds?.has(player.userId)) {
    socket.emit("game:error", {
      message: "Tu ne peux pas rejoindre ta propre partie",
    });
    return;
  }

  cancelChallengesOf(io, socket.id);
  waitingPlayers.push(socket.id);
  room.playerUserIds?.add(player.userId);
  room.waitingPlayers = waitingPlayers;
  socket.join(roomId);
  player.status = "in-game";
  player.currentRoomId = roomId;

  const abortJoin = (message: string) => {
    socket.emit("game:error", { message });
    // The creator would otherwise keep waiting on a room that no longer exists
    socket.to(roomId).emit("game:cancelled", { roomId });
    teardownRoom(io, room);
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
}

// After a finished match its players can ask to play again together, for a short while
const REMATCH_TTL_MS = 60_000;

interface RematchOffer {
  roomId: string;
  // Real players only, in their spawn order
  socketIds: string[];
  accepted: Set<string>;
  difficulty?: BotDifficulty;
  timer: ReturnType<typeof setTimeout>;
}

const rematchOffers = new Map<string, RematchOffer>();

export function openRematch(io: Server, room: RoomState) {
  const socketIds = Array.from(room.players.keys()).filter((id) => id !== room.bot?.id);
  rematchOffers.set(room.roomId, {
    roomId: room.roomId,
    socketIds,
    accepted: new Set(),
    difficulty: room.bot?.difficulty,
    timer: setTimeout(() => closeRematch(io, room.roomId, null), REMATCH_TTL_MS),
  });
}

// leaverSocketId is the player who left, named to the others; null when the offer expired
function closeRematch(io: Server, roomId: string, leaverSocketId: string | null) {
  const offer = rematchOffers.get(roomId);
  if (!offer) return;
  clearTimeout(offer.timer);
  rematchOffers.delete(roomId);
  const username = leaverSocketId
    ? (connectedPlayers.get(leaverSocketId)?.username ?? null)
    : null;
  for (const id of offer.socketIds) {
    if (id === leaverSocketId) continue;
    io.sockets.sockets.get(id)?.emit("game:rematchCancelled", { roomId, username });
  }
}

function cancelRematchesOf(io: Server, socketId: string) {
  for (const offer of Array.from(rematchOffers.values())) {
    if (offer.socketIds.includes(socketId)) closeRematch(io, offer.roomId, socketId);
  }
}

async function startRematch(io: Server, offer: RematchOffer, players: ConnectedPlayer[]) {
  await launchMatch(io, players, offer.difficulty, () => {
    for (const p of players) {
      io.sockets.sockets.get(p.socketId)?.emit("game:rematchCancelled", {
        roomId: offer.roomId,
        username: null,
      });
    }
  });
}

// Starts a match straight away between players who all agreed to it, against the bot when a
// difficulty is given
async function launchMatch(
  io: Server,
  players: ConnectedPlayer[],
  difficulty: BotDifficulty | undefined,
  onServerFull: () => void,
) {
  const full = difficulty
    ? rooms.size - publicRooms().length >= MAX_TRAINING_ROOMS
    : publicRooms().length >= MAX_TOTAL_ROOMS;
  if (full) {
    onServerFull();
    return;
  }

  const room = openRoom(io, players, { training: !!difficulty });
  const { roomId } = room;

  let profiles;
  try {
    profiles = await Promise.all(players.map((p) => loadPlayerStats(p.userId)));
  } catch (err) {
    console.error("[launchMatch] erreur chargement loadout:", err);
    io.to(roomId).emit("game:cancelled", { roomId });
    teardownRoom(io, room);
    return;
  }
  // A player who left meanwhile already cancelled the room
  if (rooms.get(roomId) !== room || room.status !== "waiting") return;

  const entries = players.map((p, i) => ({
    socket: io.sockets.sockets.get(p.socketId),
    player: { ...p, ...profiles[i] },
  }));
  if (entries.some((e) => !e.socket)) {
    io.to(roomId).emit("game:cancelled", { roomId });
    teardownRoom(io, room);
    return;
  }

  registerGameSocket(
    io,
    roomId,
    room,
    entries as { socket: Socket; player: (typeof entries)[number]["player"] }[],
    difficulty
      ? {
          difficulty,
          stats: botStats(profiles[0].stats, difficulty),
          level: profiles[0].level,
          sprite: botShipFor(players[0].activeShip),
        }
      : undefined,
  );
  broadcastLobbyState(io);
}

// A player can challenge an idle player directly; the duel starts once the target accepts
const CHALLENGE_TTL_MS = 30_000;

interface Challenge {
  id: string;
  fromSocketId: string;
  toSocketId: string;
  timer: ReturnType<typeof setTimeout>;
}

const challenges = new Map<string, Challenge>();

function findChallenge(predicate: (c: Challenge) => boolean): Challenge | undefined {
  for (const c of challenges.values()) if (predicate(c)) return c;
  return undefined;
}

// Both sides learn why the challenge is over: declined, cancelled, expired or unavailable
function endChallenge(io: Server, challenge: Challenge, reason: string) {
  clearTimeout(challenge.timer);
  challenges.delete(challenge.id);
  const from = connectedPlayers.get(challenge.fromSocketId)?.username ?? null;
  const to = connectedPlayers.get(challenge.toSocketId)?.username ?? null;
  for (const id of [challenge.fromSocketId, challenge.toSocketId]) {
    io.sockets.sockets.get(id)?.emit("game:challengeEnded", {
      id: challenge.id,
      reason,
      from,
      to,
    });
  }
}

function cancelChallengesOf(io: Server, socketId: string) {
  for (const c of Array.from(challenges.values())) {
    if (c.fromSocketId === socketId || c.toSocketId === socketId) endChallenge(io, c, "unavailable");
  }
}

// Single exit path for a room: stops its timers, frees every member and refreshes the lobby.
// The room object stays readable afterwards, so callers can still emit results or save the match.
export function teardownRoom(io: Server, room: RoomState) {
  cleanupRoomInputs(io, room);
  if (rooms.get(room.roomId) === room) rooms.delete(room.roomId);

  const members = new Set([
    ...(room.waitingPlayers ?? []),
    ...room.players.keys(),
    ...room.spectators,
  ]);
  for (const socketId of members) {
    const p = connectedPlayers.get(socketId);
    if (p && p.currentRoomId === room.roomId) {
      p.status = "idle";
      p.currentRoomId = undefined;
    }
    io.sockets.sockets.get(socketId)?.leave(room.roomId);
  }
  broadcastLobbyState(io);
}

async function handlePlayerLeave(io: Server, socketId: string, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  // A spectator leaving never affects the match
  if (room.spectators.delete(socketId)) {
    const spectator = connectedPlayers.get(socketId);
    if (spectator) {
      spectator.status = "idle";
      spectator.currentRoomId = undefined;
    }
    io.sockets.sockets.get(socketId)?.leave(roomId);
    broadcastLobbyState(io);
    return;
  }

  if (room.status === "waiting") {
    if ((room.waitingPlayers ?? []).includes(socketId)) {
      io.to(roomId).emit("game:cancelled", { roomId });
      teardownRoom(io, room);
    }
    return;
  }

  if (room.status !== "playing" && room.status !== "roundEnd") return;
  const leaverEntry = room.players.get(socketId);
  if (!leaverEntry) return;

  // Stopped synchronously, before any await, so the next-round timer cannot restart the loop
  room.status = "matchEnd";
  teardownRoom(io, room);
  if (room.training) return;

  const opponentEntry = Array.from(room.players.entries()).find(
    ([id]) => id !== socketId,
  );
  if (!opponentEntry) return;
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

  await saveGameRecord({
    roomId,
    players: Array.from(room.players.values()).map((p) => ({
      userId: p.userId,
      username: p.username,
      score: room.scores.get(p.id) ?? 0,
    })),
    winnerUserId: opponent.userId,
  });
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
  }).catch((err) => console.error("[chat] grade message not saved:", err));
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
    cancelRematchesOf(io, socket.id);
    // Coming back to the lobby means leaving any room this socket was still part of
    const previous = connectedPlayers.get(socket.id);
    if (previous?.currentRoomId) {
      await handlePlayerLeave(io, socket.id, previous.currentRoomId);
    }
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
    createDuelRoom(io, socket, player);
  });

  guard(socket, "game:challenge", (data: { socketId?: string }) => {
    const player = connectedPlayers.get(socket.id);
    const targetId = typeof data?.socketId === "string" ? data.socketId : null;
    const target = targetId ? connectedPlayers.get(targetId) : undefined;
    if (!player || player.status !== "idle" || !target || !targetId) return;
    if (target.userId === player.userId) return;
    if (target.status !== "idle") {
      socket.emit("game:error", { message: `${target.username} est déjà occupé` });
      return;
    }
    if (findChallenge((c) => c.fromSocketId === socket.id)) {
      socket.emit("game:error", { message: "Tu as déjà un défi en attente" });
      return;
    }
    if (findChallenge((c) => c.toSocketId === targetId || c.fromSocketId === targetId)) {
      socket.emit("game:error", { message: `${target.username} a déjà un défi en cours` });
      return;
    }

    const id = randomBytes(8).toString("hex");
    const challenge: Challenge = {
      id,
      fromSocketId: socket.id,
      toSocketId: targetId,
      timer: setTimeout(() => {
        const c = challenges.get(id);
        if (c) endChallenge(io, c, "expired");
      }, CHALLENGE_TTL_MS),
    };
    challenges.set(id, challenge);
    socket.emit("game:challengeSent", { id, to: target.username });
    io.sockets.sockets.get(targetId)?.emit("game:challenged", {
      id,
      from: player.username,
      level: player.level,
    });
  });

  guard(socket, "game:challengeCancel", (data: { id?: string }) => {
    const challenge = typeof data?.id === "string" ? challenges.get(data.id) : undefined;
    if (!challenge || challenge.fromSocketId !== socket.id) return;
    endChallenge(io, challenge, "cancelled");
  });

  guard(socket, "game:challengeAnswer", async (data: { id?: string; accept?: boolean }) => {
    const challenge = typeof data?.id === "string" ? challenges.get(data.id) : undefined;
    if (!challenge || challenge.toSocketId !== socket.id) return;
    if (data.accept !== true) {
      endChallenge(io, challenge, "declined");
      return;
    }
    const from = connectedPlayers.get(challenge.fromSocketId);
    const to = connectedPlayers.get(challenge.toSocketId);
    if (from?.status !== "idle" || to?.status !== "idle") {
      endChallenge(io, challenge, "unavailable");
      return;
    }
    clearTimeout(challenge.timer);
    challenges.delete(challenge.id);
    await launchMatch(io, [from, to], undefined, () => {
      for (const id of [challenge.fromSocketId, challenge.toSocketId]) {
        io.sockets.sockets.get(id)?.emit("game:error", {
          message: "Serveur saturé, réessaie plus tard",
        });
      }
    });
  });

  // Joins the oldest duel waiting for an opponent, or opens one when nobody is waiting
  guard(socket, "game:quickplay", async () => {
    const player = connectedPlayers.get(socket.id);
    if (!player || player.status !== "idle") return;
    const open = publicRooms()
      .filter(
        (r) =>
          r.status === "waiting" &&
          r.waitingPlayers?.length === 1 &&
          connectedPlayers.has(r.waitingPlayers[0]) &&
          !r.playerUserIds?.has(player.userId),
      )
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0];
    if (open) await joinDuelRoom(io, socket, player, open);
    else createDuelRoom(io, socket, player);
  });

  guard(socket, "game:training", async (data: { difficulty?: string }) => {
    const player = connectedPlayers.get(socket.id);
    if (!player || player.status !== "idle") return;
    const difficulty = BOT_DIFFICULTIES.find((d) => d === data?.difficulty);
    if (!difficulty) return;

    if (rooms.size - publicRooms().length >= MAX_TRAINING_ROOMS) {
      socket.emit("game:error", { message: "Serveur saturé, réessaie plus tard" });
      return;
    }

    const room = openRoom(io, [player], { training: true });
    const { roomId } = room;

    let profile;
    try {
      profile = await loadPlayerStats(player.userId);
    } catch (err) {
      console.error("[game:training] erreur chargement loadout:", err);
      socket.emit("game:error", { message: "Erreur serveur au lancement de l'entraînement" });
      teardownRoom(io, room);
      return;
    }
    if (rooms.get(roomId) !== room || room.status !== "waiting") return;

    // The bot starts from the player's own attributes, then its difficulty softens it
    registerGameSocket(
      io,
      roomId,
      room,
      [{ socket, player: { ...player, ...profile } }],
      {
        difficulty,
        stats: botStats(profile.stats, difficulty),
        level: profile.level,
        sprite: botShipFor(player.activeShip),
      },
    );
    broadcastLobbyState(io);
  });

  guard(socket, "game:cancel", (data: { roomId?: string }) => {
    const roomId = validRoomId(data?.roomId);
    if (!roomId) return;
    const player = connectedPlayers.get(socket.id);
    const room = rooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    if (!(room.waitingPlayers ?? []).includes(socket.id)) return;

    socket.emit("game:cancelled", { roomId });
    teardownRoom(io, room);
  });

  guard(socket, "game:join", async (data: { roomId?: string }) => {
    const roomId = validRoomId(data?.roomId);
    if (!roomId) return;
    const player = connectedPlayers.get(socket.id);
    const room = rooms.get(roomId);
    if (!player || !room || player.status !== "idle" || room.training) return;
    await joinDuelRoom(io, socket, player, room);
  });

  guard(socket, "game:rematch", async (data: { roomId?: string }) => {
    const roomId = validRoomId(data?.roomId);
    if (!roomId) return;
    const offer = rematchOffers.get(roomId);
    if (!offer) {
      // Expired: the button must not stay stuck on waiting
      socket.emit("game:rematchCancelled", { roomId, username: null });
      return;
    }
    if (!offer.socketIds.includes(socket.id)) return;

    const players = offer.socketIds.map((id) => connectedPlayers.get(id));
    const gone = offer.socketIds.find(
      (id, i) => players[i]?.status !== "idle" || !io.sockets.sockets.has(id),
    );
    if (gone) {
      closeRematch(io, roomId, gone);
      return;
    }

    offer.accepted.add(socket.id);
    if (offer.accepted.size < offer.socketIds.length) {
      for (const id of offer.socketIds) {
        if (id === socket.id) continue;
        io.sockets.sockets.get(id)?.emit("game:rematchOffered", {
          roomId,
          username: connectedPlayers.get(socket.id)?.username,
        });
      }
      return;
    }
    clearTimeout(offer.timer);
    rematchOffers.delete(roomId);
    await startRematch(io, offer, players as ConnectedPlayer[]);
  });

  guard(socket, "game:spectate", (data: { roomId?: string }) => {
    const roomId = validRoomId(data?.roomId);
    if (!roomId) return;
    const player = connectedPlayers.get(socket.id);
    const room = rooms.get(roomId);
    if (!player || !room || room.status === "matchEnd" || room.training) return;
    if (player.status !== "idle") return;
    if (room.playerUserIds?.has(player.userId)) return;

    socket.join(roomId);
    room.spectators.add(socket.id);
    player.status = "spectating";
    player.currentRoomId = roomId;

    socket.emit("game:spectating", { roomId });
    broadcastLobbyState(io);
  });

  // Sent by the game page once it listens: game:start may have gone out before it existed
  guard(socket, "game:ready", (data: { roomId?: string }) => {
    const roomId = validRoomId(data?.roomId);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (!room.spectators.has(socket.id) && !room.players.has(socket.id)) return;
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
    cancelRematchesOf(io, socket.id);
    cancelChallengesOf(io, socket.id);
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
    }).catch((err) => console.error("[chat] message not saved:", err));
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
            userId: p.id === r.bot?.id ? null : p.userId,
            username: p.username,
            level: p.level,
            score: r.scores.get(p.id) ?? 0,
          }));
    return {
      roomId: r.roomId,
      status: r.status,
      training: !!r.training,
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

  room.status = "matchEnd";
  io.to(roomId).emit("game:closed", { roomId, reason });
  teardownRoom(io, room);
  return "closed";
}

// A moderator action that disconnects a player must not count as a desertion
export function closeRoomsOfUser(io: Server, userId: string, reason: string) {
  for (const room of Array.from(rooms.values())) {
    if (room.playerUserIds?.has(userId)) closeRoomByAdmin(io, room.roomId, reason);
  }
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
