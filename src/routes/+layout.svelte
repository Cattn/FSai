<script lang="ts">
    import '../app.css';
    import '../main.css';
     import { onMount } from 'svelte';

    import BottomBar from '$lib/components/BottomBar.svelte';
    import FloatingBottomBar from '$lib/components/FloatingBottomBar.svelte';

    let bottomBarVisible = false;
    let floatingBarVisible = false;

    function handleBottomBarSubmit(inputValue: string) {
        console.log('Submitted:', inputValue);
        // Hide bottom bar and show floating bar
        bottomBarVisible = false;
        floatingBarVisible = true;
    }

    function handleFloatingBarAccept() {
        console.log('Action accepted');
        floatingBarVisible = false;
    }

    function handleFloatingBarDeny() {
        console.log('Action denied');
        floatingBarVisible = false;
    }

    onMount(() => {
        function handleKeydown(event: KeyboardEvent) {
            // Check for Cmd+K (Mac) or Ctrl+K (Windows/Linux)
            if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
                event.preventDefault();
                bottomBarVisible = true;
            }
            
            // Hide bottom bar on Escape
            if (event.key === 'Escape') {
                bottomBarVisible = false;
                floatingBarVisible = false;
            }
        }

        document.addEventListener('keydown', handleKeydown);

        return () => {
            document.removeEventListener('keydown', handleKeydown);
        };
    });
</script>

<div class="app-container">
    <slot />
    <FloatingBottomBar 
        visible={floatingBarVisible}
        message="Move item to destination?"
        onAccept={handleFloatingBarAccept}
        onDeny={handleFloatingBarDeny}
    />
    <BottomBar 
        visible={bottomBarVisible}
        onSubmit={handleBottomBarSubmit}
    />
</div>