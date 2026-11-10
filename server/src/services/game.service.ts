import { User } from "../models/User.js";
import {
  type PlayerStats,
  PERK_CONFIG,
  computeStats,
  effectiveAttributes,
} from "../shared/attributes.js";

export { xpForLevel, applyXP } from "../shared/xp.js";

export const GAME_CONFIG = {
  MAP_WIDTH: 1280,
  MAP_HEIGHT: 720,
  SHIP_RADIUS: 24,
  BULLET_SPECIAL_SPEED: 5,
  BULLET_RADIUS: 6,
  ROUNDS_TO_WIN: 3,
  POINTS_PER_WIN: 100,
  CREDITS_PER_LOSS: 25,
  GALACTICS_PER_LEVEL: 1,
  DESERTION_PENALTY_RATE: 0.05,
  DESERTION_PENALTY_CAP: 0.5,
  XP_PER_WIN: 120,
  XP_PER_LOSS: 40,
  // Daily anti-farming counters reset at midnight in this zone, the same moment for everyone
  DAILY_RESET_TIMEZONE: "Europe/Paris",
  // Anti-farming: wins over the same opponent since the daily reset keep full rewards up to
  // this count, then fade by a step per extra win down to a floor (never zero). The loser's
  // rewards follow the same count, which is also their number of losses to that opponent
  FULL_REWARD_MATCHES_PER_OPPONENT: 5,
  REPEAT_REWARD_STEP: 0.15,
  REPEAT_REWARD_FLOOR: 0.25,
  // A loser below this travelled distance who never dealt damage did not really fight
  MIN_FIGHT_DISTANCE: 300,
  // Winner rewards fade out when the loser is this many levels below (WoW-style grey targets)
  GREY_GAP_START: 5,
  GREY_GAP_ZERO: 10,
  // Beating a higher level opponent grants extra XP, per level of difference, capped
  UPSET_XP_BONUS_PER_LEVEL: 0.02,
  UPSET_XP_BONUS_MAX: 0.1,
  TICK_RATE: 1000 / 60,
  // Max time a shooter's view may be rewound for hit detection (lag compensation)
  MAX_REWIND_MS: 200,
  HISTORY_MS: 1000,
};

// Exact (fractional) number of ticks between two primary shots
export function shotInterval(cooldownMs: number): number {
  return (cooldownMs * 60) / 1000;
}

// The fractional remainder is carried over while firing continuously, so every Cadence point
// changes the real fire rate instead of being lost to tick rounding
export function nextShotClock(last: number, clock: number, interval: number): number {
  return clock - last < 2 * interval ? last + interval : clock;
}

export function cooldownTicks(cooldownMs: number): number {
  return Math.max(1, Math.round(cooldownMs / GAME_CONFIG.TICK_RATE));
}

export async function loadPlayerStats(
  userId: string,
): Promise<{ stats: PlayerStats; level: number }> {
  const user = await User.findById(userId).select("attributes level").lean();
  const level = user?.level ?? 1;
  return { stats: computeStats(effectiveAttributes(user?.attributes, level)), level };
}

export interface PlayerState extends PlayerStats {
  id: string;
  userId: string;
  username: string;
  level: number;
  x: number;
  y: number;
  angle: number;
  hp: number;
  energy: number;
  sprite: string;
  bulletSprite: string;
  bulletSpriteSecondary: string;
  // Shot cooldowns are counted in processed inputs so the client can predict them exactly
  inputClock: number;
  lastNormalShotClock: number;
  lastSpecialShotClock: number;
  lastDashClock: number;
  prevRightClick: boolean;
  prevDashKey: boolean;
  lastDamagedAt: number;
  invulnerableUntil: number;
  lastStandUsed: boolean;
  // Whole-match totals, used to tell a real fight from a farmed one
  damageDealt: number;
  distanceMoved: number;
  viewLag: number;
  history: { t: number; x: number; y: number }[];
}

export interface BulletState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  type: "normal" | "special";
  sprite: string;
  seq: number;
  spawnT: number;
  viewLag: number;
}

export interface RoomState {
  roomId: string;
  players: Map<string, PlayerState>;
  bullets: BulletState[];
  scores: Map<string, number>;
  spectators: Set<string>;
  status: "waiting" | "playing" | "roundEnd" | "matchEnd";
  roundStartTime: number;
  ownerUserId?: string;
  playerUserIds?: Set<string>;
  createdAt?: number;
  intervalId?: ReturnType<typeof setInterval>;
  nextRoundTimeout?: ReturnType<typeof setTimeout>;
  waitingPlayers?: string[];
  simTime?: number;
  lastSent?: Map<
    string,
    {
      x: number;
      y: number;
      angle: number;
      hp: number;
      energy: number;
      inv: boolean;
      seq: number;
    }
  >;
}

export function getSpawnPosition(playerIndex: number) {
  const margin = 150;
  if (playerIndex === 0) return { x: margin, y: GAME_CONFIG.MAP_HEIGHT / 2 };
  return { x: GAME_CONFIG.MAP_WIDTH - margin, y: GAME_CONFIG.MAP_HEIGHT / 2 };
}

export function createPlayerState(
  socketId: string,
  userId: string,
  username: string,
  playerIndex: number,
  sprite: string,
  bulletSprite: string,
  bulletSpriteSecondary: string,
  stats: PlayerStats,
  level = 1,
): PlayerState {
  const { x, y } = getSpawnPosition(playerIndex);
  return {
    id: socketId,
    userId,
    username,
    level,
    x,
    y,
    angle: playerIndex === 0 ? 0 : Math.PI,
    hp: stats.maxHp,
    energy: stats.maxEnergy,
    sprite,
    bulletSprite,
    bulletSpriteSecondary,
    inputClock: 0,
    lastNormalShotClock: -Infinity,
    lastSpecialShotClock: -Infinity,
    lastDashClock: -Infinity,
    prevRightClick: false,
    prevDashKey: false,
    lastDamagedAt: -Infinity,
    invulnerableUntil: -Infinity,
    lastStandUsed: false,
    damageDealt: 0,
    distanceMoved: 0,
    viewLag: 0,
    history: [],
    ...stats,
  };
}

export function resetShotState(player: PlayerState): void {
  player.inputClock = 0;
  player.lastNormalShotClock = -Infinity;
  player.lastSpecialShotClock = -Infinity;
  player.lastDashClock = -Infinity;
  player.prevRightClick = false;
  player.prevDashKey = false;
  player.lastDamagedAt = -Infinity;
  player.invulnerableUntil = -Infinity;
  player.lastStandUsed = false;
  player.viewLag = 0;
  player.history = [];
}

export function isInvulnerable(player: PlayerState, now: number): boolean {
  return now < player.invulnerableUntil;
}

export function applyInput(
  player: PlayerState,
  input: {
    seq: number;
    keys: string[];
    mouseAngle: number;
    leftClick: boolean;
    rightClick: boolean;
  },
  now: number,
): BulletState[] {
  const bullets: BulletState[] = [];
  player.inputClock++;
  const clock = player.inputClock;

  player.angle = input.mouseAngle;

  let dx = 0;
  let dy = 0;
  if (input.keys.includes("z") || input.keys.includes("w")) dy -= 1;
  if (input.keys.includes("s")) dy += 1;
  if (input.keys.includes("q") || input.keys.includes("a")) dx -= 1;
  if (input.keys.includes("d")) dx += 1;

  const startX = player.x;
  const startY = player.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > 0) {
    player.x = clampToMapX(player.x + (dx / len) * player.speed);
    player.y = clampToMapY(player.y + (dy / len) * player.speed);
  }

  const dashPressed = input.keys.includes("shift") && !player.prevDashKey;
  player.prevDashKey = input.keys.includes("shift");
  if (
    dashPressed &&
    player.perks.dash &&
    clock - player.lastDashClock >=
      cooldownTicks(PERK_CONFIG.DASH_COOLDOWN_MS) &&
    player.energy >= PERK_CONFIG.DASH_ENERGY
  ) {
    // Dash along the movement direction, or forward when standing still
    const dirX = len > 0 ? dx / len : Math.cos(player.angle);
    const dirY = len > 0 ? dy / len : Math.sin(player.angle);
    player.lastDashClock = clock;
    player.energy -= PERK_CONFIG.DASH_ENERGY;
    player.x = clampToMapX(player.x + dirX * PERK_CONFIG.DASH_DISTANCE);
    player.y = clampToMapY(player.y + dirY * PERK_CONFIG.DASH_DISTANCE);
    if (player.perks.dashInvuln) {
      player.invulnerableUntil = Math.max(
        player.invulnerableUntil,
        now + PERK_CONFIG.DASH_INVULN_MS,
      );
    }
  }

  player.distanceMoved += Math.hypot(player.x - startX, player.y - startY);

  const muzzleOffset = GAME_CONFIG.SHIP_RADIUS + GAME_CONFIG.BULLET_RADIUS + 1;
  const cos = Math.cos(player.angle);
  const sin = Math.sin(player.angle);

  if (
    input.leftClick &&
    clock - player.lastNormalShotClock >= shotInterval(player.primaryCooldown)
  ) {
    player.lastNormalShotClock = nextShotClock(
      player.lastNormalShotClock,
      clock,
      shotInterval(player.primaryCooldown),
    );
    bullets.push({
      id: `${player.id}:${input.seq}:n`,
      ownerId: player.id,
      x: player.x + cos * muzzleOffset,
      y: player.y + sin * muzzleOffset,
      vx: cos * player.primaryBulletSpeed,
      vy: sin * player.primaryBulletSpeed,
      damage: player.primaryDamage,
      radius: GAME_CONFIG.BULLET_RADIUS,
      type: "normal",
      sprite: player.bulletSprite,
      seq: input.seq,
      spawnT: now,
      viewLag: player.viewLag,
    });
  }

  const specialPressed = input.rightClick && !player.prevRightClick;
  if (
    specialPressed &&
    clock - player.lastSpecialShotClock >=
      cooldownTicks(player.specialCooldown) &&
    player.energy >= player.specialEnergyCost
  ) {
    player.lastSpecialShotClock = clock;
    player.energy -= player.specialEnergyCost;
    const specialMuzzle =
      GAME_CONFIG.SHIP_RADIUS + GAME_CONFIG.BULLET_RADIUS * 2 + 1;
    bullets.push({
      id: `${player.id}:${input.seq}:s`,
      ownerId: player.id,
      x: player.x + cos * specialMuzzle,
      y: player.y + sin * specialMuzzle,
      vx: cos * GAME_CONFIG.BULLET_SPECIAL_SPEED,
      vy: sin * GAME_CONFIG.BULLET_SPECIAL_SPEED,
      damage: player.specialDamage,
      radius: GAME_CONFIG.BULLET_RADIUS * 2,
      type: "special",
      sprite: player.bulletSpriteSecondary,
      seq: input.seq,
      spawnT: now,
      viewLag: player.viewLag,
    });
  }
  player.prevRightClick = input.rightClick;

  return bullets;
}

export function resolveShipCollisions(players: PlayerState[]): void {
  const minDist = GAME_CONFIG.SHIP_RADIUS * 2;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      if (dist >= minDist) continue;
      if (dist === 0) {
        dx = 1;
        dy = 0;
        dist = 1;
      }
      const push = (minDist - dist) / 2;
      const nx = dx / dist;
      const ny = dy / dist;
      a.x = clampToMapX(a.x - nx * push);
      a.y = clampToMapY(a.y - ny * push);
      b.x = clampToMapX(b.x + nx * push);
      b.y = clampToMapY(b.y + ny * push);
    }
  }
}

function clampToMapX(x: number): number {
  return Math.max(
    GAME_CONFIG.SHIP_RADIUS,
    Math.min(GAME_CONFIG.MAP_WIDTH - GAME_CONFIG.SHIP_RADIUS, x),
  );
}

function clampToMapY(y: number): number {
  return Math.max(
    GAME_CONFIG.SHIP_RADIUS,
    Math.min(GAME_CONFIG.MAP_HEIGHT - GAME_CONFIG.SHIP_RADIUS, y),
  );
}

export function moveBullets(bullets: BulletState[]): string[] {
  const removed: string[] = [];
  let write = 0;
  for (let read = 0; read < bullets.length; read++) {
    const b = bullets[read];
    b.x += b.vx;
    b.y += b.vy;
    if (
      b.x > 0 &&
      b.x < GAME_CONFIG.MAP_WIDTH &&
      b.y > 0 &&
      b.y < GAME_CONFIG.MAP_HEIGHT
    ) {
      bullets[write++] = b;
    } else {
      removed.push(b.id);
    }
  }
  bullets.length = write;
  return removed;
}

export function recordHistory(players: PlayerState[], t: number): void {
  for (const p of players) {
    p.history.push({ t, x: p.x, y: p.y });
    const cutoff = t - GAME_CONFIG.HISTORY_MS;
    let drop = 0;
    while (drop < p.history.length - 1 && p.history[drop].t < cutoff) drop++;
    if (drop) p.history.splice(0, drop);
  }
}

// Position of a player at a past server time, interpolated from recorded history
export function positionAt(
  player: PlayerState,
  t: number,
): { x: number; y: number } {
  const h = player.history;
  if (h.length === 0 || t >= h[h.length - 1].t) return { x: player.x, y: player.y };
  if (t <= h[0].t) return { x: h[0].x, y: h[0].y };
  for (let i = h.length - 1; i > 0; i--) {
    const a = h[i - 1];
    const b = h[i];
    if (t >= a.t) {
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return { x: h[0].x, y: h[0].y };
}

// Bullets are tested against targets as the shooter saw them (rewound by the shooter's view lag)
export function resolveCollisions(
  bullets: BulletState[],
  players: PlayerState[],
  now: number,
): string[] {
  const removed: string[] = [];
  let write = 0;

  for (let read = 0; read < bullets.length; read++) {
    const bullet = bullets[read];
    let hit = false;
    for (const player of players) {
      if (player.id === bullet.ownerId) continue;
      if (player.hp <= 0 || isInvulnerable(player, now)) continue;
      const pos =
        bullet.viewLag > 0
          ? positionAt(player, now - bullet.viewLag)
          : { x: player.x, y: player.y };
      const dx = bullet.x - pos.x;
      const dy = bullet.y - pos.y;
      const threshold = bullet.radius + GAME_CONFIG.SHIP_RADIUS;
      if (dx * dx + dy * dy < threshold * threshold) {
        const shooter = players.find((p) => p.id === bullet.ownerId);
        applyHit(bullet, shooter, player, now);
        hit = true;
        break;
      }
    }
    if (hit) removed.push(bullet.id);
    else bullets[write++] = bullet;
  }
  bullets.length = write;
  return removed;
}

function applyHit(
  bullet: BulletState,
  shooter: PlayerState | undefined,
  target: PlayerState,
  now: number,
): void {
  let damage = bullet.damage;
  if (
    shooter?.perks.execute &&
    target.hp < target.maxHp * PERK_CONFIG.EXECUTE_HP_RATIO
  ) {
    damage *= 1 + PERK_CONFIG.EXECUTE_BONUS;
  }
  damage *= 1 - target.damageReduction;

  target.lastDamagedAt = now;
  if (shooter) shooter.damageDealt += Math.min(damage, target.hp);
  if (target.hp - damage <= 0 && target.perks.lastStand && !target.lastStandUsed) {
    target.lastStandUsed = true;
    target.hp = 1;
  } else {
    target.hp = Math.max(0, target.hp - damage);
  }

  if (bullet.type === "normal" && shooter?.perks.energyOnHit) {
    shooter.energy = Math.min(
      shooter.maxEnergy,
      shooter.energy + PERK_CONFIG.ENERGY_ON_HIT,
    );
  }
}

export function regenerate(player: PlayerState, now: number): void {
  const tickSeconds = GAME_CONFIG.TICK_RATE / 1000;
  player.energy = Math.min(
    player.maxEnergy,
    player.energy + player.energyRegen * tickSeconds,
  );
  if (
    player.perks.regen &&
    player.hp > 0 &&
    player.hp < player.maxHp &&
    now - player.lastDamagedAt >= PERK_CONFIG.REGEN_DELAY_MS
  ) {
    player.hp = Math.min(
      player.maxHp,
      player.hp + PERK_CONFIG.REGEN_PER_SECOND * tickSeconds,
    );
  }
}
