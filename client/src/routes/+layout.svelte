<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { isAuthenticated, auth, currentUser, token } from '$lib/stores/auth';
	import { connectSocket, disconnectSocket } from '$lib/stores/socket';
	import { addMessage } from '$lib/stores/chat';
	import Rocket from '@lucide/svelte/icons/rocket';
	import Gem from '@lucide/svelte/icons/gem';
	import { getGrade } from '$lib/grades';
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let { children } = $props();

	const PUBLIC_ROUTES = ['/login', '/register'];

	onMount(async () => {
		if (!$token) return;
		try {
			const { user } = await api.auth.me();
			auth.updateUser(user);
		} catch {}
	});

	$effect(() => {
		if (!$isAuthenticated && !PUBLIC_ROUTES.includes($page.url.pathname)) {
			goto('/login');
		}
	});

	$effect(() => {
		if (!$isAuthenticated) return;
		const { token } = $page.data ?? {};
		import('$lib/stores/socket').then(({ getSocket }) => {
			const socket = getSocket();
			if (!socket) return;
			socket.off('chat:message');
			socket.on('chat:message', addMessage);
		});
	});

	function logout() {
		disconnectSocket();
		auth.logout();
		goto('/login');
	}
</script>

<svelte:head>
	<title>Galactica.io</title>
</svelte:head>

{#if $isAuthenticated && !PUBLIC_ROUTES.includes($page.url.pathname)}
	<nav class="navbar">
		<a href="/lobby" class="logo"><Rocket size={16} /> Galactica.io</a>
		<div class="nav-center"></div>
		<div class="nav-right">
			{#if $currentUser}
				{@const grade = getGrade($currentUser.level ?? 1)}
				<div class="nav-profile">
					<span class="nav-username">{$currentUser.username}</span>
					<span class="nav-grade" style="color: {grade.color}">{grade.label}</span>
				</div>
				<div class="nav-sep"></div>
			{/if}
			<div class="nav-credits">
				<span class="nav-credit-item"
					><span class="nav-credit-icon">⭐</span>{($currentUser?.points ?? 0).toLocaleString(
						'fr-FR'
					)} Crédits</span
				>
				<span class="nav-credit-sep">·</span>
				<span class="nav-credit-item nav-galactics"
					><Gem size={13} />{($currentUser?.galactics ?? 0).toLocaleString('fr-FR')} Galactics</span
				>
			</div>
			<button class="logout-btn" onclick={logout} title="Déconnexion">
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
					<polyline points="16 17 21 12 16 7" />
					<line x1="21" y1="12" x2="9" y2="12" />
				</svg>
			</button>
		</div>
	</nav>
{/if}

{@render children()}

<style>
	:global(*, *::before, *::after) {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	:global(body) {
		background: #0a0a1a;
		color: #e0e0ff;
		font-family: 'Segoe UI', system-ui, sans-serif;
		min-height: 100vh;
	}

	:global(input) {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(100, 100, 255, 0.3);
		border-radius: 8px;
		color: #e0e0ff;
		padding: 0.6rem 0.9rem;
		font-size: 0.95rem;
		width: 100%;
		outline: none;
		transition: border-color 0.2s;
	}

	:global(input:focus) {
		border-color: rgba(100, 100, 255, 0.7);
	}

	:global(.btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.65rem 1.4rem;
		border-radius: 8px;
		border: none;
		cursor: pointer;
		font-size: 0.95rem;
		font-weight: 600;
		transition:
			opacity 0.2s,
			transform 0.1s;
	}

	:global(.btn:active) {
		transform: scale(0.97);
	}
	:global(.btn:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.btn-primary) {
		background: linear-gradient(135deg, #4a5fff, #7b3ff5);
		color: #fff;
	}

	:global(.btn-secondary) {
		background: rgba(100, 100, 255, 0.15);
		border: 1px solid rgba(100, 100, 255, 0.4);
		color: #a0a8ff;
	}

	:global(.btn-danger) {
		background: rgba(255, 60, 60, 0.2);
		border: 1px solid rgba(255, 60, 60, 0.4);
		color: #ff8080;
	}

	.navbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 1.75rem;
		background: rgba(8, 10, 28, 0.85);
		border-bottom: 1px solid rgba(77, 217, 255, 0.15);
		position: sticky;
		top: 0;
		z-index: 100;
		backdrop-filter: blur(10px);
	}

	.logo {
		font-size: 1.2rem;
		font-weight: 700;
		color: #7b8cff;
		letter-spacing: 1px;
		text-decoration: none;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	:global(.logo svg) {
		color: #7b8cff;
	}

	.nav-center {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 2rem;
	}

	.nav-profile {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.05rem;
	}
	.nav-username {
		font-size: 0.85rem;
		font-weight: 600;
		color: #c0c8ff;
		line-height: 1;
	}
	.nav-grade {
		font-size: 0.7rem;
		font-weight: 600;
		line-height: 1;
	}
	.nav-sep {
		width: 1px;
		height: 24px;
		background: rgba(100, 100, 255, 0.2);
	}

	.nav-right {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.nav-credits {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: #ffd700;
		background: rgba(255, 215, 0, 0.06);
		border: 1px solid rgba(255, 215, 0, 0.15);
		border-radius: 8px;
		padding: 0.3rem 0.7rem;
	}
	.nav-credit-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.nav-credit-icon {
		font-size: 0.9rem;
	}
	.nav-credit-item.nav-galactics {
		color: #c4b5fd;
	}
	:global(.nav-galactics svg) {
		display: inline-block;
		flex-shrink: 0;
	}
	.nav-credit-sep {
		color: rgba(255, 215, 0, 0.3);
	}

	.logout-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: rgba(255, 60, 60, 0.12);
		border: 1px solid rgba(255, 60, 60, 0.3);
		border-radius: 8px;
		color: #ff6b6b;
		cursor: pointer;
		transition:
			background 0.2s,
			border-color 0.2s,
			color 0.2s;
		flex-shrink: 0;
	}
	.logout-btn:hover {
		background: rgba(255, 60, 60, 0.25);
		border-color: rgba(255, 60, 60, 0.6);
		color: #ff4444;
	}
</style>
