// Mirror exact des constantes serveur (server/src/services/game.service.ts).
// Si tu changes une valeur côté serveur, change-la ici aussi — sinon la prédiction
// client divergera de la simulation autoritaire et provoquera du rubber-banding.
export const GAME_CONFIG = {
	MAP_WIDTH: 1280,
	MAP_HEIGHT: 720,
	SHIP_SPEED: 3,
	SHIP_RADIUS: 16,
	MAX_HP: 100,
	MAX_ENERGY: 100,
	ENERGY_REGEN: 5 / 60
};

export interface PredictedPlayer {
	x: number;
	y: number;
	angle: number;
}

export interface PredictedInput {
	keys: string[];
	mouseAngle: number;
}

// Mirror du mouvement serveur. On ne prédit QUE x/y/angle — pas hp/energy/tirs.
export function applyMovement(player: PredictedPlayer, input: PredictedInput): void {
	player.angle = input.mouseAngle;

	let dx = 0;
	let dy = 0;
	if (input.keys.includes('z') || input.keys.includes('w')) dy -= 1;
	if (input.keys.includes('s')) dy += 1;
	if (input.keys.includes('q') || input.keys.includes('a')) dx -= 1;
	if (input.keys.includes('d')) dx += 1;

	if (dx !== 0 || dy !== 0) {
		const len = Math.sqrt(dx * dx + dy * dy);
		player.x = Math.max(
			GAME_CONFIG.SHIP_RADIUS,
			Math.min(
				GAME_CONFIG.MAP_WIDTH - GAME_CONFIG.SHIP_RADIUS,
				player.x + (dx / len) * GAME_CONFIG.SHIP_SPEED
			)
		);
		player.y = Math.max(
			GAME_CONFIG.SHIP_RADIUS,
			Math.min(
				GAME_CONFIG.MAP_HEIGHT - GAME_CONFIG.SHIP_RADIUS,
				player.y + (dy / len) * GAME_CONFIG.SHIP_SPEED
			)
		);
	}
}
