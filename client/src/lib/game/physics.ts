// Mirror exact des constantes serveur (server/src/services/game.service.ts).
// Si tu changes une valeur côté serveur, change-la ici aussi — sinon la prédiction
// client divergera de la simulation autoritaire et provoquera du rubber-banding.
export const GAME_CONFIG = {
	MAP_WIDTH: 1280,
	MAP_HEIGHT: 720,
	SHIP_SPEED: 3,
	SHIP_RADIUS: 24,
	MAX_HP: 100,
	MAX_ENERGY: 100,
	ENERGY_REGEN: 5 / 60
};

export interface PredictedPlayer {
	x: number;
	y: number;
	angle: number;
	// Vitesse du vaisseau équipé, fournie par le serveur dans game:start.
	// Doit matcher la stat serveur sinon la prédiction rubber-band.
	speed: number;
}

export interface PredictedInput {
	keys: string[];
	mouseAngle: number;
}

// Mirror du mouvement serveur. On ne prédit QUE x/y/angle — pas hp/energy/tirs.
// `blockers` = positions des autres vaisseaux : le serveur sépare les vaisseaux
// qui se chevauchent (collision sans dégâts), on prédit ici la même poussée
// (moitié de la pénétration, comme côté serveur) pour éviter le rubber-banding.
export function applyMovement(
	player: PredictedPlayer,
	input: PredictedInput,
	blockers?: { x: number; y: number }[]
): void {
	player.angle = input.mouseAngle;

	let dx = 0;
	let dy = 0;
	if (input.keys.includes('z') || input.keys.includes('w')) dy -= 1;
	if (input.keys.includes('s')) dy += 1;
	if (input.keys.includes('q') || input.keys.includes('a')) dx -= 1;
	if (input.keys.includes('d')) dx += 1;

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
