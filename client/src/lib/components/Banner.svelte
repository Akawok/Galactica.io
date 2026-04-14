<script lang="ts">
	interface Props {
		text: string;
		ok: boolean;
	}

	let { text, ok }: Props = $props();
</script>

<div class="banner" class:ok class:err={!ok}>{text}</div>

<style>
	.banner {
		padding: 0.7rem 1rem;
		border-radius: 8px;
		margin-bottom: 1rem;
		font-size: 0.9rem;
		text-align: center;
	}

	.banner.ok {
		background: rgba(60, 200, 60, 0.15);
		color: #80e880;
		border: 1px solid rgba(60, 200, 60, 0.3);
	}

	.banner.err {
		background: rgba(255, 60, 60, 0.15);
		color: #ff8888;
		border: 1px solid rgba(255, 60, 60, 0.3);
	}
</style>
