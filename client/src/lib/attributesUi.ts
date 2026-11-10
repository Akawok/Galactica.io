import {
	BASE_STATS,
	PERK_CONFIG,
	PER_POINT,
	type AttributeKey,
	type BranchKey,
	type Perks
} from './shared/attributes';

export interface AttributeInfo {
	key: AttributeKey;
	label: string;
	effect: (points: number) => string;
}

export interface PerkInfo {
	key: keyof Perks;
	label: string;
	description: string;
}

export interface BranchInfo {
	key: BranchKey;
	label: string;
	accent: string;
	attributes: AttributeInfo[];
	perks: [PerkInfo, PerkInfo];
}

// Every effect is shown as a gain over the base ship, which players read more easily than raw values
const gain = (added: number, base: number) => `+${Math.round((added / base) * 100)} %`;

export const BRANCHES: BranchInfo[] = [
	{
		key: 'defense',
		label: 'Défense',
		accent: '#4dd9ff',
		attributes: [
			{
				key: 'blindage',
				label: 'Blindage',
				effect: (p) => `${gain(p * PER_POINT.blindage, BASE_STATS.maxHp)} de points de vie`
			},
			{
				key: 'deflecteur',
				label: 'Déflecteur',
				effect: (p) => `-${Math.round(p * PER_POINT.deflecteur * 100)} % de dégâts reçus`
			}
		],
		perks: [
			{
				key: 'regen',
				label: 'Nanoréparation',
				description: `Après ${PERK_CONFIG.REGEN_DELAY_MS / 1000} s sans être touché, ta coque se répare toute seule.`
			},
			{
				key: 'lastStand',
				label: 'Dernier rempart',
				description: 'Une fois par manche, un coup fatal te laisse à 1 PV au lieu de te détruire.'
			}
		]
	},
	{
		key: 'attaque',
		label: 'Attaque',
		accent: '#ff5566',
		attributes: [
			{
				key: 'canons',
				label: 'Canons',
				effect: (p) =>
					`${gain(p * PER_POINT.canons, BASE_STATS.primaryDamage)} de dégâts et ${gain(p * PER_POINT.canonsBulletSpeed, BASE_STATS.primaryBulletSpeed)} de vitesse des tirs`
			},
			{
				key: 'cadence',
				label: 'Cadence',
				effect: (p) =>
					`+${Math.round((BASE_STATS.primaryCooldown / (BASE_STATS.primaryCooldown - p * PER_POINT.cadence) - 1) * 100)} % de cadence de tir`
			},
			{
				key: 'ogive',
				label: 'Ogive',
				effect: (p) => `${gain(p * PER_POINT.ogive, BASE_STATS.specialDamage)} de dégâts du missile`
			}
		],
		perks: [
			{
				key: 'energyOnHit',
				label: 'Siphon',
				description: 'Chaque tir qui touche recharge un peu ton énergie.'
			},
			{
				key: 'execute',
				label: 'Exécution',
				description: `+${PERK_CONFIG.EXECUTE_BONUS * 100} % de dégâts sur une cible sous ${PERK_CONFIG.EXECUTE_HP_RATIO * 100} % de PV.`
			}
		]
	},
	{
		key: 'deplacement',
		label: 'Déplacement',
		accent: '#ffaa33',
		attributes: [
			{
				key: 'propulseurs',
				label: 'Propulseurs',
				effect: (p) => `${gain(p * PER_POINT.propulseurs, BASE_STATS.speed)} de vitesse`
			},
			{
				key: 'reacteur',
				label: 'Réacteur',
				effect: (p) =>
					`${gain(p * PER_POINT.reacteurEnergy, BASE_STATS.maxEnergy)} d'énergie et de recharge`
			}
		],
		perks: [
			{
				key: 'dash',
				label: 'Dash',
				description: `Shift : un bond rapide vers l'avant, utilisable toutes les ${PERK_CONFIG.DASH_COOLDOWN_MS / 1000} s. Coûte un quart de ton énergie.`
			},
			{
				key: 'dashInvuln',
				label: 'Phase',
				description: 'Tu es intouchable pendant le dash.'
			}
		]
	}
];
