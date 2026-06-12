<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { currentUser, auth } from '$lib/stores/auth';
	import { connectSocket } from '$lib/stores/socket';
	import { chatMessages, addMessage } from '$lib/stores/chat';
	import { api } from '$lib/api';
	import { xpForLevel, xpPercent } from '$lib/xp';
	import { filterByTab } from '$lib/itemFilter';
	import { GAME_EVENT, LOBBY_EVENT } from '$lib/shared/events';
	import LoadoutRow from '$lib/components/LoadoutRow.svelte';
	import ItemPopover from '$lib/components/ItemPopover.svelte';
	import Backpack from '@lucide/svelte/icons/backpack';
	import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
	import Rocket from '@lucide/svelte/icons/rocket';
	import Lock from '@lucide/svelte/icons/lock';
	import Swords from '@lucide/svelte/icons/swords';
	import Clock from '@lucide/svelte/icons/clock';
	import Users from '@lucide/svelte/icons/users';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Eye from '@lucide/svelte/icons/eye';
	import Trophy from '@lucide/svelte/icons/trophy';
	import Skull from '@lucide/svelte/icons/skull';
	import Zap from '@lucide/svelte/icons/zap';
	import X from '@lucide/svelte/icons/x';
	import { getGrade } from '$lib/grades';
	import type { Socket } from 'socket.io-client';

	interface Player {
		socketId: string;
		username: string;
		status: string;
	}
	interface Room {
		roomId: string;
		players: { username: string }[];
		spectatorCount: number;
		status: string;
	}
	interface InventoryItem {
		_id: string;
		name: string;
		type: string;
		bulletRole?: string | null;
		sprite: string;
		price?: number;
		description?: string;
		stats?: Record<string, number>;
	}

	let players = $state<Player[]>([]);
	let rooms = $state<Room[]>([]);
	let chatInput = $state('');
	let socket: Socket | null = null;
	let createdRoom = $state<string | null>(null);
	let inventory = $state<InventoryItem[]>([]);
	let fullStats = $state<{
		wins: number;
		losses: number;
		totalGames: number;
		bestStreak: number;
	} | null>(null);
	let equipLoading = $state<string | null>(null);
	let buyLoading = $state<string | null>(null);
	let leftTab = $state<'armement' | 'shop'>('armement');
	let rightTab = $state<'stats' | 'classement'>('stats');
	let shopTab = $state<'ship' | 'primary' | 'secondary'>('ship');
	let allItems = $state<InventoryItem[]>([]);
	let ownedIds = $state<Set<string>>(new Set());

	interface LeaderboardPlayer {
		_id: string;
		username: string;
		level: number;
		stats: { wins: number; losses: number; totalGames: number };
	}
	let leaderboard = $state<LeaderboardPlayer[]>([]);
	let lbSort = $state<'wins' | 'losses' | 'level'>('wins');
	const lbSorted = $derived(
		[...leaderboard].sort((a, b) => {
			if (lbSort === 'wins') return b.stats.wins - a.stats.wins;
			if (lbSort === 'losses') return b.stats.losses - a.stats.losses;
			return (b.level ?? 1) - (a.level ?? 1);
		})
	);
	const ANIMATED_SPRITES = ['spaceship-01', 'spaceship-02', 'spaceship-03', 'spaceship-04', 'spaceship-05', 'spaceship-06'];
	function shipPreviewSrc(sprite: string | undefined): string {
		const s = sprite ?? 'spaceship-01';
		return ANIMATED_SPRITES.includes(s) ? `/assets/${s}-f1.png` : `/assets/${s}.png`;
	}

	function lbMedal(i: number) {
		return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
	}
	let hoveredItem = $state<InventoryItem | null>(null);
	let popoverX = $state(0);
	let popoverY = $state(0);

	function showPopover(e: MouseEvent, item: InventoryItem) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		popoverX = rect.right + 10;
		popoverY = rect.top + rect.height / 2;
		hoveredItem = item;
	}
	function hidePopover() {
		hoveredItem = null;
	}

	const xpPct = $derived(xpPercent($currentUser?.level ?? 1, $currentUser?.xp ?? 0));
	const grade = $derived(getGrade($currentUser?.level ?? 1));

	const winrate = $derived(
		fullStats?.totalGames ? Math.round((fullStats.wins / fullStats.totalGames) * 100) : 0
	);

	function computeKD(stats: typeof fullStats): string {
		if (!stats) return '0.0';
		if (stats.losses === 0) return stats.wins > 0 ? '∞' : '0.0';
		return (stats.wins / stats.losses).toFixed(1);
	}
	const kd = $derived(computeKD(fullStats));

	const shopNotOwned = $derived(allItems.filter((i) => !ownedIds.has(String(i._id))));
	const shopFiltered = $derived(filterByTab(shopNotOwned as any, shopTab) as InventoryItem[]);

	async function buyItem(item: InventoryItem) {
		if (buyLoading) return;
		buyLoading = item._id;
		try {
			const { points } = await api.shop.buy(item._id);
			auth.updateUser({ points });
			ownedIds = new Set([...ownedIds, String(item._id)]);
			inventory = [...inventory, item];
		} finally {
			buyLoading = null;
		}
	}

	const ships = $derived(inventory.filter((i) => i.type === 'ship'));
	const primaryBullets = $derived(
		inventory.filter((i) => i.type === 'bullet' && i.bulletRole === 'primary')
	);
	const secondaryBullets = $derived(
		inventory.filter((i) => i.type === 'bullet' && i.bulletRole === 'secondary')
	);

	onMount(async () => {
		const u = $currentUser;
		const tok = u ? localStorage.getItem('galactica_token') : null;
		if (!u || !tok) return;

		socket = connectSocket(tok);

		const [statsResult, chatResult, shopResult, lbResult] = await Promise.allSettled([
			api.stats.me(),
			$chatMessages.length === 0 ? api.chat.history() : Promise.resolve(null),
			api.shop.items(),
			api.leaderboard.get()
		]);

		if (statsResult.status === 'fulfilled') {
			const statsUser = statsResult.value.user;
			fullStats = statsUser.stats;
			inventory = statsUser.inventory ?? [];
			ownedIds = new Set(inventory.map((i) => String(i._id)));
			auth.updateUser({
				xp: statsUser.xp ?? 0,
				level: statsUser.level ?? 1,
				points: statsUser.points ?? 0
			});
		}

		if (shopResult.status === 'fulfilled') {
			allItems = shopResult.value.items;
		}

		if (lbResult.status === 'fulfilled') {
			leaderboard = lbResult.value.players;
		}

		if (chatResult.status === 'fulfilled' && chatResult.value) {
			for (const m of chatResult.value.messages)
				addMessage({
					username: m.username,
					message: m.message,
					timestamp: new Date(m.timestamp).getTime()
				});
		}

		// L'identité et le loadout sont résolus côté serveur à partir du JWT
		// du handshake — aucun payload n'est accepté (anti-usurpation).
		socket.emit(LOBBY_EVENT.USER_JOIN);

		socket.on(LOBBY_EVENT.STATE, (data: { players: Player[]; rooms: Room[] }) => {
			players = data.players;
			rooms = data.rooms;
		});

		socket.on(GAME_EVENT.CREATED, ({ roomId }: { roomId: string }) => {
			createdRoom = roomId;
		});

		socket.on(GAME_EVENT.NAVIGATE, ({ roomId }: { roomId: string }) => {
			goto(`/game/${roomId}`);
		});

		socket.on(GAME_EVENT.SPECTATING, ({ roomId }: { roomId: string }) => {
			goto(`/game/${roomId}`);
		});
	});

	onDestroy(() => {
		socket?.off(LOBBY_EVENT.STATE);
		socket?.off(GAME_EVENT.CREATED);
		socket?.off(GAME_EVENT.NAVIGATE);
		socket?.off(GAME_EVENT.SPECTATING);
		socket?.off(GAME_EVENT.CANCELLED);
		hoveredItem = null;
	});

	function createGame() {
		socket?.emit(GAME_EVENT.CREATE);
	}

	function cancelGame() {
		if (!createdRoom) return;
		socket?.emit(GAME_EVENT.CANCEL, { roomId: createdRoom });
		socket?.once(GAME_EVENT.CANCELLED, () => {
			createdRoom = null;
		});
	}

	function joinGame(roomId: string) {
		socket?.emit(GAME_EVENT.JOIN, { roomId });
	}

	function spectate(roomId: string) {
		socket?.emit(GAME_EVENT.SPECTATE, { roomId });
	}

	function sendMessage(e: Event) {
		e.preventDefault();
		if (!chatInput.trim()) return;
		socket?.emit(LOBBY_EVENT.CHAT_MESSAGE, { message: chatInput.trim() });
		chatInput = '';
	}

	async function equipItem(item: InventoryItem) {
		if (equipLoading) return;
		equipLoading = item._id;
		try {
			const type = item.type as 'ship' | 'bullet';
			const role = item.bulletRole as 'primary' | 'secondary' | undefined;
			const result = await api.shop.equip(type, item.sprite, role ?? undefined);
			auth.updateUser({
				activeShip: result.activeShip,
				activeBullet: result.activeBullet,
				activeBulletSecondary: result.activeBulletSecondary
			});
			// Notifie simplement le serveur, qui relit le loadout depuis la DB
			socket?.emit('user:updateLoadout');
		} finally {
			equipLoading = null;
		}
	}

	function formatTime(ts: number) {
		const date = new Date(ts);
		const now = new Date();
		const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
		const isToday =
			date.getDate() === now.getDate() &&
			date.getMonth() === now.getMonth() &&
			date.getFullYear() === now.getFullYear();
		const yesterday = new Date(now);
		yesterday.setDate(now.getDate() - 1);
		const isYesterday =
			date.getDate() === yesterday.getDate() &&
			date.getMonth() === yesterday.getMonth() &&
			date.getFullYear() === yesterday.getFullYear();
		if (isToday) return `Aujourd'hui ${time}`;
		if (isYesterday) return `Hier ${time}`;
		return (
			date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
			` ${time}`
		);
	}

	function statusLabel(status: string) {
		return status === 'waiting' ? 'En attente' : status === 'playing' ? 'En cours' : status;
	}

	function radarPath(values: number[]): string {
		const cx = 50,
			cy = 50,
			r = 38;
		const n = values.length;
		return (
			values
				.map((v, i) => {
					const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
					const x = cx + r * v * Math.cos(angle);
					const y = cy + r * v * Math.sin(angle);
					return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
				})
				.join(' ') + ' Z'
		);
	}

	function radarGrid(fraction: number): string {
		return radarPath([fraction, fraction, fraction, fraction, fraction]);
	}

	const activeShip = $derived(
		inventory.find((i) => i.type === 'ship' && i.sprite === $currentUser?.activeShip) ?? null
	);
	const activePrimary = $derived(
		inventory.find(
			(i) =>
				i.type === 'bullet' && i.bulletRole === 'primary' && i.sprite === $currentUser?.activeBullet
		) ?? null
	);

	const radarAxes = ['Vitesse', 'DEF', 'Dégâts', 'DPS'];

	function computeRadar(ship: typeof activeShip, primary: typeof activePrimary): number[] {
		const speed = Math.min(1, (ship?.stats?.speed ?? 0) / 5);
		const def = Math.min(1, (ship?.stats?.hp ?? 0) / 150);
		const damage = Math.min(1, (primary?.stats?.damage ?? 0) / 60);
		const cd = primary?.stats?.cooldown ?? 0;
		const dps = cd > 0 ? Math.min(1, (((primary?.stats?.damage ?? 0) / cd) * 1000) / 50) : 0;
		return [speed, def, damage, dps];
	}
	const radarValues = $derived(computeRadar(activeShip, activePrimary));
</script>

<div class="hub-bg">
	<div class="stars"></div>
	<div class="nebula"></div>
	<div class="cockpit"></div>
</div>

<div class="hub">
	<aside class="left-col">
		<div class="logo-card">
			<img src="/assets/galactica-logo.webp" alt="Galactica.io" class="logo-card-img" />
		</div>
		<section class="panel loadout-panel">
			<div class="left-tabs">
				<button
					class="ltab"
					class:active={leftTab === 'armement'}
					onclick={() => (leftTab = 'armement')}
				>
					<Backpack size={14} /> Armement
				</button>
				<button class="ltab" class:active={leftTab === 'shop'} onclick={() => (leftTab = 'shop')}>
					<ShoppingCart size={14} /> Shop
				</button>
			</div>

			{#if leftTab === 'armement'}
				<LoadoutRow
					label="Vaisseau"
					items={ships}
					activeSprite={$currentUser?.activeShip}
					loadingId={equipLoading}
					emptyText="Aucun vaisseau"
					onequip={equipItem}
					onhover={showPopover}
					onleave={hidePopover}
				/>
				<LoadoutRow
					label="🔴 Missile principal"
					items={primaryBullets}
					activeSprite={$currentUser?.activeBullet}
					loadingId={equipLoading}
					emptyText="Aucun missile"
					onequip={equipItem}
					onhover={showPopover}
					onleave={hidePopover}
				/>
				<LoadoutRow
					label="🟠 Missile secondaire"
					items={secondaryBullets}
					activeSprite={$currentUser?.activeBulletSecondary}
					loadingId={equipLoading}
					emptyText="Aucun missile"
					onequip={equipItem}
					onhover={showPopover}
					onleave={hidePopover}
				/>
				<div class="shield-row">
					<span class="shield-label">Bouclier</span>
					<div class="shield-scroll">
						<div class="shield-card">
							<span class="shield-lock"><Lock size={14} /></span>
							<span class="shield-soon">Bientôt</span>
						</div>
					</div>
				</div>
			{:else}
				<div class="shop-tabs">
					<button
						class="shop-stab"
						class:active={shopTab === 'ship'}
						onclick={() => (shopTab = 'ship')}><Rocket size={14} /></button
					>
					<button
						class="shop-stab"
						class:active={shopTab === 'primary'}
						onclick={() => (shopTab = 'primary')}>🔴</button
					>
					<button
						class="shop-stab"
						class:active={shopTab === 'secondary'}
						onclick={() => (shopTab = 'secondary')}>🟠</button
					>
				</div>

				<div class="shop-balance">
					⭐ <span>{($currentUser?.points ?? 0).toLocaleString('fr-FR')} Crédits</span>
				</div>

				<div class="shop-list">
					{#each shopFiltered as item (item._id)}
						<div
							class="shop-card"
							onmouseenter={(e) => showPopover(e, item)}
							onmouseleave={hidePopover}
						>
							<div class="shop-card-img">
								<img
									src={shipPreviewSrc(item.sprite)}
									alt={item.name}
									onerror={(e: any) => (e.target.style.display = 'none')}
								/>
							</div>
							<div class="shop-card-info">
								<span class="shop-card-name">{item.name}</span>
								<span class="shop-card-price"
									>{item.price === 0 ? 'Gratuit' : `⭐ ${item.price} Crédits`}</span
								>
							</div>
							<button
								class="btn btn-primary btn-sm"
								disabled={buyLoading === item._id ||
									($currentUser?.points ?? 0) < (item.price ?? 0)}
								onclick={() => buyItem(item)}
							>
								{buyLoading === item._id ? '…' : item.price === 0 ? 'Obtenir' : 'Acheter'}
							</button>
						</div>
					{:else}
						<p class="empty-text">Tous les items sont déjà possédés !</p>
					{/each}
				</div>
			{/if}
		</section>
	</aside>

	<main class="center-col">
		<div class="mega-ring-wrap">
			<img
				src="/assets/level-ring.webp"
				alt=""
				class="mega-ring-img"
				onerror={(e: any) => (e.target.style.opacity = '0.1')}
			/>
			<img
				src="/assets/level-ring-only-filled.webp"
				alt=""
				class="mega-ring-filled"
				style="--reveal: {(Math.floor((xpPct / 100) * 64) / 64) * 360}deg"
			/>
			<div class="mega-ring-center">
				<span class="mega-level">{$currentUser?.level ?? 1}</span>
			</div>
			<div class="mega-pct">{xpPct}%</div>
			<div class="mega-exp">
				EXP: {($currentUser?.xp ?? 0).toLocaleString('fr-FR')} / {xpForLevel(
					$currentUser?.level ?? 1
				).toLocaleString('fr-FR')}
			</div>
			<div class="mega-grade" style="--grade-color: {grade.color}">
				Niv. {$currentUser?.level ?? 1} Grade: <strong>{grade.label}</strong>
			</div>
		</div>

		<div class="hero-ship">
			<div class="ship-display">
				<img
					src={shipPreviewSrc($currentUser?.activeShip)}
					alt="vaisseau"
					class="ship-img"
					onerror={(e: any) => (e.target.style.display = 'none')}
				/>
				<div class="ship-podium">
					<div class="podium-ring"></div>
					<div class="podium-ring podium-ring-2"></div>
				</div>
			</div>
		</div>

		<div class="hero-actions">
			<div class="primary-cta">
				{#if createdRoom}
					<button class="btn btn-hero" disabled><Clock size={14} /> En attente…</button>
				{:else}
					<button class="btn btn-hero" onclick={createGame}>+ Lancer un Duel 1v1</button>
				{/if}
			</div>
			{#if createdRoom}
				<div class="secondary-actions">
					<button class="btn-ghost" onclick={cancelGame}>
						<span class="btn-ghost-icon"><X size={12} /></span> Annuler le duel
					</button>
				</div>
			{/if}
		</div>

		<section class="panel chat-panel">
			<div class="chat-col chat-col-side">
				<div class="chat-col-title">
					<Users size={14} /> Joueurs <span class="col-badge">{players.length}</span>
				</div>
				<div class="chat-col-scroll">
					{#each players as p (p.socketId)}
						<div class="social-item">
							<span class="dot" class:idle={p.status === 'idle'} class:busy={p.status !== 'idle'}
							></span>
							<span class="social-name" class:me={p.username === $currentUser?.username}>
								{p.username}
								{#if p.username === $currentUser?.username}<span class="you">(toi)</span>{/if}
							</span>
						</div>
					{:else}
						<p class="empty-text">Aucun joueur…</p>
					{/each}
				</div>
			</div>

			<div class="chat-divider"></div>

			<div class="chat-col chat-col-main">
				<div class="chat-col-title"><MessageSquare size={14} /> Chat</div>
				<div class="messages">
					{#each $chatMessages as msg}
						<div class="message" class:own={msg.username === $currentUser?.username}>
							<span class="msg-time">{formatTime(msg.timestamp)}</span>
							<span class="msg-author">{msg.username}</span>
							<span class="msg-text">{msg.message}</span>
						</div>
					{:else}
						<p class="empty-text">Aucun message…</p>
					{/each}
				</div>
				<form class="chat-form" onsubmit={sendMessage}>
					<input
						bind:value={chatInput}
						placeholder="Envoie un message…"
						maxlength="200"
						autocomplete="off"
					/>
					<button type="submit" class="chat-send" title="Envoyer">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
							<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
						</svg>
					</button>
				</form>
			</div>
		</section>
	</main>

	<aside class="right-col">
		<section class="panel radar-panel">
			<h2>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<polygon
						points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
					/>
				</svg>
				Caractéristiques
			</h2>
			<div class="radar-wrap">
				<svg viewBox="-18 -18 136 136" class="radar">
					{#each [0.25, 0.5, 0.75, 1] as f}
						<path
							d={radarPath([f, f, f, f])}
							fill="none"
							stroke="rgba(100,100,255,0.15)"
							stroke-width="0.5"
						/>
					{/each}
					{#each radarAxes as _, i}
						{@const angle = (i / radarAxes.length) * 2 * Math.PI - Math.PI / 2}
						<line
							x1="50"
							y1="50"
							x2={50 + 38 * Math.cos(angle)}
							y2={50 + 38 * Math.sin(angle)}
							stroke="rgba(100,100,255,0.2)"
							stroke-width="0.5"
						/>
					{/each}
					<path
						d={radarPath(radarValues)}
						fill="rgba(123,140,255,0.25)"
						stroke="#7b8cff"
						stroke-width="0.8"
					/>
					{#each radarAxes as label, i}
						{@const angle = (i / radarAxes.length) * 2 * Math.PI - Math.PI / 2}
						<text
							x={50 + 46 * Math.cos(angle)}
							y={50 + 46 * Math.sin(angle)}
							text-anchor="middle"
							dominant-baseline="middle"
							class="radar-label">{label}</text
						>
					{/each}
				</svg>
			</div>
		</section>

		<section class="panel stats-lb-panel">
			<div class="left-tabs">
				<button
					class="ltab"
					class:active={rightTab === 'stats'}
					onclick={() => (rightTab = 'stats')}
				>
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg
					>
					Stats
				</button>
				<button
					class="ltab"
					class:active={rightTab === 'classement'}
					onclick={() => (rightTab = 'classement')}
				>
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><polyline points="18 20 18 10" /><polyline points="12 20 12 4" /><polyline
							points="6 20 6 14"
						/></svg
					>
					Classement
				</button>
			</div>

			{#if rightTab === 'stats'}
				<div class="stat-rows">
					<div class="stat-row">
						<span class="stat-label">Taux de Victoire</span>
						<div class="stat-bar">
							<div class="stat-fill cyan" style="width:{winrate}%"></div>
						</div>
						<span class="stat-val">{winrate}%</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">K/D Ratio</span>
						<div class="stat-bar">
							<div
								class="stat-fill cyan"
								style="width:{Math.min(100, (parseFloat(String(kd)) / 5) * 100)}%"
							></div>
						</div>
						<span class="stat-val">{kd}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Meilleure Série</span>
						<div class="stat-bar">
							<div
								class="stat-fill cyan"
								style="width:{Math.min(100, (fullStats?.bestStreak ?? 0) * 10)}%"
							></div>
						</div>
						<span class="stat-val">{fullStats?.bestStreak ?? 0}v</span>
					</div>
				</div>
			{:else}
				<div class="lb-sort">
					<button class="lb-stab" class:active={lbSort === 'wins'} onclick={() => (lbSort = 'wins')}
						><Trophy size={14} /> Wins</button
					>
					<button
						class="lb-stab"
						class:active={lbSort === 'losses'}
						onclick={() => (lbSort = 'losses')}><Skull size={14} /> Défaites</button
					>
					<button
						class="lb-stab"
						class:active={lbSort === 'level'}
						onclick={() => (lbSort = 'level')}><Zap size={14} /> Niveau</button
					>
				</div>
				<div class="lb-list">
					{#each lbSorted as p, i (p._id)}
						<div class="lb-row" class:lb-me={p.username === $currentUser?.username}>
							<span class="lb-rank">{lbMedal(i)}</span>
							<span class="lb-name">{p.username}</span>
							<span class="lb-val">
								{#if lbSort === 'wins'}{p.stats.wins}
								{:else if lbSort === 'losses'}{p.stats.losses}
								{:else}Niv. {p.level ?? 1}{/if}
							</span>
						</div>
					{:else}
						<p class="empty-text">Aucun joueur…</p>
					{/each}
				</div>
			{/if}
		</section>

		<section class="panel duels-panel">
			<h2>
				<Swords size={14} /> Duels <span class="col-badge">{rooms.length}</span>
			</h2>
			<div class="duels-list">
				{#if createdRoom}
					<div class="waiting-row">
						<span><Clock size={14} /> En attente…</span>
						<button class="btn btn-danger btn-sm" onclick={cancelGame}>Annuler</button>
					</div>
				{/if}
				{#each rooms.filter((r) => !r.players.some((p) => p.username === $currentUser?.username)) as room (room.roomId)}
					<div class="duel-item">
						<span class="room-players">{room.players.map((p) => p.username).join(' vs ')}</span>
						<span class="room-status">{statusLabel(room.status)}</span>
						<div class="room-actions">
							{#if room.status === 'waiting' && room.players.length < 2}
								<button class="btn btn-primary btn-sm" onclick={() => joinGame(room.roomId)}
									>Rejoindre</button
								>
							{/if}
							{#if room.status === 'playing'}
								<button class="btn btn-secondary btn-sm" onclick={() => spectate(room.roomId)}
									><Eye size={14} /> Regarder</button
								>
							{/if}
						</div>
					</div>
				{:else}
					{#if !createdRoom}<p class="empty-text">Aucun duel…</p>{/if}
				{/each}
			</div>
		</section>
	</aside>
</div>

{#if hoveredItem}
	<ItemPopover
		item={hoveredItem}
		x={popoverX}
		y={popoverY}
		activeShip={$currentUser?.activeShip}
		activeBullet={$currentUser?.activeBullet}
		activeBulletSecondary={$currentUser?.activeBulletSecondary}
	/>
{/if}

<style>
	/* ====== Galaxy background ====== */
	.hub-bg {
		position: fixed;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		background:
			url('/assets/background-hub.webp') center center / cover no-repeat,
			#050818;
	}
	.stars {
		position: absolute;
		inset: 0;
		background-image:
			radial-gradient(1.5px 1.5px at 20% 30%, #fff, transparent),
			radial-gradient(1px 1px at 60% 70%, #fff, transparent),
			radial-gradient(1px 1px at 80% 20%, #fff, transparent),
			radial-gradient(1.5px 1.5px at 40% 80%, #fff, transparent),
			radial-gradient(1px 1px at 10% 60%, #fff, transparent),
			radial-gradient(2px 2px at 50% 40%, rgba(255, 255, 255, 0.8), transparent),
			radial-gradient(1px 1px at 90% 90%, #fff, transparent),
			radial-gradient(1px 1px at 30% 10%, #fff, transparent),
			radial-gradient(1.5px 1.5px at 70% 50%, #fff, transparent),
			radial-gradient(1px 1px at 15% 85%, rgba(255, 255, 255, 0.7), transparent),
			radial-gradient(1px 1px at 85% 35%, #fff, transparent),
			radial-gradient(2px 2px at 25% 55%, rgba(180, 200, 255, 0.9), transparent);
		background-size: 800px 800px;
		background-repeat: repeat;
		opacity: 0.85;
	}
	.nebula {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(ellipse 40% 30% at 25% 35%, rgba(160, 100, 220, 0.18) 0%, transparent 70%),
			radial-gradient(ellipse 30% 25% at 75% 55%, rgba(80, 140, 220, 0.2) 0%, transparent 70%),
			radial-gradient(ellipse 50% 25% at 50% 80%, rgba(200, 80, 140, 0.1) 0%, transparent 70%);
		filter: blur(20px);
	}
	.cockpit {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 130px;
		background:
			linear-gradient(
				180deg,
				transparent 0%,
				rgba(10, 15, 40, 0.7) 35%,
				rgba(15, 20, 50, 0.95) 100%
			),
			radial-gradient(ellipse 60% 100% at 50% 100%, rgba(40, 60, 120, 0.4) 0%, transparent 70%);
		border-top: 1px solid rgba(77, 217, 255, 0.1);
		pointer-events: none;
	}
	.cockpit::before,
	.cockpit::after {
		content: '';
		position: absolute;
		bottom: 18px;
		width: 80px;
		height: 14px;
		background: linear-gradient(90deg, #4dd9ff, #7b3ff5);
		border-radius: 3px;
		opacity: 0.45;
		box-shadow: 0 0 20px rgba(77, 217, 255, 0.4);
	}
	.cockpit::before {
		left: 8%;
	}
	.cockpit::after {
		right: 8%;
		background: linear-gradient(90deg, #7b3ff5, #4dd9ff);
	}

	/* Bloquer le scroll sur la page hub */
	:global(body):has(.hub) {
		overflow: hidden;
		height: 100vh;
	}

	/* ====== Layout ====== */
	.hub {
		display: grid;
		grid-template-columns: 300px 1fr 300px;
		gap: 1rem;
		padding: 1rem 1.5rem;
		height: calc(100vh - 60px);
		max-height: calc(100vh - 60px);
		max-width: 1700px;
		margin: 0 auto;
		align-items: start;
		position: relative;
		overflow: hidden;
	}

	/* ====== Panels ====== */
	.panel {
		background: rgba(10, 14, 36, 0.78);
		border: 1px solid rgba(77, 217, 255, 0.18);
		border-radius: 14px;
		padding: 1rem;
		backdrop-filter: blur(8px);
		box-shadow:
			0 4px 24px rgba(0, 0, 0, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
	}

	h2 {
		font-size: 0.78rem;
		font-weight: 700;
		color: #c0d8ff;
		text-transform: uppercase;
		letter-spacing: 1.4px;
		margin-bottom: 0.85rem;
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	h2 svg {
		color: #4dd9ff;
		flex-shrink: 0;
	}

	:global(.chat-col-title svg),
	:global(.ltab svg),
	:global(.lb-stab svg),
	:global(.waiting-row svg),
	:global(.btn-hero svg),
	:global(.btn-ghost svg) {
		display: inline-block;
		vertical-align: middle;
		flex-shrink: 0;
	}
	:global(.ltab svg),
	:global(.lb-stab svg) {
		color: inherit;
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}
	.panel-header h2 {
		margin-bottom: 0;
	}

	/* ====== Left col : Loadout ====== */
	.left-col {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		overflow: visible;
	}
	.logo-card {
		background: rgba(10, 14, 36, 0.78);
		border-radius: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		overflow: hidden;
	}
	.logo-card-img {
		width: 100%;
		max-width: 250px;
		height: auto;
		display: block;
	}

	.loadout-panel {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		overflow: visible;
	}

	.shield-row {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.shield-label {
		font-size: 0.72rem;
		font-weight: 600;
		color: #7080b0;
		text-transform: uppercase;
		letter-spacing: 0.8px;
	}
	.shield-scroll {
		display: flex;
		gap: 0.5rem;
		padding-bottom: 4px;
		padding-top: 4px;
	}
	.shield-card {
		flex-shrink: 0;
		width: 64px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		background: rgba(5, 8, 22, 0.85);
		border: 1px dashed rgba(77, 217, 255, 0.18);
		border-radius: 10px;
		padding: 0.45rem 0.3rem 0.35rem;
		cursor: default;
		opacity: 0.45;
	}
	.shield-lock {
		font-size: 1.2rem;
		line-height: 1;
		margin: 4px 0;
	}
	.shield-soon {
		font-size: 0.6rem;
		color: #8090c0;
		text-align: center;
	}

	/* ====== Onglets gauche (Armement / Shop) ====== */
	.left-tabs {
		display: flex;
		gap: 0;
		border-bottom: 1px solid rgba(77, 217, 255, 0.12);
		margin-bottom: 0.85rem;
		margin-left: -1rem;
		margin-right: -1rem;
		padding: 0 1rem;
	}
	.stats-lb-panel .left-tabs {
		margin-top: -1rem;
	}
	.ltab {
		flex: 1;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: #5060a0;
		font-size: 0.78rem;
		font-weight: 600;
		padding: 0.5rem 0;
		cursor: pointer;
		transition: all 0.15s;
		margin-bottom: -1px;
	}
	.ltab:hover {
		color: #a0b0d0;
	}
	.ltab.active {
		color: #4dd9ff;
		border-bottom-color: #4dd9ff;
	}

	/* ====== Shop inline ====== */
	.shop-tabs {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 0.6rem;
	}
	.shop-stab {
		flex: 1;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(77, 217, 255, 0.12);
		border-radius: 8px;
		font-size: 1rem;
		padding: 0.35rem 0;
		cursor: pointer;
		transition: all 0.15s;
	}
	.shop-stab:hover {
		border-color: rgba(77, 217, 255, 0.3);
	}
	.shop-stab.active {
		border-color: #4dd9ff;
		background: rgba(77, 217, 255, 0.08);
		box-shadow: 0 0 8px rgba(77, 217, 255, 0.2);
	}

	.shop-balance {
		font-size: 0.78rem;
		color: #6870a0;
		margin-bottom: 0.6rem;
	}
	.shop-balance span {
		color: #ffd700;
		font-weight: 700;
	}

	.shop-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow-y: auto;
		max-height: calc(100vh - 280px);
		scrollbar-width: thin;
		scrollbar-color: rgba(77, 217, 255, 0.15) transparent;
	}

	.shop-card {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		background: rgba(5, 8, 22, 0.7);
		border: 1px solid rgba(77, 217, 255, 0.12);
		border-radius: 10px;
		padding: 0.5rem 0.6rem;
		transition: border-color 0.15s;
	}
	.shop-card:hover {
		border-color: rgba(77, 217, 255, 0.35);
	}
	.shop-card-img {
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		background: rgba(5, 5, 25, 0.8);
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.shop-card-img img {
		max-width: 30px;
		max-height: 30px;
		object-fit: contain;
		image-rendering: pixelated;
	}
	.shop-card-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}
	.shop-card-name {
		font-size: 0.8rem;
		color: #c0c8ff;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.shop-card-price {
		font-size: 0.72rem;
		color: #ffd700;
		font-weight: 600;
	}

	/* ====== Center col ====== */
	.center-col {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: center;
		gap: 0.875rem;
		position: relative;
		height: calc(100vh - 60px - 2rem);
		overflow: hidden;
	}

	.hero-ship {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 420px;
		position: relative;
	}

	.ship-display {
		position: relative;
		width: 100%;
		height: 380px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.ship-img {
		width: 280px;
		height: 280px;
		object-fit: contain;
		image-rendering: pixelated;
		filter: drop-shadow(0 0 30px rgba(77, 217, 255, 0.55))
			drop-shadow(0 0 60px rgba(123, 63, 245, 0.35));
		position: relative;
		z-index: 2;
		animation: shipFloat 4s ease-in-out infinite;
	}
	@keyframes shipFloat {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-12px);
		}
	}
	.ship-podium {
		position: absolute;
		bottom: 30px;
		left: 50%;
		transform: translateX(-50%);
		width: 320px;
		height: 60px;
		pointer-events: none;
	}
	.podium-ring {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 280px;
		height: 40px;
		transform: translate(-50%, -50%);
		border: 2px solid #4dd9ff;
		border-radius: 50%;
		box-shadow:
			0 0 20px rgba(77, 217, 255, 0.6),
			inset 0 0 20px rgba(77, 217, 255, 0.3);
		opacity: 0.8;
	}
	.podium-ring-2 {
		width: 220px;
		height: 30px;
		border-color: #b794f4;
		box-shadow: 0 0 15px rgba(183, 148, 244, 0.5);
		opacity: 0.6;
	}

	.primary-cta {
		display: flex;
		justify-content: center;
	}
	.btn-hero {
		appearance: none;
		border: 1.5px solid #4dd9ff;
		background: linear-gradient(180deg, rgba(20, 30, 70, 0.92) 0%, rgba(15, 22, 55, 0.92) 100%);
		color: #eafcff;
		font-weight: 800;
		font-size: 1.05rem;
		letter-spacing: 0.5px;
		padding: 0.95rem 2.4rem;
		border-radius: 12px;
		cursor: pointer;
		text-shadow: 0 0 10px rgba(77, 217, 255, 0.7);
		box-shadow:
			0 0 24px rgba(77, 217, 255, 0.55),
			0 0 60px rgba(77, 217, 255, 0.25),
			inset 0 0 18px rgba(77, 217, 255, 0.18);
		transition: all 0.2s ease;
		white-space: nowrap;
	}
	.btn-hero:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow:
			0 0 32px rgba(77, 217, 255, 0.8),
			0 0 80px rgba(77, 217, 255, 0.35),
			inset 0 0 22px rgba(77, 217, 255, 0.25);
	}
	.btn-hero:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.hero-actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.85rem;
		margin-top: -1rem;
	}
	.secondary-actions {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		justify-content: center;
	}
	.btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.7rem 1.3rem;
		font-size: 0.92rem;
		font-weight: 600;
		color: #e0e8ff;
		background: linear-gradient(180deg, rgba(28, 36, 78, 0.85) 0%, rgba(20, 26, 60, 0.85) 100%);
		border: 1px solid rgba(120, 140, 220, 0.45);
		border-radius: 12px;
		text-decoration: none;
		cursor: pointer;
		transition: all 0.18s ease;
		box-shadow:
			0 2px 12px rgba(0, 0, 0, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}
	.btn-ghost:hover {
		color: #fff;
		border-color: rgba(77, 217, 255, 0.7);
		background: linear-gradient(180deg, rgba(38, 50, 100, 0.9) 0%, rgba(28, 36, 80, 0.9) 100%);
		box-shadow:
			0 2px 16px rgba(77, 217, 255, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}
	.btn-ghost-icon {
		font-size: 1rem;
		display: inline-flex;
		align-items: center;
	}

	/* ====== Chat 3 colonnes ====== */
	.chat-panel {
		flex: 1;
		min-height: 160px;
		max-height: 260px;
		display: flex;
		flex-direction: row;
		gap: 0;
		max-width: 720px;
		width: 100%;
		margin: 0 auto;
		padding: 0;
		overflow: hidden;
	}

	.chat-col {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		padding: 0.75rem;
	}
	.chat-col-side {
		width: 140px;
		flex-shrink: 0;
	}
	.chat-col-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	.chat-divider {
		width: 1px;
		background: rgba(77, 217, 255, 0.1);
		align-self: stretch;
		flex-shrink: 0;
	}

	.chat-col-title {
		font-size: 0.7rem;
		font-weight: 700;
		color: #5060a0;
		text-transform: uppercase;
		letter-spacing: 1px;
		margin-bottom: 0.5rem;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.col-badge {
		background: rgba(77, 217, 255, 0.12);
		color: #4dd9ff;
		border-radius: 8px;
		padding: 0 0.3rem;
		font-size: 0.65rem;
		line-height: 1.5;
	}

	.chat-col-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		scrollbar-width: thin;
		scrollbar-color: rgba(100, 100, 255, 0.15) transparent;
	}

	.social-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
	}
	.social-name {
		color: #7080a0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.social-name.me {
		color: #c0c8ff;
		font-weight: 600;
	}
	.you {
		font-size: 0.65rem;
		color: #405080;
		margin-left: 0.15rem;
	}

	.duel-item {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 6px;
		padding: 0.4rem 0.5rem;
	}
	.room-players {
		font-size: 0.75rem;
		color: #c0c8ff;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.room-status {
		font-size: 0.68rem;
		color: #6870a0;
	}
	.room-actions {
		display: flex;
		gap: 0.3rem;
		margin-top: 0.15rem;
	}

	.waiting-row {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		background: rgba(100, 100, 255, 0.07);
		border: 1px solid rgba(100, 100, 255, 0.18);
		border-radius: 6px;
		padding: 0.4rem 0.5rem;
		font-size: 0.72rem;
		color: #8090c0;
	}

	.messages {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.1rem 0;
		scrollbar-width: thin;
		scrollbar-color: rgba(100, 100, 255, 0.2) transparent;
	}
	.message {
		display: flex;
		gap: 0.35rem;
		align-items: baseline;
		font-size: 0.78rem;
		flex-wrap: wrap;
	}
	.message.own .msg-author {
		color: #7b8cff;
	}
	.msg-time {
		color: #3a4060;
		font-size: 0.65rem;
		flex-shrink: 0;
	}
	.msg-author {
		color: #6870a0;
		font-weight: 600;
		flex-shrink: 0;
	}
	.msg-text {
		color: #a0a8c0;
		word-break: break-word;
	}
	.chat-form {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid rgba(100, 100, 255, 0.1);
		flex-shrink: 0;
	}
	.chat-form input {
		flex: 1;
		border-radius: 20px;
		padding: 0.5rem 1rem;
	}
	.chat-send {
		flex-shrink: 0;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: none;
		background: linear-gradient(135deg, #4a5fff, #7b3ff5);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			opacity 0.15s,
			transform 0.1s;
		align-self: center;
	}
	.chat-send:hover {
		opacity: 0.85;
	}
	.chat-send:active {
		transform: scale(0.92);
	}
	.chat-send svg {
		transform: translateX(1px);
	}

	.empty-text {
		color: #3a4060;
		font-size: 0.75rem;
		text-align: center;
		padding: 0.4rem 0;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.dot.idle {
		background: #4caf50;
		box-shadow: 0 0 4px #4caf5080;
	}
	.dot.busy {
		background: #ff9800;
	}

	/* ====== Right col ====== */
	.right-col {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		overflow-y: auto;
		overflow-x: hidden;
		scrollbar-width: thin;
		scrollbar-color: rgba(77, 217, 255, 0.15) transparent;
	}
	.duels-panel h2 {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.duels-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-height: 180px;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: rgba(77, 217, 255, 0.15) transparent;
	}

	/* Mega Ring */
	.mega-ring-wrap {
		position: absolute;
		top: 0;
		right: 0;
		width: 10vw;
		height: 20vh;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 110;
		pointer-events: none;
	}
	.mega-ring-img {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 110%;
		height: 110%;
		object-fit: cover;
		pointer-events: none;
	}
	.mega-ring-filled {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 110%;
		height: 110%;
		object-fit: cover;
		pointer-events: none;
		-webkit-mask-image: conic-gradient(
			from 2.1deg,
			#000 0deg,
			#000 var(--reveal),
			transparent var(--reveal),
			transparent 360deg
		);
		mask-image: conic-gradient(
			from 2.1deg,
			#000 0deg,
			#000 var(--reveal),
			transparent var(--reveal),
			transparent 360deg
		);
		filter: drop-shadow(0 0 6px rgba(77, 217, 255, 0.6));
	}
	.mega-ring-center {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		line-height: 1;
		z-index: 2;
	}
	.mega-level {
		font-family: 'Quantico', sans-serif;
		font-size: 3.5rem;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -1px;
		background: linear-gradient(
			180deg,
			#fff8c8 0%,
			#ffe98a 25%,
			#ffd24a 50%,
			#c8861f 62%,
			#ffd24a 78%,
			#fff2a0 95%,
			#ffe27a 100%
		);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
		filter: drop-shadow(0 1px 0 #8a4a14) drop-shadow(0 -1px 0 #8a4a14) drop-shadow(1px 0 0 #8a4a14)
			drop-shadow(-1px 0 0 #8a4a14);
	}
	.mega-pct {
		position: absolute;
		top: 22%;
		left: -60px;
		font-size: 0.95rem;
		font-weight: 700;
		color: #4dd9ff;
		text-shadow: 0 0 8px rgba(77, 217, 255, 0.6);
	}
	.mega-pct::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 100%;
		width: 50px;
		height: 1px;
		background: rgba(77, 217, 255, 0.35);
	}
	.mega-exp {
		position: absolute;
		top: 38%;
		left: -130px;
		font-size: 0.7rem;
		color: #8ab4d8;
		background: rgba(8, 12, 30, 0.85);
		padding: 0.25rem 0.55rem;
		border-radius: 6px;
		border: 1px solid rgba(77, 217, 255, 0.25);
		white-space: nowrap;
	}
	.mega-exp::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 100%;
		width: 60px;
		height: 1px;
		background: rgba(77, 217, 255, 0.35);
	}
	.mega-grade {
		position: absolute;
		bottom: -2rem;
		left: 50%;
		transform: translateX(-50%);
		font-size: 0.72rem;
		color: #c0d8ff;
		background: rgba(8, 12, 30, 0.85);
		padding: 0.3rem 0.65rem;
		border-radius: 6px;
		border: 1px solid rgba(77, 217, 255, 0.25);
		white-space: nowrap;
	}
	.mega-grade strong {
		color: #ffd700;
	}

	/* Radar */
	.radar-panel {
		padding-bottom: 0.5rem;
	}
	.radar-wrap {
		width: 100%;
		display: flex;
		justify-content: center;
	}
	.radar {
		width: 100%;
		max-width: 100%;
		height: auto;
	}
	.radar-label {
		font-size: 5px;
		fill: #c0d8ff;
		font-weight: 600;
	}

	/* Stats */
	.stat-rows {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.stat-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.stat-label {
		font-size: 0.75rem;
		color: #a0b0d0;
		flex: 1;
		white-space: nowrap;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.stat-bar {
		flex: 1;
		height: 6px;
		background: rgba(255, 255, 255, 0.07);
		border-radius: 3px;
		overflow: hidden;
		flex-shrink: 0;
		max-width: 90px;
	}
	.stat-fill {
		height: 100%;
		border-radius: 3px;
		transition: width 0.5s ease;
	}
	.stat-fill.cyan {
		background: linear-gradient(90deg, #4dd9ff, #7df3ff);
		box-shadow: 0 0 6px rgba(77, 217, 255, 0.5);
	}
	.stat-val {
		font-size: 0.82rem;
		font-weight: 700;
		color: #e8eeff;
		min-width: 32px;
		text-align: right;
	}

	.stats-summary {
		background: rgba(8, 8, 28, 0.85);
	}

	/* ====== Classement ====== */
	.lb-panel {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-height: 0;
	}
	.lb-sort {
		display: flex;
		gap: 0.35rem;
	}
	.lb-stab {
		flex: 1;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(77, 217, 255, 0.12);
		border-radius: 6px;
		color: #5060a0;
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.3rem 0;
		cursor: pointer;
		transition: all 0.15s;
	}
	.lb-stab:hover {
		color: #a0b0d0;
		border-color: rgba(77, 217, 255, 0.25);
	}
	.lb-stab.active {
		color: #4dd9ff;
		border-color: #4dd9ff;
		background: rgba(77, 217, 255, 0.07);
	}
	.lb-list {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		overflow-y: auto;
		max-height: 180px;
		scrollbar-width: thin;
		scrollbar-color: rgba(77, 217, 255, 0.15) transparent;
	}
	.lb-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.78rem;
		padding: 0.3rem 0.4rem;
		border-radius: 6px;
		transition: background 0.1s;
	}
	.lb-row:hover {
		background: rgba(255, 255, 255, 0.03);
	}
	.lb-me {
		background: rgba(100, 100, 255, 0.08);
		border: 1px solid rgba(100, 100, 255, 0.15);
	}
	.lb-rank {
		font-size: 0.85rem;
		width: 24px;
		flex-shrink: 0;
		text-align: center;
	}
	.lb-name {
		flex: 1;
		color: #a0a8c0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lb-me .lb-name {
		color: #c0c8ff;
		font-weight: 600;
	}
	.lb-val {
		color: #ffd700;
		font-weight: 700;
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	/* ====== Buttons ====== */
	.btn-sm {
		padding: 0.3rem 0.65rem !important;
		font-size: 0.78rem !important;
	}
</style>
