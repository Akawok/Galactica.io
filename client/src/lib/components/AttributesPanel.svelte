<script lang="ts">
	import { untrack } from 'svelte';
	import { api } from '$lib/api';
	import { BRANCHES } from '$lib/attributesUi';
	import {
		ATTRIBUTE_KEYS,
		ATTRIBUTE_MAX,
		PERK_THRESHOLDS,
		POINTS_START_LEVEL,
		branchPoints,
		computePerks,
		spentPoints,
		totalPoints,
		type AttributeKey,
		type Attributes
	} from '$lib/shared/attributes';
	import Gem from '@lucide/svelte/icons/gem';

	interface Props {
		saved: Attributes;
		level: number;
		galactics: number;
		respecCost: number;
		onchange: (update: { attributes: Attributes; galactics?: number; respecCost?: number }) => void;
	}
	let { saved, level, galactics, respecCost, onchange }: Props = $props();

	let draft = $state<Attributes>(untrack(() => ({ ...saved })));
	let busy = $state(false);
	let error = $state<string | null>(null);
	let confirmReset = $state(false);

	// Only a real change of the saved allocation discards the draft, not every parent re-render
	const savedKey = $derived(ATTRIBUTE_KEYS.map((k) => saved[k]).join(','));
	$effect(() => {
		void savedKey;
		draft = untrack(() => ({ ...saved }));
	});

	const available = $derived(totalPoints(level) - spentPoints(draft));
	const dirty = $derived(ATTRIBUTE_KEYS.some((k) => draft[k] !== saved[k]));
	const perks = $derived(computePerks(draft));
	const savedPerks = $derived(computePerks(saved));

	function add(key: AttributeKey) {
		if (available <= 0 || draft[key] >= ATTRIBUTE_MAX) return;
		draft = { ...draft, [key]: draft[key] + 1 };
	}

	function remove(key: AttributeKey) {
		if (draft[key] <= saved[key]) return;
		draft = { ...draft, [key]: draft[key] - 1 };
	}

	async function save() {
		if (busy) return;
		busy = true;
		error = null;
		try {
			const res = await api.attributes.save(draft);
			onchange({ attributes: res.attributes });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Enregistrement impossible';
		} finally {
			busy = false;
		}
	}

	async function reset() {
		if (busy) return;
		if (!confirmReset) {
			confirmReset = true;
			return;
		}
		busy = true;
		error = null;
		confirmReset = false;
		try {
			const res = await api.attributes.reset();
			onchange(res);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Remise à zéro impossible';
		} finally {
			busy = false;
		}
	}
</script>

<div class="attr-panel">
	<div class="attr-head">
		<span class="attr-available" class:has-points={available > 0}>
			<strong>{available}</strong>
			{available > 1 ? 'points à placer' : 'point à placer'}
		</span>
		<span class="attr-total">{spentPoints(draft)} / {totalPoints(level)}</span>
	</div>

	{#if level < POINTS_START_LEVEL}
		<p class="attr-locked">Tes premiers points arrivent au niveau {POINTS_START_LEVEL}.</p>
	{/if}

	{#if error}
		<p class="attr-error" role="alert">{error}</p>
	{/if}

	{#each BRANCHES as branch (branch.key)}
		{@const pts = branchPoints(draft, branch.key)}
		<section class="branch" style="--accent: {branch.accent}">
			<div class="branch-head">
				<span class="branch-name">{branch.label}</span>
				<span class="branch-pts">{pts} pts</span>
			</div>
			<div class="branch-track">
				<div
					class="branch-fill"
					style="width: {Math.min(100, (pts / PERK_THRESHOLDS[1]) * 100)}%"
				></div>
				<span class="branch-tick" style="left: {(PERK_THRESHOLDS[0] / PERK_THRESHOLDS[1]) * 100}%"
				></span>
			</div>

			{#each branch.attributes as attr (attr.key)}
				<div class="attr-row">
					<div class="attr-info">
						<span class="attr-name">{attr.label}</span>
						<span class="attr-effect">{attr.effect(draft[attr.key])}</span>
					</div>
					<div class="attr-ctrl">
						<button
							class="step"
							aria-label="Retirer un point en {attr.label}"
							disabled={busy || draft[attr.key] <= saved[attr.key]}
							onclick={() => remove(attr.key)}>−</button
						>
						<span class="attr-val">{draft[attr.key]}<small>/{ATTRIBUTE_MAX}</small></span>
						<button
							class="step"
							aria-label="Ajouter un point en {attr.label}"
							disabled={busy || available <= 0 || draft[attr.key] >= ATTRIBUTE_MAX}
							onclick={() => add(attr.key)}>+</button
						>
					</div>
				</div>
			{/each}

			<div class="perks">
				{#each branch.perks as perk, i (perk.key)}
					<div class="perk" class:unlocked={perks[perk.key]}>
						<span class="perk-req">{PERK_THRESHOLDS[i]}</span>
						<div class="perk-text">
							<span class="perk-name">
								{perk.label}
								{#if perks[perk.key] && !savedPerks[perk.key]}<em>nouveau</em>{/if}
							</span>
							<span class="perk-desc">{perk.description}</span>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/each}

	<div class="attr-actions">
		{#if dirty}
			<button
				class="btn btn-secondary btn-sm"
				disabled={busy}
				onclick={() => (draft = { ...saved })}>Annuler</button
			>
			<button class="btn btn-primary btn-sm" disabled={busy} onclick={save}>
				{busy ? '…' : 'Valider'}
			</button>
		{:else}
			<button
				class="btn btn-secondary btn-sm reset-btn"
				class:confirm={confirmReset}
				disabled={busy || spentPoints(saved) === 0 || galactics < respecCost}
				onclick={reset}
				onmouseleave={() => (confirmReset = false)}
			>
				{#if confirmReset}
					Confirmer ?
				{:else}
					Remise à zéro
				{/if}
				<span class="reset-cost">
					{#if respecCost === 0}gratuite{:else}<Gem size={11} /> {respecCost}{/if}
				</span>
			</button>
		{/if}
	</div>
</div>

<style>
	.attr-panel {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding-right: 0.25rem;
		scrollbar-width: thin;
		scrollbar-color: rgba(77, 217, 255, 0.15) transparent;
	}

	.attr-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		font-size: 0.8rem;
		color: #8090c0;
	}

	.attr-available strong {
		font-size: 1.1rem;
		color: #a0a8ff;
		margin-right: 0.2rem;
	}

	.attr-available.has-points strong {
		color: #4dd9ff;
		text-shadow: 0 0 10px rgba(77, 217, 255, 0.6);
	}

	.attr-total {
		font-size: 0.72rem;
		color: #5060a0;
	}

	.attr-locked {
		font-size: 0.75rem;
		color: #8090c0;
		background: rgba(77, 217, 255, 0.06);
		border: 1px solid rgba(77, 217, 255, 0.2);
		border-radius: 6px;
		padding: 0.4rem 0.5rem;
	}

	.attr-error {
		font-size: 0.75rem;
		color: #ff5566;
		background: rgba(255, 85, 102, 0.08);
		border: 1px solid rgba(255, 85, 102, 0.25);
		border-radius: 6px;
		padding: 0.35rem 0.5rem;
	}

	.branch {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.65rem;
		background: rgba(5, 8, 22, 0.6);
		border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
		border-radius: 10px;
	}

	.branch-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.branch-name {
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.branch-pts {
		font-size: 0.72rem;
		color: #6870a0;
	}

	.branch-track {
		position: relative;
		height: 4px;
		background: rgba(100, 100, 255, 0.12);
		border-radius: 2px;
	}

	.branch-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 2px;
		box-shadow: 0 0 8px var(--accent);
		transition: width 0.2s;
	}

	.branch-tick {
		position: absolute;
		top: -2px;
		width: 2px;
		height: 8px;
		background: #c0c8ff;
		opacity: 0.6;
	}

	.attr-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.attr-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.attr-name {
		font-size: 0.8rem;
		color: #c0c8ff;
	}

	.attr-effect {
		font-size: 0.68rem;
		color: #6870a0;
	}

	.attr-ctrl {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-shrink: 0;
	}

	.attr-val {
		min-width: 2.4rem;
		text-align: center;
		font-size: 0.85rem;
		font-weight: 700;
		color: #e0e8ff;
	}

	.attr-val small {
		font-size: 0.65rem;
		font-weight: 400;
		color: #5060a0;
	}

	.step {
		width: 22px;
		height: 22px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
		background: rgba(10, 14, 36, 0.9);
		color: var(--accent);
		font-size: 0.9rem;
		line-height: 1;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s;
	}

	.step:hover:not(:disabled) {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		border-color: var(--accent);
	}

	.step:disabled {
		opacity: 0.25;
		cursor: default;
	}

	.perks {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-top: 0.2rem;
	}

	.perk {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		padding: 0.35rem 0.45rem;
		border-radius: 6px;
		background: rgba(100, 100, 255, 0.04);
		opacity: 0.45;
		transition: opacity 0.2s;
	}

	.perk.unlocked {
		opacity: 1;
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.perk-req {
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		font-size: 0.65rem;
		font-weight: 700;
		color: var(--accent);
		border: 1px solid var(--accent);
	}

	.perk-text {
		display: flex;
		flex-direction: column;
	}

	.perk-name {
		font-size: 0.75rem;
		font-weight: 600;
		color: #e0e8ff;
	}

	.perk-name em {
		font-style: normal;
		font-size: 0.6rem;
		text-transform: uppercase;
		color: var(--accent);
		margin-left: 0.3rem;
	}

	.perk-desc {
		font-size: 0.66rem;
		color: #8090c0;
		line-height: 1.35;
	}

	.attr-actions {
		position: sticky;
		bottom: 0;
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0.5rem 0 0.1rem;
		background: rgba(10, 14, 36, 0.95);
	}

	.reset-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.reset-btn.confirm {
		border-color: #ff5566;
		color: #ff5566;
	}

	.reset-cost {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.7rem;
		opacity: 0.8;
	}
</style>
