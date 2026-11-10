<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { api, type AdminOverview } from '$lib/api';
	import { ACTION_LABEL, describeAudit, formatNumber, timeAgo } from '$lib/admin/format';
	import { getGrade } from '$lib/shared/grades';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Megaphone from '@lucide/svelte/icons/megaphone';

	type Section = 'players' | 'games' | 'chat' | 'journal';

	let {
		isAdmin,
		onOpenPlayer,
		onNavigate
	}: {
		isAdmin: boolean;
		onOpenPlayer: (id: string) => void;
		onNavigate: (tab: Section) => void;
	} = $props();

	let data = $state<AdminOverview | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(false);

	let announcement = $state('');
	let announcing = $state(false);
	let announceDone = $state<string | null>(null);
	let announceError = $state<string | null>(null);

	let timer: ReturnType<typeof setInterval> | undefined;

	onMount(() => {
		load();
		timer = setInterval(load, 20_000);
	});
	onDestroy(() => clearInterval(timer));

	async function load() {
		if (loading) return;
		loading = true;
		try {
			data = await api.admin.overview();
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Chargement impossible';
		} finally {
			loading = false;
		}
	}

	async function announce(e: SubmitEvent) {
		e.preventDefault();
		const message = announcement.trim();
		if (!message || announcing) return;
		announcing = true;
		announceError = null;
		announceDone = null;
		try {
			await api.admin.announce(message);
			announcement = '';
			announceDone = 'Annonce envoyée à tous les joueurs connectés.';
		} catch (err) {
			announceError = err instanceof Error ? err.message : 'Envoi impossible';
		} finally {
			announcing = false;
		}
	}
</script>

<div class="toolbar-line">
	<span class="a-muted">Mise à jour automatique toutes les 20 secondes</span>
	<button class="btn btn-secondary btn-sm" onclick={load} disabled={loading}>
		<RefreshCw size={13} /> Actualiser
	</button>
</div>

{#if error}<p class="a-error" role="alert">{error}</p>{/if}

{#if data}
	<div class="tiles">
		<button class="tile" onclick={() => onNavigate('games')}>
			<span class="tile-label">Connectés</span>
			<span class="tile-value">{formatNumber(data.live.online)}</span>
			<span class="tile-sub">
				{data.live.inGame} en partie · {data.live.spectating} spectateur{data.live.spectating > 1
					? 's'
					: ''}
			</span>
		</button>
		<button class="tile" onclick={() => onNavigate('games')}>
			<span class="tile-label">Parties en cours</span>
			<span class="tile-value">{formatNumber(data.live.roomsPlaying)}</span>
			<span class="tile-sub">{data.live.roomsWaiting} en attente d'adversaire</span>
		</button>
		<button class="tile" onclick={() => onNavigate('players')}>
			<span class="tile-label">Joueurs inscrits</span>
			<span class="tile-value">{formatNumber(data.players.total)}</span>
			<span class="tile-sub">
				+{data.players.newToday} aujourd'hui · +{data.players.newWeek} sur 7 jours
			</span>
		</button>
		<button class="tile" onclick={() => onNavigate('games')}>
			<span class="tile-label">Parties jouées</span>
			<span class="tile-value">{formatNumber(data.games.today)}</span>
			<span class="tile-sub">
				sur 24 h · {formatNumber(data.games.week)} sur 7 jours · {formatNumber(data.games.total)} au
				total
			</span>
		</button>
		<button class="tile" onclick={() => onNavigate('chat')}>
			<span class="tile-label">Messages du chat</span>
			<span class="tile-value">{formatNumber(data.chat.today)}</span>
			<span class="tile-sub">sur les dernières 24 h</span>
		</button>
		<button class="tile" onclick={() => onNavigate('players')}>
			<span class="tile-label">Sanctions actives</span>
			<span class="tile-value">{formatNumber(data.players.banned + data.players.muted)}</span>
			<span class="tile-sub">
				{data.players.banned} banni{data.players.banned > 1 ? 's' : ''} · {data.players.muted} en sourdine
			</span>
		</button>
	</div>

	<div class="a-grid columns">
		<section class="a-panel">
			<h2>Meilleurs joueurs</h2>
			{#if data.topPlayers.length === 0}
				<p class="a-empty">Aucun joueur pour l'instant.</p>
			{:else}
				<div class="a-table-wrap">
					<table class="a-table">
						<thead>
							<tr><th>Joueur</th><th>Grade</th><th class="a-num">Crédits</th><th class="a-num">Victoires</th></tr>
						</thead>
						<tbody>
							{#each data.topPlayers as p (p.id)}
								{@const grade = getGrade(p.level)}
								<tr class="clickable" onclick={() => onOpenPlayer(p.id)}>
									<td>{p.username}</td>
									<td><span style="color: {grade.color}">{grade.label}</span> · niv. {p.level}</td>
									<td class="a-num">{formatNumber(p.points)}</td>
									<td class="a-num">{p.wins} / {p.totalGames}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="a-panel">
			<h2>Derniers inscrits</h2>
			{#if data.latestSignups.length === 0}
				<p class="a-empty">Personne pour l'instant.</p>
			{:else}
				<ul class="simple-list">
					{#each data.latestSignups as u (u.id)}
						<li>
							<button class="a-link" onclick={() => onOpenPlayer(u.id)}>{u.username}</button>
							<span class="a-muted">{timeAgo(u.createdAt)}</span>
						</li>
					{/each}
				</ul>
			{/if}
			{#if data.players.unverified > 0}
				<p class="a-muted note">
					{data.players.unverified} compte{data.players.unverified > 1 ? 's' : ''} sans email confirmé.
				</p>
			{/if}
		</section>

		{#if isAdmin}
			<section class="a-panel">
				<h2><Megaphone size={16} /> Annonce à tous les joueurs</h2>
				<form onsubmit={announce} class="announce">
					<textarea
						bind:value={announcement}
						maxlength="200"
						rows="3"
						placeholder="Maintenance ce soir à 22 h, pensez à finir vos parties !"
					></textarea>
					<div class="announce-foot">
						<span class="a-muted">{announcement.length}/200 · s'affiche en haut du chat</span>
						<button class="btn btn-primary btn-sm" disabled={announcing || !announcement.trim()}>
							{announcing ? 'Envoi…' : 'Envoyer'}
						</button>
					</div>
					{#if announceError}<p class="a-error" role="alert">{announceError}</p>{/if}
					{#if announceDone}<p class="a-success">{announceDone}</p>{/if}
				</form>
			</section>

			<section class="a-panel">
				<h2>Dernières actions de l'équipe</h2>
				{#if data.recentActions.length === 0}
					<p class="a-empty">Rien pour l'instant.</p>
				{:else}
					<ul class="simple-list actions">
						{#each data.recentActions as a (a._id)}
							<li>
								<span>
									<strong>{a.actorUsername}</strong>
									· {ACTION_LABEL[a.action] ?? a.action}
									{#if a.targetUsername}· {a.targetUsername}{/if}
									{#if describeAudit(a)}<span class="a-muted"> · {describeAudit(a)}</span>{/if}
								</span>
								<span class="a-muted">{timeAgo(a.createdAt)}</span>
							</li>
						{/each}
					</ul>
					<button class="a-link more" onclick={() => onNavigate('journal')}>Voir tout le journal</button>
				{/if}
			</section>
		{/if}
	</div>
{:else if !error}
	<p class="a-empty">Chargement…</p>
{/if}

<style>
	.toolbar-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.9rem;
	}
	.toolbar-line .btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr));
		gap: 0.75rem;
		margin-bottom: 1.1rem;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		text-align: left;
		background: rgba(10, 14, 36, 0.85);
		border: 1px solid rgba(77, 217, 255, 0.15);
		border-radius: 12px;
		padding: 0.85rem 1rem;
		font-family: inherit;
		cursor: pointer;
		color: inherit;
	}
	.tile:hover {
		border-color: rgba(77, 217, 255, 0.4);
	}
	.tile-label {
		font-size: 0.75rem;
		color: #8090c0;
	}
	.tile-value {
		font-size: 1.7rem;
		font-weight: 700;
		color: #e0f0ff;
		font-variant-numeric: tabular-nums;
	}
	.tile-sub {
		font-size: 0.72rem;
		color: #5a6290;
	}
	.columns {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
	}
	.simple-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		font-size: 0.84rem;
		color: #b0b8e8;
	}
	.simple-list li {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.simple-list li > :last-child {
		white-space: nowrap;
	}
	.actions strong {
		color: #c0c8ff;
	}
	.note {
		margin-top: 0.8rem;
	}
	.more {
		margin-top: 0.8rem;
		font-size: 0.8rem;
	}
	.announce {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.announce-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
</style>
