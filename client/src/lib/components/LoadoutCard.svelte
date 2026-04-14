<script lang="ts">
	interface Item {
		_id: string;
		name: string;
		sprite: string;
		type?: string;
		bulletRole?: string | null;
		description?: string;
		stats?: Record<string, number>;
		price?: number;
	}
	interface Props {
		item: Item;
		active: boolean;
		loading: boolean;
		onequip: () => void;
		onhover: (e: MouseEvent) => void;
		onleave: () => void;
	}
	let { item, active, loading, onequip, onhover, onleave }: Props = $props();
</script>

<button
	class="loadout-card"
	class:active
	onclick={() => !active && onequip()}
	disabled={loading}
	onmouseenter={onhover}
	onmouseleave={onleave}
>
	<img
		src={`/assets/${item.sprite}.png`}
		alt={item.name}
		onerror={(e: any) => (e.target.style.display = 'none')}
	/>
	{#if active}<span class="active-dot"></span>{/if}
	<span class="loadout-name">{item.name}</span>
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
