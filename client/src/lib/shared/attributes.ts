// Keep in sync with server/src/shared/attributes.ts
import { MAX_LEVEL } from './xp';

export type AttributeKey =
	| 'blindage'
	| 'deflecteur'
	| 'canons'
	| 'cadence'
	| 'ogive'
	| 'propulseurs'
	| 'reacteur';

export type BranchKey = 'defense' | 'attaque' | 'deplacement';

export type Attributes = Record<AttributeKey, number>;

export const ATTRIBUTE_KEYS: AttributeKey[] = [
	'blindage',
	'deflecteur',
	'canons',
	'cadence',
	'ogive',
	'propulseurs',
	'reacteur'
];

export const ATTRIBUTE_MAX = 10;
export const PERK_THRESHOLDS = [4, 10] as const;
export const RESPEC_COST_GALACTICS = 2;
// One point per level from this level up to MAX_LEVEL, never enough to max every attribute
export const POINTS_START_LEVEL = 10;

export const BASE_STATS = {
	maxHp: 100,
	damageReduction: 0,
	primaryDamage: 10,
	primaryCooldown: 200,
	primaryBulletSpeed: 7,
	specialDamage: 40,
	specialCooldown: 2000,
	specialEnergyCost: 20,
	speed: 3,
	maxEnergy: 100,
	// Energy regained per second
	energyRegen: 5
};

export const PER_POINT = {
	blindage: 5, // max HP
	deflecteur: 0.015, // damage reduction
	canons: 0.7, // primary damage
	canonsBulletSpeed: 0.28, // primary bullet speed
	cadence: 6, // ms removed from primary cooldown
	ogive: 3, // missile damage
	propulseurs: 0.2, // speed
	reacteurEnergy: 10, // max energy
	reacteurRegen: 0.5 // energy per second
};

export const PERK_CONFIG = {
	REGEN_DELAY_MS: 3000,
	REGEN_PER_SECOND: 4,
	ENERGY_ON_HIT: 2,
	EXECUTE_HP_RATIO: 0.3,
	EXECUTE_BONUS: 0.5,
	DASH_DISTANCE: 110,
	DASH_ENERGY: 25,
	DASH_COOLDOWN_MS: 3000,
	DASH_INVULN_MS: 250
};

export const BRANCH_ATTRIBUTES: Record<BranchKey, AttributeKey[]> = {
	defense: ['blindage', 'deflecteur'],
	attaque: ['canons', 'cadence', 'ogive'],
	deplacement: ['propulseurs', 'reacteur']
};

export interface Perks {
	regen: boolean;
	lastStand: boolean;
	energyOnHit: boolean;
	execute: boolean;
	dash: boolean;
	dashInvuln: boolean;
}

export interface PlayerStats {
	maxHp: number;
	damageReduction: number;
	speed: number;
	maxEnergy: number;
	energyRegen: number;
	primaryDamage: number;
	primaryCooldown: number;
	primaryBulletSpeed: number;
	specialDamage: number;
	specialCooldown: number;
	specialEnergyCost: number;
	perks: Perks;
}

export function emptyAttributes(): Attributes {
	return {
		blindage: 0,
		deflecteur: 0,
		canons: 0,
		cadence: 0,
		ogive: 0,
		propulseurs: 0,
		reacteur: 0
	};
}

export function sanitizeAttributes(raw: unknown): Attributes {
	const out = emptyAttributes();
	if (!raw || typeof raw !== 'object') return out;
	const src = raw as Record<string, unknown>;
	for (const key of ATTRIBUTE_KEYS) {
		const v = src[key];
		if (typeof v === 'number' && Number.isInteger(v)) {
			out[key] = Math.min(ATTRIBUTE_MAX, Math.max(0, v));
		}
	}
	return out;
}

export function totalPoints(level: number): number {
	const capped = Math.min(Math.floor(level), MAX_LEVEL);
	return capped >= POINTS_START_LEVEL ? capped - POINTS_START_LEVEL + 1 : 0;
}

export function spentPoints(a: Attributes): number {
	return ATTRIBUTE_KEYS.reduce((sum, k) => sum + a[k], 0);
}

export function branchPoints(a: Attributes, branch: BranchKey): number {
	return BRANCH_ATTRIBUTES[branch].reduce((sum, k) => sum + a[k], 0);
}

export function computePerks(a: Attributes): Perks {
	const def = branchPoints(a, 'defense');
	const att = branchPoints(a, 'attaque');
	const dep = branchPoints(a, 'deplacement');
	const [first, second] = PERK_THRESHOLDS;
	return {
		regen: def >= first,
		lastStand: def >= second,
		energyOnHit: att >= first,
		execute: att >= second,
		dash: dep >= first,
		dashInvuln: dep >= second
	};
}

export function computeStats(a: Attributes): PlayerStats {
	return {
		maxHp: BASE_STATS.maxHp + a.blindage * PER_POINT.blindage,
		damageReduction: a.deflecteur * PER_POINT.deflecteur,
		speed: BASE_STATS.speed + a.propulseurs * PER_POINT.propulseurs,
		maxEnergy: BASE_STATS.maxEnergy + a.reacteur * PER_POINT.reacteurEnergy,
		energyRegen: BASE_STATS.energyRegen + a.reacteur * PER_POINT.reacteurRegen,
		primaryDamage: BASE_STATS.primaryDamage + a.canons * PER_POINT.canons,
		primaryCooldown: BASE_STATS.primaryCooldown - a.cadence * PER_POINT.cadence,
		primaryBulletSpeed: BASE_STATS.primaryBulletSpeed + a.canons * PER_POINT.canonsBulletSpeed,
		specialDamage: BASE_STATS.specialDamage + a.ogive * PER_POINT.ogive,
		specialCooldown: BASE_STATS.specialCooldown,
		specialEnergyCost: BASE_STATS.specialEnergyCost,
		perks: computePerks(a)
	};
}

// An allocation exceeding the level's points is ignored rather than trusted
export function effectiveAttributes(raw: unknown, level: number): Attributes {
	const a = sanitizeAttributes(raw);
	return spentPoints(a) <= totalPoints(level) ? a : emptyAttributes();
}

export function respecCost(respecCount: number): number {
	return respecCount > 0 ? RESPEC_COST_GALACTICS : 0;
}
