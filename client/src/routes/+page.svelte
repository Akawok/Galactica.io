<script lang="ts">
	import { goto } from '$app/navigation';
	import { isAuthenticated } from '$lib/stores/auth';

	$effect(() => {
		if ($isAuthenticated) goto('/lobby');
		else goto('/login');
	});
</script>
