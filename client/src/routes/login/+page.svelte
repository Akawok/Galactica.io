<script lang="ts">
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth';
	import { api } from '$lib/api';
	import AuthCard from '$lib/components/AuthCard.svelte';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function handleLogin(e: Event) {
		e.preventDefault();
		error = '';
		loading = true;
		try {
			const { token, user } = await api.auth.login(email, password);
			auth.login(token, user);
			goto('/lobby');
		} catch (err: any) {
			error = err.message;
		} finally {
			loading = false;
		}
	}
</script>

<AuthCard
	title="Galactica.io"
	subtitle="Connecte-toi pour rejoindre la bataille"
	{error}
	onsubmit={handleLogin}
>
	{#snippet fields()}
		<div class="field">
			<label for="email">Email</label>
			<input id="email" type="email" bind:value={email} placeholder="ton@email.com" required />
		</div>
		<div class="field">
			<label for="password">Mot de passe</label>
			<input
				id="password"
				type="password"
				bind:value={password}
				placeholder="••••••••"
				required
			/>
		</div>
	{/snippet}

	{#snippet submit()}
		<button type="submit" class="btn btn-primary" disabled={loading}>
			{loading ? 'Connexion...' : 'Se connecter'}
		</button>
	{/snippet}

	{#snippet footer()}
		Pas encore de compte ? <a href="/register">Créer un compte</a>
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
