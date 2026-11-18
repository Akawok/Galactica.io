<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Gem from '@lucide/svelte/icons/gem';
	import { goto } from '$app/navigation';
	import { currentUser, auth } from '$lib/stores/auth';
	import { getSocket } from '$lib/stores/socket';
	import type { GameEngine, GameStartPayload, GameStatePayload } from '$lib/game/engine';

	type GameStatus = 'waiting' | 'playing' | 'roundEnd' | 'matchEnd';
	type RewardNote =
		| { kind: 'repeat'; matchNumber: number; percent: number }
		| { kind: 'grey'; percent: number }
		| { kind: 'upset'; bonusPercent: number }
		| { kind: 'noFight'; self: boolean };

	function noteText(note: RewardNote, won: boolean): string {
		switch (note.kind) {
			case 'noFight':
				return note.self
					? "Pas de gains : tu n'as pas combattu."
					: "Pas de gains : ton adversaire n'a pas combattu.";
			case 'repeat':
				return `${note.matchNumber}e ${won ? 'victoire' : 'défaite'} du jour contre ce joueur : gains à ${note.percent} %.`;
			case 'grey':
				return note.percent === 0
					? 'Pas de gains : ton adversaire a beaucoup moins de niveaux que toi.'
					: `Ton adversaire a moins de niveaux que toi : gains à ${note.percent} %.`;
			case 'upset':
				return `+${note.bonusPercent} % d'XP : tu as battu plus fort que toi !`;
		}
	}

	let canvas: HTMLCanvasElement;
	let engine: GameEngine | null = null;
	let status = $state<GameStatus>('waiting');
	let roundResult = $state<{ winner: string | null; scores: Record<string, number> } | null>(null);
	let matchResult = $state<{
		winner: string;
		pointsEarned: number;
		xpGained: number | null;
		newLevel: number | null;
		leveledUp: boolean;
		galacticsGained: number;
		rewardNotes: RewardNote[];
		training: boolean;
	} | null>(null);
	// 'asked': this player wants a rematch; 'offered': the opponent asked for one
	let rematch = $state<'none' | 'asked' | 'offered' | 'cancelled'>('none');
	let rematchFrom = $state<string | null>(null);
	let abandonResult = $state<{ deserter: string; creditsRecovered: number } | null>(null);
	let closedReason = $state<string | null>(null);

	let { roomId, isSpectator }: { roomId: string; isSpectator: boolean } = $props();
	let destroyed = false;
	let roundTimer: ReturnType<typeof setTimeout> | null = null;
	// game:start can arrive while Pixi is still loading, it is replayed once the engine is ready
	let pendingStart: GameStartPayload | null = null;

	// Only this screen's own handlers are removed: the next screen may already listen after a rematch
	const listeners: [string, (...args: any[]) => void][] = [];
	function listen<T>(event: string, handler: (data: T) => void) {
		getSocket()?.on(event, handler);
		listeners.push([event, handler]);
	}

	onMount(async () => {
		if (!$currentUser) {
			goto('/login');
			return;
		}

		// The socket is only connected from the lobby: a reload or a direct link lands here without it
		const socket = getSocket();
		if (!socket?.connected) {
			goto('/lobby');
			return;
		}

		listen('game:start', (payload: GameStartPayload) => {
			status = 'playing';
			if (engine) engine.onGameStart(payload);
			else pendingStart = payload;
		});

		listen('game:state', (state: GameStatePayload) => {
			if (status === 'playing') engine?.onGameState(state);
		});

		listen(
			'game:roundEnd',
			(data: { winner: { username: string } | null; scores: Record<string, number> }) => {
				status = 'roundEnd';
				roundResult = { winner: data.winner?.username ?? null, scores: data.scores };
				engine?.pause();
				engine?.updateScores(data.scores);
				if (roundTimer) clearTimeout(roundTimer);
				roundTimer = setTimeout(() => {
					if (status === 'roundEnd') {
						status = 'playing';
						roundResult = null;
					}
				}, 3000);
			}
		);

		listen(
			'game:roundStart',
			(data: {
				scores: Record<string, number>;
				players: { id: string; x: number; y: number; angle: number; hp: number; energy: number }[];
			}) => {
				engine?.resetRound(data.players);
				status = 'playing';
				roundResult = null;
			}
		);

		listen(
			'game:matchEnd',
			(data: {
				winner: { username: string };
				pointsEarned: number;
				newPoints: number | null;
				xpGained?: number | null;
				newXP?: number | null;
				newLevel?: number | null;
				leveledUp?: boolean;
				galacticsGained?: number;
				newGalactics?: number | null;
				rewardNotes?: RewardNote[];
				training?: boolean;
			}) => {
				status = 'matchEnd';
				matchResult = {
					training: data.training ?? false,
					winner: data.winner.username,
					pointsEarned: data.pointsEarned,
					xpGained: data.xpGained ?? null,
					newLevel: data.newLevel ?? null,
					leveledUp: data.leveledUp ?? false,
					galacticsGained: data.galacticsGained ?? 0,
					rewardNotes: data.rewardNotes ?? []
				};
				// A spectator's payload carries no rewards, and absent fields must not wipe the profile
				if (isSpectator) return;
				const updates: { points?: number; xp?: number; level?: number; galactics?: number } = {};
				if (data.newPoints != null) updates.points = data.newPoints;
				if (data.newXP != null) updates.xp = data.newXP;
				if (data.newLevel != null) updates.level = data.newLevel;
				if (data.newGalactics != null) updates.galactics = data.newGalactics;
				if (Object.keys(updates).length) auth.updateUser(updates);
			}
		);

		listen(
			'game:abandoned',
			(data: { deserter: string; creditsRecovered: number; newPoints: number | null }) => {
				status = 'matchEnd';
				matchResult = null;
				abandonResult = {
					deserter: data.deserter,
					creditsRecovered: data.creditsRecovered
				};
				if (data.newPoints !== null && !isSpectator) {
					auth.updateUser({ points: data.newPoints });
				}
			}
		);

		listen('game:closed', (data: { reason?: string }) => {
			status = 'matchEnd';
			matchResult = null;
			abandonResult = null;
			engine?.pause();
			closedReason = data.reason ?? 'Partie arrêtée par la modération';
		});

		// A rematch is played in a new room
		listen('game:navigate', (data: { roomId: string }) => {
			if (data.roomId !== roomId) goto(`/game/${data.roomId}`);
		});

		listen('game:rematchOffered', (data: { roomId: string; username: string }) => {
			if (data.roomId !== roomId || rematch !== 'none') return;
			rematch = 'offered';
			rematchFrom = data.username;
		});

		listen('game:rematchCancelled', (data: { roomId: string; username: string | null }) => {
			if (data.roomId !== roomId) return;
			rematch = 'cancelled';
			rematchFrom = data.username;
		});

		// The rematch room could not start, for instance because the other player left meanwhile
		listen('game:cancelled', () => {
			if (status !== 'matchEnd' || rematch === 'none') return;
			rematch = 'cancelled';
			rematchFrom = null;
		});

		const { GameEngine } = await import('$lib/game/engine');
		if (destroyed) return;
		const instance = new GameEngine(socket, socket.id!, isSpectator);
		engine = instance;
		await instance.init(canvas);
		if (destroyed) return;

		if (pendingStart) {
			const payload = pendingStart;
			pendingStart = null;
			await instance.onGameStart(payload);
		}
		// Asks for the current state, in case game:start was sent before this page existed
		socket.emit('game:ready', { roomId });
	});

	onDestroy(() => {
		destroyed = true;
		if (roundTimer) clearTimeout(roundTimer);
		engine?.destroy();
		const socket = getSocket();
		if (status === 'playing' || status === 'roundEnd' || status === 'waiting') {
			socket?.emit('game:leave', { roomId });
		}
		for (const [event, handler] of listeners) socket?.off(event, handler);
	});

	function backToLobby() {
		goto('/lobby');
	}

	function askRematch() {
		rematch = 'asked';
		getSocket()?.emit('game:rematch', { roomId });
	}
</script>

<div class="game-page">
	<canvas bind:this={canvas}></canvas>

	{#if status === 'waiting'}
		<div class="overlay">
			<div class="overlay-card">
				<div class="spinner"></div>
				<p>En attente d'un adversaire…</p>
				<span class="room-code">Room #{roomId}</span>
			</div>
		</div>
	{/if}

	{#if status === 'roundEnd' && roundResult}
		<div class="overlay semi">
			<div class="overlay-card">
				{#if roundResult.winner}
					<h2>{roundResult.winner} gagne la manche</h2>
				{:else}
					<h2>Égalité</h2>
				{/if}
				<div class="scores">
					{#each Object.entries(roundResult.scores) as [id, score] (id)}
						<span>{score}</span>
					{/each}
				</div>
				<p class="next-round">Prochaine manche dans 3s…</p>
			</div>
		</div>
	{/if}

	{#if status === 'matchEnd' && closedReason}
		<div class="overlay">
			<div class="overlay-card">
				<div class="winner-emoji">🛑</div>
				<h2>Partie arrêtée</h2>
				<p>{closedReason}</p>
				<p class="reward-note">Personne ne gagne ni ne perd quoi que ce soit.</p>
				<button class="btn btn-primary" onclick={backToLobby}>Retour au lobby</button>
			</div>
		</div>
	{/if}

	{#if status === 'matchEnd' && abandonResult}
		<div class="overlay">
			<div class="overlay-card">
				<div class="winner-emoji">💨</div>
				<h2>{abandonResult.deserter} a déserté !</h2>
				{#if isSpectator}
					<p>La partie est terminée</p>
				{:else if abandonResult.creditsRecovered > 0}
					<p>
						Tu récupères <strong>+{abandonResult.creditsRecovered} Crédits</strong> sur sa caution
					</p>
				{:else}
					<p>Il n'avait plus un crédit, rien à récupérer</p>
				{/if}
				{#if !isSpectator}
					<p class="reward-note">Partie abandonnée : pas d'XP pour ce combat.</p>
				{/if}
				<button class="btn btn-primary" onclick={backToLobby}>Retour au lobby</button>
			</div>
		</div>
	{/if}

	{#if status === 'matchEnd' && matchResult}
		<div class="overlay">
			<div class="overlay-card">
				{#if isSpectator}
					<div class="winner-emoji">🏁</div>
					<h2>{matchResult.winner} remporte le duel</h2>
				{:else}
					{#if matchResult.winner === $currentUser?.username}
						<div class="winner-emoji">🏆</div>
						<h2>Victoire !</h2>
					{:else}
						<div class="winner-emoji">💫</div>
						<h2>{matchResult.winner} a gagné</h2>
						<p>Ce sera pour la prochaine</p>
					{/if}

					{#if matchResult.pointsEarned > 0 || (matchResult.xpGained ?? 0) > 0}
						<div class="xp-reward">
							{#if matchResult.leveledUp}
								<span class="levelup-badge">Niveau {matchResult.newLevel}</span>
							{/if}
							{#if matchResult.pointsEarned > 0}
								<span class="credits-gained">+{matchResult.pointsEarned} Crédits</span>
							{/if}
							{#if matchResult.galacticsGained > 0}
								<span class="galactics-gained">
									<Gem size={13} /> +{matchResult.galacticsGained}
									{matchResult.galacticsGained > 1 ? 'Galactics' : 'Galactic'}
								</span>
							{/if}
							{#if (matchResult.xpGained ?? 0) > 0}
								<span class="xp-gained">+{matchResult.xpGained} XP</span>
							{/if}
						</div>
					{/if}

					{#if matchResult.training}
						<p class="reward-note">Entraînement : pas d'XP ni de crédits.</p>
					{/if}

					{#each matchResult.rewardNotes as note, i (i)}
						<p class="reward-note" class:bonus={note.kind === 'upset'}>{noteText(note, matchResult.winner === $currentUser?.username)}</p>
					{/each}

					{#if rematch === 'offered'}
						<p class="rematch-note">{rematchFrom} veut une revanche !</p>
					{:else if rematch === 'asked' && !matchResult.training}
						<p class="rematch-note">En attente de ton adversaire…</p>
					{:else if rematch === 'cancelled'}
						<p class="reward-note">
							{rematchFrom ? `${rematchFrom} est reparti au lobby.` : "La revanche n'est plus possible."}
						</p>
					{/if}
				{/if}

				<div class="end-actions">
					{#if !isSpectator && rematch !== 'cancelled'}
						<button class="btn btn-primary" disabled={rematch === 'asked'} onclick={askRematch}>
							{#if matchResult.training}Rejouer{:else if rematch === 'offered'}Accepter la revanche{:else}Revanche{/if}
						</button>
					{/if}
					<button class="btn btn-secondary" onclick={backToLobby}>Retour au lobby</button>
				</div>
			</div>
		</div>
	{/if}

	{#if isSpectator}
		<div class="spectator-badge">👁 Spectateur</div>
	{/if}
</div>

<style>
	.game-page {
		position: relative;
		width: 100vw;
		height: calc(100vh - 52px);
		display: flex;
		align-items: center;
		justify-content: center;
		background: #050510;
		overflow: hidden;
		padding: 4px;
	}

	canvas {
		display: block;
		width: 100% !important;
		height: auto !important;
		max-height: calc(100vh - 52px - 8px);
		aspect-ratio: 16 / 9;
		object-fit: contain;
		border-radius: 4px;
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(5, 5, 20, 0.85);
		z-index: 50;
		backdrop-filter: blur(4px);
	}

	.overlay.semi {
		background: rgba(5, 5, 20, 0.6);
	}

	.overlay-card {
		background: rgba(15, 15, 50, 0.95);
		border: 1px solid rgba(100, 100, 255, 0.3);
		border-radius: 16px;
		padding: 2.5rem 3rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		box-shadow: 0 0 60px rgba(80, 80, 255, 0.15);
	}

	.overlay-card h2 {
		font-size: 1.5rem;
		color: #c0c8ff;
	}
	.overlay-card p {
		color: #8090c0;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid rgba(100, 100, 255, 0.2);
		border-top-color: #7b8cff;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.room-code {
		font-family: monospace;
		font-size: 0.85rem;
		color: #4a5070;
		letter-spacing: 2px;
	}

	.scores {
		display: flex;
		gap: 2rem;
		font-size: 2rem;
		font-weight: 700;
		color: #7b8cff;
	}

	.next-round {
		font-size: 0.85rem;
		color: #5060a0;
	}

	.winner-emoji {
		font-size: 3.5rem;
	}

	strong {
		color: #ffd700;
	}

	.xp-reward {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
	}

	.credits-gained {
		color: #ffcc55;
		font-weight: 700;
	}
	.xp-gained {
		font-size: 1.1rem;
		font-weight: 700;
		color: #a8ff78;
	}

	.reward-note {
		font-size: 0.8rem;
		color: #ffaa33;
	}

	.end-actions {
		display: flex;
		gap: 0.6rem;
		justify-content: center;
		flex-wrap: wrap;
	}
	.rematch-note {
		color: #4dd9ff;
		font-weight: 600;
	}
	.reward-note.bonus {
		color: #4dd9ff;
	}

	.levelup-badge {
		font-size: 1rem;
		font-weight: 700;
		color: #ffd700;
		background: rgba(255, 215, 0, 0.12);
		border: 1px solid rgba(255, 215, 0, 0.3);
		border-radius: 20px;
		padding: 0.25rem 0.9rem;
	}

	.galactics-gained {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.95rem;
		font-weight: 700;
		color: #c4b5fd;
		background: rgba(167, 139, 250, 0.12);
		border: 1px solid rgba(167, 139, 250, 0.35);
		border-radius: 20px;
		padding: 0.25rem 0.9rem;
	}
	:global(.galactics-gained svg) {
		display: inline-block;
		flex-shrink: 0;
	}

	.spectator-badge {
		position: absolute;
		top: 12px;
		left: 12px;
		background: rgba(0, 0, 0, 0.6);
		border: 1px solid rgba(100, 100, 255, 0.3);
		border-radius: 20px;
		padding: 0.3rem 0.75rem;
		font-size: 0.8rem;
		color: #a0a8ff;
	}
</style>
