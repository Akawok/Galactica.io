<script lang="ts">
	interface Item {
		name: string;
		sprite: string;
		type: string;
		bulletRole?: string | null;
		description?: string;
		stats?: Record<string, number>;
	}
	interface Props {
		item: Item;
		x: number;
		y: number;
		activeShip: string | undefined;
		activeBullet: string | undefined;
		activeBulletSecondary: string | undefined;
	}
	let { item, x, y, activeShip, activeBullet, activeBulletSecondary }: Props = $props();

	const STAT_LABELS: Record<string, string> = {
		damage: 'Dégâts',
		cooldown: 'Cooldown',
		speed: 'Vitesse',
		hp: 'HP',
		energy: 'Énergie'
	};
	const statLabel = (key: string) => STAT_LABELS[key] ?? key;

	const ANIMATED_SPRITES = ['spaceship-01', 'spaceship-02', 'spaceship-03', 'spaceship-04', 'spaceship-05', 'spaceship-06'];
	function spriteSrc(sprite: string) {
		return ANIMATED_SPRITES.includes(sprite)
			? `/assets/${sprite}-f1.png`
			: `/assets/${sprite}.png`;
	}

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
			src={spriteSrc(item.sprite)}
			alt={item.name}
			onerror={(e: any) => (e.target.style.display = 'none')}
		/>
		{#if active}<span class="popover-badge">Équipé</span>{/if}
	</div>
	<div class="popover-body">
		<h4>{item.name}</h4>
		{#if item.description}<p class="popover-desc">{item.description}</p>{/if}
		{#if item.stats && Object.keys(item.stats).length > 0}
			<div class="popover-stats">
				{#each Object.entries(item.stats) as [key, val]}
					<span class="popover-stat">{statLabel(key)}: <strong>{val}</strong></span>
				{/each}
			</div>
		{/if}
		{#if !active}
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
	.popover-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.popover-stat {
		font-size: 0.68rem;
		background: rgba(100, 100, 255, 0.1);
		border-radius: 4px;
		padding: 0.1rem 0.35rem;
		color: #8090c0;
	}
	.popover-stat strong {
		color: #a0a8ff;
	}
	.popover-hint {
		font-size: 0.7rem;
		color: #404870;
		font-style: italic;
	}
</style>
