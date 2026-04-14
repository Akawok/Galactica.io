<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		subtitle: string;
		error?: string;
		fields: Snippet;
		submit: Snippet;
		footer: Snippet;
		onsubmit: (e: Event) => void;
	}

	let { title, subtitle, error = '', fields, submit, footer, onsubmit }: Props = $props();
</script>

<div class="auth-page">
	<div class="stars-bg"></div>
	<div class="auth-card">
		<div class="game-logo">🚀</div>
		<h1>{title}</h1>
		<p class="subtitle">{subtitle}</p>

		<form {onsubmit}>
			{@render fields()}

			{#if error}
				<p class="error">{error}</p>
			{/if}

			{@render submit()}
		</form>

		<p class="switch-link">{@render footer()}</p>
	</div>
</div>

<style>
	.auth-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		overflow: hidden;
	}

	.stars-bg {
		position: fixed;
		inset: 0;
		background:
			radial-gradient(ellipse at 20% 50%, rgba(60, 40, 120, 0.3) 0%, transparent 50%),
			radial-gradient(ellipse at 80% 20%, rgba(40, 60, 140, 0.3) 0%, transparent 50%), #0a0a1a;
		z-index: 0;
	}

	.auth-card {
		position: relative;
		z-index: 1;
		background: rgba(15, 15, 40, 0.85);
		border: 1px solid rgba(100, 100, 255, 0.25);
		border-radius: 16px;
		padding: 2.5rem 2rem;
		width: 100%;
		max-width: 380px;
		backdrop-filter: blur(12px);
		box-shadow: 0 0 60px rgba(80, 80, 255, 0.1);
	}

	.game-logo {
		font-size: 3rem;
		text-align: center;
		margin-bottom: 0.5rem;
	}

	h1 {
		text-align: center;
		font-size: 1.6rem;
		color: #7b8cff;
		margin-bottom: 0.25rem;
		letter-spacing: 2px;
	}

	.subtitle {
		text-align: center;
		color: #6870a0;
		font-size: 0.85rem;
		margin-bottom: 2rem;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.error {
		color: #ff6b6b;
		font-size: 0.85rem;
		text-align: center;
		padding: 0.5rem;
		background: rgba(255, 60, 60, 0.1);
		border-radius: 6px;
	}

	.switch-link {
		text-align: center;
		margin-top: 1.5rem;
		font-size: 0.85rem;
		color: #6870a0;
	}

	.switch-link :global(a) {
		color: #7b8cff;
		text-decoration: none;
		font-weight: 600;
	}

	.switch-link :global(a:hover) {
		text-decoration: underline;
	}
</style>
