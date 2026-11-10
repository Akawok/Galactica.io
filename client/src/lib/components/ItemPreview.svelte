<script lang="ts">
	import { onDestroy } from 'svelte';

	interface Props {
		urls: string[];
		size?: number;
		alt?: string;
	}
	let { urls, size = 64, alt = '' }: Props = $props();

	let frame = $state(0);
	const timer = setInterval(() => {
		frame = urls.length > 1 ? (frame + 1) % urls.length : 0;
	}, 150);
	onDestroy(() => clearInterval(timer));
</script>

<div class="preview" style="width:{size}px; height:{size}px">
	{#each urls as url, i (url)}
		<img src={url} {alt} class:visible={i === frame % urls.length} />
	{/each}
</div>

<style>
	.preview {
		position: relative;
		flex-shrink: 0;
	}
	img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		image-rendering: pixelated;
		visibility: hidden;
	}
	img.visible {
		visibility: visible;
	}
</style>
