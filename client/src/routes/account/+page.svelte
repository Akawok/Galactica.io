<script lang="ts">
	import { api } from '$lib/api';
	import { auth, currentUser } from '$lib/stores/auth';
	import { getSocket } from '$lib/stores/socket';
	import UserRound from '@lucide/svelte/icons/user-round';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	const NAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;

	let newName = $state('');
	let nameBusy = $state(false);
	let nameError = $state('');
	let nameDone = $state('');

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordBusy = $state(false);
	let passwordError = $state('');
	let passwordDone = $state('');

	function nameProblem(name: string): string {
		if (name.length < 3 || name.length > 20) return 'Entre 3 et 20 caractères';
		if (!NAME_PATTERN.test(name))
			return 'Lettres, chiffres, tirets et underscores, sans en commencer ni finir par un symbole';
		if (name === $currentUser?.username) return "C'est déjà ton pseudo";
		return '';
	}

	function passwordProblem(): string {
		if (newPassword.length < 10) return 'Le mot de passe doit faire au moins 10 caractères';
		const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
			re.test(newPassword)
		).length;
		if (classes < 3)
			return 'Combine au moins 3 types parmi : minuscules, majuscules, chiffres, caractères spéciaux';
		if (newPassword !== confirmPassword) return 'Les deux mots de passe ne correspondent pas';
		return '';
	}

	async function changeName(e: Event) {
		e.preventDefault();
		const name = newName.trim();
		nameDone = '';
		nameError = nameProblem(name);
		if (nameError) return;
		nameBusy = true;
		try {
			const { user } = await api.auth.changeUsername(name);
			auth.updateUser({ username: user.username });
			nameDone = `Tu t'appelles maintenant ${user.username}`;
			newName = '';
		} catch (err) {
			nameError = err instanceof Error ? err.message : 'Changement impossible';
		} finally {
			nameBusy = false;
		}
	}

	async function changePassword(e: Event) {
		e.preventDefault();
		passwordDone = '';
		passwordError = passwordProblem();
		if (passwordError) return;
		passwordBusy = true;
		try {
			await api.auth.changePassword(currentPassword, newPassword, getSocket()?.id);
			passwordDone = 'Mot de passe modifié, tes autres appareils ont été déconnectés';
			currentPassword = newPassword = confirmPassword = '';
		} catch (err) {
			passwordError = err instanceof Error ? err.message : 'Changement impossible';
		} finally {
			passwordBusy = false;
		}
	}
</script>

<div class="account-page">
	<a href="/lobby" class="back"><ArrowLeft size={14} /> Retour au lobby</a>
	<h1>Mon compte</h1>

	<form class="panel" onsubmit={changeName}>
		<h2><UserRound size={16} /> Pseudo</h2>
		<p class="muted">
			Actuel : <strong>{$currentUser?.username}</strong>. Un changement par jour, et tes anciens
			messages du chat garderont l'ancien nom.
		</p>
		<label>
			<span>Nouveau pseudo</span>
			<input
				bind:value={newName}
				minlength="3"
				maxlength="20"
				autocomplete="username"
				placeholder="3 à 20 caractères"
				required
			/>
		</label>
		{#if nameError}<p class="error" role="alert">{nameError}</p>{/if}
		{#if nameDone}<p class="success">{nameDone}</p>{/if}
		<button class="btn btn-primary" type="submit" disabled={nameBusy || !newName.trim()}>
			{nameBusy ? 'Enregistrement…' : 'Changer de pseudo'}
		</button>
	</form>

	<form class="panel" onsubmit={changePassword}>
		<h2><KeyRound size={16} /> Mot de passe</h2>
		<p class="muted">Tes autres appareils seront déconnectés, celui-ci reste connecté.</p>
		<label>
			<span>Mot de passe actuel</span>
			<input
				type="password"
				bind:value={currentPassword}
				maxlength="128"
				autocomplete="current-password"
				required
			/>
		</label>
		<label>
			<span>Nouveau mot de passe</span>
			<input
				type="password"
				bind:value={newPassword}
				minlength="10"
				maxlength="128"
				autocomplete="new-password"
				required
			/>
		</label>
		<label>
			<span>Confirmation</span>
			<input
				type="password"
				bind:value={confirmPassword}
				minlength="10"
				maxlength="128"
				autocomplete="new-password"
				required
			/>
		</label>
		{#if passwordError}<p class="error" role="alert">{passwordError}</p>{/if}
		{#if passwordDone}<p class="success">{passwordDone}</p>{/if}
		<button class="btn btn-primary" type="submit" disabled={passwordBusy}>
			{passwordBusy ? 'Enregistrement…' : 'Changer le mot de passe'}
		</button>
	</form>
</div>

<style>
	.account-page {
		max-width: 520px;
		margin: 0 auto;
		padding: 2rem 1rem 3rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: #8090c0;
		font-size: 0.85rem;
		text-decoration: none;
	}
	.back:hover {
		color: #c0c8ff;
	}
	h1 {
		font-size: 1.4rem;
		color: #e0e8ff;
	}
	.panel {
		background: rgba(10, 14, 36, 0.85);
		border: 1px solid rgba(77, 217, 255, 0.15);
		border-radius: 14px;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 1px;
		color: #4dd9ff;
	}
	.muted {
		font-size: 0.82rem;
		color: #8090c0;
		line-height: 1.5;
	}
	.muted strong {
		color: #c0c8ff;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	label span {
		font-size: 0.8rem;
		color: #8090c0;
		font-weight: 500;
	}
	.error {
		color: #ff7b7b;
		font-size: 0.82rem;
	}
	.success {
		color: #6ee7a8;
		font-size: 0.82rem;
	}
	.btn {
		align-self: flex-start;
	}
</style>
