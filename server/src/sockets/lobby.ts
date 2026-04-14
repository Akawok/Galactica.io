import type { Server, Socket } from "socket.io";
import type { RoomState } from "../services/game.service.js";
import { GAME_CONFIG } from "../services/game.service.js";
import { registerGameSocket, cleanupRoomInputs } from "./game.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { recordMatchResult, saveGameRecord } from "../services/match.service.js";

interface ConnectedPlayer {
  socketId: string;
  userId: string;
  username: string;
  status: "idle" | "in-game" | "spectating";
  activeShip: string;
  activeBullet: string;
  activeBulletSecondary: string;
  currentRoomId?: string;
  lastChatAt?: number;
}

const CHAT_MIN_INTERVAL_MS = 750;

// État global du lobby (en mémoire)
const connectedPlayers = new Map<string, ConnectedPlayer>(); // socketId → player
export const rooms = new Map<string, RoomState>(); // roomId → room

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
    ({ socketId, username, status }) => ({
      socketId,
      username,
      status,
    }),
  );

  const roomList = Array.from(rooms.values()).map((r) => {
    // En phase waiting, les joueurs sont dans waitingPlayers (pas encore dans room.players)
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

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function handlePlayerLeave(io: Server, socketId: string, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const player = connectedPlayers.get(socketId);

  // Cas 1 : le joueur était en attente (room pas encore lancée)
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

    if (opponentEntry) {
      const [opponentSocketId, opponent] = opponentEntry;

      const results = await recordMatchResult({
        winner: { socketId: opponentSocketId, userId: opponent.userId },
        loser: leaverEntry
          ? { socketId, userId: leaverEntry.userId }
          : undefined,
        awardXP: false,
      });

      const winnerResult = results.get(opponentSocketId);
      io.sockets.sockets.get(opponentSocketId)?.emit("game:matchEnd", {
        winner: { id: opponentSocketId, username: opponent.username },
        scores: Object.fromEntries(room.scores),
        pointsEarned: GAME_CONFIG.POINTS_PER_WIN,
        newPoints: winnerResult?.points ?? null,
      });

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

      io.to(roomId).emit("game:abandoned", { username: opponent.username });
    }

    cleanupRoomInputs(room);
    if (player) player.status = "idle";
    rooms.delete(roomId);
    return;
  }

  if (room.spectators.has(socketId)) {
    room.spectators.delete(socketId);
    if (player) player.status = "idle";
  }
}

export function registerLobbySocket(io: Server, socket: Socket) {
  // Authentification du joueur à la connexion socket
  socket.on(
    "user:join",
    (data: {
      userId: string;
      username: string;
      activeShip: string;
      activeBullet: string;
      activeBulletSecondary: string;
    }) => {
      connectedPlayers.set(socket.id, {
        socketId: socket.id,
        userId: data.userId,
        username: data.username,
        status: "idle",
        activeShip: data.activeShip ?? "ship1",
        activeBullet: data.activeBullet ?? "bullet1",
        activeBulletSecondary: data.activeBulletSecondary ?? "bullet3",
      });
      broadcastLobbyState(io);
    },
  );

  // Créer une nouvelle room
  socket.on("game:create", () => {
    const player = connectedPlayers.get(socket.id);
    if (!player || player.status !== "idle") return;

    const roomId = generateRoomId();
    const room: RoomState = {
      roomId,
      players: new Map(),
      bullets: [],
      scores: new Map(),
      spectators: new Set(),
      status: "waiting",
      roundStartTime: 0,
    };

    // Stocke le créateur comme participant en attente
    room.waitingPlayers = [socket.id];

    rooms.set(roomId, room);
    socket.join(roomId);
    player.status = "in-game";
    player.currentRoomId = roomId;

    socket.emit("game:created", { roomId });
    broadcastLobbyState(io);
  });

  // Annuler une room en attente
  socket.on("game:cancel", (data: { roomId: string }) => {
    const player = connectedPlayers.get(socket.id);
    const room = rooms.get(data.roomId);
    if (!room || room.status !== "waiting") return;
    if (!(room.waitingPlayers ?? []).includes(socket.id)) return;

    rooms.delete(data.roomId);
    socket.leave(data.roomId);
    if (player) player.status = "idle";
    socket.emit("game:cancelled", { roomId: data.roomId });
    broadcastLobbyState(io);
  });

  // Rejoindre une room existante
  socket.on("game:join", (data: { roomId: string }) => {
    const player = connectedPlayers.get(socket.id);
    const room = rooms.get(data.roomId);
    if (!player || !room || player.status !== "idle") return;

    const waitingPlayers = room.waitingPlayers ?? [];
    if (room.status !== "waiting" || waitingPlayers.length >= 2) return;

    socket.join(data.roomId);
    player.status = "in-game";
    player.currentRoomId = data.roomId;

    const player1SocketId = waitingPlayers[0];
    const player1Socket = io.sockets.sockets.get(player1SocketId);
    const player1 = connectedPlayers.get(player1SocketId);

    if (!player1Socket || !player1) {
      // Le créateur s'est déconnecté entre temps
      socket.emit("game:error", {
        message: "Le créateur de la partie s'est déconnecté",
      });
      player.status = "idle";
      rooms.delete(data.roomId);
      broadcastLobbyState(io);
      return;
    }

    // Démarre la partie avec les 2 joueurs
    registerGameSocket(io, data.roomId, room, [
      { socket: player1Socket, player: player1 },
      { socket, player },
    ]);

    broadcastLobbyState(io);
  });

  // Rejoindre en spectateur
  socket.on("game:spectate", (data: { roomId: string }) => {
    const player = connectedPlayers.get(socket.id);
    const room = rooms.get(data.roomId);
    if (!player || !room || room.status === "matchEnd") return;

    socket.join(data.roomId);
    room.spectators.add(socket.id);
    player.status = "spectating";
    player.currentRoomId = data.roomId;

    socket.emit("game:spectating", { roomId: data.roomId });
    broadcastLobbyState(io);
  });

  // Abandon volontaire d'une partie en cours (navigation hors de la page game)
  socket.on("game:leave", (data: { roomId: string }) => {
    handlePlayerLeave(io, socket.id, data.roomId);
  });

  // Déconnexion
  socket.on("disconnect", () => {
    const player = connectedPlayers.get(socket.id);
    if (player) {
      if (player.currentRoomId)
        handlePlayerLeave(io, socket.id, player.currentRoomId);
      connectedPlayers.delete(socket.id);
    }
    broadcastLobbyState(io);
  });

  socket.on("chat:message", async (data: { message: string }) => {
    const player = connectedPlayers.get(socket.id);
    if (!player || !data.message?.trim()) return;

    const now = Date.now();
    if (player.lastChatAt && now - player.lastChatAt < CHAT_MIN_INTERVAL_MS) return;
    player.lastChatAt = now;

    const sanitized = data.message.trim().slice(0, 200);
    // TTL 24h géré côté MongoDB
    ChatMessage.create({
      username: player.username,
      message: sanitized,
      timestamp: new Date(now),
    }).catch(() => {});
    io.emit("chat:message", {
      username: player.username,
      message: sanitized,
      timestamp: now,
    });
  });
}
