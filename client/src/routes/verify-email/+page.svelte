<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { api } from '$lib/api';
	import AuthCard from '$lib/components/AuthCard.svelte';

	let error = $state('');
	let notice = $state('');
	let checking = $state(true);

	onMount(async () => {
		const token = $page.url.searchParams.get('token');
		if (!token) {
			error = 'Lien de vérification incomplet';
			checking = false;
			return;
		}
		try {
			await api.auth.verifyEmail(token);
			notice = 'Adresse email confirmée.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Erreur serveur';
		} finally {
			checking = false;
		}
	});
</script>

<AuthCard
	title="Vérification"
	subtitle="Vérification de ton email"
	{error}
	{notice}
	onsubmit={(e) => e.preventDefault()}
>
	{#snippet fields()}
		{#if checking}
			<p class="hint">Vérification en cours...</p>
		{/if}
	{/snippet}

	{#snippet submit()}{/snippet}

	{#snippet footer()}
		<a href="/lobby">Aller au lobby</a>
	{/snippet}
</AuthCard>

<style>
	.hint {
		font-size: 0.85rem;
		color: #8090c0;
		text-align: center;
	}
</style>
