<script lang="ts">
	import { onDestroy } from 'svelte';
	import { api, type AdminUser, type UserFilter, type UserSort } from '$lib/api';
	import { ROLE_LABEL, formatNumber, isActive, timeAgo } from '$lib/admin/format';
	import AdminPlayerDetail from './AdminPlayerDetail.svelte';

	let {
		isAdmin,
		selectedId,
		onSelect
	}: {
		isAdmin: boolean;
		selectedId: string | null;
		onSelect: (id: string | null) => void;
	} = $props();

	const FILTERS: { key: UserFilter; label: string }[] = [
		{ key: 'all', label: 'Tous' },
		{ key: 'online', label: 'En ligne' },
		{ key: 'banned', label: 'Bannis' },
		{ key: 'muted', label: 'En sourdine' },
		{ key: 'staff', label: 'Équipe' },
		{ key: 'unverified', label: 'Email non confirmé' }
	];
	const SORTS: { key: UserSort; label: string }[] = [
		{ key: 'recent', label: 'Plus récents' },
		{ key: 'points', label: 'Plus de crédits' },
		{ key: 'level', label: 'Plus haut niveau' },
		{ key: 'games', label: 'Plus de parties' },
		{ key: 'name', label: 'Pseudo (A → Z)' }
	];
	const PAGE_SIZE = 25;

	let q = $state('');
	let filter = $state<UserFilter>('all');
	let sort = $state<UserSort>('recent');
	let pageNumber = $state(1);

	let users = $state<AdminUser[]>([]);
	let total = $state(0);
	let loading = $state(false);
	let error = $state<string | null>(null);

	const pageCount = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));

	let requestId = 0;
	let debounce: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(debounce));

	$effect(() => {
		const params = { q: q.trim() || undefined, filter, sort, page: pageNumber, limit: PAGE_SIZE };
		clearTimeout(debounce);
		debounce = setTimeout(() => load(params), params.q ? 250 : 0);
	});

	async function load(params: Parameters<typeof api.admin.users>[0]) {
		const id = ++requestId;
		loading = true;
		try {
			const res = await api.admin.users(params);
			if (id !== requestId) return;
			users = res.users;
			total = res.total;
			error = null;
		} catch (e) {
			if (id === requestId) error = e instanceof Error ? e.message : 'Chargement impossible';
		} finally {
			if (id === requestId) loading = false;
		}
	}

	function refresh() {
		load({ q: q.trim() || undefined, filter, sort, page: pageNumber, limit: PAGE_SIZE });
	}

	function setFilter(next: UserFilter) {
		filter = next;
		pageNumber = 1;
	}
</script>

<div class="a-grid layout" class:with-detail={!!selectedId}>
	<section class="a-panel">
		<div class="a-toolbar">
			<input
				type="search"
				placeholder={isAdmin ? 'Pseudo, email ou identifiant' : 'Pseudo ou identifiant'}
				maxlength="60"
				bind:value={q}
				oninput={() => (pageNumber = 1)}
				aria-label="Rechercher un joueur"
			/>
			<select bind:value={sort} onchange={() => (pageNumber = 1)} aria-label="Trier">
				{#each SORTS as s (s.key)}<option value={s.key}>{s.label}</option>{/each}
			</select>
		</div>
		<div class="a-seg filters">
			{#each FILTERS as f (f.key)}
				<button class:active={filter === f.key} onclick={() => setFilter(f.key)}>{f.label}</button>
			{/each}
		</div>

		{#if error}<p class="a-error" role="alert">{error}</p>{/if}

		{#if users.length === 0 && !loading}
			<p class="a-empty">Aucun joueur ne correspond.</p>
		{:else}
			<div class="a-table-wrap">
				<table class="a-table" class:dim={loading}>
					<thead>
						<tr>
							<th>Joueur</th>
							<th class="a-num">Niveau</th>
							<th class="a-num">Crédits</th>
							<th class="a-num">V / D</th>
							<th>Inscrit</th>
						</tr>
					</thead>
					<tbody>
						{#each users as u (u.id)}
							<tr
								class="clickable"
								class:selected={u.id === selectedId}
								onclick={() => onSelect(u.id === selectedId ? null : u.id)}
							>
								<td>
									<span class="who">
										<span class="a-dot" class:on={u.online} title={u.online ? 'En ligne' : 'Hors ligne'}
										></span>
										<span class="name">{u.username}</span>
										{#if u.role !== 'user'}<span class="a-tag staff">{ROLE_LABEL[u.role]}</span>{/if}
										{#if isActive(u.bannedUntil)}<span class="a-tag danger">Banni</span>{/if}
										{#if isActive(u.mutedUntil)}<span class="a-tag warn">Sourdine</span>{/if}
									</span>
									{#if u.email}<span class="email">{u.email}</span>{/if}
								</td>
								<td class="a-num">{u.level}</td>
								<td class="a-num">{formatNumber(u.points)}</td>
								<td class="a-num">{u.stats.wins ?? 0} / {u.stats.losses ?? 0}</td>
								<td class="when">{timeAgo(u.createdAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<div class="a-pager">
			<span>{formatNumber(total)} joueur{total > 1 ? 's' : ''}</span>
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

	{#if selectedId}
		{#key selectedId}
			<AdminPlayerDetail
				userId={selectedId}
				{isAdmin}
				onClose={() => onSelect(null)}
				onChanged={refresh}
			/>
		{/key}
	{/if}
</div>

<style>
	.layout {
		grid-template-columns: minmax(0, 1fr);
	}
	@media (min-width: 1000px) {
		.layout.with-detail {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
		}
	}
	.filters {
		margin-bottom: 0.9rem;
	}
	.who {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.name {
		color: #d0d8ff;
		font-weight: 600;
	}
	.email {
		display: block;
		font-size: 0.72rem;
		color: #5a6290;
		margin-left: 1.05rem;
		overflow-wrap: anywhere;
	}
	.when {
		white-space: nowrap;
		color: #6870a0;
	}
	.dim {
		opacity: 0.6;
	}
	.page-label {
		align-self: center;
		white-space: nowrap;
	}
</style>
