import { PERK_CONFIG } from '$lib/shared/attributes';

export const GAME_CONFIG = {
	MAP_WIDTH: 1280,
	MAP_HEIGHT: 720,
	SHIP_SPEED: 3,
	SHIP_RADIUS: 24,
	MAX_HP: 100,
	MAX_ENERGY: 100,
	ENERGY_REGEN: 5 / 60,
	TICK_MS: 1000 / 60,
	BULLET_SPECIAL_SPEED: 5,
	BULLET_RADIUS: 6
};

// Must match the server: cooldowns are counted in inputs (one input per tick)
// Must match the server: primary shots carry the fractional tick remainder
export function shotInterval(cooldownMs: number): number {
	return (cooldownMs * 60) / 1000;
}

export function nextShotClock(last: number, clock: number, interval: number): number {
	return clock - last < 2 * interval ? last + interval : clock;
}

export function cooldownTicks(cooldownMs: number): number {
	return Math.max(1, Math.round(cooldownMs / GAME_CONFIG.TICK_MS));
}

export interface PredictedPlayer {
	x: number;
	y: number;
	angle: number;
	speed: number;
}

export interface PredictedInput {
	keys: string[];
	mouseAngle: number;
	// Set when this input was predicted to trigger a dash
	dash?: boolean;
}

// Same rule as the server: dash along the movement direction, or forward when standing still
export function dashDirection(keys: string[], angle: number): { x: number; y: number } {
	const { dx, dy } = moveVector(keys);
	const len = Math.sqrt(dx * dx + dy * dy);
	return len > 0 ? { x: dx / len, y: dy / len } : { x: Math.cos(angle), y: Math.sin(angle) };
}

function moveVector(keys: string[]): { dx: number; dy: number } {
	let dx = 0;
	let dy = 0;
	if (keys.includes('z') || keys.includes('w')) dy -= 1;
	if (keys.includes('s')) dy += 1;
	if (keys.includes('q') || keys.includes('a')) dx -= 1;
	if (keys.includes('d')) dx += 1;
	return { dx, dy };
}

export function applyMovement(
	player: PredictedPlayer,
	input: PredictedInput,
	blockers?: { x: number; y: number }[]
): void {
	player.angle = input.mouseAngle;

	const { dx, dy } = moveVector(input.keys);

	if (dx !== 0 || dy !== 0) {
		const len = Math.sqrt(dx * dx + dy * dy);
		const speed = player.speed || GAME_CONFIG.SHIP_SPEED;
		player.x = Math.max(
			GAME_CONFIG.SHIP_RADIUS,
			Math.min(GAME_CONFIG.MAP_WIDTH - GAME_CONFIG.SHIP_RADIUS, player.x + (dx / len) * speed)
		);
		player.y = Math.max(
			GAME_CONFIG.SHIP_RADIUS,
			Math.min(GAME_CONFIG.MAP_HEIGHT - GAME_CONFIG.SHIP_RADIUS, player.y + (dy / len) * speed)
		);
	}

	if (input.dash) {
		const dir = dashDirection(input.keys, player.angle);
		player.x = Math.max(
			GAME_CONFIG.SHIP_RADIUS,
			Math.min(
				GAME_CONFIG.MAP_WIDTH - GAME_CONFIG.SHIP_RADIUS,
				player.x + dir.x * PERK_CONFIG.DASH_DISTANCE
			)
		);
		player.y = Math.max(
			GAME_CONFIG.SHIP_RADIUS,
			Math.min(
				GAME_CONFIG.MAP_HEIGHT - GAME_CONFIG.SHIP_RADIUS,
				player.y + dir.y * PERK_CONFIG.DASH_DISTANCE
			)
		);
	}

	if (blockers) {
		const minDist = GAME_CONFIG.SHIP_RADIUS * 2;
		for (const b of blockers) {
			let bx = player.x - b.x;
			let by = player.y - b.y;
			let dist = Math.hypot(bx, by);
			if (dist >= minDist) continue;
			if (dist === 0) {
				bx = 1;
				by = 0;
				dist = 1;
			}
			const push = (minDist - dist) / 2;
			player.x = Math.max(
				GAME_CONFIG.SHIP_RADIUS,
				Math.min(GAME_CONFIG.MAP_WIDTH - GAME_CONFIG.SHIP_RADIUS, player.x + (bx / dist) * push)
			);
			player.y = Math.max(
				GAME_CONFIG.SHIP_RADIUS,
				Math.min(GAME_CONFIG.MAP_HEIGHT - GAME_CONFIG.SHIP_RADIUS, player.y + (by / dist) * push)
			);
		}
	}
}
