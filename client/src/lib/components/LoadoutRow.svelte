<script lang="ts">
	import LoadoutCard from './LoadoutCard.svelte';

	interface Item {
		_id: string;
		name: string;
		type: string;
		sprite: string;
		bulletRole?: string | null;
		description?: string;
		stats?: Record<string, number>;
		price?: number;
	}
	interface Props {
		label: string;
		items: Item[];
		activeSprite: string | undefined;
		loadingId: string | null;
		emptyText: string;
		onequip: (item: Item) => void;
		onhover: (e: MouseEvent, item: Item) => void;
		onleave: () => void;
	}
	let { label, items, activeSprite, loadingId, emptyText, onequip, onhover, onleave }: Props =
		$props();
</script>

<div class="loadout-row">
	<span class="loadout-label">{label}</span>
	<div class="loadout-scroll">
		{#each items as item (item._id)}
			<LoadoutCard
				{item}
				active={activeSprite === item.sprite}
				loading={loadingId === item._id}
				onequip={() => onequip(item)}
				onhover={(e) => onhover(e, item)}
				{onleave}
			/>
		{:else}
			<p class="empty-text">{emptyText}</p>
		{/each}
	</div>
</div>

<style>
	.loadout-row {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.loadout-label {
		font-size: 0.72rem;
		font-weight: 600;
		color: #7080b0;
		text-transform: uppercase;
		letter-spacing: 0.8px;
	}
	.loadout-scroll {
		display: flex;
		gap: 0.5rem;
		overflow-x: auto;
		overflow-y: visible;
		padding-bottom: 4px;
		padding-top: 4px;
		scrollbar-width: thin;
		scrollbar-color: rgba(77, 217, 255, 0.2) transparent;
	}
	.empty-text {
		font-size: 0.78rem;
		color: #404870;
		font-style: italic;
	}
</style>
