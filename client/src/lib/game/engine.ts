import {
	Application,
	Sprite,
	AnimatedSprite,
	Texture,
	Graphics,
	Container,
	Text,
	TextStyle,
	Assets,
	type Ticker
} from 'pixi.js';
import { Starfield } from './starfield';
import {
	GAME_CONFIG,
	applyMovement,
	type PredictedInput,
	type PredictedPlayer
} from './physics';
import type { Socket } from 'socket.io-client';

// Particules de propulseur : données pures, dessinées chaque frame dans UN SEUL
// Graphics partagé (un objet Pixi par particule créait un churn d'allocations
// qui faisait chuter les FPS).
interface ThrusterParticle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number; // en frames équivalentes 60 fps
	maxLife: number;
	size: number;
}

interface PlayerState {
	id: string;
	x: number;
	y: number;
	angle: number;
	hp: number;
	energy: number;
	maxHp?: number;
	maxEnergy?: number;
	speed?: number;
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
interface BulletPayload {
	id: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	angle: number;
	type: string;
	sprite: string;
}
interface GameStartPayload {
	players: (PlayerState & {
		username: string;
		sprite: string;
		bulletSprite: string;
		bulletSpriteSecondary: string;
	})[];
	config: { mapWidth: number; mapHeight: number };
}

interface PlayerVisual {
	container: Container;
	sprite: Sprite | AnimatedSprite;
	hpBar: Graphics;
	hpBg: Graphics;
	energyBar: Graphics;
	energyBg: Graphics;
	nameText: Text;
	state: PlayerState & { username: string; sprite: string };
	targetX: number;
	targetY: number;
	targetAngle: number;
	isMoving: boolean;
	thrustAcc: number; // accumulateur de spawn de particules (indépendant du framerate)
}

// Balles : simulation locale par vélocité (le serveur n'envoie qu'une correction
// périodique). simX/simY est la position simulée, le visuel lerp dessus.
interface BulletVisual {
	visual: Sprite | Graphics;
	simX: number;
	simY: number;
	vx: number;
	vy: number;
}

// Sprites qui ont des frames d'animation : "spaceship-01" → ["spaceship-01-f1.png", ..., "spaceship-01-f4.png"]
const ANIMATED_SPRITES: Record<string, string[]> = {
	'spaceship-01': ['spaceship-01-f1', 'spaceship-01-f2', 'spaceship-01-f3', 'spaceship-01-f4'],
	'spaceship-02': ['spaceship-02-f1', 'spaceship-02-f2', 'spaceship-02-f3', 'spaceship-02-f4'],
	'spaceship-03': ['spaceship-03-f1', 'spaceship-03-f2', 'spaceship-03-f3', 'spaceship-03-f4'],
	'spaceship-04': ['spaceship-04-f1', 'spaceship-04-f2', 'spaceship-04-f3', 'spaceship-04-f4'],
	'spaceship-05': ['spaceship-05-f1', 'spaceship-05-f2', 'spaceship-05-f3', 'spaceship-05-f4'],
	'spaceship-06': ['spaceship-06-f1', 'spaceship-06-f2', 'spaceship-06-f3', 'spaceship-06-f4'],
};

function isAnimated(spriteName: string): spriteName is keyof typeof ANIMATED_SPRITES {
	return spriteName in ANIMATED_SPRITES;
}

export class GameEngine {
	private app: Application;
	private starfield!: Starfield;
	private playerVisuals = new Map<string, PlayerVisual>();
	private bulletVisuals = new Map<string, BulletVisual>();
	private socket: Socket;
	private myId: string;
	private isSpectator: boolean;

	private thrusterParticles: ThrusterParticle[] = [];
	private thrusterGfx!: Graphics;

	private keys = new Set<string>();
	private mouseAngle = 0;
	private mouseWorldX = 0;
	private mouseWorldY = 0;
	private leftClick = false;
	private rightClick = false;

	private scoreText!: Text;
	private hudContainer!: Container;

	// Stored so they can be removed in destroy()
	private onKeyDown = (e: KeyboardEvent) => this.keys.add(e.key.toLowerCase());
	private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
	// Si la fenêtre perd le focus, les keyup ne sont jamais reçus → touches "collées".
	private onBlur = () => {
		this.keys.clear();
		this.leftClick = false;
		this.rightClick = false;
	};

	private mapWidth = 1280;
	private mapHeight = 720;

	private inputIntervalId: ReturnType<typeof setInterval> | null = null;
	private inputSeq = 0;

	private predicted: PredictedPlayer = { x: 0, y: 0, angle: 0, speed: 3 };
	private pendingInputs: { seq: number; input: PredictedInput }[] = [];
	private hasPredictedState = false;
	private static readonly MAX_PENDING_INPUTS = 200;

	constructor(socket: Socket, myId: string, isSpectator: boolean) {
		this.socket = socket;
		this.myId = myId;
		this.isSpectator = isSpectator;

		this.app = new Application();
	}

	async init(canvas: HTMLCanvasElement) {
		await this.app.init({
			canvas,
			width: this.mapWidth,
			height: this.mapHeight,
			background: 0x050510,
			antialias: true
		});

		this.starfield = new Starfield(this.app, this.mapWidth, this.mapHeight);

		this.thrusterGfx = new Graphics();
		this.app.stage.addChild(this.thrusterGfx);

		this.setupHUD();

		if (!this.isSpectator) {
			this.setupInputs(canvas);
		}

		// Toutes les mises à jour visuelles sont scalées par deltaTime (1 = frame à 60 fps)
		// pour que le jeu se comporte pareil à 60, 120 ou 144 Hz.
		this.app.ticker.add((ticker: Ticker) => {
			const dt = ticker.deltaTime;
			this.starfield.update(dt);
			this.interpolatePlayers(dt);
			this.interpolateBullets(dt);
			this.updateThrusterParticles(dt);
		});

		if (!this.isSpectator) {
			this.inputIntervalId = setInterval(() => this.sendInput(), 1000 / 60);
		}

		return this;
	}

	private setupHUD() {
		this.hudContainer = new Container();
		this.app.stage.addChild(this.hudContainer);

		const style = new TextStyle({ fill: '#ffffff', fontSize: 18, fontWeight: 'bold' });
		this.scoreText = new Text({ text: '', style });
		this.scoreText.x = this.mapWidth / 2;
		this.scoreText.y = 12;
		this.scoreText.anchor.set(0.5, 0);
		this.hudContainer.addChild(this.scoreText);
	}

	private setupInputs(canvas: HTMLCanvasElement) {
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.addEventListener('blur', this.onBlur);

		canvas.addEventListener('mousemove', (e) => {
			const rect = canvas.getBoundingClientRect();
			this.mouseWorldX = (e.clientX - rect.left) / (rect.width / this.mapWidth);
			this.mouseWorldY = (e.clientY - rect.top) / (rect.height / this.mapHeight);
			this.updateMouseAngle();
		});

		canvas.addEventListener('mousedown', (e) => {
			if (e.button === 0) this.leftClick = true;
			if (e.button === 2) this.rightClick = true;
		});

		canvas.addEventListener('mouseup', (e) => {
			if (e.button === 0) this.leftClick = false;
			if (e.button === 2) this.rightClick = false;
		});

		canvas.addEventListener('contextmenu', (e) => e.preventDefault());
	}

	// Positions serveur connues des autres vaisseaux — utilisées pour prédire
	// la collision vaisseau-vaisseau (le serveur sépare, on anticipe la poussée).
	private getBlockers(): { x: number; y: number }[] {
		const blockers: { x: number; y: number }[] = [];
		for (const [id, v] of this.playerVisuals) {
			if (id !== this.myId) blockers.push({ x: v.targetX, y: v.targetY });
		}
		return blockers;
	}

	private updateMouseAngle() {
		// Position prédite plutôt que visuelle : l'angle reste exact même quand
		// le vaisseau bouge alors que la souris est immobile.
		if (this.hasPredictedState) {
			this.mouseAngle = Math.atan2(
				this.mouseWorldY - this.predicted.y,
				this.mouseWorldX - this.predicted.x
			);
			return;
		}
		const myPlayer = this.playerVisuals.get(this.myId);
		if (!myPlayer) return;
		const dx = this.mouseWorldX - myPlayer.container.x;
		const dy = this.mouseWorldY - myPlayer.container.y;
		this.mouseAngle = Math.atan2(dy, dx);
	}

	private sendInput() {
		this.inputSeq++;
		// Recalcule l'angle à chaque envoi : le vaisseau a pu bouger sans mousemove
		this.updateMouseAngle();
		const keys = Array.from(this.keys);
		const input: PredictedInput = { keys, mouseAngle: this.mouseAngle };

		this.socket.emit('game:input', {
			seq: this.inputSeq,
			keys,
			mouseAngle: this.mouseAngle,
			leftClick: this.leftClick,
			rightClick: this.rightClick
		});

		if (this.hasPredictedState) {
			applyMovement(this.predicted, input, this.getBlockers());
			this.pendingInputs.push({ seq: this.inputSeq, input });
			// Garde-fou : si le serveur cesse d'acquitter (lag fort, déco), on ne laisse pas la queue exploser.
			if (this.pendingInputs.length > GameEngine.MAX_PENDING_INPUTS) {
				this.pendingInputs.splice(0, this.pendingInputs.length - GameEngine.MAX_PENDING_INPUTS);
			}
		}
	}

	async onGameStart(payload: GameStartPayload) {
		if (
			payload.config.mapWidth !== this.mapWidth ||
			payload.config.mapHeight !== this.mapHeight
		) {
			this.mapWidth = payload.config.mapWidth;
			this.mapHeight = payload.config.mapHeight;
			this.app.renderer.resize(this.mapWidth, this.mapHeight);
			this.scoreText.x = this.mapWidth / 2;
		}

		const spritesToLoad = new Set<string>();
		for (const p of payload.players) {
			if (isAnimated(p.sprite)) {
				for (const frame of ANIMATED_SPRITES[p.sprite]) {
					spritesToLoad.add(`/assets/${frame}.png`);
				}
			} else {
				spritesToLoad.add(`/assets/${p.sprite}.png`);
			}
			spritesToLoad.add(`/assets/${p.bulletSprite}.png`);
			spritesToLoad.add(`/assets/${p.bulletSpriteSecondary}.png`);
		}

		await Promise.all(Array.from(spritesToLoad).map((url) => Assets.load(url).catch(() => null)));

		for (const p of payload.players) {
			this.createPlayerVisual(p);
		}
	}

	private createShipSprite(spriteName: string, playerId: string): Sprite | AnimatedSprite {
		// Les sprites sont dessinés nez vers le haut — on les pré-rotate de -90° pour que
		// le nez pointe vers la droite (angle 0 dans le repère du moteur).
		if (isAnimated(spriteName)) {
			const frames = ANIMATED_SPRITES[spriteName].map((f) => {
				const tex = Assets.get(`/assets/${f}.png`);
				return tex ?? Texture.WHITE;
			});
			const anim = new AnimatedSprite(frames);
			anim.anchor.set(0.5);
			anim.width = 64;
			anim.height = 64;
			anim.rotation = Math.PI / 2;
			anim.animationSpeed = 0.15;
			anim.loop = true;
			anim.gotoAndStop(0);
			return anim;
		}

		const texture = Assets.get(`/assets/${spriteName}.png`);
		const spr = new Sprite(texture ?? Texture.WHITE);
		spr.anchor.set(0.5);
		spr.width = 64;
		spr.height = 64;
		spr.rotation = Math.PI / 2;
		if (!texture) spr.tint = playerId === this.myId ? 0x00aaff : 0xff4444;
		return spr;
	}

	private createPlayerVisual(p: PlayerState & { username: string; sprite: string }) {
		const container = new Container();

		const shipSprite = this.createShipSprite(p.sprite, p.id);

		// Hitbox réelle (SHIP_RADIUS serveur) en cercle très fin — lisibilité des
		// impacts et des collisions vaisseau-vaisseau.
		const hitbox = new Graphics()
			.circle(0, 0, GAME_CONFIG.SHIP_RADIUS)
			.stroke({ width: 1, color: p.id === this.myId ? 0x4dd9ff : 0xff6b6b, alpha: 0.35 });

		const hpBg = new Graphics().rect(-24, 30, 48, 5).fill({ color: 0x333333 });
		const hpBar = new Graphics().rect(-24, 30, 48, 5).fill({ color: 0x44ff44 });
		const energyBg = new Graphics().rect(-24, 37, 48, 4).fill({ color: 0x333333 });
		const energyBar = new Graphics().rect(-24, 37, 48, 4).fill({ color: 0x4488ff });

		const nameText = new Text({
			text: p.username,
			style: new TextStyle({ fill: p.id === this.myId ? '#88ccff' : '#ffaaaa', fontSize: 11 })
		});
		nameText.anchor.set(0.5, 1);
		nameText.y = -32;

		container.addChild(hitbox, hpBg, hpBar, energyBg, energyBar, shipSprite, nameText);
		container.x = p.x;
		container.y = p.y;

		this.app.stage.addChild(container);

		this.playerVisuals.set(p.id, {
			container,
			sprite: shipSprite,
			hpBar,
			hpBg,
			energyBar,
			energyBg,
			nameText,
			state: { ...p },
			targetX: p.x,
			targetY: p.y,
			targetAngle: p.angle,
			isMoving: false,
			thrustAcc: 0
		});

		if (p.id === this.myId) {
			this.predicted.x = p.x;
			this.predicted.y = p.y;
			this.predicted.angle = p.angle;
			// Vitesse du vaisseau équipé : la prédiction doit utiliser la même
			// valeur que la simulation serveur.
			this.predicted.speed = p.speed ?? 3;
			this.hasPredictedState = true;
		}
	}

	private setShipMoving(v: PlayerVisual, moving: boolean) {
		if (!(v.sprite instanceof AnimatedSprite)) return;
		if (moving && !v.sprite.playing) {
			v.sprite.play();
		} else if (!moving && v.sprite.playing) {
			v.sprite.gotoAndStop(0);
		}
	}

	onGameState(state: {
		players: PlayerDelta[];
		bulletsAdded: BulletPayload[];
		bulletsRemoved: string[];
		bulletsUpdated?: { id: string; x: number; y: number }[];
	}) {
		for (const p of state.players) {
			const visual = this.playerVisuals.get(p.id);
			if (!visual) continue;

			if (p.id === this.myId && this.hasPredictedState) {
				if (p.x !== undefined) this.predicted.x = p.x;
				if (p.y !== undefined) this.predicted.y = p.y;
				if (p.angle !== undefined) this.predicted.angle = p.angle;

				const acked = p.lastProcessedSeq ?? 0;
				this.pendingInputs = this.pendingInputs.filter((pi) => pi.seq > acked);
				const blockers = this.getBlockers();
				for (const pending of this.pendingInputs) {
					applyMovement(this.predicted, pending.input, blockers);
				}
			} else {
				const prevX = visual.container.x;
				const prevY = visual.container.y;
				if (p.x !== undefined) visual.targetX = p.x;
				if (p.y !== undefined) visual.targetY = p.y;
				if (p.angle !== undefined) visual.targetAngle = p.angle;
				visual.isMoving =
					Math.abs((p.x ?? prevX) - prevX) > 0.5 ||
					Math.abs((p.y ?? prevY) - prevY) > 0.5;
				this.setShipMoving(visual, visual.isMoving);
			}

			// HP / énergie : invariant — jamais prédits côté client (le serveur est seule source de vérité,
			// sinon les barres "remontent" quand la prédiction et la collision serveur divergent).
			if (p.hp !== undefined) visual.state.hp = p.hp;
			if (p.energy !== undefined) visual.state.energy = p.energy;
			if (p.hp !== undefined || p.energy !== undefined) this.updateBars(visual);
		}

		for (const id of state.bulletsRemoved) {
			const entry = this.bulletVisuals.get(id);
			if (entry) {
				entry.visual.destroy();
				this.bulletVisuals.delete(id);
			}
		}

		for (const b of state.bulletsAdded) {
			if (this.bulletVisuals.has(b.id)) continue;
			const texture = Assets.get(`/assets/${b.sprite}.png`);
			const isSpecial = b.type === 'special';
			let visual: Sprite | Graphics;
			if (texture) {
				const spr = new Sprite(texture);
				spr.anchor.set(0.5);
				spr.width = isSpecial ? 24 : 16;
				spr.height = isSpecial ? 24 : 16;
				spr.rotation = b.angle ?? 0;
				visual = spr;
			} else {
				const g = new Graphics();
				g.circle(0, 0, isSpecial ? 6 : 3).fill({ color: isSpecial ? 0xff8800 : 0x00ffff });
				visual = g;
			}
			visual.x = b.x;
			visual.y = b.y;
			this.app.stage.addChild(visual);
			this.bulletVisuals.set(b.id, {
				visual,
				simX: b.x,
				simY: b.y,
				vx: b.vx ?? 0,
				vy: b.vy ?? 0
			});
		}

		// Corrections périodiques du serveur : on recale la simulation locale
		if (state.bulletsUpdated) {
			for (const u of state.bulletsUpdated) {
				const entry = this.bulletVisuals.get(u.id);
				if (!entry) continue;
				entry.simX = u.x;
				entry.simY = u.y;
			}
		}
	}

	updateScores(scores: Record<string, number>) {
		const parts = Object.entries(scores).map(([id, score]) => {
			const v = this.playerVisuals.get(id);
			return `${v?.state.username ?? '?'}: ${score}`;
		});
		this.scoreText.text = parts.join('  —  ');
	}

	resetRound(players?: { id: string; x: number; y: number; angle: number; hp: number; energy: number }[]) {
		for (const entry of this.bulletVisuals.values()) entry.visual.destroy();
		this.bulletVisuals.clear();
		this.leftClick = false;
		this.rightClick = false;
		this.keys.clear();
		this.pendingInputs = [];

		if (players) {
			for (const p of players) {
				const visual = this.playerVisuals.get(p.id);
				if (!visual) continue;
				visual.state.hp = p.hp;
				visual.state.energy = p.energy;
				visual.container.x = p.x;
				visual.container.y = p.y;
				visual.targetX = p.x;
				visual.targetY = p.y;
				visual.targetAngle = p.angle;
				visual.sprite.rotation = p.angle + Math.PI / 2;
				visual.isMoving = false;
				this.setShipMoving(visual, false);
				this.updateBars(visual);

				if (p.id === this.myId) {
					this.predicted.x = p.x;
					this.predicted.y = p.y;
					this.predicted.angle = p.angle;
				}
			}
		}
	}

	// Facteur de lissage indépendant du framerate : équivaut à `base` par frame à 60 fps.
	private static smoothing(base: number, dt: number): number {
		return 1 - Math.pow(1 - base, dt);
	}

	private interpolateBullets(dt: number) {
		// La vélocité serveur est exprimée en px/tick (60 ticks/s) et dt en frames
		// équivalentes 60 fps → l'extrapolation locale colle à la simulation serveur.
		const k = GameEngine.smoothing(0.35, dt);
		for (const entry of this.bulletVisuals.values()) {
			entry.simX += entry.vx * dt;
			entry.simY += entry.vy * dt;
			entry.visual.x += (entry.simX - entry.visual.x) * k;
			entry.visual.y += (entry.simY - entry.visual.y) * k;
		}
	}

	private spawnThrusterParticles(x: number, y: number, angle: number) {
		const backAngle = angle + Math.PI;
		const spawnDist = 22;
		const baseX = x + Math.cos(backAngle) * spawnDist;
		const baseY = y + Math.sin(backAngle) * spawnDist;

		for (let i = 0; i < 3; i++) {
			const spread = (Math.random() - 0.5) * 0.6;
			const speed = 1.5 + Math.random() * 2;
			const particleAngle = backAngle + spread;

			this.thrusterParticles.push({
				x: baseX + (Math.random() - 0.5) * 6,
				y: baseY + (Math.random() - 0.5) * 6,
				vx: Math.cos(particleAngle) * speed,
				vy: Math.sin(particleAngle) * speed,
				life: 0,
				maxLife: 12 + Math.random() * 8,
				size: 2.5 + Math.random() * 2.5
			});
		}
	}

	private updateThrusterParticles(dt: number) {
		for (const [id, v] of this.playerVisuals) {
			let moving = false;
			let angle = 0;
			let px = 0;
			let py = 0;

			if (id === this.myId && this.hasPredictedState) {
				const k = this.keys;
				moving = k.has('z') || k.has('w') || k.has('s') || k.has('q') || k.has('a') || k.has('d');
				angle = this.predicted.angle;
				px = this.predicted.x;
				py = this.predicted.y;

				// Sync animation pour le joueur local
				this.setShipMoving(v, moving);
			} else {
				moving = v.isMoving;
				angle = v.targetAngle;
				px = v.container.x;
				py = v.container.y;
			}

			// Pas de particules pour les sprites animés (ils ont déjà la flamme intégrée).
			// Le spawn est accumulé en temps 60 fps pour ne pas dépendre du refresh écran.
			if (!isAnimated(v.state.sprite) && moving) {
				v.thrustAcc += dt;
				while (v.thrustAcc >= 1) {
					v.thrustAcc -= 1;
					this.spawnThrusterParticles(px, py, angle);
				}
			} else {
				v.thrustAcc = 0;
			}
		}

		const gfx = this.thrusterGfx;
		gfx.clear();
		const damping = Math.pow(0.92, dt);
		for (let i = this.thrusterParticles.length - 1; i >= 0; i--) {
			const p = this.thrusterParticles[i];
			p.life += dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.vx *= damping;
			p.vy *= damping;

			if (p.life >= p.maxLife) {
				this.thrusterParticles.splice(i, 1);
				continue;
			}

			const t = p.life / p.maxLife;
			const alpha = (1 - t) * 0.85;
			const size = p.size * (1 - t * 0.5);

			let color: number;
			if (t < 0.25) color = 0xffffff;
			else if (t < 0.55) color = 0xff9933;
			else color = 0xff3300;

			gfx.circle(p.x, p.y, size).fill({ color, alpha });
		}
	}

	private interpolatePlayers(dt: number) {
		const k = GameEngine.smoothing(0.2, dt);
		for (const [id, v] of this.playerVisuals) {
			if (id === this.myId && this.hasPredictedState) {
				v.container.x = this.predicted.x;
				v.container.y = this.predicted.y;
				v.sprite.rotation = this.predicted.angle + Math.PI / 2;
				continue;
			}
			v.container.x += (v.targetX - v.container.x) * k;
			v.container.y += (v.targetY - v.container.y) * k;

			// Interpoler l'angle logique (sans le -π/2 de base)
			const targetRotation = v.targetAngle + Math.PI / 2;
			let da = targetRotation - v.sprite.rotation;
			while (da > Math.PI) da -= Math.PI * 2;
			while (da < -Math.PI) da += Math.PI * 2;
			v.sprite.rotation += da * k;
		}
	}

	private updateBars(v: PlayerVisual) {
		const hpRatio = Math.max(0, v.state.hp / (v.state.maxHp ?? 100));
		const energyRatio = Math.max(0, v.state.energy / (v.state.maxEnergy ?? 100));

		v.hpBar
			.clear()
			.rect(-24, 30, 48 * hpRatio, 5)
			.fill({
				color: hpRatio > 0.5 ? 0x44ff44 : hpRatio > 0.25 ? 0xffaa00 : 0xff4444
			});

		v.energyBar
			.clear()
			.rect(-24, 37, 48 * energyRatio, 4)
			.fill({ color: 0x4488ff });
	}

	destroy() {
		if (this.inputIntervalId !== null) {
			clearInterval(this.inputIntervalId);
			this.inputIntervalId = null;
		}
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		window.removeEventListener('blur', this.onBlur);
		this.starfield?.destroy();
		this.app.destroy(false);
	}
}
