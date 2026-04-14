import type { Server, Socket } from "socket.io";
import type { RoomState, PlayerState } from "../services/game.service.js";
import {
  GAME_CONFIG,
  createPlayerState,
  applyInput,
  moveBullets,
  resolveCollisions,
  getSpawnPosition,
} from "../services/game.service.js";
import { recordMatchResult, saveGameRecord } from "../services/match.service.js";
import { rooms } from "./lobby.js";

interface PlayerEntry {
  socket: Socket;
  player: {
    userId: string;
    username: string;
    activeShip: string;
    activeBullet: string;
    activeBulletSecondary: string;
  };
}

interface ClientInput {
  seq: number;
  keys: string[];
  mouseAngle: number;
  leftClick: boolean;
  rightClick: boolean;
}

const MAX_QUEUE_PER_TICK = 8; // garde-fou anti-spam

const inputQueues = new Map<string, ClientInput[]>();
const lastSeenSeq = new Map<string, number>();
const lastProcessedSeq = new Map<string, number>();

function resetRound(room: RoomState) {
  room.bullets = [];
  room.lastSent?.clear();
  let index = 0;
  for (const [, player] of room.players) {
    const pos = getSpawnPosition(index);
    player.x = pos.x;
    player.y = pos.y;
    player.hp = GAME_CONFIG.MAX_HP;
    player.energy = GAME_CONFIG.MAX_ENERGY;
    player.angle = index === 0 ? 0 : Math.PI;
    index++;
  }
}

export function registerGameSocket(
  io: Server,
  roomId: string,
  room: RoomState,
  entries: PlayerEntry[],
) {
  room.status = "playing";
  room.roundStartTime = Date.now();

  entries.forEach((entry, index) => {
    const state = createPlayerState(
      entry.socket.id,
      entry.player.userId,
      entry.player.username,
      index,
      entry.player.activeShip,
      entry.player.activeBullet,
      entry.player.activeBulletSecondary,
    );
    room.players.set(entry.socket.id, state);
    room.scores.set(entry.socket.id, 0);
    inputQueues.set(entry.socket.id, []);
    lastSeenSeq.set(entry.socket.id, -1);
    lastProcessedSeq.set(entry.socket.id, 0);
  });

  for (const entry of entries) {
    entry.socket.on("game:input", (input: ClientInput) => {
      if (typeof input?.seq !== "number") return;
      const lastSeen = lastSeenSeq.get(entry.socket.id) ?? -1;
      if (input.seq <= lastSeen) return; // doublon ou retard
      lastSeenSeq.set(entry.socket.id, input.seq);
      const queue = inputQueues.get(entry.socket.id);
      if (queue) queue.push(input);
    });
  }

  io.to(roomId).emit("game:navigate", { roomId });

  // 500ms delay so clients have time to mount the game page before game:start arrives
  setTimeout(() => {
    io.to(roomId).emit("game:start", {
      roomId,
      players: Array.from(room.players.values()).map(
        ({
          id,
          username,
          x,
          y,
          angle,
          hp,
          energy,
          sprite,
          bulletSprite,
          bulletSpriteSecondary,
        }) => ({
          id,
          username,
          x,
          y,
          angle,
          hp,
          energy,
          sprite,
          bulletSprite,
          bulletSpriteSecondary,
        }),
      ),
      config: {
        mapWidth: GAME_CONFIG.MAP_WIDTH,
        mapHeight: GAME_CONFIG.MAP_HEIGHT,
      },
    });
  }, 500);

  room.intervalId = setInterval(
    makeTick(io, roomId, room),
    GAME_CONFIG.TICK_RATE,
  );
}

function makeTick(io: Server, roomId: string, room: RoomState) {
  return () => {
    if (room.status !== "playing") return;

    const now = Date.now();
    const players = Array.from(room.players.values());
    const added: BulletPayload[] = [];

    for (const player of players) {
      const queue = inputQueues.get(player.id);
      if (!queue || queue.length === 0) continue;
      const start = Math.max(0, queue.length - MAX_QUEUE_PER_TICK);
      for (let i = start; i < queue.length; i++) {
        const input = queue[i];
        const shots = applyInput(player, input, now);
        for (const shot of shots) {
          room.bullets.push(shot);
          added.push(toBulletPayload(shot));
        }
        lastProcessedSeq.set(player.id, input.seq);
      }
      queue.length = 0;
    }

    const removed = moveBullets(room.bullets);
    const hitRemoved = resolveCollisions(room.bullets, players);
    if (hitRemoved.length) removed.push(...hitRemoved);

    const bulletsUpdated = room.bullets.map((b) => ({ id: b.id, x: b.x, y: b.y }));

    const playerDeltas = buildPlayerDeltas(room, players);
    if (playerDeltas.length || added.length || removed.length || bulletsUpdated.length) {
      io.to(roomId).emit("game:state", {
        players: playerDeltas,
        bulletsAdded: added,
        bulletsRemoved: removed,
        bulletsUpdated,
        tick: now,
      });
    }

    const dead = players.filter((p) => p.hp <= 0);
    if (dead.length > 0) endRound(io, roomId, room, players);
  };
}

interface BulletPayload {
  id: string;
  x: number;
  y: number;
  angle: number;
  type: "normal" | "special";
  sprite: string;
}

function toBulletPayload(b: {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: "normal" | "special";
  sprite: string;
}): BulletPayload {
  return { id: b.id, x: b.x, y: b.y, angle: Math.atan2(b.vy, b.vx), type: b.type, sprite: b.sprite };
}

interface PlayerDelta {
  id: string;
  x?: number;
  y?: number;
  angle?: number;
  hp?: number;
  energy?: number;
  lastProcessedSeq?: number;
}

function buildPlayerDeltas(room: RoomState, players: PlayerState[]): PlayerDelta[] {
  if (!room.lastSent) room.lastSent = new Map();
  const deltas: PlayerDelta[] = [];
  for (const p of players) {
    const prev = room.lastSent.get(p.id);
    const delta: PlayerDelta = { id: p.id };
    let changed = false;
    if (!prev || prev.x !== p.x) { delta.x = p.x; changed = true; }
    if (!prev || prev.y !== p.y) { delta.y = p.y; changed = true; }
    if (!prev || prev.angle !== p.angle) { delta.angle = p.angle; changed = true; }
    if (!prev || prev.hp !== p.hp) { delta.hp = p.hp; changed = true; }
    if (!prev || prev.energy !== p.energy) { delta.energy = p.energy; changed = true; }
    const seq = lastProcessedSeq.get(p.id) ?? 0;
    if (changed) {
      delta.lastProcessedSeq = seq;
      deltas.push(delta);
      room.lastSent.set(p.id, { x: p.x, y: p.y, angle: p.angle, hp: p.hp, energy: p.energy });
    }
  }
  return deltas;
}

async function endRound(
  io: Server,
  roomId: string,
  room: RoomState,
  players: PlayerState[],
) {
  room.status = "roundEnd";
  if (room.intervalId) clearInterval(room.intervalId);

  const alive = players.filter((p) => p.hp > 0);
  const winner = alive.length === 1 ? alive[0] : null; // null = draw

  if (winner) {
    room.scores.set(winner.id, (room.scores.get(winner.id) ?? 0) + 1);
  }

  const scores = Object.fromEntries(room.scores);
  io.to(roomId).emit("game:roundEnd", {
    winner: winner ? { id: winner.id, username: winner.username } : null,
    scores,
    duration: Date.now() - room.roundStartTime,
  });

  const matchWinner = Array.from(room.scores.entries()).find(
    ([, s]) => s >= GAME_CONFIG.ROUNDS_TO_WIN,
  );

  if (matchWinner) {
    await endMatch(io, roomId, room, players, matchWinner[0]);
  } else {
    room.nextRoundTimeout = setTimeout(() => {
      room.nextRoundTimeout = undefined;
      if (!rooms.has(roomId)) return;
      room.status = "playing";
      room.roundStartTime = Date.now();
      resetRound(room);
      for (const [socketId] of room.players) {
        inputQueues.set(socketId, []);
        lastSeenSeq.set(socketId, -1);
        lastProcessedSeq.set(socketId, 0);
      }
      const spawnStates = Array.from(room.players.values()).map(({ id, x, y, angle, hp, energy }) => ({ id, x, y, angle, hp, energy }));
      io.to(roomId).emit("game:roundStart", { scores, players: spawnStates });
      restartLoop(io, roomId, room);
    }, 3000);
  }
}

function restartLoop(io: Server, roomId: string, room: RoomState) {
  if (room.intervalId) clearInterval(room.intervalId);
  room.intervalId = setInterval(
    makeTick(io, roomId, room),
    GAME_CONFIG.TICK_RATE,
  );
}

async function endMatch(
  io: Server,
  roomId: string,
  room: RoomState,
  players: PlayerState[],
  winnerSocketId: string,
) {
  room.status = "matchEnd";
  if (room.intervalId) clearInterval(room.intervalId);

  const winner = room.players.get(winnerSocketId);
  if (!winner) return;
  const loser = players.find((p) => p.id !== winnerSocketId);

  const results = await recordMatchResult({
    winner: { socketId: winner.id, userId: winner.userId },
    loser: loser ? { socketId: loser.id, userId: loser.userId } : undefined,
    awardXP: true,
  });

  await saveGameRecord({
    roomId,
    players: players.map((p) => ({
      userId: p.userId,
      username: p.username,
      score: room.scores.get(p.id) ?? 0,
    })),
    winnerUserId: winner.userId,
  });

  const matchEndBase = {
    winner: { id: winner.id, username: winner.username },
    scores: Object.fromEntries(room.scores),
  };

  for (const p of players) {
    const playerSocket = io.sockets.sockets.get(p.id);
    const data = results.get(p.id);
    playerSocket?.emit("game:matchEnd", {
      ...matchEndBase,
      pointsEarned: p.id === winnerSocketId ? GAME_CONFIG.POINTS_PER_WIN : 0,
      newPoints: data?.points ?? null,
      xpGained: data?.xpGained ?? null,
      newXP: data?.xp ?? null,
      newLevel: data?.level ?? null,
      leveledUp: data?.leveledUp ?? false,
    });
  }

  for (const spectatorId of room.spectators) {
    const spectatorSocket = io.sockets.sockets.get(spectatorId);
    spectatorSocket?.emit("game:matchEnd", {
      ...matchEndBase,
      pointsEarned: 0,
      newPoints: null,
    });
  }

  cleanupSocketInput(winnerSocketId);
  for (const p of players) cleanupSocketInput(p.id);
  rooms.delete(roomId);
}

function cleanupSocketInput(socketId: string) {
  inputQueues.delete(socketId);
  lastSeenSeq.delete(socketId);
  lastProcessedSeq.delete(socketId);
}

export function cleanupRoomInputs(room: RoomState) {
  for (const socketId of room.players.keys()) cleanupSocketInput(socketId);
  if (room.nextRoundTimeout) {
    clearTimeout(room.nextRoundTimeout);
    room.nextRoundTimeout = undefined;
  }
}
