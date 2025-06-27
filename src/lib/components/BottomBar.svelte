<script lang="ts">
    import { Button } from "m3-svelte";
    import { slide, scale } from 'svelte/transition';
    import { quintOut } from 'svelte/easing';
    
    let {
        visible = $bindable(false),
        onSubmit = (value: string) => {}
    } = $props<{
        visible?: boolean;
        onSubmit?: (value: string) => void;
    }>();
    
    let inputValue = $state('');
    let inputElement: HTMLInputElement | null = $state(null);
    
    $effect(() => {
        if (visible && inputElement) {
            setTimeout(() => {
                if (inputElement) {
                    inputElement.focus();
                }
            }, 450);
        }
    });
    
    function handleSubmit() {
        if (inputValue.trim()) {
            onSubmit(inputValue);
            inputValue = '';
        }
    }
    
    function handleKeydown(event: KeyboardEvent) {
        if (event.key === 'Enter') {
            handleSubmit();
        }
    }
</script>

{#if visible}
    <div 
        class="w-full p-3 backdrop-blur-[12px] max-[480px]:p-2"
        style="background: rgb(var(--m3-scheme-surface-container)); border: 1px solid rgb(var(--m3-scheme-outline-variant)); border-radius: var(--m3-util-rounding-extra-large); box-shadow: var(--m3-util-elevation-3);"
    >
        <div class="flex items-center gap-3 w-full max-[480px]:gap-2">
            <div 
                class="flex-1 min-w-0"
                transition:scale={{ delay: 200, duration: 300, start: 0.8 }}
            >
                <input
                    bind:this={inputElement}
                    bind:value={inputValue}
                    placeholder="What would you like to do?"
                    class="w-full py-3.5 px-5 outline-none box-border transition-all duration-200 ease-in-out max-[480px]:py-3 max-[480px]:px-4 max-[480px]:text-[0.8125rem]"
                    style="background: rgb(var(--m3-scheme-surface-container-low)); border: 1px solid transparent; border-radius: var(--m3-util-rounding-large); color: rgb(var(--m3-scheme-on-surface)); font-family: var(--m3-font); font-size: 0.875rem; font-weight: 400; line-height: 1.5;"
                    onkeydown={handleKeydown}
                />
            </div>
            
            <div 
                class="flex-shrink-0"
                transition:scale={{ delay: 300, duration: 300, start: 0.8 }}
            >
                <Button
                    variant="filled"
                    iconType="full"
                    click={handleSubmit}
                    disabled={!inputValue.trim()}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M4.4 19.425q-.5.2-.95-.088T3 18.5V14l8-2l-8-2V5.5q0-.55.45-.837t.95-.088l15.4 6.5q.625.275.625.925t-.625.925z" />
                    </svg>
                </Button>
            </div>
        </div>
    </div>
{/if}

<style>
    input::placeholder {
        color: rgb(var(--m3-scheme-on-surface-variant));
        opacity: 0.8;
    }

    input:focus {
        background: rgb(var(--m3-scheme-surface)) !important;
        border-color: rgb(var(--m3-scheme-primary)) !important;
        box-shadow: 0 0 0 2px rgb(var(--m3-scheme-primary) / 0.12) !important;
    }

    input:hover:not(:focus) {
        background: rgb(var(--m3-scheme-surface-container)) !important;
        border-color: rgb(var(--m3-scheme-outline)) !important;
    }
</style>