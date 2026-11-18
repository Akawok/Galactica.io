<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { currentUser, auth } from '$lib/stores/auth';
	import { connectSocket } from '$lib/stores/socket';
	import { chatMessages, addMessage } from '$lib/stores/chat';
	import { api } from '$lib/api';
	import { MAX_LEVEL, xpForLevel, xpPercent } from '$lib/shared/xp';
	import { GAME_EVENT, LOBBY_EVENT } from '$lib/shared/events';
	import LoadoutRow from '$lib/components/LoadoutRow.svelte';
	import GradeBadge from '$lib/components/GradeBadge.svelte';
	import ItemPopover from '$lib/components/ItemPopover.svelte';
	import AttributesPanel from '$lib/components/AttributesPanel.svelte';
	import { BRANCHES } from '$lib/attributesUi';
	import {
		ATTRIBUTE_MAX,
		sanitizeAttributes,
		spentPoints,
		totalPoints,
		type Attributes
	} from '$lib/shared/attributes';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Rocket from '@lucide/svelte/icons/rocket';
	import Lock from '@lucide/svelte/icons/lock';
	import Swords from '@lucide/svelte/icons/swords';
	import Clock from '@lucide/svelte/icons/clock';
	import Users from '@lucide/svelte/icons/users';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Eye from '@lucide/svelte/icons/eye';
	import Bomb from '@lucide/svelte/icons/bomb';
	import Zap from '@lucide/svelte/icons/zap';
	import Shield from '@lucide/svelte/icons/shield';
	import Warehouse from '@lucide/svelte/icons/warehouse';
	import X from '@lucide/svelte/icons/x';
	import Bot from '@lucide/svelte/icons/bot';
	import { getGrade } from '$lib/shared/grades';
	import { findItem, itemFrameUrls, pingPongOrder } from '$lib/itemImages';
	import type { Socket } from 'socket.io-client';

	interface Player {
		socketId: string;
		username: string;
		level?: number;
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
		frames?: number;
		imageVersion?: number;
		price?: number;
		priceGalactics?: number;
		description?: string;
	}

	let players = $state<Player[]>([]);
	let rooms = $state<Room[]>([]);
	// Matchmaking pairs waiting players on its own, only the matches being played are worth listing
	const liveDuels = $derived(
		rooms.filter(
			(r) =>
				(r.status === 'playing' || r.status === 'roundEnd') &&
				!r.players.some((p) => p.username === $currentUser?.username)
		)
	);
	let chatInput = $state('');
	let socket: Socket | null = null;
	let createdRoom = $state<string | null>(null);
	let incomingChallenge = $state<{ id: string; from: string; level?: number } | null>(null);
	let outgoingChallenge = $state<{ id: string; to: string } | null>(null);
	const searchingRooms = $derived(
		rooms.filter(
			(r) =>
				r.status === 'waiting' &&
				r.players.length === 1 &&
				r.players[0].username !== $currentUser?.username
		)
	);
	const searchingRoomOf = $derived(
		new Map(searchingRooms.map((r) => [r.players[0].username, r.roomId]))
	);
	const isSearching = (username: string) =>
		searchingRoomOf.has(username) || (!!createdRoom && username === $currentUser?.username);
	// Players waiting for an opponent come first: they are the ones worth noticing
	const sortedPlayers = $derived(
		[...players].sort((a, b) => Number(isSearching(b.username)) - Number(isSearching(a.username)))
	);
	let inventory = $state<InventoryItem[]>([]);
	let fullStats = $state<{
		wins: number;
		losses: number;
		totalGames: number;
		bestStreak: number;
	} | null>(null);
	let equipLoading = $state<string | null>(null);
	let buyLoading = $state<string | null>(null);
	let leftTab = $state<'pilote' | 'hangar'>('pilote');
	let rightTab = $state<'stats' | 'classement'>('stats');
	let allItems = $state<InventoryItem[]>([]);
	let ownedIds = $state<Set<string>>(new Set());

	interface LeaderboardPlayer {
		username: string;
		level: number;
		stats: { wins: number; losses: number; totalGames: number; desertions?: number };
	}
	let leaderboard = $state<LeaderboardPlayer[]>([]);
	type LeaderboardSort = 'wins' | 'losses' | 'level' | 'desertions';
	let lbSort = $state<LeaderboardSort>('wins');
	let lbRequest = 0;
	// The server ranks every player, so each tab asks for its own top 50
	async function setLbSort(sort: LeaderboardSort) {
		lbSort = sort;
		const id = ++lbRequest;
		try {
			const { players } = await api.leaderboard.get(sort);
			if (id === lbRequest) leaderboard = players;
		} catch {
			// The previous ranking stays displayed
		}
	}
	const activeShipItem = $derived(findItem(allItems, 'ship', $currentUser?.activeShip));
	let previewShip = $state<InventoryItem | null>(null);
	const displayedShip = $derived(previewShip ?? activeShipItem);
	const shipFrames = $derived(displayedShip ? itemFrameUrls(displayedShip) : []);
	const shipSequence = $derived(pingPongOrder(shipFrames.length));
	let shipStep = $state(0);
	const shipFrame = $derived(shipSequence[shipStep % shipSequence.length] ?? 0);
	$effect(() => {
		if (shipSequence.length < 2) return;
		const timer = setInterval(() => (shipStep = (shipStep + 1) % shipSequence.length), 110);
		return () => clearInterval(timer);
	});

	const LB_SORTS: { key: LeaderboardSort; label: string; unit: [string, string] }[] = [
		{ key: 'wins', label: 'Victoires', unit: ['victoire', 'victoires'] },
		{ key: 'losses', label: 'Défaites', unit: ['défaite', 'défaites'] },
		{ key: 'level', label: 'Niveau', unit: ['niv.', 'niv.'] },
		{ key: 'desertions', label: 'Désertions', unit: ['désertion', 'désertions'] }
	];
	const lbCurrent = $derived(LB_SORTS.find((s) => s.key === lbSort) ?? LB_SORTS[0]);
	function lbScore(p: LeaderboardPlayer): number {
		if (lbSort === 'wins') return p.stats.wins;
		if (lbSort === 'losses') return p.stats.losses;
		if (lbSort === 'desertions') return p.stats.desertions ?? 0;
		return p.level ?? 1;
	}
	let hoveredItem = $state<InventoryItem | null>(null);
	let popoverX = $state(0);
	let popoverY = $state(0);
	let loadoutError = $state<string | null>(null);

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
	// The bar is full at a 5.0 ratio; no loss at all counts as full
	const kdBarPct = $derived(
		!fullStats || (fullStats.losses === 0 && fullStats.wins === 0)
			? 0
			: fullStats.losses === 0
				? 100
				: Math.min(100, (fullStats.wins / fullStats.losses / 5) * 100)
	);

	let lobbyError = $state<string | null>(null);
	let chatError = $state<string | null>(null);
	let messagesEl = $state<HTMLDivElement | null>(null);

	// Keeps the newest message in view, unless the player scrolled up to read older ones
	$effect.pre(() => {
		void $chatMessages.length;
		const el = messagesEl;
		if (!el) return;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
		if (atBottom) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
	});

	// Free items are given to every player at sign-up, they never belong in the shop
	const forSale = $derived(
		allItems.filter(
			(i) => !ownedIds.has(String(i._id)) && (i.price ?? 0) + (i.priceGalactics ?? 0) > 0
		)
	);
	const shipsForSale = $derived(forSale.filter((i) => i.type === 'ship'));
	const primaryForSale = $derived(
		forSale.filter((i) => i.type === 'bullet' && i.bulletRole === 'primary')
	);
	const secondaryForSale = $derived(
		forSale.filter((i) => i.type === 'bullet' && i.bulletRole === 'secondary')
	);

	function canAfford(item: InventoryItem): boolean {
		return (
			($currentUser?.points ?? 0) >= (item.price ?? 0) &&
			($currentUser?.galactics ?? 0) >= (item.priceGalactics ?? 0)
		);
	}

	async function buyItem(item: InventoryItem): Promise<boolean> {
		if (buyLoading) return false;
		buyLoading = item._id;
		loadoutError = null;
		try {
			const { points, galactics } = await api.shop.buy(item._id);
			auth.updateUser({ points, galactics });
			ownedIds = new Set([...ownedIds, String(item._id)]);
			inventory = [...inventory, item];
			return true;
		} catch (e) {
			loadoutError = e instanceof Error ? e.message : 'Achat impossible';
			return false;
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

	const joinLobby = () => socket?.emit(LOBBY_EVENT.USER_JOIN);
	const onLobbyState = (data: { players: Player[]; rooms: Room[] }) => {
		players = data.players;
		rooms = data.rooms;
	};
	const onCreated = ({ roomId }: { roomId: string }) => {
		createdRoom = roomId;
		lobbyError = null;
	};
	const onCancelled = () => {
		createdRoom = null;
	};
	const onNavigate = ({ roomId }: { roomId: string }) => {
		goto(`/game/${roomId}`);
	};
	const onSpectating = ({ roomId }: { roomId: string }) => {
		goto(`/game/${roomId}?spectate=1`);
	};
	const onGameError = ({ message }: { message: string }) => {
		lobbyError = message;
	};
	const onChatBlocked = ({ reason }: { reason: string }) => {
		chatError = reason;
	};
	const onChallengeSent = (data: { id: string; to: string }) => {
		outgoingChallenge = data;
		lobbyError = null;
	};
	const onChallenged = (data: { id: string; from: string; level?: number }) => {
		incomingChallenge = data;
	};
	const onChallengeEnded = (data: { id: string; reason: string; to: string | null }) => {
		if (incomingChallenge?.id === data.id) incomingChallenge = null;
		if (outgoingChallenge?.id !== data.id) return;
		outgoingChallenge = null;
		const who = data.to ?? 'Ton adversaire';
		if (data.reason === 'declined') lobbyError = `${who} a refusé ton défi`;
		else if (data.reason === 'expired') lobbyError = `${who} n'a pas répondu à ton défi`;
		else if (data.reason === 'unavailable') lobbyError = `${who} n'est plus disponible`;
	};

	onMount(async () => {
		if (!$currentUser) return;

		socket = connectSocket();
		// Listeners go first so nothing sent during the API calls below is missed
		socket.on(LOBBY_EVENT.STATE, onLobbyState);
		socket.on(GAME_EVENT.CREATED, onCreated);
		socket.on(GAME_EVENT.CANCELLED, onCancelled);
		socket.on(GAME_EVENT.NAVIGATE, onNavigate);
		socket.on(GAME_EVENT.SPECTATING, onSpectating);
		socket.on(GAME_EVENT.ERROR, onGameError);
		socket.on('chat:blocked', onChatBlocked);
		socket.on(GAME_EVENT.CHALLENGE_SENT, onChallengeSent);
		socket.on(GAME_EVENT.CHALLENGED, onChallenged);
		socket.on(GAME_EVENT.CHALLENGE_ENDED, onChallengeEnded);
		// A reconnection gets a new socket id that the server does not know yet
		socket.on('connect', joinLobby);
		if (socket.connected) joinLobby();

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
				points: statsUser.points ?? 0,
				galactics: statsUser.galactics ?? 0,
				attributes: statsUser.attributes,
				respecCost: statsUser.respecCost ?? 0
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
					id: m.id,
					username: m.username,
					message: m.message,
					timestamp: new Date(m.timestamp).getTime(),
					level: m.level,
					system: m.system,
					announcement: m.announcement
				});
		}
	});

	onDestroy(() => {
		socket?.off(LOBBY_EVENT.STATE, onLobbyState);
		socket?.off(GAME_EVENT.CREATED, onCreated);
		socket?.off(GAME_EVENT.CANCELLED, onCancelled);
		socket?.off(GAME_EVENT.NAVIGATE, onNavigate);
		socket?.off(GAME_EVENT.SPECTATING, onSpectating);
		socket?.off(GAME_EVENT.ERROR, onGameError);
		socket?.off('chat:blocked', onChatBlocked);
		socket?.off(GAME_EVENT.CHALLENGE_SENT, onChallengeSent);
		socket?.off(GAME_EVENT.CHALLENGED, onChallenged);
		socket?.off(GAME_EVENT.CHALLENGE_ENDED, onChallengeEnded);
		socket?.off('connect', joinLobby);
		hoveredItem = null;
	});

	// Starting anything else withdraws our pending challenge, without telling us it was refused
	function withdrawChallenge() {
		if (!outgoingChallenge) return;
		socket?.emit(GAME_EVENT.CHALLENGE_CANCEL, { id: outgoingChallenge.id });
		outgoingChallenge = null;
	}

	function challenge(socketId: string) {
		lobbyError = null;
		socket?.emit(GAME_EVENT.CHALLENGE, { socketId });
	}

	function answerChallenge(accept: boolean) {
		if (!incomingChallenge) return;
		withdrawChallenge();
		socket?.emit(GAME_EVENT.CHALLENGE_ANSWER, { id: incomingChallenge.id, accept });
		incomingChallenge = null;
	}

	function joinGame(roomId: string) {
		withdrawChallenge();
		lobbyError = null;
		socket?.emit(GAME_EVENT.JOIN, { roomId });
	}

	function play() {
		withdrawChallenge();
		lobbyError = null;
		socket?.emit(GAME_EVENT.QUICKPLAY);
	}

	const BOT_LEVELS = [
		{ difficulty: 'facile', label: 'Facile' },
		{ difficulty: 'normal', label: 'Normal' },
		{ difficulty: 'difficile', label: 'Difficile' }
	] as const;

	let choosingLevel = $state(false);

	function startTraining(difficulty: (typeof BOT_LEVELS)[number]['difficulty']) {
		withdrawChallenge();
		choosingLevel = false;
		lobbyError = null;
		socket?.emit(GAME_EVENT.TRAINING, { difficulty });
	}

	function cancelGame() {
		if (!createdRoom) return;
		socket?.emit(GAME_EVENT.CANCEL, { roomId: createdRoom });
	}

	function spectate(roomId: string) {
		lobbyError = null;
		socket?.emit(GAME_EVENT.SPECTATE, { roomId });
	}

	function sendMessage(e: Event) {
		e.preventDefault();
		if (!chatInput.trim()) return;
		chatError = null;
		socket?.emit(LOBBY_EVENT.CHAT_MESSAGE, { message: chatInput.trim() });
		chatInput = '';
	}

	async function equipItem(item: InventoryItem) {
		if (equipLoading) return;
		equipLoading = item._id;
		loadoutError = null;
		try {
			const result = await api.shop.equip(item.type as 'ship' | 'bullet', item.sprite);
			auth.updateUser({
				activeShip: result.activeShip,
				activeBullet: result.activeBullet,
				activeBulletSecondary: result.activeBulletSecondary
			});
			socket?.emit('user:updateLoadout');
		} catch (e) {
			loadoutError = e instanceof Error ? e.message : 'Équipement impossible';
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

	const myAttributes = $derived(sanitizeAttributes($currentUser?.attributes));
	const pointsAvailable = $derived(
		totalPoints($currentUser?.level ?? 1) - spentPoints(myAttributes)
	);

	function onAttributesChange(update: {
		attributes: Attributes;
		galactics?: number;
		respecCost?: number;
	}) {
		auth.updateUser(update);
	}

	const radarAxes = BRANCHES.flatMap((b) =>
		b.attributes.map((a) => ({ key: a.key, label: a.label, color: b.accent }))
	);
	const radarValues = $derived(radarAxes.map((a) => myAttributes[a.key] / ATTRIBUTE_MAX));
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
					class:active={leftTab === 'pilote'}
					onclick={() => (leftTab = 'pilote')}
				>
					<Sparkles size={14} /> Pilote
					{#if pointsAvailable > 0}<span class="ltab-badge">{pointsAvailable}</span>{/if}
				</button>
				<button
					class="ltab"
					class:active={leftTab === 'hangar'}
					onclick={() => (leftTab = 'hangar')}
				>
					<Warehouse size={14} /> Hangar
				</button>
			</div>

			{#if loadoutError}
				<p class="loadout-error" role="alert">{loadoutError}</p>
			{/if}

			{#if leftTab === 'pilote'}
				<AttributesPanel
					saved={myAttributes}
					level={$currentUser?.level ?? 1}
					galactics={$currentUser?.galactics ?? 0}
					respecCost={$currentUser?.respecCost ?? 0}
					onchange={onAttributesChange}
				/>
			{:else}
				<div class="hangar">
					<LoadoutRow
						label="Vaisseau"
						icon={Rocket}
						accent="#4dd9ff"
						items={ships}
						activeSprite={$currentUser?.activeShip}
						loadingId={equipLoading}
						emptyText="Aucun vaisseau"
						shopItems={shipsForSale}
						buyingId={buyLoading}
						{canAfford}
						onbuy={buyItem}
						onequip={equipItem}
						onpreview={(item) => (previewShip = item as InventoryItem | null)}
						onhover={showPopover}
						onleave={hidePopover}
					/>
					<LoadoutRow
						label="Missile principal"
						icon={Zap}
						accent="#ff5566"
						items={primaryBullets}
						activeSprite={$currentUser?.activeBullet}
						loadingId={equipLoading}
						emptyText="Aucun missile"
						shopItems={primaryForSale}
						buyingId={buyLoading}
						{canAfford}
						onbuy={buyItem}
						onequip={equipItem}
						onhover={showPopover}
						onleave={hidePopover}
					/>
					<LoadoutRow
						label="Missile secondaire"
						icon={Bomb}
						accent="#ffaa33"
						items={secondaryBullets}
						activeSprite={$currentUser?.activeBulletSecondary}
						loadingId={equipLoading}
						emptyText="Aucun missile"
						shopItems={secondaryForSale}
						buyingId={buyLoading}
						{canAfford}
						onbuy={buyItem}
						onequip={equipItem}
						onhover={showPopover}
						onleave={hidePopover}
					/>
					<div class="shield-row">
						<span class="shield-label">
							<span class="shield-label-icon"><Shield size={12} /></span>
							Bouclier
						</span>
						<div class="shield-scroll">
							<div class="shield-card">
								<span class="shield-lock"><Lock size={14} /></span>
								<span class="shield-soon">Bientôt</span>
							</div>
						</div>
					</div>
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
				onerror={(e) => ((e.currentTarget as HTMLImageElement).style.opacity = '0.1')}
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
				{#if ($currentUser?.level ?? 1) >= MAX_LEVEL}
					Niveau max
				{:else}
					EXP: {($currentUser?.xp ?? 0).toLocaleString('fr-FR')} / {xpForLevel(
						$currentUser?.level ?? 1
					).toLocaleString('fr-FR')}
				{/if}
			</div>
			<div class="mega-grade" style="--grade-color: {grade.color}">
				Niv. {$currentUser?.level ?? 1} Grade: <strong>{grade.label}</strong>
			</div>
		</div>

		<div class="hero-ship">
			<div class="ship-display">
				{#if previewShip}
					<span class="ship-preview-tag">Aperçu · {previewShip.name}</span>
				{/if}
				{#if shipFrames.length}
					<div class="ship-img" role="img" aria-label={displayedShip?.name ?? 'vaisseau'}>
						{#each shipFrames as url, i (url)}
							<img src={url} alt="" class:visible={i === shipFrame} />
						{/each}
					</div>
				{/if}
				<div class="ship-podium">
					<div class="podium-ring"></div>
					<div class="podium-ring podium-ring-2"></div>
				</div>
			</div>
		</div>

		<div class="hero-actions">
			{#if incomingChallenge}
				<div class="challenge-card" role="alert">
					<span class="challenge-text">
						<Swords size={16} />
						<strong>{incomingChallenge.from}</strong>
						{#if incomingChallenge.level}<GradeBadge level={incomingChallenge.level} />{/if}
						te défie !
					</span>
					<div class="challenge-buttons">
						<button class="btn btn-primary btn-sm" onclick={() => answerChallenge(true)}>Accepter</button>
						<button class="btn btn-secondary btn-sm" onclick={() => answerChallenge(false)}>Refuser</button>
					</div>
				</div>
			{/if}
			{#if outgoingChallenge}
				<div class="challenge-card">
					<span class="challenge-text">
						<Clock size={14} /> Défi envoyé à <strong>{outgoingChallenge.to}</strong>…
					</span>
					<button class="btn btn-secondary btn-sm" onclick={withdrawChallenge}>Annuler</button>
				</div>
			{/if}
			<div class="primary-cta">
				{#if createdRoom}
					<button class="btn btn-hero" disabled><Clock size={14} /> Recherche…</button>
				{:else}
					<button class="btn btn-hero" onclick={play}>Jouer</button>
				{/if}
			</div>
			{#if lobbyError}<p class="loadout-error" role="alert">{lobbyError}</p>{/if}
			{#if createdRoom}
				<div class="secondary-actions">
					<button class="btn-ghost" onclick={cancelGame}>
						<span class="btn-ghost-icon"><X size={12} /></span> Annuler la recherche
					</button>
				</div>
			{:else}
				<div class="secondary-actions">
					{#if choosingLevel}
						{#each BOT_LEVELS as level (level.difficulty)}
							<button class="btn-ghost" onclick={() => startTraining(level.difficulty)}>
								{level.label}
							</button>
						{/each}
						<button class="btn-ghost" aria-label="Annuler" onclick={() => (choosingLevel = false)}>
							<span class="btn-ghost-icon"><X size={12} /></span>
						</button>
					{:else}
						<button class="btn-ghost" onclick={() => (choosingLevel = true)}>
							<span class="btn-ghost-icon"><Bot size={12} /></span> S'entraîner contre un bot
						</button>
					{/if}
				</div>
			{/if}
		</div>

		<section class="panel chat-panel">
			<div class="chat-col chat-col-side">
				<div class="chat-col-title">
					<Users size={14} /> Joueurs <span class="col-badge">{players.length}</span>
				</div>
				<div class="chat-col-scroll">
					{#each sortedPlayers as p (p.socketId)}
						{@const searching = isSearching(p.username)}
						{@const waitingRoom = searchingRoomOf.get(p.username)}
						<div class="social-item">
							<span
								class="dot"
								class:idle={p.status === 'idle'}
								class:busy={p.status !== 'idle' && !searching}
								class:searching
							></span>
							<GradeBadge level={p.level} />
							<span class="social-who">
								<span class="social-name" class:me={p.username === $currentUser?.username}>
									{p.username}
									{#if p.username === $currentUser?.username}<span class="you">(toi)</span>{/if}
								</span>
								{#if searching}<span class="searching-text">Cherche un duel</span>{/if}
							</span>
							{#if waitingRoom && !createdRoom}
								<button
									class="challenge-btn fight-btn"
									title="Affronter {p.username}"
									aria-label="Affronter {p.username}"
									onclick={() => joinGame(waitingRoom)}><Swords size={12} /> Affronter</button
								>
							{:else if p.status === 'idle' && p.username !== $currentUser?.username && !createdRoom && !outgoingChallenge}
								<button
									class="challenge-btn"
									title="Défier {p.username}"
									aria-label="Défier {p.username}"
									onclick={() => challenge(p.socketId)}><Swords size={12} /> Défier</button
								>
							{/if}
						</div>
					{:else}
						<p class="empty-text">Personne en ligne</p>
					{/each}
				</div>
			</div>

			<div class="chat-divider"></div>

			<div class="chat-col chat-col-main">
				<div class="chat-col-title"><MessageSquare size={14} /> Chat</div>
				<div class="messages" bind:this={messagesEl}>
					{#each $chatMessages as msg}
						{#if msg.announcement}
							<div class="message announcement">
								<span class="msg-time">{formatTime(msg.timestamp)}</span>
								<span class="msg-text">📢 {msg.message}</span>
							</div>
						{:else if msg.system}
							<div class="message promotion">
								<span class="msg-time">{formatTime(msg.timestamp)}</span>
								<span class="msg-text">🎖️ {msg.message}</span>
								<GradeBadge level={msg.level} />
							</div>
						{:else}
							<div class="message" class:own={msg.username === $currentUser?.username}>
								<span class="msg-time">{formatTime(msg.timestamp)}</span>
								{#if msg.level}<GradeBadge level={msg.level} />{/if}
								<span class="msg-author">{msg.username}</span>
								<span class="msg-text">{msg.message}</span>
							</div>
						{/if}
					{:else}
						<p class="empty-text">Pas encore de message</p>
					{/each}
				</div>
				{#if chatError}<p class="loadout-error" role="alert">{chatError}</p>{/if}
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
				<svg viewBox="-28 -2 144 100" class="radar">
					{#each [0.25, 0.5, 0.75, 1] as f}
						<path
							d={radarPath(radarAxes.map(() => f))}
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
					{#each radarAxes as axis, i}
						{@const angle = (i / radarAxes.length) * 2 * Math.PI - Math.PI / 2}
						{@const cos = Math.cos(angle)}
						<text
							x={50 + 44 * cos}
							y={50 + 44 * Math.sin(angle)}
							text-anchor={cos > 0.2 ? 'start' : cos < -0.2 ? 'end' : 'middle'}
							dominant-baseline="middle"
							fill={axis.color}
							class="radar-label">{axis.label}</text
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
						<span class="stat-label">Taux de victoire</span>
						<div class="stat-bar">
							<div class="stat-fill cyan" style="width:{winrate}%"></div>
						</div>
						<span class="stat-val">{winrate}%</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Ratio K/D</span>
						<div class="stat-bar">
							<div class="stat-fill cyan" style="width:{kdBarPct}%"></div>
						</div>
						<span class="stat-val">{kd}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Meilleure série</span>
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
				<div class="lb-sort" role="tablist" aria-label="Trier le classement">
					{#each LB_SORTS as sort (sort.key)}
						<button
							class="lb-seg"
							class:active={lbSort === sort.key}
							role="tab"
							aria-selected={lbSort === sort.key}
							onclick={() => setLbSort(sort.key)}>{sort.label}</button
						>
					{/each}
				</div>
				<ol class="lb-list">
					{#each leaderboard as p, i (p.username)}
						{@const g = getGrade(p.level ?? 1)}
						{@const score = lbScore(p)}
						<li class="lb-row" class:lb-me={p.username === $currentUser?.username}>
							<span
								class="lb-rank"
								class:gold={i === 0}
								class:silver={i === 1}
								class:bronze={i === 2}>{i + 1}</span
							>
							<span class="lb-who">
								<span class="lb-name">{p.username}</span>
								<span class="lb-grade" style="color: {g.color}">{g.label}</span>
							</span>
							<span
								class="lb-score"
								class:bad={lbSort === 'losses' || lbSort === 'desertions'}
								class:level={lbSort === 'level'}
							>
								{#if lbSort === 'level'}
									<small>niv.</small><strong>{score}</strong>
								{:else}
									<strong>{score}</strong><small>{lbCurrent.unit[score > 1 ? 1 : 0]}</small>
								{/if}
							</span>
						</li>
					{:else}
						<li class="empty-text">Personne pour l'instant</li>
					{/each}
				</ol>
			{/if}
		</section>

		<section class="panel duels-panel">
			<h2>
				<Swords size={14} /> Duels
				<span class="col-badge">{searchingRooms.length + liveDuels.length}</span>
			</h2>
			<div class="duels-list">
				{#if createdRoom}
					<div class="waiting-row">
						<span><Clock size={14} /> Recherche d'un adversaire…</span>
						<button class="btn btn-danger btn-sm" onclick={cancelGame}>Annuler</button>
					</div>
				{/if}
				{#if searchingRooms.length}
					<p class="duels-subtitle">En recherche</p>
					{#each searchingRooms as room (room.roomId)}
						<div class="duel-item">
							<span class="room-players">{room.players[0].username}</span>
							{#if !createdRoom}
								<div class="room-actions">
									<button class="btn btn-primary btn-sm" onclick={() => joinGame(room.roomId)}
										><Swords size={14} /> Affronter</button
									>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
				{#if liveDuels.length}<p class="duels-subtitle">En cours</p>{/if}
				{#each liveDuels as room (room.roomId)}
					<div class="duel-item">
						<span class="room-players">{room.players.map((p) => p.username).join(' vs ')}</span>
						<div class="room-actions">
							<button class="btn btn-secondary btn-sm" onclick={() => spectate(room.roomId)}
								><Eye size={14} /> Regarder</button
							>
						</div>
					</div>
				{:else}
					{#if !createdRoom && !searchingRooms.length}<p class="empty-text">Aucun duel en cours</p>{/if}
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
		owned={ownedIds.has(String(hoveredItem._id))}
	/>
{/if}

<style>
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

	:global(body):has(.hub) {
		overflow: hidden;
		height: 100vh;
	}

	.hub {
		display: grid;
		grid-template-columns: 300px 1fr 300px;
		grid-template-rows: minmax(0, 1fr);
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
	:global(.waiting-row svg),
	:global(.btn-hero svg),
	:global(.btn-ghost svg) {
		display: inline-block;
		vertical-align: middle;
		flex-shrink: 0;
	}
	:global(.ltab svg) {
		color: inherit;
	}

	.left-col {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		overflow: visible;
		max-height: 100%;
		min-height: 0;
	}
	.logo-card {
		flex-shrink: 0;
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
		min-height: 0;
	}
	.hangar {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.shield-row {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.shield-label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: #7080b0;
		text-transform: uppercase;
		letter-spacing: 0.8px;
	}
	.shield-label-icon {
		display: inline-flex;
		align-items: center;
		color: #a78bfa;
		filter: drop-shadow(0 0 4px currentColor);
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
	.ltab-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		margin-left: 0.25rem;
		border-radius: 8px;
		background: #4dd9ff;
		color: #050818;
		font-size: 0.65rem;
		font-weight: 700;
		vertical-align: middle;
		box-shadow: 0 0 8px rgba(77, 217, 255, 0.6);
	}

	:global(.price-galactics svg) {
		display: inline-block;
		flex-shrink: 0;
	}

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
		filter: drop-shadow(0 0 30px rgba(77, 217, 255, 0.55))
			drop-shadow(0 0 60px rgba(123, 63, 245, 0.35));
		position: relative;
		z-index: 2;
		animation: shipFloat 4s ease-in-out infinite;
	}
	.ship-preview-tag {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 3;
		padding: 0.25rem 0.7rem;
		border: 1px solid rgba(255, 204, 85, 0.45);
		border-radius: 999px;
		background: rgba(255, 204, 85, 0.08);
		color: #ffcc55;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.5px;
		white-space: nowrap;
	}
	.ship-img img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		image-rendering: pixelated;
		visibility: hidden;
	}
	.ship-img img.visible {
		visibility: visible;
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

	.chat-panel {
		flex: 1;
		min-height: 160px;
		max-height: 260px;
		display: flex;
		flex-direction: row;
		gap: 0;
		max-width: 860px;
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
		width: 260px;
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
	.challenge-btn {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.15rem 0.45rem;
		font-size: 0.7rem;
		font-weight: 600;
		color: #e0e8ff;
		background: rgba(77, 217, 255, 0.12);
		border: 1px solid rgba(77, 217, 255, 0.4);
		border-radius: 8px;
		cursor: pointer;
	}
	.challenge-btn:hover {
		background: rgba(77, 217, 255, 0.25);
	}
	.challenge-card {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 0.75rem;
		padding: 0.6rem 1rem;
		background: rgba(20, 26, 60, 0.85);
		border: 1px solid rgba(77, 217, 255, 0.5);
		border-radius: 12px;
		color: #e0e8ff;
		font-size: 0.9rem;
	}
	.challenge-text {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.challenge-buttons {
		display: flex;
		gap: 0.5rem;
	}
	.duels-subtitle {
		margin: 0.4rem 0 0.2rem;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #6870a0;
	}
	.social-who {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.searching-text {
		font-size: 0.65rem;
		color: #ffb547;
	}
	.fight-btn {
		color: #fff4e0;
		background: rgba(255, 181, 71, 0.18);
		border-color: rgba(255, 181, 71, 0.6);
	}
	.fight-btn:hover {
		background: rgba(255, 181, 71, 0.32);
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
	.message.promotion {
		align-items: center;
		padding: 0.25rem 0.45rem;
		border-radius: 6px;
		background: linear-gradient(90deg, rgba(255, 215, 0, 0.12), transparent);
		border-left: 2px solid #ffd700;
	}
	.message.announcement {
		align-items: center;
		padding: 0.3rem 0.5rem;
		border-radius: 6px;
		background: linear-gradient(90deg, rgba(77, 217, 255, 0.14), transparent);
		border-left: 2px solid #4dd9ff;
	}
	.message.announcement .msg-text {
		color: #c0e8ff;
		font-weight: 700;
	}
	.message.promotion .msg-text {
		color: #ffe680;
		font-weight: 600;
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

	.loadout-error {
		font-size: 0.75rem;
		color: #ff5566;
		background: rgba(255, 85, 102, 0.08);
		border: 1px solid rgba(255, 85, 102, 0.25);
		border-radius: 6px;
		padding: 0.35rem 0.5rem;
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
	.dot.searching {
		background: #ffb547;
		box-shadow: 0 0 6px #ffb547;
		animation: searchPulse 1.2s ease-in-out infinite;
	}
	@keyframes searchPulse {
		50% {
			opacity: 0.35;
		}
	}

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
		font-weight: 600;
	}

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

	.lb-sort {
		display: flex;
		gap: 2px;
		padding: 3px;
		margin-bottom: 0.6rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(77, 217, 255, 0.12);
		border-radius: 999px;
	}
	.lb-seg {
		flex: 1;
		min-width: 0;
		padding: 0.32rem 0.2rem;
		background: none;
		border: none;
		border-radius: 999px;
		color: #6070a8;
		font-size: 0.68rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s;
	}
	.lb-seg:hover {
		color: #a0b0d0;
	}
	.lb-seg.active {
		color: #050818;
		background: #4dd9ff;
		box-shadow: 0 0 10px rgba(77, 217, 255, 0.35);
	}
	.lb-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
		max-height: 180px;
		scrollbar-width: thin;
		scrollbar-color: rgba(77, 217, 255, 0.15) transparent;
	}
	.lb-row {
		display: grid;
		grid-template-columns: 1.6rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.6rem;
		padding: 0.35rem 0.5rem;
		border-radius: 8px;
		transition: background 0.1s;
	}
	.lb-row:hover {
		background: rgba(255, 255, 255, 0.03);
	}
	.lb-me {
		background: rgba(77, 217, 255, 0.07);
		box-shadow: inset 2px 0 0 #4dd9ff;
	}
	.lb-rank {
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		color: #6070a8;
		font-size: 0.72rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.lb-rank.gold {
		color: #ffd700;
		background: rgba(255, 215, 0, 0.12);
		box-shadow: inset 0 0 0 1px rgba(255, 215, 0, 0.45);
	}
	.lb-rank.silver {
		color: #d4dcea;
		background: rgba(212, 220, 234, 0.1);
		box-shadow: inset 0 0 0 1px rgba(212, 220, 234, 0.4);
	}
	.lb-rank.bronze {
		color: #e3975e;
		background: rgba(227, 151, 94, 0.12);
		box-shadow: inset 0 0 0 1px rgba(227, 151, 94, 0.45);
	}
	.lb-who {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.25;
	}
	.lb-name {
		color: #d6deff;
		font-size: 0.8rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lb-me .lb-name {
		color: #4dd9ff;
	}
	.lb-grade {
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.2px;
		opacity: 0.85;
	}
	.lb-score {
		display: flex;
		align-items: baseline;
		gap: 0.25rem;
		font-variant-numeric: tabular-nums;
	}
	.lb-score strong {
		color: #ffd700;
		font-size: 0.95rem;
	}
	.lb-score small {
		color: #6070a8;
		font-size: 0.62rem;
	}
	.lb-score.bad strong {
		color: #ff8080;
	}
	.lb-score.level strong {
		color: #4dd9ff;
	}

	.btn-sm {
		padding: 0.3rem 0.65rem !important;
		font-size: 0.78rem !important;
	}
</style>
