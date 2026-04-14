<script lang="ts">
	import { ITEM_TABS, type ItemTab } from '$lib/itemFilter';

	interface Props {
		value: ItemTab;
		onchange: (tab: ItemTab) => void;
	}

	let { value, onchange }: Props = $props();
</script>

<div class="tabs">
	{#each ITEM_TABS as t}
		<button class="tab" class:active={value === t.key} onclick={() => onchange(t.key)}>
			{t.label}
		</button>
	{/each}
</div>

<style>
	.tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
		border-bottom: 1px solid rgba(100, 100, 255, 0.15);
		padding-bottom: 0.75rem;
	}

	.tab {
		padding: 0.45rem 1.1rem;
		border-radius: 8px;
		border: 1px solid rgba(100, 100, 255, 0.2);
		background: transparent;
		color: #8090c0;
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.tab:hover {
		color: #c0c8ff;
		border-color: rgba(100, 100, 255, 0.4);
	}

	.tab.active {
		background: rgba(100, 100, 255, 0.18);
		border-color: rgba(100, 100, 255, 0.55);
		color: #d0d8ff;
		font-weight: 600;
	}
</style>
