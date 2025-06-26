<script lang="ts">
	import { quintOut } from "svelte/easing";
	import { scale, slide } from "svelte/transition";
	import BottomBar from "./BottomBar.svelte";
	import FloatingChat from "./FloatingChat.svelte";

    export let visible = false;
    export let messages: Array<{id: string, type: 'user' | 'ai' | 'system', content: string, timestamp: Date}> = [];
    export let onSubmit: (value: string) => void = () => {};
    export let onNewChat = () => {};
    export let onClose = () => {};
    export let confirmationVisible = false;
    export let floatingBarHeight = 0;

</script>

{#if visible}
<div 
    class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] max-w-[600px] w-[90%] max-sm:bottom-4 max-sm:left-4 max-sm:right-4 max-sm:w-auto max-sm:translate-x-0 transition-transform duration-300 ease-in-out"
    style:transform={confirmationVisible ? `translateY(-${floatingBarHeight + 16}px)` : 'translateY(0)'}
    transition:slide={{ delay: 100, duration: 400, easing: quintOut, axis: 'y' }}
>
    <div 
        class="flex flex-col gap-3"
        transition:scale={{ delay: 200, duration: 300, start: 0.95 }}
    >
        {#if messages.length > 0}
            <FloatingChat {messages} {onNewChat} {onClose} bind:visible={visible} />
        {/if}
        {#if !confirmationVisible}
            <BottomBar {onSubmit} bind:visible={visible} />
        {/if}
    </div>
</div>
{/if} 