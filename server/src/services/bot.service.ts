import { PERK_CONFIG, type PlayerStats } from "../shared/attributes.js";
import {
  GAME_CONFIG,
  type BulletState,
  type PlayerState,
} from "./game.service.js";

export const BOT_ID_PREFIX = "bot:";
export const BOT_USER_ID = "bot";
export const BOT_BULLET = "bullet1";
export const BOT_BULLET_SECONDARY = "bullet2";
const BOT_SHIPS = ["spaceship-02", "spaceship-03"];

const PREFERRED_DISTANCE = 320;
const DISTANCE_TOLERANCE = 70;
const WALL_MARGIN = 90;
const AIM_ROLL_MS = 350;
const FIRE_RANGE = 750;
const MISSILE_RANGE = 480;
const DODGE_HORIZON_TICKS = 45;
const DODGE_URGENT_TICKS = 12;
const DODGE_MARGIN = 12;
const STRAFE_SWITCH_MIN_MS = 900;
const STRAFE_SWITCH_MAX_MS = 2200;
const KEY_THRESHOLD = 0.38;

export type BotDifficulty = "facile" | "normal" | "difficile";
export const BOT_DIFFICULTIES: BotDifficulty[] = ["facile", "normal", "difficile"];

interface BotProfile {
  label: string;
  aimJitter: number;
  leadFactor: number;
  dodgeChance: number;
  missileDodgeChance: number;
  reactionMs: number;
  fireBurstMs: number;
  firePauseMs: number;
  missileChancePerTick: number;
  usesDash: boolean;
  // Applied to the mirrored player stats so the lower levels hit softer and move slower
  damageScale: number;
  speedScale: number;
}

const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  facile: {
    label: "Facile",
    aimJitter: 0.45,
    leadFactor: 0.2,
    dodgeChance: 0,
    missileDodgeChance: 0.1,
    reactionMs: 500,
    fireBurstMs: 600,
    firePauseMs: 1300,
    missileChancePerTick: 0.004,
    usesDash: false,
    damageScale: 0.5,
    speedScale: 0.8,
  },
  normal: {
    label: "Normal",
    aimJitter: 0.3,
    leadFactor: 0.5,
    dodgeChance: 0.15,
    missileDodgeChance: 0.3,
    reactionMs: 350,
    fireBurstMs: 800,
    firePauseMs: 800,
    missileChancePerTick: 0.008,
    usesDash: false,
    damageScale: 0.75,
    speedScale: 0.9,
  },
  difficile: {
    label: "Difficile",
    aimJitter: 0.2,
    leadFactor: 0.75,
    dodgeChance: 0.3,
    missileDodgeChance: 0.5,
    reactionMs: 250,
    fireBurstMs: 900,
    firePauseMs: 500,
    missileChancePerTick: 0.015,
    usesDash: true,
    damageScale: 1,
    speedScale: 1,
  },
};

export function botStats(playerStats: PlayerStats, difficulty: BotDifficulty): PlayerStats {
  const { damageScale, speedScale } = BOT_PROFILES[difficulty];
  return {
    ...playerStats,
    primaryDamage: playerStats.primaryDamage * damageScale,
    specialDamage: playerStats.specialDamage * damageScale,
    speed: playerStats.speed * speedScale,
  };
}

export function botUsername(difficulty: BotDifficulty): string {
  return `Bot ${BOT_PROFILES[difficulty].label}`;
}

export interface BotBrain {
  profile: BotProfile;
  seq: number;
  strafeDir: 1 | -1;
  nextStrafeSwitch: number;
  aimOffset: number;
  nextAimRoll: number;
  lastTarget: { x: number; y: number } | null;
  // Per enemy bullet: when the bot starts dodging it, or false when it will not
  dodgeDecisions: Map<string, number | false>;
  firing: boolean;
  nextFireToggle: number;
  prevRightClick: boolean;
  prevDash: boolean;
}

export interface BotInput {
  seq: number;
  keys: string[];
  mouseAngle: number;
  leftClick: boolean;
  rightClick: boolean;
}

export function botShipFor(playerShip: string): string {
  return BOT_SHIPS.find((s) => s !== playerShip) ?? BOT_SHIPS[0];
}

export function createBotBrain(difficulty: BotDifficulty): BotBrain {
  return {
    profile: BOT_PROFILES[difficulty],
    seq: 0,
    strafeDir: Math.random() < 0.5 ? 1 : -1,
    nextStrafeSwitch: 0,
    aimOffset: 0,
    nextAimRoll: 0,
    lastTarget: null,
    dodgeDecisions: new Map(),
    // Toggled on the first tick, so every round opens with a burst
    firing: false,
    nextFireToggle: 0,
    prevRightClick: false,
    prevDash: false,
  };
}

// Keeps the input sequence going so bullet ids stay unique across rounds
export function resetBotBrain(brain: BotBrain): void {
  brain.lastTarget = null;
  brain.dodgeDecisions.clear();
  brain.nextStrafeSwitch = 0;
  brain.firing = false;
  brain.nextFireToggle = 0;
  brain.prevRightClick = false;
  brain.prevDash = false;
}

export function nextBotInput(
  brain: BotBrain,
  bot: PlayerState,
  target: PlayerState | undefined,
  bullets: BulletState[],
  now: number,
): BotInput {
  brain.seq++;
  const profile = brain.profile;
  const input: BotInput = {
    seq: brain.seq,
    keys: [],
    mouseAngle: bot.angle,
    leftClick: false,
    rightClick: false,
  };
  if (!target || target.hp <= 0) {
    brain.lastTarget = null;
    return input;
  }

  let targetVx = brain.lastTarget ? target.x - brain.lastTarget.x : 0;
  let targetVy = brain.lastTarget ? target.y - brain.lastTarget.y : 0;
  brain.lastTarget = { x: target.x, y: target.y };
  // Several inputs of the player can be processed in one tick after a lag spike, and a dash
  // jumps far: the observed step is capped to the ship's real speed so the aim stays sane
  const step = Math.hypot(targetVx, targetVy);
  if (step > target.speed) {
    targetVx *= target.speed / step;
    targetVy *= target.speed / step;
  }

  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  if (now >= brain.nextAimRoll) {
    brain.aimOffset = (Math.random() * 2 - 1) * profile.aimJitter;
    brain.nextAimRoll = now + AIM_ROLL_MS;
  }
  const travelTicks = dist / bot.primaryBulletSpeed;
  const aimX = target.x + targetVx * travelTicks * profile.leadFactor;
  const aimY = target.y + targetVy * travelTicks * profile.leadFactor;
  input.mouseAngle = Math.atan2(aimY - bot.y, aimX - bot.x) + brain.aimOffset;

  if (now >= brain.nextStrafeSwitch) {
    brain.strafeDir = brain.strafeDir === 1 ? -1 : 1;
    brain.nextStrafeSwitch =
      now +
      STRAFE_SWITCH_MIN_MS +
      Math.random() * (STRAFE_SWITCH_MAX_MS - STRAFE_SWITCH_MIN_MS);
  }
  let tx = -uy * brain.strafeDir;
  let ty = ux * brain.strafeDir;
  if (pushesIntoWall(bot, tx, ty)) {
    brain.strafeDir = brain.strafeDir === 1 ? -1 : 1;
    tx = -tx;
    ty = -ty;
  }

  const radial =
    dist > PREFERRED_DISTANCE + DISTANCE_TOLERANCE
      ? 1
      : dist < PREFERRED_DISTANCE - DISTANCE_TOLERANCE
        ? -1
        : 0;
  let mx = ux * radial + tx;
  let my = uy * radial + ty;

  const threat = findThreat(brain, bot, bullets, now);
  if (threat) {
    ({ x: mx, y: my } = slideAlongWalls(bot, threat.dirX, threat.dirY));
    // Pinned in a corner: crossing the bullet's path is the only way out
    if (Math.hypot(mx, my) < 0.2) {
      mx = -threat.dirX;
      my = -threat.dirY;
    }
  } else {
    if (bot.x < WALL_MARGIN) mx += 1;
    if (bot.x > GAME_CONFIG.MAP_WIDTH - WALL_MARGIN) mx -= 1;
    if (bot.y < WALL_MARGIN) my += 1;
    if (bot.y > GAME_CONFIG.MAP_HEIGHT - WALL_MARGIN) my -= 1;
  }
  input.keys = toKeys(mx, my);

  // Dash and missile are triggered on a key press, so they are held for a single tick
  const wantDash =
    !brain.prevDash &&
    !!threat?.urgent &&
    profile.usesDash &&
    bot.perks.dash &&
    bot.energy >= PERK_CONFIG.DASH_ENERGY;
  if (wantDash) input.keys.push("shift");
  brain.prevDash = wantDash;

  if (now >= brain.nextFireToggle) {
    brain.firing = !brain.firing;
    brain.nextFireToggle = now + (brain.firing ? profile.fireBurstMs : profile.firePauseMs);
  }
  input.leftClick = brain.firing && dist < FIRE_RANGE;

  const wantMissile =
    !brain.prevRightClick &&
    dist < MISSILE_RANGE &&
    bot.energy >= bot.specialEnergyCost &&
    Math.random() < profile.missileChancePerTick;
  input.rightClick = wantMissile;
  brain.prevRightClick = wantMissile;

  return input;
}

function pushesIntoWall(bot: PlayerState, dirX: number, dirY: number): boolean {
  return (
    (bot.x < WALL_MARGIN && dirX < 0) ||
    (bot.x > GAME_CONFIG.MAP_WIDTH - WALL_MARGIN && dirX > 0) ||
    (bot.y < WALL_MARGIN && dirY < 0) ||
    (bot.y > GAME_CONFIG.MAP_HEIGHT - WALL_MARGIN && dirY > 0)
  );
}

// Drops the parts of a move that would push the ship into a wall it is already against
function slideAlongWalls(bot: PlayerState, dirX: number, dirY: number): { x: number; y: number } {
  let x = dirX;
  let y = dirY;
  if ((bot.x < WALL_MARGIN && x < 0) || (bot.x > GAME_CONFIG.MAP_WIDTH - WALL_MARGIN && x > 0)) x = 0;
  if ((bot.y < WALL_MARGIN && y < 0) || (bot.y > GAME_CONFIG.MAP_HEIGHT - WALL_MARGIN && y > 0)) y = 0;
  return { x, y };
}

// The most imminent enemy bullet on a collision course, if the bot decided to react to it
function findThreat(
  brain: BotBrain,
  bot: PlayerState,
  bullets: BulletState[],
  now: number,
): { dirX: number; dirY: number; urgent: boolean } | null {
  if (brain.dodgeDecisions.size > 64) {
    const live = new Set(bullets.map((b) => b.id));
    for (const id of brain.dodgeDecisions.keys()) {
      if (!live.has(id)) brain.dodgeDecisions.delete(id);
    }
  }

  let best: { dirX: number; dirY: number; ticks: number } | null = null;
  for (const b of bullets) {
    if (b.ownerId === bot.id) continue;
    const speedSq = b.vx * b.vx + b.vy * b.vy;
    if (speedSq === 0) continue;
    const ticks = ((bot.x - b.x) * b.vx + (bot.y - b.y) * b.vy) / speedSq;
    // Lag compensation tests the bullet against where the bot was viewLag ago, so only the
    // ticks left after that delay can still be used to move out of the way
    const ticksLeft = ticks - b.viewLag / GAME_CONFIG.TICK_RATE;
    if (ticksLeft <= 0 || ticks > DODGE_HORIZON_TICKS) continue;
    const cx = b.x + b.vx * ticks;
    const cy = b.y + b.vy * ticks;
    const missX = bot.x - cx;
    const missY = bot.y - cy;
    const miss = Math.hypot(missX, missY);
    if (miss >= GAME_CONFIG.SHIP_RADIUS + b.radius + DODGE_MARGIN) continue;

    let reactAt = brain.dodgeDecisions.get(b.id);
    if (reactAt === undefined) {
      const chance =
        b.type === "special" ? brain.profile.missileDodgeChance : brain.profile.dodgeChance;
      reactAt = Math.random() < chance ? now + brain.profile.reactionMs : false;
      brain.dodgeDecisions.set(b.id, reactAt);
    }
    if (reactAt === false || now < reactAt) continue;
    if (best && best.ticks <= ticksLeft) continue;

    const speed = Math.sqrt(speedSq);
    const dir =
      miss > 1
        ? { dirX: missX / miss, dirY: missY / miss }
        : { dirX: -b.vy / speed, dirY: b.vx / speed };
    best = { ...dir, ticks: ticksLeft };
  }
  return best
    ? { dirX: best.dirX, dirY: best.dirY, urgent: best.ticks < DODGE_URGENT_TICKS }
    : null;
}

function toKeys(mx: number, my: number): string[] {
  const len = Math.hypot(mx, my);
  if (len < 0.2) return [];
  const nx = mx / len;
  const ny = my / len;
  const keys: string[] = [];
  if (ny < -KEY_THRESHOLD) keys.push("z");
  if (ny > KEY_THRESHOLD) keys.push("s");
  if (nx < -KEY_THRESHOLD) keys.push("q");
  if (nx > KEY_THRESHOLD) keys.push("d");
  return keys;
}
