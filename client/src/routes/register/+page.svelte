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

	const USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;

	function validate(): string {
		if (!USERNAME_RE.test(username)) {
			return 'Le pseudo ne peut contenir que des lettres non accentuées, chiffres, tirets et underscores';
		}
		if (password.length < 10) {
			return 'Le mot de passe doit faire au moins 10 caractères';
		}
		const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
			re.test(password)
		).length;
		if (classes < 3) {
			return 'Le mot de passe doit combiner au moins 3 types parmi : minuscules, majuscules, chiffres, caractères spéciaux';
		}
		return '';
	}

	async function handleRegister(e: Event) {
		e.preventDefault();
		error = validate();
		if (error) return;
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
				pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*[a-zA-Z0-9]"
				autocomplete="username"
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
				minlength="10"
				maxlength="128"
				autocomplete="new-password"
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
