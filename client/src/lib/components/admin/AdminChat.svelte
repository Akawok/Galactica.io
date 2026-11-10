<script lang="ts">
	import { onDestroy } from 'svelte';
	import { api, type AdminChatMessage } from '$lib/api';
	import { formatDate, plural } from '$lib/admin/format';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	let messages = $state<AdminChatMessage[]>([]);
	let username = $state('');
	let error = $state<string | null>(null);
	let feedback = $state<string | null>(null);
	let busy = $state(false);
	let confirmPurge = $state(false);

	let debounce: ReturnType<typeof setTimeout> | undefined;
	let requestId = 0;
	onDestroy(() => clearTimeout(debounce));

	const filtered = $derived(username.trim());

	$effect(() => {
		const name = filtered;
		clearTimeout(debounce);
		confirmPurge = false;
		debounce = setTimeout(() => load(name), name ? 250 : 0);
	});

	async function load(name = filtered) {
		const id = ++requestId;
		try {
			const res = await api.admin.chat({ username: name || undefined });
			if (id !== requestId) return;
			messages = res.messages;
			error = null;
		} catch (e) {
			if (id === requestId) error = e instanceof Error ? e.message : 'Chargement impossible';
		}
	}

	async function remove(m: AdminChatMessage) {
		if (busy) return;
		busy = true;
		feedback = null;
		try {
			await api.admin.deleteMessage(m.id);
			messages = messages.filter((x) => x.id !== m.id);
			feedback = `Message de ${m.username} supprimé partout.`;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Suppression impossible';
		} finally {
			busy = false;
		}
	}

	async function purge() {
		if (busy) return;
		if (!confirmPurge) {
			confirmPurge = true;
			return;
		}
		busy = true;
		feedback = null;
		try {
			// Purging by name needs the exact username, the filter only matches the beginning
			const exact = messages.find((m) => m.username.toLowerCase() === filtered.toLowerCase());
			const target = filtered ? (exact?.username ?? filtered) : undefined;
			const { deletedCount } = await api.admin.purgeChat(target);
			feedback = target
				? `${plural(deletedCount, 'message')} de ${target} supprimé${deletedCount > 1 ? 's' : ''}.`
				: `Chat vidé (${plural(deletedCount, 'message')}).`;
			confirmPurge = false;
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Suppression impossible';
		} finally {
			busy = false;
		}
	}
</script>

<section class="a-panel">
	<h2>Messages des dernières 24 h</h2>
	<div class="a-toolbar">
		<input
			type="search"
			placeholder="Filtrer par pseudo"
			bind:value={username}
			aria-label="Filtrer par pseudo"
		/>
		<button class="btn btn-secondary btn-sm icon" onclick={() => load()} disabled={busy}>
			<RefreshCw size={13} /> Actualiser
		</button>
		<button class="btn btn-danger btn-sm" onclick={purge} disabled={busy}>
			{#if confirmPurge}
				Confirmer : tout supprimer {filtered ? `de ${filtered}` : 'du chat'} ?
			{:else}
				{filtered ? `Supprimer tous ses messages` : 'Vider le chat'}
			{/if}
		</button>
	</div>

	{#if error}<p class="a-error" role="alert">{error}</p>{/if}
	{#if feedback}<p class="a-success">{feedback}</p>{/if}

	{#if messages.length === 0}
		<p class="a-empty">Aucun message.</p>
	{:else}
		<ul class="messages">
			{#each messages as m (m.id)}
				<li class:special={m.system || m.announcement}>
					<span class="time" title={formatDate(m.timestamp)}>
						{new Date(m.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
					</span>
					{#if m.announcement}
						<span class="a-tag info">Annonce</span>
					{:else if m.system}
						<span class="a-tag muted">Auto</span>
					{/if}
					<button class="author a-link" onclick={() => (username = m.username)} title="Voir ses messages"
						>{m.username}</button
					>
					<span class="text">{m.message}</span>
					<button
						class="delete"
						onclick={() => remove(m)}
						disabled={busy}
						aria-label="Supprimer ce message"
						title="Supprimer ce message"><Trash2 size={14} /></button
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.icon {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.messages {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.messages li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		border-radius: 6px;
		font-size: 0.84rem;
	}
	.messages li:hover {
		background: rgba(77, 217, 255, 0.05);
	}
	.messages li.special {
		background: rgba(77, 217, 255, 0.04);
	}
	.time {
		color: #3a4060;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}
	.author {
		font-weight: 700;
		flex-shrink: 0;
	}
	.text {
		flex: 1;
		color: #c0c8ff;
		overflow-wrap: anywhere;
	}
	.delete {
		background: none;
		border: none;
		color: #5a6290;
		cursor: pointer;
		padding: 0.1rem;
		flex-shrink: 0;
		align-self: center;
	}
	.delete:hover {
		color: #ff8a8a;
	}
</style>
