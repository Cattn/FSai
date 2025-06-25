<script lang="ts">
    import '../app.css';
    import '../main.css';

    import BottomBar from '$lib/components/BottomBar.svelte';
</script>

<div class="app-container">
    <slot />
    <BottomBar />
</div>