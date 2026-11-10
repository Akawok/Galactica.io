<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Item } from '$lib/itemFilter';
	import ItemCard from './ItemCard.svelte';

	interface Props {
		items: Item[];
		isHighlighted?: (item: Item) => boolean;
		footer: Snippet<[Item]>;
		topRight?: Snippet<[Item]>;
	}

	let { items, isHighlighted, footer, topRight }: Props = $props();
</script>

<div class="grid">
	{#each items as item (item._id)}
		<ItemCard {item} highlight={isHighlighted ? isHighlighted(item) : false} {footer} {topRight} />
	{/each}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 1rem;
	}
</style>
