<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type AdminUserDetail, type Role } from '$lib/api';
	import { currentUser } from '$lib/stores/auth';
	import { BRANCHES } from '$lib/attributesUi';
	import { getGrade } from '$lib/shared/grades';
	import { MAX_LEVEL } from '$lib/shared/xp';
	import {
		ACTION_LABEL,
		PLAYER_STATUS_LABEL,
		ROLE_LABEL,
		describeAudit,
		formatDate,
		formatNumber,
		isActive,
		timeAgo,
		timeLeft
	} from '$lib/admin/format';
	import X from '@lucide/svelte/icons/x';
	import Gavel from '@lucide/svelte/icons/gavel';
	import Shield from '@lucide/svelte/icons/shield';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	let {
		userId,
		isAdmin,
		onClose,
		onChanged
	}: {
		userId: string;
		isAdmin: boolean;
		onClose: () => void;
		onChanged: () => void;
	} = $props();

	const BAN_DURATIONS = [
		{ label: '1 heure', minutes: 60 },
		{ label: '1 jour', minutes: 1_440 },
		{ label: '7 jours', minutes: 10_080 },
		{ label: '30 jours', minutes: 43_200 },
		{ label: '1 an', minutes: 525_600 },
		{ label: 'Définitif', minutes: 0 }
	];
	const MUTE_DURATIONS = [
		{ label: '10 min', minutes: 10 },
		{ label: '1 h', minutes: 60 },
		{ label: '24 h', minutes: 1_440 },
		{ label: '7 jours', minutes: 10_080 }
	];

	let detail = $state<AdminUserDetail | null>(null);
	let loadError = $state<string | null>(null);
	let busy = $state(false);
	let feedback = $state<{ ok: boolean; text: string } | null>(null);

	let banMinutes = $state(1_440);
	let banReason = $state('');
	let newName = $state('');
	let newRole = $state<Role>('user');
	let res = $state({ points: 0, galactics: 0, level: 1, xp: 0 });
	let deleteConfirm = $state('');

	const user = $derived(detail?.user);
	const isSelf = $derived(user?.id === $currentUser?.id);
	const canModerate = $derived(
		!!user &&
			!isSelf &&
			user.role !== 'admin' &&
			(isAdmin || user.role === 'user')
	);
	const banned = $derived(isActive(user?.bannedUntil));
	const muted = $derived(isActive(user?.mutedUntil));

	onMount(load);

	async function load() {
		try {
			detail = await api.admin.user(userId);
			loadError = null;
			const u = detail.user;
			newName = u.username;
			newRole = u.role;
			res = { points: u.points, galactics: u.galactics, level: u.level, xp: u.xp };
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Chargement impossible';
		}
	}

	async function run(action: () => Promise<unknown>, success: string) {
		if (busy) return;
		busy = true;
		feedback = null;
		try {
			const result = await action();
			feedback = { ok: true, text: typeof result === 'string' ? result : success };
			await load();
			onChanged();
		} catch (e) {
			feedback = { ok: false, text: e instanceof Error ? e.message : 'Action impossible' };
		} finally {
			busy = false;
		}
	}

	function ban() {
		const permanent = banMinutes === 0;
		run(
			() =>
				api.admin.ban(userId, {
					...(permanent ? { permanent: true } : { durationMinutes: banMinutes }),
					reason: banReason.trim() || undefined
				}),
			'Joueur banni et déconnecté.'
		);
	}

	function saveResources() {
		const u = user;
		if (!u) return;
		// An emptied number field reads as null, which the server would turn into 0
		const values = [res.points, res.galactics, res.level, res.xp];
		if (values.some((v) => typeof v !== 'number' || !Number.isInteger(v) || v < 0)) {
			feedback = { ok: false, text: 'Indique un nombre entier positif dans chaque champ.' };
			return;
		}
		if (res.level < 1 || res.level > MAX_LEVEL) {
			feedback = { ok: false, text: `Le niveau va de 1 à ${MAX_LEVEL}.` };
			return;
		}
		const changes: Record<string, number> = {};
		if (res.points !== u.points) changes.points = res.points;
		if (res.galactics !== u.galactics) changes.galactics = res.galactics;
		if (res.level !== u.level) changes.level = res.level;
		if (res.xp !== u.xp) changes.xp = res.xp;
		if (Object.keys(changes).length === 0) {
			feedback = { ok: true, text: 'Rien à enregistrer.' };
			return;
		}
		run(async () => {
			const out = await api.admin.setResources(userId, changes);
			return out.attributesReset
				? 'Enregistré. Ses caractéristiques ont été remises à zéro (trop de points pour ce niveau).'
				: undefined;
		}, 'Ressources enregistrées.');
	}

	async function deleteAccount() {
		if (!user || busy) return;
		busy = true;
		feedback = null;
		try {
			await api.admin.deleteUser(userId, deleteConfirm);
			onChanged();
			onClose();
		} catch (e) {
			feedback = { ok: false, text: e instanceof Error ? e.message : 'Suppression impossible' };
		} finally {
			busy = false;
		}
	}
</script>

<section class="a-panel detail" aria-label="Fiche joueur">
	<button class="close" onclick={onClose} aria-label="Fermer la fiche"><X size={18} /></button>

	{#if loadError}
		<p class="a-error" role="alert">{loadError}</p>
	{:else if !user || !detail}
		<p class="a-empty">Chargement…</p>
	{:else}
		{@const grade = getGrade(user.level)}
		<header class="head">
			<h2>
				<span class="a-dot" class:on={user.online}></span>
				{user.username}
			</h2>
			<div class="tags">
				<span class="a-tag {user.role === 'user' ? 'muted' : 'staff'}">{ROLE_LABEL[user.role]}</span>
				<span class="a-tag info" style="color: {grade.color}">{grade.label} · niv. {user.level}</span>
				{#if detail.live}
					<span class="a-tag ok">
						{PLAYER_STATUS_LABEL[detail.live.status]}{detail.live.roomId
							? ` · #${detail.live.roomId}`
							: ''}
					</span>
				{:else}
					<span class="a-tag muted">Hors ligne</span>
				{/if}
				{#if banned}<span class="a-tag danger">Banni · {timeLeft(user.bannedUntil)}</span>{/if}
				{#if muted}<span class="a-tag warn">Sourdine · {timeLeft(user.mutedUntil)}</span>{/if}
			</div>
			<dl class="facts">
				{#if user.email}
					<div>
						<dt>Email</dt>
						<dd>
							{user.email}
							{#if user.emailVerified}<span class="a-tag ok">confirmé</span>{:else}<span
									class="a-tag warn">non confirmé</span
								>{/if}
						</dd>
					</div>
				{/if}
				<div><dt>Inscrit le</dt><dd>{formatDate(user.createdAt)}</dd></div>
				<div><dt>Identifiant</dt><dd class="mono">{user.id}</dd></div>
				{#if banned && user.banReason}
					<div><dt>Motif du ban</dt><dd>{user.banReason}</dd></div>
				{/if}
			</dl>
		</header>

		<div class="stats">
			<div><span>Crédits</span><strong>{formatNumber(user.points)}</strong></div>
			<div><span>Galactics</span><strong>{formatNumber(user.galactics)}</strong></div>
			<div><span>Victoires</span><strong>{user.stats.wins ?? 0}</strong></div>
			<div><span>Défaites</span><strong>{user.stats.losses ?? 0}</strong></div>
			<div><span>Meilleure série</span><strong>{user.stats.bestStreak ?? 0}</strong></div>
			<div><span>Désertions</span><strong>{user.stats.desertions ?? 0}</strong></div>
		</div>

		{#if feedback}
			<p class={feedback.ok ? 'a-success' : 'a-error'} role={feedback.ok ? 'status' : 'alert'}>
				{feedback.text}
			</p>
		{/if}

		{#if canModerate}
			<div class="block">
				<h3><Gavel size={14} /> Modération</h3>

				{#if banned}
					<div class="line">
						<span>Banni jusqu'au {formatDate(user.bannedUntil)}</span>
						<button
							class="btn btn-secondary btn-sm"
							disabled={busy}
							onclick={() => run(() => api.admin.unban(userId), 'Ban levé.')}>Lever le ban</button
						>
					</div>
				{:else}
					<div class="ban-form">
						<select bind:value={banMinutes} aria-label="Durée du ban">
							{#each BAN_DURATIONS as d (d.minutes)}<option value={d.minutes}>{d.label}</option>{/each}
						</select>
						<input bind:value={banReason} maxlength="200" placeholder="Motif (visible dans le journal)" />
						<button class="btn btn-danger btn-sm" disabled={busy} onclick={ban}>Bannir</button>
					</div>
				{/if}

				<div class="line">
					<span>Chat</span>
					<div class="a-seg">
						{#each MUTE_DURATIONS as d (d.minutes)}
							<button
								disabled={busy}
								onclick={() =>
									run(() => api.admin.mute(userId, d.minutes), `Réduit au silence (${d.label}).`)}
								>{d.label}</button
							>
						{/each}
						{#if muted}
							<button
								class="active"
								disabled={busy}
								onclick={() => run(() => api.admin.mute(userId, 0), 'Il peut de nouveau écrire.')}
								>Lever</button
							>
						{/if}
					</div>
				</div>

				<div class="line">
					<span>Pseudo</span>
					<div class="inline">
						<input bind:value={newName} maxlength="20" aria-label="Nouveau pseudo" />
						<button
							class="btn btn-secondary btn-sm"
							disabled={busy || !newName.trim() || newName.trim() === user.username}
							onclick={() =>
								run(() => api.admin.rename(userId, newName.trim()), 'Pseudo modifié.')}>Renommer</button
						>
					</div>
				</div>

				{#if user.online}
					<div class="line">
						<span>Le renvoyer à l'écran de connexion</span>
						<button
							class="btn btn-secondary btn-sm"
							disabled={busy}
							onclick={() => run(() => api.admin.kick(userId), 'Joueur déconnecté.')}>Déconnecter</button
						>
					</div>
				{/if}
			</div>
		{:else if !isSelf}
			<p class="a-muted">
				{user.role === 'admin'
					? 'Un administrateur ne peut pas être sanctionné.'
					: 'Tu ne peux pas sanctionner un membre de ton rang.'}
			</p>
		{/if}

		{#if isAdmin}
			<div class="block">
				<h3><Shield size={14} /> Compte</h3>

				{#if !isSelf}
					<div class="line">
						<span>Rôle</span>
						<div class="inline">
							<select bind:value={newRole} aria-label="Rôle">
								<option value="user">Joueur</option>
								<option value="moderator">Modérateur</option>
								<option value="admin">Admin</option>
							</select>
							<button
								class="btn btn-secondary btn-sm"
								disabled={busy || newRole === user.role}
								onclick={() =>
									run(() => api.admin.setRole(userId, newRole), `Rôle changé en ${ROLE_LABEL[newRole]}.`)}
								>Appliquer</button
							>
						</div>
					</div>
				{/if}

				<div class="res-grid">
					<label class="a-field"><span>Crédits</span><input type="number" min="0" bind:value={res.points} /></label>
					<label class="a-field"><span>Galactics</span><input type="number" min="0" bind:value={res.galactics} /></label>
					<label class="a-field"><span>Niveau</span><input type="number" min="1" max={MAX_LEVEL} bind:value={res.level} /></label>
					<label class="a-field"><span>XP du niveau</span><input type="number" min="0" bind:value={res.xp} /></label>
				</div>
				<div class="line">
					<span class="a-muted">Baisser le niveau peut remettre ses caractéristiques à zéro.</span>
					<button class="btn btn-secondary btn-sm" disabled={busy} onclick={saveResources}>Enregistrer</button>
				</div>

				<div class="actions">
					<button
						class="btn btn-secondary btn-sm"
						disabled={busy}
						onclick={() =>
							run(() => api.admin.resetAttributes(userId), 'Caractéristiques remises à zéro, sans frais.')}
						>Remettre les caractéristiques à zéro</button
					>
					{#if !user.emailVerified}
						<button
							class="btn btn-secondary btn-sm"
							disabled={busy}
							onclick={() => run(() => api.admin.verifyEmail(userId), 'Email marqué comme confirmé.')}
							>Valider l'email</button
						>
					{/if}
					<button
						class="btn btn-secondary btn-sm"
						disabled={busy}
						onclick={() =>
							run(() => api.admin.sendReset(userId), 'Lien de nouveau mot de passe envoyé par email.')}
						>Envoyer un lien de mot de passe</button
					>
				</div>
			</div>
		{/if}

		<div class="block">
			<h3>Caractéristiques</h3>
			<div class="attrs">
				{#each BRANCHES as b (b.key)}
					<div>
						<span class="branch" style="color: {b.accent}">{b.label}</span>
						{#each b.attributes as a (a.key)}
							<span class="attr">{a.label} <strong>{user.attributes[a.key] ?? 0}</strong></span>
						{/each}
					</div>
				{/each}
			</div>
			<p class="a-muted">{user.attributePoints} point{user.attributePoints > 1 ? 's' : ''} à son niveau · {user.respecCount} réinitialisation{user.respecCount > 1 ? 's' : ''}</p>
		</div>

		<div class="block">
			<h3>Hangar ({user.inventory.length})</h3>
			{#if user.inventory.length === 0}
				<p class="a-muted">Vide.</p>
			{:else}
				<p class="inventory">{user.inventory.map((i) => i.name).join(' · ')}</p>
			{/if}
		</div>

		<div class="block">
			<h3>Dernières parties</h3>
			{#if detail.games.length === 0}
				<p class="a-muted">Aucune partie jouée.</p>
			{:else}
				<ul class="list">
					{#each detail.games as g (g.id)}
						{@const opponent = g.players.find((p) => p.userId !== user.id)}
						<li>
							<span class="a-tag {g.won ? 'ok' : 'danger'}">{g.won ? 'Victoire' : 'Défaite'}</span>
							<span>contre {opponent?.username ?? '?'}</span>
							<span class="score">{g.players.map((p) => p.score).join(' – ')}</span>
							<span class="a-muted">{timeAgo(g.endedAt ?? g.createdAt)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="block">
			<h3>Historique de modération</h3>
			{#if detail.history.length === 0}
				<p class="a-muted">Rien à signaler.</p>
			{:else}
				<ul class="list">
					{#each detail.history as h (h._id)}
						<li>
							<strong>{ACTION_LABEL[h.action] ?? h.action}</strong>
							<span class="a-muted">{describeAudit(h)}</span>
							<span class="a-muted">par {h.actorUsername} · {timeAgo(h.createdAt)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		{#if isAdmin && !isSelf && user.role !== 'admin'}
			<div class="block danger-zone">
				<h3><TriangleAlert size={14} /> Supprimer le compte</h3>
				<p class="a-muted">
					Définitif : le compte, sa progression et ses messages disparaissent. Ses anciennes parties
					restent visibles chez ses adversaires. Recopie <strong>{user.username}</strong> pour confirmer.
				</p>
				<div class="inline">
					<input bind:value={deleteConfirm} placeholder={user.username} aria-label="Confirmation" />
					<button
						class="btn btn-danger btn-sm"
						disabled={busy || deleteConfirm !== user.username}
						onclick={deleteAccount}>Supprimer</button
					>
				</div>
			</div>
		{/if}
	{/if}
</section>

<style>
	.detail {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.close {
		position: absolute;
		top: 0.8rem;
		right: 0.8rem;
		background: none;
		border: none;
		color: #6870a0;
		cursor: pointer;
	}
	.close:hover {
		color: #c0e8ff;
	}
	.head h2 {
		margin-bottom: 0.5rem;
		padding-right: 2rem;
		font-size: 1.2rem;
		overflow-wrap: anywhere;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
	}
	.facts {
		display: grid;
		gap: 0.35rem;
		font-size: 0.8rem;
	}
	.facts div {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.facts dt {
		color: #5a6290;
		min-width: 6.5rem;
	}
	.facts dd {
		color: #b0b8e8;
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
		overflow-wrap: anywhere;
	}
	.mono {
		font-family: ui-monospace, monospace;
		font-size: 0.74rem;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 110px), 1fr));
		gap: 0.5rem;
	}
	.stats div {
		background: rgba(5, 8, 22, 0.85);
		border-radius: 9px;
		padding: 0.5rem 0.65rem;
		display: flex;
		flex-direction: column;
	}
	.stats span {
		font-size: 0.7rem;
		color: #5a6290;
	}
	.stats strong {
		font-size: 1.05rem;
		color: #e0f0ff;
		font-variant-numeric: tabular-nums;
	}
	.block {
		border-top: 1px solid rgba(77, 217, 255, 0.1);
		padding-top: 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}
	.block h3 {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-bottom: 0;
	}
	.line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		flex-wrap: wrap;
		font-size: 0.82rem;
		color: #b0b8e8;
	}
	.inline {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.inline input {
		width: 12rem;
		max-width: 100%;
	}
	.ban-form {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 0.4rem;
	}
	@media (max-width: 520px) {
		.ban-form {
			grid-template-columns: 1fr;
		}
	}
	.res-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 120px), 1fr));
		gap: 0.5rem;
	}
	.res-grid input {
		width: 100%;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.attrs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr));
		gap: 0.6rem;
		font-size: 0.8rem;
	}
	.attrs div {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.branch {
		font-weight: 700;
		font-size: 0.75rem;
	}
	.attr {
		color: #8090c0;
	}
	.attr strong {
		color: #e0f0ff;
	}
	.inventory {
		font-size: 0.8rem;
		color: #b0b8e8;
		line-height: 1.5;
	}
	.list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: #b0b8e8;
	}
	.list li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.score {
		font-variant-numeric: tabular-nums;
		color: #e0f0ff;
	}
	.danger-zone {
		border-top-color: rgba(255, 120, 120, 0.3);
	}
	.danger-zone h3 {
		color: #ff8a8a;
	}
	.danger-zone strong {
		color: #ffb0b0;
	}
</style>
