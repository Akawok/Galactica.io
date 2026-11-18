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
	cooldownTicks,
	dashDirection,
	nextShotClock,
	shotInterval,
	type PredictedInput,
	type PredictedPlayer
} from './physics';
import { PERK_CONFIG } from '$lib/shared/attributes';
import { getGrade } from '$lib/shared/grades';
import { api } from '$lib/api';
import { findItem, itemFrameUrls, type ItemImageRef } from '$lib/itemImages';
import type { Socket } from 'socket.io-client';
import * as sfx from './sfx';

// Remote entities are rendered this far in the past so there are always two snapshots to blend
const INTERP_DELAY_MS = 100;
// When snapshots stop arriving, remote ships keep moving on their last velocity for at most this long
const MAX_EXTRAPOLATION_MS = 100;
const SAMPLE_BUFFER_MS = 1000;
const MAX_STEPS_PER_FRAME = 4;
// Fraction of a reconciliation error still visible after one 60fps frame
const CORRECTION_DECAY = 0.85;
const CORRECTION_SNAP_DISTANCE = 120;
// A hit at least this strong (a missile) gets the heavy feedback
const HEAVY_HIT_DAMAGE = 25;
const HIT_FLASH_MS = 110;
const HIT_FLASH_TINT = 0xff5050;
const MAX_SHAKE = 18;
const SHAKE_DECAY = 0.86;
const RETICLE_COLOR = 0x4dd9ff;
const RETICLE_LOCK_COLOR = 0xff4d4d;
const MISSILE_READY_COLOR = 0xffa040;
const HIT_MARKER_MS = 160;
const ZONE_COLOR = 0xff3050;
const ZONE_WARNING_MS = 5000;
const ZONE_TICK_SECONDS = 3;
const ZONE_CALM_TEXT = '#a8b4dc';
const ZONE_ALERT_TEXT = '#ff6b81';
const ZONE_ANNOUNCE_MS = 2500;

interface BlastParticle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	size: number;
	color: number;
	// Shockwave rings grow instead of moving
	ring: boolean;
}

interface ThrusterParticle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
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
	inv?: boolean;
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
interface BulletPayload {
	id: string;
	ownerId: string;
	seq: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	t: number;
	type: string;
	sprite: string;
}
export interface GameStatePayload {
	players: PlayerDelta[];
	bulletsAdded: BulletPayload[];
	bulletsRemoved: string[];
	// Ships the closing zone damaged this tick
	zoneHits?: string[];
	t: number;
}
interface StartPlayer extends PlayerState {
	username: string;
	level?: number;
	sprite: string;
	bulletSprite: string;
	bulletSpriteSecondary: string;
	primaryCooldown?: number;
	specialCooldown?: number;
	specialEnergyCost?: number;
	primaryBulletSpeed?: number;
	dash?: boolean;
}
export interface ZoneInfo {
	x: number;
	y: number;
	startRadius: number;
	delayMs: number;
	shrinkMs: number;
	// Server time the round started at
	startedAt: number;
}

export interface GameStartPayload {
	players: StartPlayer[];
	config: { mapWidth: number; mapHeight: number };
	zone?: ZoneInfo;
	t?: number;
}

interface Sample {
	t: number;
	x: number;
	y: number;
	angle: number;
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
	// Latest authoritative values from the server
	known: { x: number; y: number; angle: number };
	samples: Sample[];
	displayAngle: number;
	isMoving: boolean;
	thrustAcc: number;
	baseTint: number;
	flashUntil: number;
}

interface BulletVisual {
	visual: Sprite | Graphics;
	radius: number;
	// Own bullets live on the local input timeline (x0, y0 at input step0),
	// remote bullets on the delayed server timeline (x0, y0 at server time t0)
	own: boolean;
	x0: number;
	y0: number;
	vx: number;
	vy: number;
	step0: number;
	t0: number;
	seq: number;
	confirmed: boolean;
	removeAt: number | null;
	predictedHit: boolean;
}

function lerpAngle(a: number, b: number, k: number): number {
	let d = b - a;
	while (d > Math.PI) d -= Math.PI * 2;
	while (d < -Math.PI) d += Math.PI * 2;
	return a + d * k;
}

// 25 -> "0:25"
function formatSeconds(total: number): string {
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function clampX(x: number): number {
	return Math.max(
		GAME_CONFIG.SHIP_RADIUS,
		Math.min(GAME_CONFIG.MAP_WIDTH - GAME_CONFIG.SHIP_RADIUS, x)
	);
}

function clampY(y: number): number {
	return Math.max(
		GAME_CONFIG.SHIP_RADIUS,
		Math.min(GAME_CONFIG.MAP_HEIGHT - GAME_CONFIG.SHIP_RADIUS, y)
	);
}

export class GameEngine {
	private app: Application;
	private initDone = false;
	private destroyed = false;
	private starfield!: Starfield;
	private playerVisuals = new Map<string, PlayerVisual>();
	private shipFrameUrls = new Map<string, string[]>();
	private bulletImageUrls = new Map<string, string>();
	private bulletVisuals = new Map<string, BulletVisual>();
	private socket: Socket;
	private myId: string;
	private isSpectator: boolean;

	private thrusterParticles: ThrusterParticle[] = [];
	private thrusterGfx!: Graphics;
	private blastParticles: BlastParticle[] = [];
	private blastGfx!: Graphics;
	private shake = 0;
	private reticle: Graphics | null = null;
	private zone: ZoneInfo | null = null;
	private zoneGfx!: Graphics;
	private zoneText!: Text;
	private zoneAlarmPlayed = false;
	private lastCountdownTick: number | null = null;
	// The zone stops closing while the round-end screen is up
	private zoneFrozenAt: number | null = null;
	private mouseOnCanvas = false;
	private reticleSpin = 0;
	private hitMarkerUntil = 0;

	private keys = new Set<string>();
	private mouseAngle = 0;
	private mouseWorldX = 0;
	private mouseWorldY = 0;
	private leftClick = false;
	private rightClick = false;

	private scoreText!: Text;
	private hudContainer!: Container;

	private onKeyDown = (e: KeyboardEvent) => this.keys.add(e.key.toLowerCase());
	private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
	private onBlur = () => {
		this.keys.clear();
		this.leftClick = false;
		this.rightClick = false;
	};

	private mapWidth = 1280;
	private mapHeight = 720;

	// Server clock estimate: serverTime ≈ performance.now() + clockOffset
	private clockOffset = 0;
	private hasClock = false;

	private inputSeq = 0;
	private stepAcc = 0;
	private paused = false;
	private predicted: PredictedPlayer = { x: 0, y: 0, angle: 0, speed: 3 };
	private prevPredicted = { x: 0, y: 0 };
	private correction = { x: 0, y: 0 };
	private pendingInputs: { seq: number; input: PredictedInput }[] = [];
	private hasPredictedState = false;
	private static readonly MAX_PENDING_INPUTS = 200;

	private myLoadout = {
		primaryCooldown: 200,
		specialCooldown: 2000,
		specialEnergyCost: 20,
		primaryBulletSpeed: 7,
		dash: false,
		bulletSprite: '',
		bulletSpriteSecondary: ''
	};
	// Shot clock = inputs sent this round; seq - roundBaseSeq mirrors the server's inputClock
	private roundBaseSeq = 0;
	private lastNormalShotClock = -Infinity;
	private lastSpecialShotClock = -Infinity;
	private prevRightClick = false;
	private lastDashClock = -Infinity;
	private prevDashKey = false;
	// Energy spent by predicted actions the server has not acknowledged yet
	private unackedSpends: { seq: number; cost: number }[] = [];

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
		// The page can be left while Pixi is still starting: finish the teardown here
		if (this.destroyed) {
			this.app.destroy(false);
			return this;
		}
		this.initDone = true;

		this.starfield = new Starfield(this.app, this.mapWidth, this.mapHeight);

		this.zoneGfx = new Graphics();
		this.app.stage.addChild(this.zoneGfx);
		this.thrusterGfx = new Graphics();
		this.app.stage.addChild(this.thrusterGfx);
		this.blastGfx = new Graphics();
		this.app.stage.addChild(this.blastGfx);

		this.setupHUD();

		if (!this.isSpectator) {
			this.setupInputs(canvas);
		}

		this.app.ticker.add((ticker: Ticker) => {
			const dt = ticker.deltaTime;
			this.runPrediction(ticker.deltaMS);
			const renderTime = this.renderTime();
			this.starfield.update(dt);
			this.renderPlayers(dt, renderTime);
			this.renderBullets(renderTime);
			this.updateThrusterParticles(dt);
			this.updateBlastParticles(dt);
			this.updateShake(dt);
			this.drawZone();
			this.drawReticle(dt);
		});

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

		this.zoneText = new Text({
			text: '',
			style: new TextStyle({ fill: '#ff6b81', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 })
		});
		this.zoneText.x = this.mapWidth / 2;
		this.zoneText.y = 38;
		this.zoneText.anchor.set(0.5, 0);
		this.hudContainer.addChild(this.zoneText);
	}

	private setupInputs(canvas: HTMLCanvasElement) {
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.addEventListener('blur', this.onBlur);

		// The system cursor is replaced by the reticle drawn in drawReticle. Pixi rewrites the
		// canvas cursor on every pointer move from its own styles, so those must say 'none' too
		const cursors = this.app.renderer.events.cursorStyles;
		cursors.default = 'none';
		cursors.pointer = 'none';
		canvas.style.cursor = 'none';
		this.reticle = new Graphics();
		this.app.stage.addChild(this.reticle);
		canvas.addEventListener('mouseleave', () => (this.mouseOnCanvas = false));

		canvas.addEventListener('mousemove', (e) => {
			this.mouseOnCanvas = true;
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

	private serverNow(): number {
		return performance.now() + this.clockOffset;
	}

	private renderTime(): number {
		return this.serverNow() - INTERP_DELAY_MS;
	}

	private updateClock(serverTime: number) {
		const sample = serverTime - performance.now();
		// Large jumps (first packet, tab back from background) reset the estimate, otherwise smooth it
		if (!this.hasClock || sample > this.clockOffset + 250 || sample < this.clockOffset - 1000) {
			this.clockOffset = sample;
			this.hasClock = true;
		} else {
			this.clockOffset += (sample - this.clockOffset) * 0.02;
		}
	}

	private getBlockers(): { x: number; y: number }[] {
		const blockers: { x: number; y: number }[] = [];
		for (const [id, v] of this.playerVisuals) {
			if (id !== this.myId) blockers.push({ x: v.known.x, y: v.known.y });
		}
		return blockers;
	}

	private updateMouseAngle() {
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

	private runPrediction(deltaMS: number) {
		if (this.isSpectator || !this.hasPredictedState || this.paused) return;
		this.stepAcc += deltaMS;
		let steps = 0;
		while (this.stepAcc >= GAME_CONFIG.TICK_MS && steps < MAX_STEPS_PER_FRAME) {
			this.step();
			this.stepAcc -= GAME_CONFIG.TICK_MS;
			steps++;
		}
		// Too far behind (tab in background): do not flood the server with catch-up inputs
		if (this.stepAcc >= GAME_CONFIG.TICK_MS) this.stepAcc = 0;
	}

	private step() {
		this.inputSeq++;
		this.updateMouseAngle();
		const keys = Array.from(this.keys);
		const dash = this.predictDash(keys, this.inputSeq);
		const input: PredictedInput = { keys, mouseAngle: this.mouseAngle, dash };

		this.socket.emit('game:input', {
			seq: this.inputSeq,
			keys,
			mouseAngle: this.mouseAngle,
			leftClick: this.leftClick,
			rightClick: this.rightClick,
			rt: Math.round(this.renderTime())
		});

		this.prevPredicted.x = this.predicted.x;
		this.prevPredicted.y = this.predicted.y;
		applyMovement(this.predicted, input, this.getBlockers());
		if (dash) {
			sfx.dash();
			const dir = dashDirection(keys, this.predicted.angle);
			this.spawnDashBurst(this.prevPredicted.x, this.prevPredicted.y, dir.x, dir.y);
		}
		this.pendingInputs.push({ seq: this.inputSeq, input });
		if (this.pendingInputs.length > GameEngine.MAX_PENDING_INPUTS) {
			this.pendingInputs.splice(0, this.pendingInputs.length - GameEngine.MAX_PENDING_INPUTS);
		}

		this.predictShots(this.inputSeq);
	}

	private predictedEnergy(): number {
		const me = this.playerVisuals.get(this.myId);
		const base = me?.state.energy ?? 0;
		return base - this.unackedSpends.reduce((sum, s) => sum + s.cost, 0);
	}

	private predictDash(keys: string[], seq: number): boolean {
		const pressed = keys.includes('shift');
		const edge = pressed && !this.prevDashKey;
		this.prevDashKey = pressed;
		if (!edge || !this.myLoadout.dash) return false;
		const clock = seq - this.roundBaseSeq;
		if (clock - this.lastDashClock < cooldownTicks(PERK_CONFIG.DASH_COOLDOWN_MS)) return false;
		if (this.predictedEnergy() < PERK_CONFIG.DASH_ENERGY) return false;
		this.lastDashClock = clock;
		this.unackedSpends.push({ seq, cost: PERK_CONFIG.DASH_ENERGY });
		return true;
	}

	private predictShots(seq: number) {
		const clock = seq - this.roundBaseSeq;
		const cos = Math.cos(this.predicted.angle);
		const sin = Math.sin(this.predicted.angle);

		if (
			this.leftClick &&
			clock - this.lastNormalShotClock >= shotInterval(this.myLoadout.primaryCooldown)
		) {
			this.lastNormalShotClock = nextShotClock(
				this.lastNormalShotClock,
				clock,
				shotInterval(this.myLoadout.primaryCooldown)
			);
			const muzzle = GAME_CONFIG.SHIP_RADIUS + GAME_CONFIG.BULLET_RADIUS + 1;
			this.spawnOwnBullet(`${this.myId}:${seq}:n`, seq, {
				x: this.predicted.x + cos * muzzle,
				y: this.predicted.y + sin * muzzle,
				vx: cos * this.myLoadout.primaryBulletSpeed,
				vy: sin * this.myLoadout.primaryBulletSpeed,
				type: 'normal',
				sprite: this.myLoadout.bulletSprite
			});
			sfx.shot();
		}

		const specialPressed = this.rightClick && !this.prevRightClick;
		const cost = this.myLoadout.specialEnergyCost;
		if (
			specialPressed &&
			clock - this.lastSpecialShotClock >= cooldownTicks(this.myLoadout.specialCooldown) &&
			this.predictedEnergy() >= cost
		) {
			this.lastSpecialShotClock = clock;
			this.unackedSpends.push({ seq, cost });
			const muzzle = GAME_CONFIG.SHIP_RADIUS + GAME_CONFIG.BULLET_RADIUS * 2 + 1;
			this.spawnOwnBullet(`${this.myId}:${seq}:s`, seq, {
				x: this.predicted.x + cos * muzzle,
				y: this.predicted.y + sin * muzzle,
				vx: cos * GAME_CONFIG.BULLET_SPECIAL_SPEED,
				vy: sin * GAME_CONFIG.BULLET_SPECIAL_SPEED,
				type: 'special',
				sprite: this.myLoadout.bulletSpriteSecondary
			});
			sfx.missile();
		}
		this.prevRightClick = this.rightClick;
	}

	private createBulletGraphic(type: string, sprite: string, angle: number): Sprite | Graphics {
		const url = this.bulletImageUrls.get(sprite);
		const texture = url ? Assets.get(url) : undefined;
		const isSpecial = type === 'special';
		let visual: Sprite | Graphics;
		if (texture) {
			const spr = new Sprite(texture);
			spr.anchor.set(0.5);
			spr.width = isSpecial ? 24 : 16;
			spr.height = isSpecial ? 24 : 16;
			spr.rotation = angle;
			visual = spr;
		} else {
			const g = new Graphics();
			g.circle(0, 0, isSpecial ? 6 : 3).fill({ color: isSpecial ? 0xff8800 : 0x00ffff });
			visual = g;
		}
		this.app.stage.addChild(visual);
		return visual;
	}

	private spawnOwnBullet(
		id: string,
		seq: number,
		b: { x: number; y: number; vx: number; vy: number; type: string; sprite: string }
	) {
		if (this.bulletVisuals.has(id)) return;
		const visual = this.createBulletGraphic(b.type, b.sprite, Math.atan2(b.vy, b.vx));
		visual.x = b.x;
		visual.y = b.y;
		this.bulletVisuals.set(id, {
			visual,
			radius: b.type === 'special' ? GAME_CONFIG.BULLET_RADIUS * 2 : GAME_CONFIG.BULLET_RADIUS,
			own: true,
			x0: b.x,
			y0: b.y,
			vx: b.vx,
			vy: b.vy,
			step0: seq,
			t0: 0,
			seq,
			confirmed: false,
			removeAt: null,
			predictedHit: false
		});
	}

	async onGameStart(payload: GameStartPayload) {
		if (payload.config.mapWidth !== this.mapWidth || payload.config.mapHeight !== this.mapHeight) {
			this.mapWidth = payload.config.mapWidth;
			this.mapHeight = payload.config.mapHeight;
			this.app.renderer.resize(this.mapWidth, this.mapHeight);
			this.scoreText.x = this.mapWidth / 2;
		}
		if (payload.t !== undefined) this.updateClock(payload.t);
		if (payload.zone) this.setZone(payload.zone);

		const newPlayers = payload.players.filter((p) => !this.playerVisuals.has(p.id));
		if (newPlayers.length === 0) return;

		// The catalog gives each sprite's frame count, and items can be added at any time
		const catalog: ItemImageRef[] = await api.shop
			.items()
			.then((r) => r.items)
			.catch(() => []);
		const imageOf = (type: string, sprite: string) =>
			itemFrameUrls(findItem(catalog, type, sprite) ?? { type, sprite });

		const spritesToLoad = new Set<string>();
		for (const p of newPlayers) {
			const frames = imageOf('ship', p.sprite);
			this.shipFrameUrls.set(p.sprite, frames);
			frames.forEach((url) => spritesToLoad.add(url));
			for (const bullet of [p.bulletSprite, p.bulletSpriteSecondary]) {
				const [url] = imageOf('bullet', bullet);
				if (!url) continue;
				this.bulletImageUrls.set(bullet, url);
				spritesToLoad.add(url);
			}
		}

		await Promise.all(Array.from(spritesToLoad).map((url) => Assets.load(url).catch(() => null)));
		if (this.destroyed) return;

		for (const p of newPlayers) {
			if (this.playerVisuals.has(p.id)) continue;
			this.createPlayerVisual(p);
		}
	}

	private createShipSprite(spriteName: string, playerId: string): Sprite | AnimatedSprite {
		const urls = this.shipFrameUrls.get(spriteName) ?? [];
		if (urls.length > 1) {
			const frames = urls.map((url) => Assets.get(url) ?? Texture.WHITE);
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

		const texture = urls[0] ? Assets.get(urls[0]) : undefined;
		const spr = new Sprite(texture ?? Texture.WHITE);
		spr.anchor.set(0.5);
		spr.width = 64;
		spr.height = 64;
		spr.rotation = Math.PI / 2;
		if (!texture) spr.tint = playerId === this.myId ? 0x00aaff : 0xff4444;
		return spr;
	}

	private createPlayerVisual(p: StartPlayer) {
		const container = new Container();

		const shipSprite = this.createShipSprite(p.sprite, p.id);

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

		const grade = getGrade(p.level ?? 1);
		const gradeText = new Text({
			text: grade.label.toUpperCase(),
			style: new TextStyle({ fill: grade.color, fontSize: 9, fontWeight: '700', letterSpacing: 1 })
		});
		gradeText.anchor.set(0.5, 1);
		gradeText.y = -45;

		container.addChild(hitbox, hpBg, hpBar, energyBg, energyBar, shipSprite, nameText, gradeText);
		container.x = p.x;
		container.y = p.y;
		shipSprite.rotation = p.angle + Math.PI / 2;

		this.app.stage.addChild(container);

		const visual: PlayerVisual = {
			container,
			sprite: shipSprite,
			hpBar,
			hpBg,
			energyBar,
			energyBg,
			nameText,
			state: { ...p },
			known: { x: p.x, y: p.y, angle: p.angle },
			samples: [],
			displayAngle: p.angle,
			baseTint: Number(shipSprite.tint),
			flashUntil: 0,
			isMoving: false,
			thrustAcc: 0
		};
		this.playerVisuals.set(p.id, visual);
		this.updateBars(visual);

		if (p.id === this.myId && !this.isSpectator) {
			this.predicted.x = p.x;
			this.predicted.y = p.y;
			this.predicted.angle = p.angle;
			this.predicted.speed = p.speed ?? 3;
			this.prevPredicted.x = p.x;
			this.prevPredicted.y = p.y;
			this.myLoadout = {
				primaryCooldown: p.primaryCooldown ?? this.myLoadout.primaryCooldown,
				specialCooldown: p.specialCooldown ?? this.myLoadout.specialCooldown,
				specialEnergyCost: p.specialEnergyCost ?? this.myLoadout.specialEnergyCost,
				primaryBulletSpeed: p.primaryBulletSpeed ?? this.myLoadout.primaryBulletSpeed,
				dash: p.dash ?? false,
				bulletSprite: p.bulletSprite,
				bulletSpriteSecondary: p.bulletSpriteSecondary
			};
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

	private isLocal(id: string): boolean {
		return id === this.myId && this.hasPredictedState;
	}

	onGameState(state: GameStatePayload) {
		if (typeof state.t === 'number') this.updateClock(state.t);
		const t = state.t;

		let ackedSeq: number | null = null;
		let serverClock: number | null = null;
		const zoneHits = new Set(state.zoneHits ?? []);
		for (const p of state.players) {
			const visual = this.playerVisuals.get(p.id);
			if (!visual) continue;
			if (p.x !== undefined) visual.known.x = p.x;
			if (p.y !== undefined) visual.known.y = p.y;
			if (p.angle !== undefined) visual.known.angle = p.angle;
			if (p.hp !== undefined) {
				const lost = visual.state.hp - p.hp;
				visual.state.hp = p.hp;
				if (lost > 0) this.onDamaged(p.id, visual, lost, zoneHits.has(p.id));
			}
			if (p.energy !== undefined) visual.state.energy = p.energy;
			if (p.inv !== undefined) visual.state.inv = p.inv;
			if (p.hp !== undefined || p.energy !== undefined) this.updateBars(visual);
			if (this.isLocal(p.id) && p.lastProcessedSeq !== undefined) {
				ackedSeq = p.lastProcessedSeq;
				serverClock = p.inputClock ?? null;
			}
		}

		// Every snapshot is a sample for every remote ship (unchanged fields are omitted by the server)
		for (const [id, visual] of this.playerVisuals) {
			if (this.isLocal(id)) continue;
			visual.samples.push({ t, x: visual.known.x, y: visual.known.y, angle: visual.known.angle });
			const cutoff = t - SAMPLE_BUFFER_MS;
			while (visual.samples.length > 2 && visual.samples[0].t < cutoff) visual.samples.shift();
		}

		for (const id of state.bulletsRemoved) {
			const entry = this.bulletVisuals.get(id);
			if (!entry) continue;
			if (entry.own) this.destroyBullet(id);
			else entry.removeAt = t;
		}

		for (const b of state.bulletsAdded) this.addServerBullet(b);

		if (ackedSeq !== null) this.reconcile(ackedSeq, serverClock);
	}

	private addServerBullet(b: BulletPayload) {
		const own = this.isLocal(b.ownerId);
		const existing = this.bulletVisuals.get(b.id);
		if (existing) {
			if (own) {
				existing.x0 = b.x;
				existing.y0 = b.y;
				existing.vx = b.vx;
				existing.vy = b.vy;
				existing.confirmed = true;
			}
			return;
		}
		if (!own) {
			if (b.type === 'special') sfx.missile(false);
			else sfx.shot(false);
		}
		const visual = this.createBulletGraphic(b.type, b.sprite, Math.atan2(b.vy, b.vx));
		visual.x = b.x;
		visual.y = b.y;
		this.bulletVisuals.set(b.id, {
			visual,
			radius: b.type === 'special' ? GAME_CONFIG.BULLET_RADIUS * 2 : GAME_CONFIG.BULLET_RADIUS,
			own,
			x0: b.x,
			y0: b.y,
			vx: b.vx,
			vy: b.vy,
			step0: b.seq,
			t0: b.t,
			seq: b.seq,
			confirmed: true,
			removeAt: null,
			predictedHit: false
		});
	}

	private destroyBullet(id: string) {
		const entry = this.bulletVisuals.get(id);
		if (!entry) return;
		entry.visual.destroy();
		this.bulletVisuals.delete(id);
	}

	private reconcile(ackedSeq: number, serverClock: number | null) {
		const me = this.playerVisuals.get(this.myId);
		if (!me) return;

		const beforeX = this.predicted.x;
		const beforeY = this.predicted.y;

		this.predicted.x = me.known.x;
		this.predicted.y = me.known.y;
		this.predicted.angle = me.known.angle;
		this.pendingInputs = this.pendingInputs.filter((pi) => pi.seq > ackedSeq);
		const blockers = this.getBlockers();
		for (const pending of this.pendingInputs) {
			applyMovement(this.predicted, pending.input, blockers);
		}

		// Hide the correction by blending it out over a few frames instead of snapping
		const dx = beforeX - this.predicted.x;
		const dy = beforeY - this.predicted.y;
		this.prevPredicted.x -= dx;
		this.prevPredicted.y -= dy;
		this.correction.x += dx;
		this.correction.y += dy;
		if (Math.hypot(this.correction.x, this.correction.y) > CORRECTION_SNAP_DISTANCE) {
			this.correction.x = 0;
			this.correction.y = 0;
		}

		this.unackedSpends = this.unackedSpends.filter((s) => s.seq > ackedSeq);

		// The server skips inputs it had to drop, so realign our shot clock on its count
		if (serverClock !== null && serverClock > 0) this.roundBaseSeq = ackedSeq - serverClock;

		// Predicted shots the server processed without spawning were mispredicted
		for (const [id, b] of this.bulletVisuals) {
			if (b.own && !b.confirmed && b.seq <= ackedSeq) this.destroyBullet(id);
		}
	}

	updateScores(scores: Record<string, number>) {
		const parts = Object.entries(scores).map(([id, score]) => {
			const v = this.playerVisuals.get(id);
			return `${v?.state.username ?? '?'}: ${score}`;
		});
		this.scoreText.text = parts.join('  —  ');
	}

	pause() {
		this.paused = true;
		this.zoneFrozenAt = this.serverNow();
	}

	resetRound(
		players?: { id: string; x: number; y: number; angle: number; hp: number; energy: number }[],
		zone?: ZoneInfo
	) {
		if (zone) this.setZone(zone);
		for (const entry of this.bulletVisuals.values()) entry.visual.destroy();
		this.bulletVisuals.clear();
		this.leftClick = false;
		this.rightClick = false;
		this.keys.clear();
		this.pendingInputs = [];
		this.unackedSpends = [];
		this.roundBaseSeq = this.inputSeq;
		this.lastNormalShotClock = -Infinity;
		this.lastSpecialShotClock = -Infinity;
		this.lastDashClock = -Infinity;
		this.prevRightClick = false;
		this.prevDashKey = false;
		this.correction.x = 0;
		this.correction.y = 0;
		this.stepAcc = 0;
		this.paused = false;
		this.shake = 0;
		this.app.stage.position.set(0, 0);

		if (players) {
			for (const p of players) {
				const visual = this.playerVisuals.get(p.id);
				if (!visual) continue;
				visual.state.hp = p.hp;
				visual.state.energy = p.energy;
				visual.state.inv = false;
				visual.container.x = p.x;
				visual.container.y = p.y;
				visual.known = { x: p.x, y: p.y, angle: p.angle };
				visual.samples = [];
				visual.displayAngle = p.angle;
				visual.sprite.rotation = p.angle + Math.PI / 2;
				visual.isMoving = false;
				visual.container.visible = true;
				visual.flashUntil = 0;
				this.setShipMoving(visual, false);
				this.updateBars(visual);

				if (this.isLocal(p.id)) {
					this.predicted.x = p.x;
					this.predicted.y = p.y;
					this.predicted.angle = p.angle;
					this.prevPredicted.x = p.x;
					this.prevPredicted.y = p.y;
				}
			}
		}
	}

	private sampleAt(v: PlayerVisual, renderTime: number): Sample {
		const s = v.samples;
		if (s.length === 0) return { t: renderTime, ...v.known };
		if (renderTime <= s[0].t) return s[0];

		const last = s[s.length - 1];
		if (renderTime >= last.t) {
			if (s.length < 2) return last;
			const prev = s[s.length - 2];
			const span = last.t - prev.t;
			if (span <= 0) return last;
			const ahead = Math.min(renderTime - last.t, MAX_EXTRAPOLATION_MS);
			return {
				t: renderTime,
				x: clampX(last.x + ((last.x - prev.x) / span) * ahead),
				y: clampY(last.y + ((last.y - prev.y) / span) * ahead),
				angle: last.angle
			};
		}

		for (let i = s.length - 1; i > 0; i--) {
			const a = s[i - 1];
			const b = s[i];
			if (renderTime >= a.t) {
				const k = b.t === a.t ? 1 : (renderTime - a.t) / (b.t - a.t);
				return {
					t: renderTime,
					x: a.x + (b.x - a.x) * k,
					y: a.y + (b.y - a.y) * k,
					angle: lerpAngle(a.angle, b.angle, k)
				};
			}
		}
		return s[0];
	}

	private renderPlayers(dt: number, renderTime: number) {
		const decay = Math.pow(CORRECTION_DECAY, dt);
		this.correction.x *= decay;
		this.correction.y *= decay;

		const now = performance.now();
		for (const [id, v] of this.playerVisuals) {
			v.container.alpha = v.state.inv ? 0.4 : 1;
			v.sprite.tint = now < v.flashUntil ? HIT_FLASH_TINT : v.baseTint;
			if (this.isLocal(id)) {
				const alpha = Math.min(1, this.stepAcc / GAME_CONFIG.TICK_MS);
				v.container.x =
					this.prevPredicted.x +
					(this.predicted.x - this.prevPredicted.x) * alpha +
					this.correction.x;
				v.container.y =
					this.prevPredicted.y +
					(this.predicted.y - this.prevPredicted.y) * alpha +
					this.correction.y;
				v.displayAngle = this.predicted.angle;
				v.sprite.rotation = this.predicted.angle + Math.PI / 2;
				continue;
			}
			const sample = this.sampleAt(v, renderTime);
			const moved = Math.hypot(sample.x - v.container.x, sample.y - v.container.y);
			v.isMoving = moved > 0.3 * dt;
			// A jump far beyond normal speed is a dash
			if (moved > PERK_CONFIG.DASH_DISTANCE / 3) {
				sfx.dash(false);
				this.spawnDashBurst(
					v.container.x,
					v.container.y,
					(sample.x - v.container.x) / moved,
					(sample.y - v.container.y) / moved
				);
			}
			this.setShipMoving(v, v.isMoving);
			v.container.x = sample.x;
			v.container.y = sample.y;
			v.displayAngle = sample.angle;
			v.sprite.rotation = sample.angle + Math.PI / 2;
		}
	}

	private renderBullets(renderTime: number) {
		const alpha = Math.min(1, this.stepAcc / GAME_CONFIG.TICK_MS);
		for (const [id, b] of this.bulletVisuals) {
			let elapsed: number;
			if (b.own) {
				// Same time base as the local ship, drawn between steps inputSeq - 1 and inputSeq
				elapsed = this.inputSeq - 1 + alpha - b.step0;
			} else {
				if (b.removeAt !== null && renderTime >= b.removeAt) {
					this.destroyBullet(id);
					continue;
				}
				elapsed = (renderTime - b.t0) / GAME_CONFIG.TICK_MS;
			}
			const x = b.x0 + b.vx * elapsed;
			const y = b.y0 + b.vy * elapsed;
			b.visual.x = x;
			b.visual.y = y;

			const inside = elapsed >= 0 && x > 0 && x < this.mapWidth && y > 0 && y < this.mapHeight;
			if (b.own && inside && !b.predictedHit) {
				// The server tests our shots against targets as we see them, so a visual hit here is a hit there
				for (const [pid, pv] of this.playerVisuals) {
					if (pid === this.myId || pv.state.inv) continue;
					const threshold = b.radius + GAME_CONFIG.SHIP_RADIUS;
					const dx = x - pv.container.x;
					const dy = y - pv.container.y;
					if (dx * dx + dy * dy < threshold * threshold) {
						b.predictedHit = true;
						break;
					}
				}
			}
			b.visual.visible = inside && !b.predictedHit;
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

	private setZone(zone: ZoneInfo) {
		this.zone = zone;
		this.zoneFrozenAt = null;
		this.zoneAlarmPlayed = false;
		this.lastCountdownTick = null;
	}

	private setZoneText(text: string, alert: boolean) {
		if (this.zoneText.text !== text) this.zoneText.text = text;
		const fill = alert ? ZONE_ALERT_TEXT : ZONE_CALM_TEXT;
		if (this.zoneText.style.fill !== fill) this.zoneText.style.fill = fill;
	}

	private zoneRadiusAt(zone: ZoneInfo, t: number): number {
		const elapsed = t - zone.startedAt;
		if (elapsed <= zone.delayMs) return zone.startRadius;
		return zone.startRadius * Math.max(0, 1 - (elapsed - zone.delayMs) / zone.shrinkMs);
	}

	private drawZone() {
		const g = this.zoneGfx;
		g.clear();
		const zone = this.zone;
		if (!zone || !this.hasClock) {
			this.setZoneText('', false);
			return;
		}
		const t = this.zoneFrozenAt ?? this.serverNow();
		const elapsed = t - zone.startedAt;
		const untilClose = zone.delayMs - elapsed;

		if (untilClose > 0) {
			const seconds = Math.ceil(untilClose / 1000);
			const alert = untilClose <= ZONE_WARNING_MS;
			this.setZoneText(`Zone dans ${formatSeconds(seconds)}`, alert);
			if (
				seconds <= ZONE_TICK_SECONDS &&
				seconds !== this.lastCountdownTick &&
				this.zoneFrozenAt === null
			) {
				this.lastCountdownTick = seconds;
				sfx.countdownTick();
			}
			return;
		}
		if (!this.zoneAlarmPlayed && this.zoneFrozenAt === null) {
			this.zoneAlarmPlayed = true;
			sfx.zoneAlarm();
		}

		const r = this.zoneRadiusAt(zone, t);
		g.rect(0, 0, this.mapWidth, this.mapHeight).fill({ color: ZONE_COLOR, alpha: 0.13 });
		if (r > 0) {
			g.circle(zone.x, zone.y, r).cut();
			g.circle(zone.x, zone.y, r).stroke({ width: 3, color: ZONE_COLOR, alpha: 0.85 });
		}

		const me = this.playerVisuals.get(this.myId);
		const outside =
			!this.isSpectator &&
			!!me?.container.visible &&
			Math.hypot(me.container.x - zone.x, me.container.y - zone.y) > r;
		const untilClosed = Math.ceil((zone.delayMs + zone.shrinkMs - elapsed) / 1000);
		if (outside) this.setZoneText('Hors zone !', true);
		else if (-untilClose < ZONE_ANNOUNCE_MS) this.setZoneText('La zone se referme !', true);
		else if (untilClosed > 0) this.setZoneText(`Zone fermée dans ${formatSeconds(untilClosed)}`, true);
		else this.setZoneText('Zone fermée', true);
	}

	private onDamaged(id: string, v: PlayerVisual, amount: number, fromZone: boolean) {
		const heavy = amount >= HEAVY_HIT_DAMAGE;
		v.flashUntil = performance.now() + HIT_FLASH_MS;
		const mine = id === this.myId && !this.isSpectator;
		if (fromZone) {
			// Zone damage gets neither impact sparks nor a hit confirmation
			if (mine) {
				sfx.zoneZap();
				this.addShake(2);
			}
		} else if (mine) {
			this.spawnSparks(v.container.x, v.container.y, heavy ? 14 : 6);
			sfx.hurt(heavy);
			this.addShake(heavy ? 9 : 4);
		} else {
			this.spawnSparks(v.container.x, v.container.y, heavy ? 14 : 6);
			if (!this.isSpectator) {
				// Duels are one on one: damage on the other ship comes from us
				sfx.hitConfirm();
				this.hitMarkerUntil = performance.now() + HIT_MARKER_MS;
			}
		}
		if (v.state.hp <= 0) {
			v.container.visible = false;
			this.spawnBlast(v.container.x, v.container.y);
			sfx.explosion();
			this.addShake(mine ? MAX_SHAKE : 10);
		}
	}

	private isAimingAtEnemy(): boolean {
		const reach = GAME_CONFIG.SHIP_RADIUS + 8;
		for (const [id, v] of this.playerVisuals) {
			if (id === this.myId || !v.container.visible) continue;
			if (Math.hypot(this.mouseWorldX - v.container.x, this.mouseWorldY - v.container.y) < reach)
				return true;
		}
		return false;
	}

	// 0..1 while the missile reloads, 1 once it can be fired again
	private missileReadiness(): { progress: number; ready: boolean } {
		const elapsed = this.inputSeq - this.roundBaseSeq - this.lastSpecialShotClock;
		const progress = Math.min(1, elapsed / cooldownTicks(this.myLoadout.specialCooldown));
		const ready = progress >= 1 && this.predictedEnergy() >= this.myLoadout.specialEnergyCost;
		return { progress, ready };
	}

	private drawReticle(dt: number) {
		const g = this.reticle;
		if (!g) return;
		g.clear();
		if (!this.mouseOnCanvas) return;
		// Always drawn last, above effects re-added on top of the stage
		if (this.app.stage.children[this.app.stage.children.length - 1] !== g) this.app.stage.addChild(g);
		// The stage shakes, the reticle must stay under the real mouse
		g.position.set(this.mouseWorldX - this.app.stage.x, this.mouseWorldY - this.app.stage.y);

		const lock = this.isAimingAtEnemy();
		const color = lock ? RETICLE_LOCK_COLOR : RETICLE_COLOR;
		this.reticleSpin += dt * (lock ? 0.09 : 0.015);

		g.circle(0, 0, 1.8).fill({ color });

		// Segmented inner ring
		for (let i = 0; i < 4; i++) {
			const start = this.reticleSpin + (i * Math.PI) / 2 + 0.3;
			const end = start + Math.PI / 2 - 0.6;
			g.moveTo(Math.cos(start) * 10, Math.sin(start) * 10)
				.arc(0, 0, 10, start, end)
				.stroke({ width: 1.5, color, alpha: 0.9 });
		}

		// Fixed cross ticks
		for (let i = 0; i < 4; i++) {
			const a = (i * Math.PI) / 2;
			g.moveTo(Math.cos(a) * 14, Math.sin(a) * 14)
				.lineTo(Math.cos(a) * 20, Math.sin(a) * 20)
				.stroke({ width: 1.5, color, alpha: 0.8 });
		}

		// Corner brackets that close in on a locked target
		const r = lock ? 15 : 24;
		const len = 6;
		for (const [sx, sy] of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1]
		]) {
			g.moveTo(sx * r, sy * (r - len))
				.lineTo(sx * r, sy * r)
				.lineTo(sx * (r - len), sy * r)
				.stroke({ width: 2, color, alpha: lock ? 1 : 0.55 });
		}

		// Missile gauge along the bottom
		const { progress, ready } = this.missileReadiness();
		const from = Math.PI * 0.3;
		const span = Math.PI * 0.4;
		g.moveTo(Math.cos(from) * 28, Math.sin(from) * 28)
			.arc(0, 0, 28, from, from + span)
			.stroke({ width: 2, color: 0xffffff, alpha: 0.15 });
		if (progress > 0) {
			g.moveTo(Math.cos(from) * 28, Math.sin(from) * 28)
				.arc(0, 0, 28, from, from + span * progress)
				.stroke({ width: 2, color: ready ? MISSILE_READY_COLOR : 0x8890b0, alpha: ready ? 1 : 0.7 });
		}

		if (performance.now() < this.hitMarkerUntil) {
			for (let i = 0; i < 4; i++) {
				const a = Math.PI / 4 + (i * Math.PI) / 2;
				g.moveTo(Math.cos(a) * 5, Math.sin(a) * 5)
					.lineTo(Math.cos(a) * 11, Math.sin(a) * 11)
					.stroke({ width: 2.5, color: 0xffffff });
			}
		}
	}

	private addShake(amount: number) {
		this.shake = Math.min(MAX_SHAKE, Math.max(this.shake, amount));
	}

	private updateShake(dt: number) {
		if (this.shake < 0.2) {
			if (this.shake !== 0) {
				this.shake = 0;
				this.app.stage.position.set(0, 0);
			}
			return;
		}
		this.app.stage.position.set(
			(Math.random() * 2 - 1) * this.shake,
			(Math.random() * 2 - 1) * this.shake
		);
		this.shake *= Math.pow(SHAKE_DECAY, dt);
	}

	private spawnSparks(x: number, y: number, count: number) {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const speed = 2 + Math.random() * 4;
			this.blastParticles.push({
				x,
				y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				life: 0,
				maxLife: 10 + Math.random() * 10,
				size: 1.5 + Math.random() * 2,
				color: Math.random() < 0.5 ? 0xffffff : 0xffd27a,
				ring: false
			});
		}
		// Re-adding keeps the effects drawn above the ships
		this.app.stage.addChild(this.blastGfx);
	}

	private spawnBlast(x: number, y: number) {
		const colors = [0xffffff, 0xffe08a, 0xff9933, 0xff4d1a];
		for (let i = 0; i < 60; i++) {
			const angle = Math.random() * Math.PI * 2;
			const speed = 1 + Math.random() * 7;
			this.blastParticles.push({
				x,
				y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				life: 0,
				maxLife: 30 + Math.random() * 35,
				size: 2 + Math.random() * 5,
				color: colors[Math.floor(Math.random() * colors.length)],
				ring: false
			});
		}
		this.blastParticles.push({
			x,
			y,
			vx: 0,
			vy: 0,
			life: 0,
			maxLife: 28,
			size: 90,
			color: 0xffc266,
			ring: true
		});
		this.app.stage.addChild(this.blastGfx);
	}

	private updateBlastParticles(dt: number) {
		const gfx = this.blastGfx;
		gfx.clear();
		const damping = Math.pow(0.93, dt);
		for (let i = this.blastParticles.length - 1; i >= 0; i--) {
			const p = this.blastParticles[i];
			p.life += dt;
			if (p.life >= p.maxLife) {
				this.blastParticles.splice(i, 1);
				continue;
			}
			const t = p.life / p.maxLife;
			if (p.ring) {
				gfx.circle(p.x, p.y, p.size * t).stroke({ width: 4 * (1 - t) + 1, color: p.color, alpha: 1 - t });
				continue;
			}
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.vx *= damping;
			p.vy *= damping;
			gfx.circle(p.x, p.y, p.size * (1 - t * 0.6)).fill({ color: p.color, alpha: 1 - t });
		}
	}

	private spawnDashBurst(x: number, y: number, dirX: number, dirY: number) {
		const backAngle = Math.atan2(-dirY, -dirX);
		for (let i = 0; i < 16; i++) {
			const spread = (Math.random() - 0.5) * 1.2;
			const speed = 2 + Math.random() * 3;
			const angle = backAngle + spread;
			this.thrusterParticles.push({
				x: x + (Math.random() - 0.5) * 16,
				y: y + (Math.random() - 0.5) * 16,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				life: 0,
				maxLife: 14 + Math.random() * 10,
				size: 3 + Math.random() * 3
			});
		}
	}

	private updateThrusterParticles(dt: number) {
		for (const [id, v] of this.playerVisuals) {
			let moving = false;
			if (this.isLocal(id)) {
				const k = this.keys;
				moving = k.has('z') || k.has('w') || k.has('s') || k.has('q') || k.has('a') || k.has('d');
				this.setShipMoving(v, moving);
			} else {
				moving = v.isMoving;
			}

			if (!(v.sprite instanceof AnimatedSprite) && moving) {
				v.thrustAcc += dt;
				while (v.thrustAcc >= 1) {
					v.thrustAcc -= 1;
					this.spawnThrusterParticles(v.container.x, v.container.y, v.displayAngle);
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
		if (this.destroyed) return;
		this.destroyed = true;
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		window.removeEventListener('blur', this.onBlur);
		// Destroying Pixi before its init resolves throws, init() handles it instead
		if (!this.initDone) return;
		this.starfield?.destroy();
		this.app.destroy(false);
	}
}
