<script lang="ts">
    import '../app.css';
    import '../main.css';

    import BottomBar from '$lib/components/BottomBar.svelte';
    import FloatingBottomBar from '$lib/components/FloatingBottomBar.svelte';
</script>

<div class="app-container">
    <slot />
    <FloatingBottomBar />
    <BottomBar />
</div>