<script lang="ts">
	import Gem from '@lucide/svelte/icons/gem';
	const ANIMATED_SPRITES = ['spaceship-01', 'spaceship-02', 'spaceship-03', 'spaceship-04', 'spaceship-05', 'spaceship-06'];

	interface Item {
		_id: string;
		name: string;
		sprite: string;
		type?: string;
		bulletRole?: string | null;
		description?: string;
		price?: number;
		priceGalactics?: number;
	}
	interface Props {
		item: Item;
		active: boolean;
		loading: boolean;
		// Not owned yet: shown with its price, a click asks to buy it
		locked?: boolean;
		selected?: boolean;
		onequip: () => void;
		onhover: (e: MouseEvent) => void;
		onleave: () => void;
	}
	let {
		item,
		active,
		loading,
		locked = false,
		selected = false,
		onequip,
		onhover,
		onleave
	}: Props = $props();

	function spriteSrc(sprite: string) {
		return ANIMATED_SPRITES.includes(sprite)
			? `/assets/${sprite}-f1.png`
			: `/assets/${sprite}.png`;
	}
</script>

<button
	class="loadout-card"
	class:active
	class:locked
	class:selected
	onclick={() => onequip()}
	disabled={loading}
	onmouseenter={onhover}
	onmouseleave={onleave}
>
	<img
		src={spriteSrc(item.sprite)}
		alt={item.name}
		onerror={(e: any) => (e.target.style.display = 'none')}
	/>
	{#if active}<span class="active-dot"></span>{/if}
	<span class="loadout-name">{item.name}</span>
	{#if locked}
		<span class="loadout-price">
			{#if item.price}⭐ {item.price}{/if}
			{#if item.priceGalactics}<span class="gem"><Gem size={9} />{item.priceGalactics}</span>{/if}
		</span>
	{/if}
</button>

<style>
	.loadout-card {
		flex-shrink: 0;
		width: 64px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		background: rgba(5, 8, 22, 0.85);
		border: 1px solid rgba(77, 217, 255, 0.18);
		border-radius: 10px;
		padding: 0.45rem 0.3rem 0.35rem;
		cursor: pointer;
		position: relative;
		transition: all 0.18s ease;
	}
	.loadout-card:hover:not(:disabled):not(.active) {
		border-color: rgba(77, 217, 255, 0.5);
		background: rgba(20, 30, 60, 0.9);
	}
	.loadout-card.active {
		border-color: #4dd9ff;
		box-shadow:
			0 0 12px rgba(77, 217, 255, 0.4),
			inset 0 0 10px rgba(77, 217, 255, 0.08);
		cursor: default;
	}
	.loadout-card img {
		width: 38px;
		height: 38px;
		object-fit: contain;
		image-rendering: pixelated;
	}
	.loadout-name {
		font-size: 0.6rem;
		color: #8090c0;
		text-align: center;
		line-height: 1.2;
		max-width: 56px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.loadout-card.active .loadout-name {
		color: #c0e8ff;
	}
	.loadout-card.locked img {
		opacity: 0.45;
		filter: grayscale(0.7);
	}
	.loadout-card.locked:hover img,
	.loadout-card.locked.selected img {
		opacity: 0.85;
		filter: none;
	}
	.loadout-card.locked {
		border-style: dashed;
	}
	.loadout-card.selected {
		border-color: #ffcc55;
		border-style: solid;
		box-shadow: 0 0 10px rgba(255, 204, 85, 0.35);
	}
	.loadout-price {
		display: flex;
		gap: 0.25rem;
		font-size: 0.58rem;
		font-weight: 700;
		color: #ffcc55;
		white-space: nowrap;
	}
	.loadout-price .gem {
		display: inline-flex;
		align-items: center;
		gap: 1px;
		color: #c9a0ff;
	}
	.active-dot {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #4dd9ff;
		box-shadow: 0 0 6px rgba(77, 217, 255, 0.8);
	}
</style>
