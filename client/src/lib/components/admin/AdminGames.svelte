<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { api, type AdminGame, type LiveRoom, type OnlinePlayer } from '$lib/api';
	import {
		PLAYER_STATUS_LABEL,
		ROOM_STATUS_LABEL,
		formatDate,
		formatNumber,
		timeAgo
	} from '$lib/admin/format';
	import Radio from '@lucide/svelte/icons/radio';
	import History from '@lucide/svelte/icons/history';
	import Users from '@lucide/svelte/icons/users';

	let { onOpenPlayer }: { onOpenPlayer: (id: string) => void } = $props();

	const PAGE_SIZE = 25;

	let rooms = $state<LiveRoom[]>([]);
	let online = $state<OnlinePlayer[]>([]);
	let liveError = $state<string | null>(null);
	let liveLoaded = $state(false);
	let liveLoading = false;
	let historyLoaded = $state(false);
	let closing = $state<string | null>(null);
	let closeReason = $state('');
	let closeBusy = $state(false);
	let closeFeedback = $state<{ ok: boolean; text: string } | null>(null);

	let search = $state('');
	let pageNumber = $state(1);
	let games = $state<AdminGame[]>([]);
	let total = $state(0);
	let historyError = $state<string | null>(null);
	const pageCount = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));

	let timer: ReturnType<typeof setInterval> | undefined;
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let historyRequest = 0;

	onMount(() => {
		loadLive();
		timer = setInterval(loadLive, 5_000);
	});
	onDestroy(() => {
		clearInterval(timer);
		clearTimeout(debounce);
	});

	$effect(() => {
		const params = { username: search.trim() || undefined, page: pageNumber, limit: PAGE_SIZE };
		clearTimeout(debounce);
		debounce = setTimeout(() => loadHistory(params), params.username ? 250 : 0);
	});

	async function loadLive() {
		// A slow answer must not overwrite a newer one
		if (liveLoading) return;
		liveLoading = true;
		try {
			const res = await api.admin.liveGames();
			rooms = res.rooms.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
			online = res.online.sort((a, b) => a.username.localeCompare(b.username));
			liveError = null;
		} catch (e) {
			liveError = e instanceof Error ? e.message : 'Chargement impossible';
		} finally {
			liveLoading = false;
			liveLoaded = true;
		}
	}

	async function loadHistory(params: { username?: string; page: number; limit: number }) {
		const id = ++historyRequest;
		try {
			const res = await api.admin.games(params);
			if (id !== historyRequest) return;
			games = res.games;
			total = res.total;
			historyError = null;
		} catch (e) {
			if (id === historyRequest)
				historyError = e instanceof Error ? e.message : 'Chargement impossible';
		} finally {
			if (id === historyRequest) historyLoaded = true;
		}
	}

	function askClose(roomId: string) {
		closing = closing === roomId ? null : roomId;
		closeReason = '';
		closeFeedback = null;
	}

	async function confirmClose(roomId: string) {
		if (closeBusy) return;
		closeBusy = true;
		try {
			await api.admin.closeGame(roomId, closeReason.trim() || undefined);
			closeFeedback = { ok: true, text: `Partie #${roomId} arrêtée.` };
			closing = null;
			await loadLive();
		} catch (e) {
			closeFeedback = { ok: false, text: e instanceof Error ? e.message : 'Arrêt impossible' };
		} finally {
			closeBusy = false;
		}
	}

	function since(createdAt: number | null): string {
		if (!createdAt) return '';
		const minutes = Math.floor((Date.now() - createdAt) / 60_000);
		return minutes < 1 ? "à l'instant" : `depuis ${minutes} min`;
	}
</script>

<div class="a-grid layout">
	<section class="a-panel">
		<h2><Radio size={16} /> En direct</h2>
		{#if liveError}<p class="a-error" role="alert">{liveError}</p>{/if}
		{#if closeFeedback}
			<p class={closeFeedback.ok ? 'a-success' : 'a-error'}>{closeFeedback.text}</p>
		{/if}

		{#if !liveLoaded}
			<p class="a-empty">Chargement…</p>
		{:else if rooms.length === 0}
			<p class="a-empty">Aucune partie en cours.</p>
		{:else}
			<ul class="rooms">
				{#each rooms as r (r.roomId)}
					<li class="room">
						<div class="room-head">
							<span class="room-id">#{r.roomId}</span>
							<span class="a-tag {r.status === 'waiting' ? 'muted' : 'ok'}">
								{ROOM_STATUS_LABEL[r.status]}
							</span>
							<span class="a-muted">{since(r.createdAt)}</span>
							{#if r.spectatorCount}
								<span class="a-muted">· {r.spectatorCount} spectateur{r.spectatorCount > 1 ? 's' : ''}</span>
							{/if}
						</div>
						<div class="fighters">
							{#each r.players as p, i (p.userId)}
								{#if i > 0}<span class="vs">vs</span>{/if}
								<button class="a-link" onclick={() => onOpenPlayer(p.userId)}>{p.username}</button>
								<span class="a-muted">niv. {p.level}</span>
								{#if r.status !== 'waiting'}<span class="score">{p.score}</span>{/if}
							{/each}
							{#if r.status === 'waiting'}<span class="a-muted">attend un adversaire…</span>{/if}
						</div>
						{#if r.status !== 'matchEnd'}
							{#if closing === r.roomId}
								<div class="confirm">
									<input
										bind:value={closeReason}
										maxlength="120"
										placeholder="Message aux joueurs (facultatif)"
									/>
									<button
										class="btn btn-danger btn-sm"
										disabled={closeBusy}
										onclick={() => confirmClose(r.roomId)}>Arrêter la partie</button
									>
									<button class="btn btn-secondary btn-sm" onclick={() => askClose(r.roomId)}
										>Annuler</button
									>
								</div>
								<p class="a-muted">Personne ne gagne ni ne perd quoi que ce soit, tout le monde revient au lobby.</p>
							{:else}
								<button class="btn btn-secondary btn-sm stop" onclick={() => askClose(r.roomId)}
									>Arrêter</button
								>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="a-panel">
		<h2><Users size={16} /> Connectés ({online.length})</h2>
		{#if online.length === 0}
			<p class="a-empty">Personne en ligne.</p>
		{:else}
			<ul class="online">
				{#each online as p, i (`${p.userId}:${i}`)}
					<li>
						<span class="a-dot on"></span>
						<button class="a-link" onclick={() => onOpenPlayer(p.userId)}>{p.username}</button>
						<span class="a-muted">niv. {p.level}</span>
						<span class="a-tag {p.status === 'idle' ? 'muted' : 'info'}">
							{PLAYER_STATUS_LABEL[p.status]}{p.roomId ? ` · #${p.roomId}` : ''}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<section class="a-panel history">
	<h2><History size={16} /> Historique des parties</h2>
	<div class="a-toolbar">
		<input
			type="search"
			placeholder="Filtrer par joueur"
			maxlength="40"
			bind:value={search}
			oninput={() => (pageNumber = 1)}
			aria-label="Filtrer par joueur"
		/>
	</div>
	{#if historyError}<p class="a-error" role="alert">{historyError}</p>{/if}
	{#if !historyLoaded}
		<p class="a-empty">Chargement…</p>
	{:else if games.length === 0}
		<p class="a-empty">Aucune partie trouvée.</p>
	{:else}
		<div class="a-table-wrap">
			<table class="a-table">
				<thead>
					<tr><th>Partie</th><th>Joueurs</th><th class="a-num">Score</th><th>Gagnant</th><th>Fin</th></tr>
				</thead>
				<tbody>
					{#each games as g (g.id)}
						<tr>
							<td class="room-id">#{g.roomId}</td>
							<td>
								{#each g.players as p, i (i)}
									{#if i > 0}<span class="vs">vs</span>{/if}
									{#if p.userId}
										<button class="a-link" onclick={() => onOpenPlayer(p.userId!)}>{p.username}</button>
									{:else}{p.username}{/if}
								{/each}
							</td>
							<td class="a-num">{g.players.map((p) => p.score).join(' – ')}</td>
							<td>{g.winner ?? '—'}</td>
							<td title={formatDate(g.endedAt)}>{timeAgo(g.endedAt ?? g.createdAt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	<div class="a-pager">
		<span>{formatNumber(total)} partie{total > 1 ? 's' : ''}</span>
		<div>
			<button
				class="btn btn-secondary btn-sm"
				disabled={pageNumber <= 1}
				onclick={() => (pageNumber -= 1)}>Précédent</button
			>
			<span class="page-label">{pageNumber} / {pageCount}</span>
			<button
				class="btn btn-secondary btn-sm"
				disabled={pageNumber >= pageCount}
				onclick={() => (pageNumber += 1)}>Suivant</button
			>
		</div>
	</div>
</section>

<style>
	.layout {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
		margin-bottom: 1.1rem;
	}
	.rooms,
	.online {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.room {
		background: rgba(5, 8, 22, 0.85);
		border: 1px solid rgba(77, 217, 255, 0.12);
		border-radius: 10px;
		padding: 0.65rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.room-head,
	.fighters {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.45rem;
		font-size: 0.82rem;
	}
	.room-id {
		font-family: ui-monospace, monospace;
		color: #c0e8ff;
		font-size: 0.8rem;
	}
	.vs {
		color: #5a6290;
		font-size: 0.75rem;
		margin: 0 0.3rem;
	}
	.score {
		color: #e0f0ff;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.stop {
		align-self: flex-start;
	}
	.confirm {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.confirm input {
		flex: 1 1 200px;
		min-width: 0;
	}
	.online li {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex-wrap: wrap;
		font-size: 0.84rem;
	}
	.page-label {
		align-self: center;
		white-space: nowrap;
	}
</style>
