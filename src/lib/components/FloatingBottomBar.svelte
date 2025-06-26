<script lang="ts">
    import { Button, Chip } from "m3-svelte";
    import { fly, scale, fade } from 'svelte/transition';
    import { backOut, quintOut } from 'svelte/easing';
    
    export let visible = false;
    export let message = "Move item to destination?";
    export let risk: 'low' | 'high' = 'low';
    export let onAccept = () => {};
    export let onDeny = () => {};
    
    function handleAccept() {
        onAccept();
    }
    
    function handleDeny() {
        onDeny();
    }
</script>

{#if visible}
    <div 
        class="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-[200] max-w-[800px] w-[90%] md:bottom-6 md:w-[calc(100%-2rem)] max-[480px]:bottom-20"
        transition:fly={{ y: 50, duration: 400, easing: backOut }}
    >
        <div 
            class="flex items-center justify-between p-6 gap-4 backdrop-blur-[16px] md:py-3 md:px-4 md:gap-3 max-[640px]:flex-col max-[640px]:gap-4 max-[640px]:p-4"
            style="background: rgb(var(--m3-scheme-surface-container-high)); border: 2px solid {risk === 'high' ? 'rgb(var(--m3-scheme-error))' : 'rgb(var(--m3-scheme-outline-variant))'}; border-radius: var(--m3-util-rounding-extra-large); box-shadow: var(--m3-util-elevation-4);"
            transition:scale={{ delay: 100, duration: 300, start: 0.9 }}
        >
            <div 
                class="flex-shrink-0 max-[640px]:w-full"
                transition:scale={{ delay: 200, duration: 250, start: 0.8 }}
            >
                <Button 
                    variant="outlined" 
                    iconType="left"
                    click={handleDeny}
                    style="color: rgb(var(--m3-scheme-error)); border-color: rgb(var(--m3-scheme-error));"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24">
                        <path fill="currentColor" d="m12 13.4l-4.9 4.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.9-4.9l-4.9-4.9q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l4.9 4.9l4.9-4.9q.275-.275.7-.275t.7.275t.275.7t-.275.7L13.4 12l4.9 4.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275z" />
                    </svg>
                    Deny
                </Button>
            </div>
            
            <div 
                class="flex-1 flex justify-center items-center min-w-0 max-[640px]:order-first max-[640px]:w-full"
                transition:fade={{ delay: 300, duration: 300 }}
            >
                <div class="text-center">
                    <Chip 
                        variant="general" 
                        click={() => {}}
                        style="max-width: 300px; text-align: center; box-shadow: var(--m3-util-elevation-2);"
                    >
                        {message}
                    </Chip>
                    {#if risk === 'high'}
                        <div class="risk-warning">
                            <span style="color: rgb(var(--m3-scheme-error)); font-size: 0.75rem; margin-top: 0.25rem; display: block;">
                                ⚠️ HIGH RISK - Click to confirm
                            </span>
                        </div>
                    {:else}
                        <div class="risk-info">
                            <span style="color: rgb(var(--m3-scheme-on-surface-variant)); font-size: 0.75rem; margin-top: 0.25rem; display: block;">
                                Press Enter to confirm
                            </span>
                        </div>
                    {/if}
                </div>
            </div>
            
            <div 
                class="flex-shrink-0 max-[640px]:w-full"
                transition:scale={{ delay: 400, duration: 250, start: 0.8 }}
            >
                <Button 
                    variant="filled" 
                    iconType="left"
                    click={handleAccept}
                    style="background: rgb(var(--m3-scheme-tertiary)); color: rgb(var(--m3-scheme-on-tertiary));"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24">
                        <path fill="currentColor" d="m9.55 15.15l8.475-8.475q.3-.3.7-.3t.7.3t.3.713t-.3.712l-9.175 9.2q-.3.3-.7.3t-.7-.3L4.55 13q-.3-.3-.288-.712t.313-.713t.713-.3t.712.3z" />
                    </svg>
                    Accept
                </Button>
            </div>
        </div>
    </div>
{/if}