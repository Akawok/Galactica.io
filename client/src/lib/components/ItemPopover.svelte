<script lang="ts">
	import { itemImageUrl } from '$lib/itemImages';

	interface Item {
		name: string;
		sprite: string;
		type: string;
		frames?: number;
		imageVersion?: number;
		bulletRole?: string | null;
		description?: string;
	}
	interface Props {
		item: Item;
		x: number;
		y: number;
		activeShip: string | undefined;
		activeBullet: string | undefined;
		activeBulletSecondary: string | undefined;
		owned?: boolean;
	}
	let {
		item,
		x,
		y,
		activeShip,
		activeBullet,
		activeBulletSecondary,
		owned = true
	}: Props = $props();

	const active = $derived(
		item.type === 'ship'
			? activeShip === item.sprite
			: item.bulletRole === 'secondary'
				? activeBulletSecondary === item.sprite
				: activeBullet === item.sprite
	);
</script>

<div class="item-popover" style="left:{x}px; top:{y}px;">
	<div class="popover-img">
		<img
			src={itemImageUrl(item)}
			alt={item.name}
			onerror={(e: any) => (e.target.style.display = 'none')}
		/>
		{#if active}<span class="popover-badge">Équipé</span>{/if}
	</div>
	<div class="popover-body">
		<h4>{item.name}</h4>
		{#if item.description}<p class="popover-desc">{item.description}</p>{/if}
		{#if !owned}
			<span class="popover-hint">Clic pour acheter</span>
		{:else if !active}
			<span class="popover-hint">Clic pour équiper</span>
		{/if}
	</div>
</div>

<style>
	.item-popover {
		position: fixed;
		transform: translateY(-50%);
		width: 190px;
		background: rgba(10, 14, 36, 0.97);
		border: 1px solid rgba(77, 217, 255, 0.3);
		border-radius: 12px;
		overflow: hidden;
		box-shadow:
			0 8px 32px rgba(0, 0, 0, 0.7),
			0 0 0 1px rgba(77, 217, 255, 0.08);
		z-index: 9999;
		pointer-events: none;
	}
	.popover-img {
		position: relative;
		height: 100px;
		background: rgba(5, 5, 25, 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.popover-img img {
		max-width: 70px;
		max-height: 70px;
		object-fit: contain;
		image-rendering: pixelated;
	}
	.popover-badge {
		position: absolute;
		top: 6px;
		right: 6px;
		background: rgba(60, 200, 60, 0.25);
		color: #80e880;
		border: 1px solid rgba(60, 200, 60, 0.3);
		border-radius: 8px;
		padding: 0.1rem 0.4rem;
		font-size: 0.65rem;
		font-weight: 600;
	}
	.popover-body {
		padding: 0.65rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.popover-body h4 {
		font-size: 0.88rem;
		color: #c0c8ff;
		font-weight: 700;
		margin: 0;
	}
	.popover-desc {
		font-size: 0.72rem;
		color: #6870a0;
		line-height: 1.4;
		margin: 0;
	}
	.popover-hint {
		font-size: 0.7rem;
		color: #404870;
		font-style: italic;
	}
</style>
