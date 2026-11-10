<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { currentUser } from '$lib/stores/auth';
	import AdminOverview from '$lib/components/admin/AdminOverview.svelte';
	import AdminPlayers from '$lib/components/admin/AdminPlayers.svelte';
	import AdminGames from '$lib/components/admin/AdminGames.svelte';
	import AdminChat from '$lib/components/admin/AdminChat.svelte';
	import AdminShop from '$lib/components/admin/AdminShop.svelte';
	import AdminJournal from '$lib/components/admin/AdminJournal.svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import Users from '@lucide/svelte/icons/users';
	import Swords from '@lucide/svelte/icons/swords';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Store from '@lucide/svelte/icons/store';
	import ScrollText from '@lucide/svelte/icons/scroll-text';

	type TabKey = 'overview' | 'players' | 'games' | 'chat' | 'shop' | 'journal';

	const TABS: { key: TabKey; label: string; icon: typeof Users; adminOnly?: boolean }[] = [
		{ key: 'overview', label: "Vue d'ensemble", icon: LayoutDashboard },
		{ key: 'players', label: 'Joueurs', icon: Users },
		{ key: 'games', label: 'Parties', icon: Swords },
		{ key: 'chat', label: 'Chat', icon: MessageSquare },
		{ key: 'shop', label: 'Boutique', icon: Store, adminOnly: true },
		{ key: 'journal', label: 'Journal', icon: ScrollText, adminOnly: true }
	];

	const role = $derived($currentUser?.role ?? 'user');
	const isAdmin = $derived(role === 'admin');
	const isStaff = $derived(role === 'admin' || role === 'moderator');
	const tabs = $derived(TABS.filter((t) => isAdmin || !t.adminOnly));

	const tab = $derived.by(() => {
		const wanted = $page.url.searchParams.get('tab') as TabKey | null;
		return tabs.find((t) => t.key === wanted)?.key ?? 'overview';
	});
	const userId = $derived($page.url.searchParams.get('user'));

	function navigate(next: TabKey, extra: Record<string, string> = {}) {
		const params = new URLSearchParams({ tab: next, ...extra });
		goto(`?${params}`, { replaceState: false, noScroll: true, keepFocus: true });
	}

	function openPlayer(id: string) {
		navigate('players', { user: id });
	}

	function selectPlayer(id: string | null) {
		navigate('players', id ? { user: id } : {});
	}
</script>

<svelte:head>
	<title>Administration · Galactica.io</title>
</svelte:head>

<main class="admin">
	<header class="admin-header">
		<a href="/lobby" class="back"><ArrowLeft size={16} /> Retour au lobby</a>
		<h1>Administration</h1>
		<p class="subtitle">
			{isAdmin
				? 'Joueurs, parties, chat, boutique : tout se gère ici.'
				: 'Modération des joueurs, des parties et du chat.'}
		</p>
	</header>

	{#if !isStaff}
		<p class="denied">Cette page est réservée à l'équipe de modération.</p>
	{:else}
		<nav class="admin-tabs" aria-label="Sections">
			{#each tabs as t (t.key)}
				{@const Icon = t.icon}
				<button
					class:active={tab === t.key}
					aria-current={tab === t.key ? 'page' : undefined}
					onclick={() => navigate(t.key)}
				>
					<Icon size={15} />
					{t.label}
				</button>
			{/each}
		</nav>

		{#if tab === 'overview'}
			<AdminOverview {isAdmin} onOpenPlayer={openPlayer} onNavigate={(t) => navigate(t)} />
		{:else if tab === 'players'}
			<AdminPlayers {isAdmin} selectedId={userId} onSelect={selectPlayer} />
		{:else if tab === 'games'}
			<AdminGames onOpenPlayer={openPlayer} />
		{:else if tab === 'chat'}
			<AdminChat />
		{:else if tab === 'shop'}
			<AdminShop />
		{:else if tab === 'journal'}
			<AdminJournal onOpenPlayer={openPlayer} />
		{/if}
	{/if}
</main>

<style>
	.admin {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 3rem;
		font-family: 'Quantico', 'Segoe UI', system-ui, sans-serif;
	}
	.admin-header {
		margin-bottom: 1.25rem;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: #7080b0;
		text-decoration: none;
		font-size: 0.85rem;
		margin-bottom: 0.75rem;
	}
	.back:hover {
		color: #4dd9ff;
	}
	h1 {
		font-size: 1.6rem;
		color: #c0e8ff;
		letter-spacing: 0.5px;
	}
	.subtitle {
		color: #6870a0;
		font-size: 0.9rem;
		margin-top: 0.25rem;
	}
	.denied {
		color: #ff8080;
	}
	.admin-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 1.25rem;
		padding-bottom: 0.85rem;
		border-bottom: 1px solid rgba(77, 217, 255, 0.12);
	}
	.admin-tabs button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: rgba(5, 8, 22, 0.85);
		border: 1px solid rgba(77, 217, 255, 0.15);
		border-radius: 9px;
		color: #8090c0;
		padding: 0.5rem 0.9rem;
		font-size: 0.85rem;
		font-family: inherit;
		cursor: pointer;
	}
	.admin-tabs button:hover {
		color: #c0e8ff;
		border-color: rgba(77, 217, 255, 0.4);
	}
	.admin-tabs button.active {
		color: #c0e8ff;
		border-color: #4dd9ff;
		box-shadow: 0 0 12px rgba(77, 217, 255, 0.25);
	}

	.admin :global(.a-panel) {
		background: rgba(10, 14, 36, 0.85);
		border: 1px solid rgba(77, 217, 255, 0.15);
		border-radius: 14px;
		padding: 1.15rem;
		min-width: 0;
	}
	.admin :global(.a-panel h2) {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 1rem;
		color: #c0c8ff;
		margin-bottom: 0.9rem;
	}
	.admin :global(.a-panel h3) {
		font-size: 0.85rem;
		color: #8fa0d8;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		margin-bottom: 0.6rem;
	}
	.admin :global(.a-grid) {
		display: grid;
		gap: 1.1rem;
		align-items: start;
	}
	.admin :global(.a-toolbar) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.9rem;
	}
	.admin :global(.a-toolbar input),
	.admin :global(.a-toolbar select) {
		flex: 1 1 180px;
		min-width: 0;
	}
	.admin :global(select),
	.admin :global(textarea) {
		background: rgba(5, 8, 22, 0.9);
		border: 1px solid rgba(77, 217, 255, 0.2);
		border-radius: 8px;
		color: #c0c8ff;
		padding: 0.55rem 0.7rem;
		font-family: inherit;
		font-size: 0.85rem;
	}
	.admin :global(textarea) {
		width: 100%;
		resize: vertical;
	}
	.admin :global(.a-field) {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.admin :global(.a-field > span) {
		font-size: 0.75rem;
		color: #8090c0;
	}
	.admin :global(.a-seg) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.admin :global(.a-seg button) {
		background: rgba(5, 8, 22, 0.85);
		border: 1px solid rgba(77, 217, 255, 0.15);
		border-radius: 999px;
		color: #8090c0;
		padding: 0.3rem 0.7rem;
		font-size: 0.76rem;
		font-family: inherit;
		cursor: pointer;
	}
	.admin :global(.a-seg button.active) {
		border-color: #4dd9ff;
		color: #c0e8ff;
	}
	.admin :global(.a-table-wrap) {
		overflow-x: auto;
	}
	.admin :global(.a-table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
	}
	.admin :global(.a-table th) {
		text-align: left;
		color: #5a6290;
		font-weight: 600;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid rgba(77, 217, 255, 0.12);
		white-space: nowrap;
	}
	.admin :global(.a-table td) {
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid rgba(77, 217, 255, 0.06);
		color: #b0b8e8;
		vertical-align: middle;
	}
	.admin :global(.a-table tr.clickable) {
		cursor: pointer;
	}
	.admin :global(.a-table tr.clickable:hover td) {
		background: rgba(77, 217, 255, 0.05);
	}
	.admin :global(.a-table tr.selected td) {
		background: rgba(255, 204, 85, 0.08);
	}
	.admin :global(.a-num) {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.admin :global(.a-link) {
		background: none;
		border: none;
		padding: 0;
		color: #8fd8ff;
		font-family: inherit;
		font-size: inherit;
		cursor: pointer;
		text-align: left;
	}
	.admin :global(.a-link:hover) {
		text-decoration: underline;
	}
	.admin :global(.a-tag) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.68rem;
		font-weight: 700;
		padding: 0.12rem 0.45rem;
		border-radius: 999px;
		border: 1px solid currentColor;
		white-space: nowrap;
		line-height: 1.4;
	}
	.admin :global(.a-tag.danger) {
		color: #ff8a8a;
	}
	.admin :global(.a-tag.warn) {
		color: #ffcc55;
	}
	.admin :global(.a-tag.ok) {
		color: #80e8a0;
	}
	.admin :global(.a-tag.info) {
		color: #4dd9ff;
	}
	.admin :global(.a-tag.muted) {
		color: #6870a0;
	}
	.admin :global(.a-tag.staff) {
		color: #c9a0ff;
	}
	.admin :global(.a-dot) {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #3a4060;
		flex-shrink: 0;
	}
	.admin :global(.a-dot.on) {
		background: #50e890;
		box-shadow: 0 0 6px rgba(80, 232, 144, 0.7);
	}
	.admin :global(.a-pager) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.8rem;
		font-size: 0.78rem;
		color: #6870a0;
	}
	.admin :global(.a-pager div) {
		display: flex;
		gap: 0.4rem;
	}
	.admin :global(.btn-sm) {
		padding: 0.35rem 0.7rem;
		font-size: 0.78rem;
	}
	.admin :global(.a-error) {
		color: #ff8080;
		font-size: 0.82rem;
	}
	.admin :global(.a-success) {
		color: #80e880;
		font-size: 0.82rem;
	}
	.admin :global(.a-muted) {
		color: #5a6290;
		font-size: 0.82rem;
	}
	.admin :global(.a-empty) {
		color: #5a6290;
		font-size: 0.85rem;
		padding: 1.25rem 0;
		text-align: center;
	}
</style>
