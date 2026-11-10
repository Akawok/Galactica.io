<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { api } from '$lib/api';
	import AuthCard from '$lib/components/AuthCard.svelte';

	let password = $state('');
	let confirm = $state('');
	let error = $state('');
	let notice = $state('');
	let loading = $state(false);
	let done = $state(false);

	const token = $derived($page.url.searchParams.get('token') ?? '');

	function validate(): string {
		if (password.length < 10) {
			return 'Le mot de passe doit faire au moins 10 caractères';
		}
		const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
			re.test(password)
		).length;
		if (classes < 3) {
			return 'Le mot de passe doit combiner au moins 3 types parmi : minuscules, majuscules, chiffres, caractères spéciaux';
		}
		if (password !== confirm) {
			return 'Les deux mots de passe ne correspondent pas';
		}
		return '';
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		notice = '';
		error = validate();
		if (error) return;

		loading = true;
		try {
			await api.auth.resetPassword(token, password);
			done = true;
			notice = 'Mot de passe modifié. Redirection vers la connexion...';
			setTimeout(() => goto('/login'), 1800);
		} catch (err: any) {
			error = err.message;
		} finally {
			loading = false;
		}
	}
</script>

<AuthCard
	title="Nouveau mot de passe"
	subtitle={token ? 'Choisis ton nouveau mot de passe' : 'Lien invalide'}
	{error}
	{notice}
	onsubmit={handleSubmit}
>
	{#snippet fields()}
		{#if !token}
			<p class="hint">
				Ce lien est incomplet ou expiré. Demande-en un nouveau depuis la page
				« mot de passe oublié ».
			</p>
		{:else if !done}
			<div class="field">
				<label for="password">Nouveau mot de passe</label>
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
			<div class="field">
				<label for="confirm">Confirmation</label>
				<input
					id="confirm"
					type="password"
					bind:value={confirm}
					placeholder="••••••••"
					minlength="10"
					maxlength="128"
					autocomplete="new-password"
					required
				/>
			</div>
		{/if}
	{/snippet}

	{#snippet submit()}
		{#if token && !done}
			<button type="submit" class="btn btn-primary" disabled={loading}>
				{loading ? 'Enregistrement...' : 'Changer le mot de passe'}
			</button>
		{/if}
	{/snippet}

	{#snippet footer()}
		{#if token}
			<a href="/login">Retour à la connexion</a>
		{:else}
			<a href="/forgot-password">Demander un nouveau lien</a>
		{/if}
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

	.hint {
		font-size: 0.85rem;
		color: #8090c0;
		text-align: center;
		line-height: 1.5;
	}

	.btn {
		margin-top: 0.5rem;
	}
</style>
