<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Gem from '@lucide/svelte/icons/gem';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { currentUser, auth } from '$lib/stores/auth';
	import { getSocket } from '$lib/stores/socket';
	import type { GameEngine } from '$lib/game/engine';
	import { api } from '$lib/api';

	type GameStatus = 'waiting' | 'playing' | 'roundEnd' | 'matchEnd';

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
	} | null>(null);
	let abandonResult = $state<{ deserter: string; creditsRecovered: number } | null>(null);
	let isSpectator = $state(false);

	const roomId = $page.params.roomId;

	onMount(async () => {
		const user = $currentUser;
		if (!user) {
			goto('/login');
			return;
		}

		const socket = getSocket();
		if (!socket) {
			goto('/lobby');
			return;
		}

		const spectatorFlag = sessionStorage.getItem(`spectator_${roomId}`);
		isSpectator = !!spectatorFlag;

		const { GameEngine } = await import('$lib/game/engine');
		engine = new GameEngine(socket, socket.id!, isSpectator);
		await engine.init(canvas);

		if (isSpectator) {
			socket.emit('game:spectateReady', { roomId });
		}

		socket.on('game:start', async (payload: any) => {
			status = 'playing';
			await engine?.onGameStart(payload);
		});

		socket.on('game:state', (state: any) => {
			if (status === 'playing') engine?.onGameState(state);
		});

		socket.on(
			'game:roundEnd',
			(data: { winner: { username: string } | null; scores: Record<string, number> }) => {
				status = 'roundEnd';
				roundResult = { winner: data.winner?.username ?? null, scores: data.scores };
				engine?.pause();
				engine?.updateScores(data.scores);
				setTimeout(() => {
					if (status === 'roundEnd') {
						status = 'playing';
						roundResult = null;
					}
				}, 3000);
			}
		);

		socket.on(
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

		socket.on(
			'game:matchEnd',
			(data: {
				winner: { username: string };
				pointsEarned: number;
				newPoints: number | null;
				xpGained: number | null;
				newXP: number | null;
				newLevel: number | null;
				leveledUp: boolean;
				galacticsGained?: number;
				newGalactics?: number | null;
			}) => {
				status = 'matchEnd';
				matchResult = {
					winner: data.winner.username,
					pointsEarned: data.pointsEarned,
					xpGained: data.xpGained,
					newLevel: data.newLevel,
					leveledUp: data.leveledUp,
					galacticsGained: data.galacticsGained ?? 0
				};
				const updates: any = {};
				if (data.newPoints !== null) updates.points = data.newPoints;
				if (data.newXP !== null) updates.xp = data.newXP;
				if (data.newLevel !== null) updates.level = data.newLevel;
				if (data.newGalactics !== null && data.newGalactics !== undefined)
					updates.galactics = data.newGalactics;
				if (Object.keys(updates).length) auth.updateUser(updates);
			}
		);

		socket.on(
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
	});

	onDestroy(() => {
		engine?.destroy();
		const socket = getSocket();
		if (status === 'playing' || status === 'roundEnd' || status === 'waiting') {
			socket?.emit('game:leave', { roomId });
		}
		socket?.off('game:start');
		socket?.off('game:state');
		socket?.off('game:roundEnd');
		socket?.off('game:roundStart');
		socket?.off('game:matchEnd');
		socket?.off('game:abandoned');
	});

	function backToLobby() {
		sessionStorage.removeItem(`spectator_${roomId}`);
		goto('/lobby');
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
					{#each Object.entries(roundResult.scores) as [id, score]}
						<span>{score}</span>
					{/each}
				</div>
				<p class="next-round">Prochaine manche dans 3s…</p>
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
				<button class="btn btn-primary" onclick={backToLobby}>Retour au lobby</button>
			</div>
		</div>
	{/if}

	{#if status === 'matchEnd' && matchResult}
		<div class="overlay">
			<div class="overlay-card">
				{#if matchResult.winner === $currentUser?.username}
					<div class="winner-emoji">🏆</div>
					<h2>Victoire !</h2>
					<p>Tu as gagné <strong>+{matchResult.pointsEarned} Crédits</strong></p>
				{:else}
					<div class="winner-emoji">💫</div>
					<h2>{matchResult.winner} a gagné</h2>
					<p>Ce sera pour la prochaine</p>
					{#if matchResult.pointsEarned > 0}
						<p><strong>+{matchResult.pointsEarned} Crédits</strong> de consolation</p>
					{/if}
				{/if}

				{#if matchResult.xpGained !== null}
					<div class="xp-reward">
						{#if matchResult.leveledUp}
							<span class="levelup-badge">Niveau {matchResult.newLevel}</span>
						{/if}
						{#if matchResult.galacticsGained > 0}
							<span class="galactics-gained">
								<Gem size={13} /> +{matchResult.galacticsGained}
								{matchResult.galacticsGained > 1 ? 'Galactics' : 'Galactic'}
							</span>
						{/if}
						<span class="xp-gained">+{matchResult.xpGained} XP</span>
					</div>
				{/if}

				<button class="btn btn-primary" onclick={backToLobby}>Retour au lobby</button>
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

	.xp-gained {
		font-size: 1.1rem;
		font-weight: 700;
		color: #a8ff78;
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
