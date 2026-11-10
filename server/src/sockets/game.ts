import type { Server, Socket } from "socket.io";
import type {
  RoomState,
  PlayerState,
  BulletState,
} from "../services/game.service.js";
import type { PlayerStats } from "../shared/attributes.js";
import {
  GAME_CONFIG,
  createPlayerState,
  applyInput,
  moveBullets,
  resolveCollisions,
  resolveShipCollisions,
  getSpawnPosition,
  recordHistory,
  resetShotState,
  regenerate,
  isInvulnerable,
} from "../services/game.service.js";
import {
  recordMatchResult,
  saveGameRecord,
} from "../services/match.service.js";
import { announceLevelChange, rooms, teardownRoom } from "./lobby.js";

interface PlayerEntry {
  socket: Socket;
  player: {
    userId: string;
    username: string;
    activeShip: string;
    activeBullet: string;
    activeBulletSecondary: string;
    stats: PlayerStats;
    level: number;
  };
}

interface ClientInput {
  seq: number;
  keys: string[];
  mouseAngle: number;
  leftClick: boolean;
  rightClick: boolean;
  renderTime?: number;
}

// Inputs are consumed at most one per tick on average; credits let a player catch up after jitter
const INPUT_BURST_MAX = 15;
const MAX_QUEUE_LENGTH = 30;
// Inputs still queued beyond this after a tick are dropped to keep input latency bounded
const MAX_BACKLOG = 6;
const MAX_CATCHUP_TICKS = 5;

const ALLOWED_KEYS = new Set(["z", "q", "s", "d", "w", "a", "shift"]);

const inputQueues = new Map<string, ClientInput[]>();
const lastSeenSeq = new Map<string, number>();
const lastProcessedSeq = new Map<string, number>();
const inputCredits = new Map<string, number>();

function sanitizeInput(raw: unknown): ClientInput | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  if (!Number.isInteger(input.seq) || (input.seq as number) < 0) return null;
  if (!Number.isFinite(input.mouseAngle)) return null;
  if (!Array.isArray(input.keys) || input.keys.length > 16) return null;
  const keys = input.keys.filter(
    (k): k is string => typeof k === "string" && ALLOWED_KEYS.has(k),
  );
  return {
    seq: input.seq as number,
    keys,
    mouseAngle: input.mouseAngle as number,
    leftClick: input.leftClick === true,
    rightClick: input.rightClick === true,
    renderTime: Number.isFinite(input.rt) ? (input.rt as number) : undefined,
  };
}

function resetRound(room: RoomState) {
  room.bullets = [];
  room.lastSent?.clear();
  let index = 0;
  for (const [, player] of room.players) {
    const pos = getSpawnPosition(index);
    player.x = pos.x;
    player.y = pos.y;
    player.hp = player.maxHp;
    player.energy = player.maxEnergy;
    player.angle = index === 0 ? 0 : Math.PI;
    resetShotState(player);
    index++;
  }
}

function buildStartPayload(room: RoomState) {
  return {
    roomId: room.roomId,
    players: Array.from(room.players.values()).map(
      ({
        id,
        username,
        level,
        x,
        y,
        angle,
        hp,
        energy,
        maxHp,
        maxEnergy,
        speed,
        sprite,
        bulletSprite,
        bulletSpriteSecondary,
        primaryCooldown,
        specialCooldown,
        specialEnergyCost,
        primaryBulletSpeed,
        perks,
      }) => ({
        primaryCooldown,
        primaryBulletSpeed,
        specialCooldown,
        specialEnergyCost,
        dash: perks.dash,
        id,
        username,
        level,
        x,
        y,
        angle,
        hp,
        energy,
        maxHp,
        maxEnergy,
        speed,
        sprite,
        bulletSprite,
        bulletSpriteSecondary,
      }),
    ),
    config: {
      mapWidth: GAME_CONFIG.MAP_WIDTH,
      mapHeight: GAME_CONFIG.MAP_HEIGHT,
    },
    t: room.simTime ?? Date.now(),
  };
}

export function sendGameSnapshot(socket: Socket, room: RoomState) {
  socket.emit("game:start", buildStartPayload(room));
  const t = room.simTime ?? Date.now();
  socket.emit("game:state", {
    players: [],
    bulletsAdded: room.bullets.map((b) => toBulletPayload(b, t)),
    bulletsRemoved: [],
    t,
  });
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
      entry.player.stats,
      entry.player.level,
    );
    room.players.set(entry.socket.id, state);
    room.scores.set(entry.socket.id, 0);
    inputQueues.set(entry.socket.id, []);
    lastSeenSeq.set(entry.socket.id, -1);
    lastProcessedSeq.set(entry.socket.id, 0);
    inputCredits.set(entry.socket.id, INPUT_BURST_MAX);
  });

  for (const entry of entries) {
    entry.socket.removeAllListeners("game:input");
    entry.socket.on("game:input", (raw: unknown) => {
      const input = sanitizeInput(raw);
      if (!input) return;
      const lastSeen = lastSeenSeq.get(entry.socket.id);
      if (lastSeen === undefined) return;
      if (input.seq <= lastSeen) return;
      lastSeenSeq.set(entry.socket.id, input.seq);
      const queue = inputQueues.get(entry.socket.id);
      if (!queue) return;
      if (queue.length >= MAX_QUEUE_LENGTH) queue.shift();
      queue.push(input);
    });
  }

  io.to(roomId).emit("game:navigate", { roomId });

  setTimeout(() => {
    if (rooms.get(roomId) !== room) return;
    io.to(roomId).emit("game:start", buildStartPayload(room));
  }, 500);

  startLoop(io, roomId, room);
}

// Fixed-step loop locked to wall-clock time: tick N always represents start + N * TICK_RATE,
// which keeps server time and simulation steps consistent for client interpolation.
function startLoop(io: Server, roomId: string, room: RoomState) {
  if (room.intervalId) clearInterval(room.intervalId);
  const tick = makeTick(io, roomId, room);
  let start = Date.now();
  let ticksDone = 0;
  room.intervalId = setInterval(() => {
    const due = Math.floor((Date.now() - start) / GAME_CONFIG.TICK_RATE);
    if (due - ticksDone > MAX_CATCHUP_TICKS) {
      start += (due - ticksDone - MAX_CATCHUP_TICKS) * GAME_CONFIG.TICK_RATE;
      ticksDone = due - MAX_CATCHUP_TICKS;
    }
    while (ticksDone < due && room.status === "playing") {
      ticksDone++;
      tick(Math.round(start + ticksDone * GAME_CONFIG.TICK_RATE));
    }
  }, 4);
}

function makeTick(io: Server, roomId: string, room: RoomState) {
  return (now: number) => {
    if (room.status !== "playing") return;
    room.simTime = now;

    const players = Array.from(room.players.values());
    const added: BulletPayload[] = [];

    const removed = moveBullets(room.bullets);

    for (const player of players) {
      const queue = inputQueues.get(player.id);
      let credit = Math.min(
        (inputCredits.get(player.id) ?? 0) + 1,
        INPUT_BURST_MAX,
      );

      if (queue && queue.length > 0) {
        const take = Math.min(queue.length, credit);
        for (const input of queue.splice(0, take)) {
          if (input.renderTime !== undefined) {
            player.viewLag = Math.min(
              GAME_CONFIG.MAX_REWIND_MS,
              Math.max(0, now - input.renderTime),
            );
          }
          const shots = applyInput(player, input, now);
          for (const shot of shots) {
            room.bullets.push(shot);
            added.push(toBulletPayload(shot, now));
          }
          lastProcessedSeq.set(player.id, input.seq);
        }
        credit -= take;
        if (queue.length > MAX_BACKLOG) {
          queue.splice(0, queue.length - MAX_BACKLOG);
        }
      }
      inputCredits.set(player.id, credit);

      regenerate(player, now);
    }

    resolveShipCollisions(players);
    recordHistory(players, now);

    const hitRemoved = resolveCollisions(room.bullets, players, now);
    if (hitRemoved.length) removed.push(...hitRemoved);

    // Sent every tick, even when empty: clients use it as their time reference
    io.to(roomId).emit("game:state", {
      players: buildPlayerDeltas(room, players, now),
      bulletsAdded: added,
      bulletsRemoved: removed,
      t: now,
    });

    const dead = players.filter((p) => p.hp <= 0);
    if (dead.length > 0) {
      endRound(io, roomId, room, players).catch((err) =>
        console.error("[endRound] erreur:", err),
      );
    }
  };
}

interface BulletPayload {
  id: string;
  ownerId: string;
  seq: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  type: "normal" | "special";
  sprite: string;
}

// Position (x, y) is the bullet position at server time t; it then moves (vx, vy) per tick
function toBulletPayload(b: BulletState, t: number): BulletPayload {
  return {
    id: b.id,
    ownerId: b.ownerId,
    seq: b.seq,
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    t,
    type: b.type,
    sprite: b.sprite,
  };
}

interface PlayerDelta {
  id: string;
  x?: number;
  y?: number;
  angle?: number;
  hp?: number;
  energy?: number;
  inv?: boolean;
  lastProcessedSeq?: number;
  inputClock?: number;
}

function buildPlayerDeltas(
  room: RoomState,
  players: PlayerState[],
  now: number,
): PlayerDelta[] {
  if (!room.lastSent) room.lastSent = new Map();
  const deltas: PlayerDelta[] = [];
  for (const p of players) {
    const prev = room.lastSent.get(p.id);
    const delta: PlayerDelta = { id: p.id };
    let changed = false;
    if (!prev || prev.x !== p.x) {
      delta.x = p.x;
      changed = true;
    }
    if (!prev || prev.y !== p.y) {
      delta.y = p.y;
      changed = true;
    }
    if (!prev || prev.angle !== p.angle) {
      delta.angle = p.angle;
      changed = true;
    }
    if (!prev || prev.hp !== p.hp) {
      delta.hp = p.hp;
      changed = true;
    }
    if (!prev || prev.energy !== p.energy) {
      delta.energy = p.energy;
      changed = true;
    }
    const inv = isInvulnerable(p, now);
    if (!prev || prev.inv !== inv) {
      delta.inv = inv;
      changed = true;
    }
    const seq = lastProcessedSeq.get(p.id) ?? 0;
    if (!prev || prev.seq !== seq) changed = true;
    if (changed) {
      delta.lastProcessedSeq = seq;
      delta.inputClock = p.inputClock;
      deltas.push(delta);
      room.lastSent.set(p.id, {
        x: p.x,
        y: p.y,
        angle: p.angle,
        hp: p.hp,
        energy: p.energy,
        inv,
        seq,
      });
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
  const winner = alive.length === 1 ? alive[0] : null;

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
      if (rooms.get(roomId) !== room || room.status !== "roundEnd") return;
      room.status = "playing";
      room.roundStartTime = Date.now();
      resetRound(room);
      for (const [socketId] of room.players) {
        inputQueues.set(socketId, []);
        lastSeenSeq.set(socketId, -1);
        lastProcessedSeq.set(socketId, 0);
        inputCredits.set(socketId, INPUT_BURST_MAX);
      }
      const spawnStates = Array.from(room.players.values()).map(
        ({ id, x, y, angle, hp, energy }) => ({ id, x, y, angle, hp, energy }),
      );
      io.to(roomId).emit("game:roundStart", { scores, players: spawnStates });
      startLoop(io, roomId, room);
    }, 3000);
  }
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

  try {
    const winner = room.players.get(winnerSocketId);
    if (winner) {
      const loser = players.find((p) => p.id !== winnerSocketId);

      const results = await recordMatchResult({
        winner: { socketId: winner.id, userId: winner.userId },
        loser: loser ? { socketId: loser.id, userId: loser.userId } : undefined,
        loserFought:
          !loser ||
          (loser.damageDealt > 0 ||
            loser.distanceMoved >= GAME_CONFIG.MIN_FIGHT_DISTANCE),
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
          pointsEarned: data?.pointsGained ?? 0,
          rewardNotes: data?.rewardNotes ?? [],
          newPoints: data?.points ?? null,
          xpGained: data?.xpGained ?? null,
          newXP: data?.xp ?? null,
          newLevel: data?.level ?? null,
          leveledUp: data?.leveledUp ?? false,
          galacticsGained: data?.galacticsGained ?? 0,
          newGalactics: data?.galactics ?? null,
        });
        if (data?.leveledUp)
          announceLevelChange(io, p.userId, p.username, p.level, data.level);
      }

      for (const spectatorId of room.spectators) {
        const spectatorSocket = io.sockets.sockets.get(spectatorId);
        spectatorSocket?.emit("game:matchEnd", {
          ...matchEndBase,
          pointsEarned: 0,
          newPoints: null,
        });
      }
    }
  } catch (err) {
    console.error("[endMatch] erreur:", err);
    // Without this the players would stay frozen on the game screen
    io.to(roomId).emit("game:closed", {
      roomId,
      reason: "Erreur serveur, le résultat n'a pas pu être enregistré",
    });
  } finally {
    teardownRoom(io, room);
  }
}

function cleanupSocketInput(io: Server, socketId: string) {
  inputQueues.delete(socketId);
  lastSeenSeq.delete(socketId);
  lastProcessedSeq.delete(socketId);
  inputCredits.delete(socketId);
  io.sockets.sockets.get(socketId)?.removeAllListeners("game:input");
}

export function cleanupRoomInputs(io: Server, room: RoomState) {
  if (room.intervalId) clearInterval(room.intervalId);
  room.intervalId = undefined;
  for (const socketId of room.players.keys()) cleanupSocketInput(io, socketId);
  if (room.nextRoundTimeout) {
    clearTimeout(room.nextRoundTimeout);
    room.nextRoundTimeout = undefined;
  }
}
