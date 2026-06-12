import { Item } from "../models/Item.js";

export { xpForLevel, applyXP } from "../shared/xp.js";

export const GAME_CONFIG = {
  MAP_WIDTH: 1280,
  MAP_HEIGHT: 720,
  SHIP_SPEED: 3,
  SHIP_RADIUS: 24, // hitbox circulaire (75% de la demi-largeur du sprite 64px)
  MAX_HP: 100,
  MAX_ENERGY: 100,
  ENERGY_REGEN: 5 / 60, // par tick (60 tick/s)
  BULLET_NORMAL_SPEED: 7,
  BULLET_NORMAL_DAMAGE: 10,
  BULLET_NORMAL_COOLDOWN: 200, // ms
  BULLET_SPECIAL_SPEED: 5,
  BULLET_SPECIAL_DAMAGE: 40,
  BULLET_SPECIAL_COOLDOWN: 2000, // ms
  BULLET_SPECIAL_ENERGY: 20,
  BULLET_RADIUS: 6,
  ROUNDS_TO_WIN: 3,
  POINTS_PER_WIN: 100,
  CREDITS_PER_LOSS: 25, // le perdant progresse aussi (victoire = 4× plus rentable)
  GALACTICS_PER_LEVEL: 1,
  // Désertion : pénalité = 5% × (nº de désertion) du solde courant, plafonnée
  // à 50%, intégralement transférée à l'adversaire lésé.
  DESERTION_PENALTY_RATE: 0.05,
  DESERTION_PENALTY_CAP: 0.5,
  XP_PER_WIN: 120,
  XP_PER_LOSS: 40,
  TICK_RATE: 1000 / 60,
};

// Stats effectives d'un joueur, dérivées de son équipement (DB).
// Les valeurs GAME_CONFIG ci-dessus servent de base/fallback.
export interface LoadoutStats {
  maxHp: number;
  maxEnergy: number;
  speed: number;
  primaryDamage: number;
  primaryCooldown: number;
  specialDamage: number;
  specialCooldown: number;
  specialEnergyCost: number;
}

function clampStat(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

// Charge les stats de l'équipement depuis la DB (source de vérité — jamais le client).
// Les clamps protègent la simulation contre des données DB aberrantes.
export async function loadLoadoutStats(
  ship: string,
  bulletPrimary: string,
  bulletSecondary: string,
): Promise<LoadoutStats> {
  const [shipItem, primaryItem, specialItem] = await Promise.all([
    Item.findOne({ sprite: ship, type: "ship" }).select("stats").lean(),
    Item.findOne({ sprite: bulletPrimary, type: "bullet", bulletRole: "primary" })
      .select("stats")
      .lean(),
    Item.findOne({ sprite: bulletSecondary, type: "bullet", bulletRole: "secondary" })
      .select("stats")
      .lean(),
  ]);

  return {
    maxHp: clampStat(shipItem?.stats?.hp, 50, 300, GAME_CONFIG.MAX_HP),
    maxEnergy: clampStat(shipItem?.stats?.energy, 50, 300, GAME_CONFIG.MAX_ENERGY),
    speed: clampStat(shipItem?.stats?.speed, 1, 6, GAME_CONFIG.SHIP_SPEED),
    primaryDamage: clampStat(
      primaryItem?.stats?.damage, 1, 100, GAME_CONFIG.BULLET_NORMAL_DAMAGE,
    ),
    primaryCooldown: clampStat(
      primaryItem?.stats?.cooldown, 80, 5000, GAME_CONFIG.BULLET_NORMAL_COOLDOWN,
    ),
    specialDamage: clampStat(
      specialItem?.stats?.damage, 1, 150, GAME_CONFIG.BULLET_SPECIAL_DAMAGE,
    ),
    specialCooldown: clampStat(
      specialItem?.stats?.cooldown, 500, 10_000, GAME_CONFIG.BULLET_SPECIAL_COOLDOWN,
    ),
    specialEnergyCost: clampStat(
      specialItem?.stats?.energy, 0, 100, GAME_CONFIG.BULLET_SPECIAL_ENERGY,
    ),
  };
}

export interface PlayerState extends LoadoutStats {
  id: string; // socket id
  userId: string;
  username: string;
  x: number;
  y: number;
  angle: number; // en radians, direction du vaisseau
  hp: number;
  energy: number;
  sprite: string;
  bulletSprite: string; // tir principal (clic gauche)
  bulletSpriteSecondary: string; // tir secondaire (clic droit)
  lastNormalShot: number;
  lastSpecialShot: number;
  prevRightClick: boolean; // pour edge detection du tir spécial
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
}

export interface RoomState {
  roomId: string;
  players: Map<string, PlayerState>; // socketId → state
  bullets: BulletState[];
  scores: Map<string, number>; // socketId → manches gagnées
  spectators: Set<string>;
  status: "waiting" | "playing" | "roundEnd" | "matchEnd";
  roundStartTime: number;
  intervalId?: ReturnType<typeof setInterval>;
  nextRoundTimeout?: ReturnType<typeof setTimeout>;
  waitingPlayers?: string[]; // socketIds des joueurs en attente
  lastSent?: Map<string, { x: number; y: number; angle: number; hp: number; energy: number }>;
}

// Calcule le spawn en fonction du numéro de joueur (0 ou 1)
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
  stats: LoadoutStats,
): PlayerState {
  const { x, y } = getSpawnPosition(playerIndex);
  return {
    id: socketId,
    userId,
    username,
    x,
    y,
    angle: playerIndex === 0 ? 0 : Math.PI,
    hp: stats.maxHp,
    energy: stats.maxEnergy,
    sprite,
    bulletSprite,
    bulletSpriteSecondary,
    lastNormalShot: 0,
    lastSpecialShot: 0,
    prevRightClick: false,
    ...stats,
  };
}

// Applique les inputs d'un joueur à son état
export function applyInput(
  player: PlayerState,
  input: {
    keys: string[];
    mouseAngle: number;
    leftClick: boolean;
    rightClick: boolean;
  },
  now: number,
): BulletState[] {
  const bullets: BulletState[] = [];

  // Rotation : suivi de la souris
  player.angle = input.mouseAngle;

  // Déplacement ZQSD
  let dx = 0;
  let dy = 0;
  if (input.keys.includes("z") || input.keys.includes("w")) dy -= 1;
  if (input.keys.includes("s")) dy += 1;
  if (input.keys.includes("q") || input.keys.includes("a")) dx -= 1;
  if (input.keys.includes("d")) dx += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.sqrt(dx * dx + dy * dy);
    player.x = Math.max(
      GAME_CONFIG.SHIP_RADIUS,
      Math.min(
        GAME_CONFIG.MAP_WIDTH - GAME_CONFIG.SHIP_RADIUS,
        player.x + (dx / len) * player.speed,
      ),
    );
    player.y = Math.max(
      GAME_CONFIG.SHIP_RADIUS,
      Math.min(
        GAME_CONFIG.MAP_HEIGHT - GAME_CONFIG.SHIP_RADIUS,
        player.y + (dy / len) * player.speed,
      ),
    );
  }

  // NB : la régénération d'énergie est appliquée par tick serveur (voir makeTick),
  // pas ici — sinon un client qui spamme des inputs régénérerait plus vite.

  const muzzleOffset = GAME_CONFIG.SHIP_RADIUS + GAME_CONFIG.BULLET_RADIUS + 1;
  const cos = Math.cos(player.angle);
  const sin = Math.sin(player.angle);

  // Tir normal (clic gauche maintenu, régulé par cooldown)
  if (
    input.leftClick &&
    now - player.lastNormalShot >= player.primaryCooldown
  ) {
    player.lastNormalShot = now;
    bullets.push({
      id: `${player.id}_n_${now}`,
      ownerId: player.id,
      x: player.x + cos * muzzleOffset,
      y: player.y + sin * muzzleOffset,
      vx: cos * GAME_CONFIG.BULLET_NORMAL_SPEED,
      vy: sin * GAME_CONFIG.BULLET_NORMAL_SPEED,
      damage: player.primaryDamage,
      radius: GAME_CONFIG.BULLET_RADIUS,
      type: "normal",
      sprite: player.bulletSprite,
    });
  }

  // Tir spécial : edge detection — déclenché uniquement sur front montant du clic droit.
  const specialPressed = input.rightClick && !player.prevRightClick;
  if (
    specialPressed &&
    now - player.lastSpecialShot >= player.specialCooldown &&
    player.energy >= player.specialEnergyCost
  ) {
    player.lastSpecialShot = now;
    player.energy -= player.specialEnergyCost;
    const specialMuzzle = GAME_CONFIG.SHIP_RADIUS + GAME_CONFIG.BULLET_RADIUS * 2 + 1;
    bullets.push({
      id: `${player.id}_s_${now}`,
      ownerId: player.id,
      x: player.x + cos * specialMuzzle,
      y: player.y + sin * specialMuzzle,
      vx: cos * GAME_CONFIG.BULLET_SPECIAL_SPEED,
      vy: sin * GAME_CONFIG.BULLET_SPECIAL_SPEED,
      damage: player.specialDamage,
      radius: GAME_CONFIG.BULLET_RADIUS * 2,
      type: "special",
      sprite: player.bulletSpriteSecondary,
    });
  }
  player.prevRightClick = input.rightClick;

  return bullets;
}

// Collision vaisseau-vaisseau SANS dégâts : sépare les paires qui se
// chevauchent en repoussant chaque vaisseau de la moitié de la pénétration,
// borné aux limites de la map. Appelé chaque tick après les mouvements.
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
        // Parfaitement superposés : axe de séparation arbitraire
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

// Déplace les bullets en place et compacte le tableau, retourne les ids des bullets supprimées (sorties de la map)
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

export function resolveCollisions(
  bullets: BulletState[],
  players: PlayerState[],
): string[] {
  const removed: string[] = [];
  let write = 0;

  for (let read = 0; read < bullets.length; read++) {
    const bullet = bullets[read];
    let hit = false;
    for (const player of players) {
      if (player.id === bullet.ownerId) continue;
      const dx = bullet.x - player.x;
      const dy = bullet.y - player.y;
      const threshold = bullet.radius + GAME_CONFIG.SHIP_RADIUS;
      if (dx * dx + dy * dy < threshold * threshold) {
        player.hp = Math.max(0, player.hp - bullet.damage);
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
