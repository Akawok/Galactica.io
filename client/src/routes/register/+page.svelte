<script lang="ts">
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth';
	import { api } from '$lib/api';
	import AuthCard from '$lib/components/AuthCard.svelte';

	let username = $state('');
	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function handleRegister(e: Event) {
		e.preventDefault();
		error = '';
		if (password.length < 6) {
			error = 'Le mot de passe doit faire au moins 6 caractères';
			return;
		}
		loading = true;
		try {
			const { token, user } = await api.auth.register(username, email, password);
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
	subtitle="Crée ton compte pilote"
	{error}
	onsubmit={handleRegister}
>
	{#snippet fields()}
		<div class="field">
			<label for="username">Pseudo</label>
			<input
				id="username"
				type="text"
				bind:value={username}
				placeholder="CommanderX"
				minlength="3"
				maxlength="20"
				required
			/>
		</div>
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
				minlength="6"
				required
			/>
		</div>
	{/snippet}

	{#snippet submit()}
		<button type="submit" class="btn btn-primary" disabled={loading}>
			{loading ? 'Création...' : 'Créer mon compte'}
		</button>
	{/snippet}

	{#snippet footer()}
		Déjà un compte ? <a href="/login">Se connecter</a>
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
