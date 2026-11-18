<script lang="ts">
	import { page } from '$app/stores';
	import GameScreen from '$lib/components/GameScreen.svelte';
</script>

<!-- SvelteKit reuses a page when only its params change: a rematch room needs a fresh screen -->
{#key $page.params.roomId}
	<GameScreen roomId={$page.params.roomId ?? ''} isSpectator={$page.url.searchParams.has('spectate')} />
{/key}
