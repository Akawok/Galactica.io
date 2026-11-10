<script lang="ts">
	import { getGrade } from '$lib/grades';

	let { level }: { level: number | undefined } = $props();
	const grade = $derived(getGrade(level ?? 1));
</script>

<span class="grade-badge" style="--grade: {grade.color}" title="Niveau {level ?? 1}">{grade.label}</span>

<style>
	.grade-badge {
		display: inline-block;
		flex-shrink: 0;
		padding: 0 0.35rem;
		border: 1px solid color-mix(in srgb, var(--grade) 55%, transparent);
		border-radius: 4px;
		background: color-mix(in srgb, var(--grade) 14%, transparent);
		color: var(--grade);
		font-size: 0.62rem;
		font-weight: 700;
		line-height: 1.5;
		letter-spacing: 0.3px;
		white-space: nowrap;
		vertical-align: middle;
	}
</style>
