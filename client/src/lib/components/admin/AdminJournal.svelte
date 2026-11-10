<script lang="ts">
	import { onDestroy } from 'svelte';
	import { api, type AuditEntry } from '$lib/api';
	import { ACTION_LABEL, describeAudit, formatDate, formatNumber } from '$lib/admin/format';

	let { onOpenPlayer }: { onOpenPlayer: (id: string) => void } = $props();

	const PAGE_SIZE = 50;

	let action = $state('');
	let username = $state('');
	let pageNumber = $state(1);
	let entries = $state<AuditEntry[]>([]);
	let total = $state(0);
	let error = $state<string | null>(null);
	let loaded = $state(false);
	const pageCount = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));

	let debounce: ReturnType<typeof setTimeout> | undefined;
	let requestId = 0;
	onDestroy(() => clearTimeout(debounce));

	$effect(() => {
		const params = {
			action: action || undefined,
			username: username.trim() || undefined,
			page: pageNumber,
			limit: PAGE_SIZE
		};
		clearTimeout(debounce);
		debounce = setTimeout(() => load(params), params.username ? 250 : 0);
	});

	async function load(params: {
		action?: string;
		username?: string;
		page: number;
		limit: number;
	}) {
		const id = ++requestId;
		try {
			const res = await api.admin.audit(params);
			if (id !== requestId) return;
			entries = res.entries;
			total = res.total;
			error = null;
		} catch (e) {
			if (id === requestId) error = e instanceof Error ? e.message : 'Chargement impossible';
		} finally {
			if (id === requestId) loaded = true;
		}
	}
</script>

<section class="a-panel">
	<h2>Journal de l'équipe</h2>
	<p class="a-muted intro">Chaque action faite depuis l'administration est notée ici, avec son auteur.</p>
	<div class="a-toolbar">
		<input
			type="search"
			placeholder="Membre de l'équipe ou joueur visé"
			maxlength="40"
			bind:value={username}
			oninput={() => (pageNumber = 1)}
			aria-label="Filtrer par pseudo"
		/>
		<select bind:value={action} onchange={() => (pageNumber = 1)} aria-label="Type d'action">
			<option value="">Toutes les actions</option>
			{#each Object.entries(ACTION_LABEL) as [key, label] (key)}
				<option value={key}>{label}</option>
			{/each}
		</select>
	</div>

	{#if error}<p class="a-error" role="alert">{error}</p>{/if}

	{#if !loaded}
		<p class="a-empty">Chargement…</p>
	{:else if entries.length === 0}
		<p class="a-empty">Aucune action.</p>
	{:else}
		<div class="a-table-wrap">
			<table class="a-table">
				<thead>
					<tr><th>Quand</th><th>Par</th><th>Action</th><th>Joueur</th><th>Détail</th></tr>
				</thead>
				<tbody>
					{#each entries as e (e._id)}
						<tr>
							<td class="when">{formatDate(e.createdAt)}</td>
							<td>{e.actorUsername}</td>
							<td>{ACTION_LABEL[e.action] ?? e.action}</td>
							<td>
								{#if e.targetId && e.action !== 'delete-account'}
									<button class="a-link" onclick={() => onOpenPlayer(e.targetId!)}>{e.targetUsername}</button>
								{:else}{e.targetUsername ?? '—'}{/if}
							</td>
							<td class="detail">{describeAudit(e)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<div class="a-pager">
		<span>{formatNumber(total)} action{total > 1 ? 's' : ''}</span>
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
	.intro {
		margin: -0.4rem 0 0.9rem;
	}
	.when {
		white-space: nowrap;
		color: #6870a0;
	}
	.detail {
		color: #8090c0;
		overflow-wrap: anywhere;
	}
	.page-label {
		align-self: center;
		white-space: nowrap;
	}
</style>
