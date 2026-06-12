import type { Server, Socket } from "socket.io";
import type { RoomState } from "../services/game.service.js";
import { loadLoadoutStats } from "../services/game.service.js";
import {
  registerGameSocket,
  cleanupRoomInputs,
  sendGameSnapshot,
} from "./game.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { User } from "../models/User.js";
import { recordDesertion, saveGameRecord } from "../services/match.service.js";

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

    if (opponentEntry && leaverEntry) {
      const [opponentSocketId, opponent] = opponentEntry;

      // Désertion : pénalité croissante de crédits transférée à l'adversaire.
      // Pas de victoire comptée pour l'adversaire, pas d'XP pour personne ;
      // le déserteur prend défaite + désertion + série remise à zéro.
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

export function registerLobbySocket(io: Server, socket: Socket) {
  // Enregistrement du joueur dans le lobby. L'identité vient du JWT vérifié au
  // handshake (socket.data) et le loadout de la DB — on n'accepte RIEN du client
  // ici, sinon n'importe qui pourrait usurper un compte ou équiper des items non possédés.
  socket.on("user:join", async () => {
    const userId = socket.data.userId as string | undefined;
    if (!userId) return;
    try {
      const user = await User.findById(userId)
        .select("username activeShip activeBullet activeBulletSecondary")
        .lean();
      if (!user) return;
      connectedPlayers.set(socket.id, {
        socketId: socket.id,
        userId,
        username: user.username,
        status: "idle",
        activeShip: user.activeShip ?? "spaceship-01",
        activeBullet: user.activeBullet ?? "bullet1",
        activeBulletSecondary: user.activeBulletSecondary ?? "bullet1",
      });
      broadcastLobbyState(io);
    } catch (err) {
      console.error("[user:join] erreur:", err);
    }
  });

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
  socket.on("game:cancel", (data: { roomId?: string }) => {
    if (typeof data?.roomId !== "string") return;
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
  socket.on("game:join", async (data: { roomId?: string }) => {
    if (typeof data?.roomId !== "string") return;
    const roomId = data.roomId;
    const player = connectedPlayers.get(socket.id);
    const room = rooms.get(roomId);
    if (!player || !room || player.status !== "idle") return;

    const waitingPlayers = room.waitingPlayers ?? [];
    if (room.status !== "waiting" || waitingPlayers.length >= 2) return;

    // Réserve la place de façon SYNCHRONE : le chargement des stats ci-dessous
    // est async, sans ça deux joueurs pourraient rejoindre la même room.
    waitingPlayers.push(socket.id);
    room.waitingPlayers = waitingPlayers;
    socket.join(roomId);
    player.status = "in-game";
    player.currentRoomId = roomId;

    const abortJoin = (message: string) => {
      socket.emit("game:error", { message });
      socket.leave(roomId);
      player.status = "idle";
      player.currentRoomId = undefined;
      rooms.delete(roomId);
      broadcastLobbyState(io);
    };

    const player1SocketId = waitingPlayers[0];
    const player1Socket = io.sockets.sockets.get(player1SocketId);
    const player1 = connectedPlayers.get(player1SocketId);

    if (!player1Socket || !player1) {
      // Le créateur s'est déconnecté entre temps
      abortJoin("Le créateur de la partie s'est déconnecté");
      return;
    }

    // Stats effectives des deux loadouts, lues en DB (jamais fournies par le client)
    let stats1, stats2;
    try {
      [stats1, stats2] = await Promise.all([
        loadLoadoutStats(
          player1.activeShip,
          player1.activeBullet,
          player1.activeBulletSecondary,
        ),
        loadLoadoutStats(
          player.activeShip,
          player.activeBullet,
          player.activeBulletSecondary,
        ),
      ]);
    } catch (err) {
      console.error("[game:join] erreur chargement loadout:", err);
      abortJoin("Erreur serveur au lancement de la partie");
      return;
    }

    // La room a pu disparaître pendant l'await (déco du créateur)
    if (!rooms.has(roomId) || room.status !== "waiting") {
      abortJoin("La partie n'est plus disponible");
      return;
    }

    // Démarre la partie avec les 2 joueurs
    registerGameSocket(io, roomId, room, [
      { socket: player1Socket, player: { ...player1, stats: stats1 } },
      { socket, player: { ...player, stats: stats2 } },
    ]);

    broadcastLobbyState(io);
  });

  // Rejoindre en spectateur
  socket.on("game:spectate", (data: { roomId?: string }) => {
    if (typeof data?.roomId !== "string") return;
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

  // Le spectateur a monté la page de jeu : s'il arrive en cours de match,
  // on lui envoie un snapshot complet (sinon il resterait sur un écran vide
  // car game:start n'est diffusé qu'au lancement de la partie).
  socket.on("game:spectateReady", (data: { roomId?: string }) => {
    if (typeof data?.roomId !== "string") return;
    const room = rooms.get(data.roomId);
    if (!room || !room.spectators.has(socket.id)) return;
    if (room.status !== "playing" && room.status !== "roundEnd") return;
    sendGameSnapshot(socket, room);
  });

  // Abandon volontaire d'une partie en cours (navigation hors de la page game)
  socket.on("game:leave", (data: { roomId?: string }) => {
    if (typeof data?.roomId !== "string") return;
    handlePlayerLeave(io, socket.id, data.roomId).catch((err) =>
      console.error("[game:leave] erreur:", err),
    );
  });

  // Déconnexion
  socket.on("disconnect", () => {
    const player = connectedPlayers.get(socket.id);
    if (player) {
      if (player.currentRoomId)
        handlePlayerLeave(io, socket.id, player.currentRoomId).catch((err) =>
          console.error("[disconnect] erreur:", err),
        );
      connectedPlayers.delete(socket.id);
    }
    broadcastLobbyState(io);
  });

  // Le loadout actif est relu depuis la DB (mis à jour par /shop/equip qui, lui,
  // vérifie la possession) — on ne fait pas confiance au payload du client.
  socket.on("user:updateLoadout", async () => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;
    try {
      const user = await User.findById(player.userId)
        .select("activeShip activeBullet activeBulletSecondary")
        .lean();
      if (!user) return;
      player.activeShip = user.activeShip ?? player.activeShip;
      player.activeBullet = user.activeBullet ?? player.activeBullet;
      player.activeBulletSecondary =
        user.activeBulletSecondary ?? player.activeBulletSecondary;
    } catch (err) {
      console.error("[user:updateLoadout] erreur:", err);
    }
  });

  socket.on("chat:message", async (data: { message?: string }) => {
    const player = connectedPlayers.get(socket.id);
    if (!player || typeof data?.message !== "string" || !data.message.trim())
      return;

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
