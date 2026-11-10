<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Item } from '$lib/itemFilter';

	interface Props {
		item: Item;
		highlight?: boolean;
		footer: Snippet<[Item]>;
		topRight?: Snippet<[Item]>;
	}

	let { item, highlight = false, footer, topRight }: Props = $props();
</script>

<div class="card" class:equipped={highlight}>
	<div class="card-img">
		<img
			src={`/assets/${item.sprite}.png`}
			alt={item.name}
			onerror={(e: any) => (e.target.style.display = 'none')}
		/>
		{#if topRight}{@render topRight(item)}{/if}
	</div>
	<div class="card-body">
		<h3>{item.name}</h3>
		<p class="desc">{item.description}</p>
		<div class="card-footer">{@render footer(item)}</div>
	</div>
</div>

<style>
	.card {
		background: rgba(15, 15, 40, 0.7);
		border: 1px solid rgba(100, 100, 255, 0.2);
		border-radius: 12px;
		overflow: hidden;
		transition:
			border-color 0.2s,
			transform 0.15s;
	}

	.card:hover {
		border-color: rgba(100, 100, 255, 0.45);
		transform: translateY(-2px);
	}

	.card.equipped {
		border-color: rgba(100, 255, 100, 0.45);
		box-shadow: 0 0 16px rgba(60, 220, 60, 0.08);
	}

	.card-img {
		position: relative;
		height: 120px;
		background: rgba(5, 5, 25, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.card-img img {
		max-width: 80px;
		max-height: 80px;
		object-fit: contain;
		image-rendering: pixelated;
	}

	.card-body {
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	h3 {
		font-size: 0.95rem;
		color: #c0c8ff;
	}

	.desc {
		font-size: 0.78rem;
		color: #6870a0;
		line-height: 1.4;
	}

	.card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.5rem;
	}

	.card-footer :global(.btn) {
		padding: 0.35rem 0.9rem;
		font-size: 0.82rem;
	}
</style>
