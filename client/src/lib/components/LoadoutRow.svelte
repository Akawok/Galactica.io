<script lang="ts">
	import LoadoutCard from './LoadoutCard.svelte';
	import Gem from '@lucide/svelte/icons/gem';
	import type { Component } from 'svelte';

	interface Item {
		_id: string;
		name: string;
		type: string;
		sprite: string;
		bulletRole?: string | null;
		description?: string;
		price?: number;
		priceGalactics?: number;
	}
	interface Props {
		label: string;
		icon?: Component<{ size?: number | string }>;
		accent?: string;
		items: Item[];
		activeSprite: string | undefined;
		loadingId: string | null;
		emptyText: string;
		// Items for sale, shown after the owned ones
		shopItems?: Item[];
		buyingId?: string | null;
		canAfford?: (item: Item) => boolean;
		onbuy?: (item: Item) => Promise<boolean>;
		onequip: (item: Item) => void;
		onhover: (e: MouseEvent, item: Item) => void;
		onleave: () => void;
	}
	let {
		label,
		icon: Icon,
		accent = '#7080b0',
		items,
		activeSprite,
		loadingId,
		emptyText,
		shopItems = [],
		buyingId = null,
		canAfford = () => true,
		onbuy,
		onequip,
		onhover,
		onleave
	}: Props = $props();

	let pending = $state<Item | null>(null);

	async function confirmBuy() {
		if (!pending || !onbuy) return;
		const item = pending;
		const bought = await onbuy(item);
		if (bought) {
			pending = null;
			onequip(item);
		}
	}
</script>

<div class="loadout-row">
	<span class="loadout-label">
		{#if Icon}
			<span class="loadout-icon" style="color: {accent}"><Icon size={12} /></span>
		{/if}
		{label}
	</span>
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
			{#if shopItems.length === 0}<p class="empty-text">{emptyText}</p>{/if}
		{/each}
		{#each shopItems as item (item._id)}
			<LoadoutCard
				{item}
				active={false}
				locked
				selected={pending?._id === item._id}
				loading={buyingId === item._id}
				onequip={() => (pending = pending?._id === item._id ? null : item)}
				onhover={(e) => onhover(e, item)}
				{onleave}
			/>
		{/each}
	</div>
	{#if pending}
		{@const affordable = canAfford(pending)}
		<div class="buy-bar">
			<span class="buy-text">
				{pending.name} :
				{#if pending.price}<span class="buy-credits">⭐ {pending.price}</span>{/if}
				{#if pending.priceGalactics}
					<span class="buy-gems"><Gem size={11} />{pending.priceGalactics}</span>
				{/if}
			</span>
			{#if affordable}
				<button class="btn btn-primary btn-sm" disabled={!!buyingId} onclick={confirmBuy}>
					{buyingId === pending._id ? '…' : 'Acheter'}
				</button>
			{:else}
				<span class="buy-short">Pas assez</span>
			{/if}
			<button class="buy-cancel" onclick={() => (pending = null)}>Annuler</button>
		</div>
	{/if}
</div>

<style>
	.loadout-row {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.loadout-label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: #7080b0;
		text-transform: uppercase;
		letter-spacing: 0.8px;
	}
	.loadout-icon {
		display: inline-flex;
		align-items: center;
		filter: drop-shadow(0 0 4px currentColor);
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
	.buy-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.4rem 0.55rem;
		border: 1px solid rgba(255, 204, 85, 0.35);
		border-radius: 8px;
		background: rgba(255, 204, 85, 0.06);
		font-size: 0.75rem;
		color: #c0c8e8;
	}
	.buy-text {
		flex: 1;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}
	.buy-credits {
		color: #ffcc55;
		font-weight: 700;
	}
	.buy-gems {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		color: #c9a0ff;
		font-weight: 700;
	}
	.buy-short {
		color: #ff7788;
		font-weight: 600;
	}
	.buy-cancel {
		background: none;
		border: none;
		color: #7080b0;
		font-size: 0.72rem;
		cursor: pointer;
	}
	.buy-cancel:hover {
		color: #c0c8e8;
	}
	.empty-text {
		font-size: 0.78rem;
		color: #404870;
		font-style: italic;
	}
</style>
