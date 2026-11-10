<script lang="ts">
	import { api } from '$lib/api';
	import AuthCard from '$lib/components/AuthCard.svelte';

	let email = $state('');
	let error = $state('');
	let notice = $state('');
	let loading = $state(false);
	let sent = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		notice = '';
		loading = true;
		try {
			const res = await api.auth.forgotPassword(email);
			notice = res.message;
			sent = true;
		} catch (err: any) {
			error = err.message;
		} finally {
			loading = false;
		}
	}
</script>

<AuthCard
	title="Mot de passe oublié"
	subtitle="On t'envoie un lien par mail"
	{error}
	{notice}
	onsubmit={handleSubmit}
>
	{#snippet fields()}
		{#if !sent}
			<div class="field">
				<label for="email">Email</label>
				<input
					id="email"
					type="email"
					bind:value={email}
					placeholder="ton@email.com"
					autocomplete="email"
					required
				/>
			</div>
		{/if}
	{/snippet}

	{#snippet submit()}
		{#if !sent}
			<button type="submit" class="btn btn-primary" disabled={loading}>
				{loading ? 'Envoi...' : 'Envoyer le lien'}
			</button>
		{/if}
	{/snippet}

	{#snippet footer()}
		<a href="/login">Retour à la connexion</a>
	{/snippet}
</AuthCard>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	label {
		font-size: 0.8rem;
		color: #8090c0;
		font-weight: 500;
	}

	.btn {
		margin-top: 0.5rem;
	}
</style>
