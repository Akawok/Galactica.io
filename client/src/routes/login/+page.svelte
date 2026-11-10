<script lang="ts">
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { auth } from '$lib/stores/auth';
	import { sessionTerminated } from '$lib/stores/socket';
	import { api } from '$lib/api';
	import AuthCard from '$lib/components/AuthCard.svelte';

	let email = $state('');
	let password = $state('');
	// Tells the player why they were sent back here (another device, suspension…)
	let error = $state(get(sessionTerminated) ?? '');
	sessionTerminated.set(null);
	let loading = $state(false);

	async function handleLogin(e: Event) {
		e.preventDefault();
		error = '';
		loading = true;
		try {
			const { user } = await api.auth.login(email, password);
			auth.login(user);
			goto('/lobby');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Erreur serveur';
		} finally {
			loading = false;
		}
	}
</script>

<AuthCard
	title="Galactica.io"
	subtitle="Connecte-toi pour jouer"
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
				autocomplete="current-password"
				required
			/>
			<a class="forgot" href="/forgot-password">Mot de passe oublié ?</a>
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

	.forgot {
		align-self: flex-end;
		font-size: 0.78rem;
		color: #6870a0;
		text-decoration: none;
		margin-top: 0.15rem;
	}

	.forgot:hover {
		color: #7b8cff;
		text-decoration: underline;
	}
</style>
