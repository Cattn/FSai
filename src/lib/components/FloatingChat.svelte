<script lang="ts">
    import { fly, scale, fade } from 'svelte/transition';
    import { backOut, quintOut } from 'svelte/easing';
    import { parseMarkdown, isMarkdown } from '$lib/markdown.js';
    
    export let visible = false;
    export let messages: Array<{id: string, type: 'user' | 'ai' | 'system', content: string, timestamp: Date}> = [];
    export let onClose = () => {};
    export let onNewChat = () => {};
    
    function handleClose() {
        onClose();
    }

    function handleNewChat() {
        onNewChat();
    }
    
    function formatTime(date: Date): string {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // Auto-scroll to bottom when new messages arrive (only if user is already at bottom)
    let chatContainer: HTMLElement;
    let previousMessageCount = 0;
    let shouldAutoScroll = true;
    
    // Check if user is near the bottom of the chat
    function isNearBottom(): boolean {
        if (!chatContainer) return true;
        const threshold = 50; // pixels from bottom
        return chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight <= threshold;
    }
    
    // Handle scroll events to determine if we should auto-scroll
    function handleScroll() {
        shouldAutoScroll = isNearBottom();
    }
    
    // Auto-scroll only when new messages arrive and user was at bottom
    $: if (chatContainer && messages.length > previousMessageCount) {
        if (shouldAutoScroll) {
            setTimeout(() => {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }, 50);
        }
        previousMessageCount = messages.length;
    }
</script>

{#if visible}
    <div 
        class="z-[150] max-w-[600px] w-full"
    >
        <div 
            class="backdrop-blur-[16px] rounded-lg min-h-[120px] max-h-[70vh] flex flex-col"
            style="background: rgb(var(--m3-scheme-surface-container-high)); border: 1px solid rgb(var(--m3-scheme-outline-variant)); border-radius: var(--m3-util-rounding-extra-large); box-shadow: var(--m3-util-elevation-4);"
        >
            <!-- Header -->
            <div 
                class="flex items-center justify-between p-4 border-b border-opacity-20 flex-shrink-0"
                style="border-color: rgb(var(--m3-scheme-outline-variant));"
                transition:fade={{ delay: 200, duration: 300 }}
            >
                <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full bg-green-500"></div>
                    <span style="color: rgb(var(--m3-scheme-on-surface)); font-family: var(--m3-font); font-size: 0.875rem; font-weight: 500;">
                        FSai Assistant
                    </span>
                </div>
                <div class="flex items-center gap-2">
                    <!-- svelte-ignore a11y_consider_explicit_label -->
                    <button
                        class="px-2 py-1 rounded-full text-xs hover:bg-opacity-10 transition-colors duration-200"
                        style="color: rgb(var(--m3-scheme-on-surface-variant)); background: transparent; border: 1px solid rgb(var(--m3-scheme-outline-variant));"
                        on:click={handleNewChat}
                        transition:scale={{ delay: 250, duration: 250, start: 0.8 }}
                        title="Start new chat"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" style="margin-right: 4px; display: inline;">
                            <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                        </svg>
                        New
                    </button>
                    <!-- svelte-ignore a11y_consider_explicit_label -->
                    <button
                        class="p-1 rounded-full hover:bg-opacity-10 transition-colors duration-200"
                        style="color: rgb(var(--m3-scheme-on-surface-variant)); background: transparent;"
                        on:click={handleClose}
                        transition:scale={{ delay: 300, duration: 250, start: 0.8 }}
                        title="Close chat"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24">
                            <path fill="currentColor" d="m12 13.4l-4.9 4.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.9-4.9l-4.9-4.9q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l4.9 4.9l4.9-4.9q.275-.275.7-.275t.7.275t.275.7t-.275.7L13.4 12l4.9 4.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275z" />
                        </svg>
                    </button>
                </div>
            </div>
            
            <!-- Messages -->
            <div 
                bind:this={chatContainer}
                class="overflow-y-auto p-4 space-y-3 flex-1 min-h-0"
                transition:fade={{ delay: 400, duration: 300 }}
                on:scroll={handleScroll}
            >
                {#each messages as message (message.id)}
                    <div 
                        class="message {message.type === 'user' ? 'user-message' : message.type === 'system' ? 'system-message' : 'ai-message'}"
                        transition:scale={{ duration: 200, start: 0.95 }}
                    >
                        {#if message.type === 'user'}
                            <div class="flex justify-end">
                                <div 
                                    class="max-w-[80%] p-3 rounded-lg"
                                    style="background: rgb(var(--m3-scheme-primary)); color: rgb(var(--m3-scheme-on-primary)); border-radius: 16px 16px 4px 16px;"
                                >
                                    <div class="text-sm font-medium leading-relaxed">
                                        {#if typeof message.content === 'string' && isMarkdown(message.content)}
                                            {@html parseMarkdown(message.content)}
                                        {:else}
                                            {typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}
                                        {/if}
                                    </div>
                                    <div 
                                        class="text-xs mt-1 opacity-80"
                                        style="color: rgb(var(--m3-scheme-on-primary));"
                                    >
                                        {formatTime(message.timestamp)}
                                    </div>
                                </div>
                            </div>
                        {:else if message.type === 'system'}
                            <div class="flex justify-center">
                                <div 
                                    class="px-3 py-1 rounded-full text-xs"
                                    style="background: rgb(var(--m3-scheme-surface-container-highest)); color: rgb(var(--m3-scheme-on-surface-variant));"
                                >
                                    {message.content}
                                </div>
                            </div>
                        {:else}
                            <div class="flex justify-start">
                                <div 
                                    class="max-w-[80%] p-3 rounded-lg"
                                    style="background: rgb(var(--m3-scheme-surface-container-low)); color: rgb(var(--m3-scheme-on-surface)); border-radius: 16px 16px 16px 4px; border: 1px solid rgb(var(--m3-scheme-outline-variant));"
                                >
                                    <div class="text-sm leading-relaxed">
                                        {#if typeof message.content === 'string' && isMarkdown(message.content)}
                                            {@html parseMarkdown(message.content)}
                                        {:else}
                                            <div class="whitespace-pre-wrap">{typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}</div>
                                        {/if}
                                    </div>
                                    <div 
                                        class="text-xs mt-1"
                                        style="color: rgb(var(--m3-scheme-on-surface-variant));"
                                    >
                                        {formatTime(message.timestamp)}
                                    </div>
                                </div>
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        </div>
    </div>
{/if}

<style>
    .message {
        transition: all 0.2s ease-in-out;
    }
    
    /* Custom scrollbar */
    div::-webkit-scrollbar {
        width: 4px;
    }
    
    div::-webkit-scrollbar-track {
        background: transparent;
    }
    
    div::-webkit-scrollbar-thumb {
        background: rgb(var(--m3-scheme-outline-variant));
        border-radius: 2px;
    }
    
    div::-webkit-scrollbar-thumb:hover {
        background: rgb(var(--m3-scheme-outline));
    }

    /* Markdown styling - using default marked HTML elements */
    :global(.message h1, .message h2, .message h3, .message h4, .message h5, .message h6) {
        font-weight: 600;
        margin: 0.5rem 0 0.25rem 0;
        color: rgb(var(--m3-scheme-on-surface));
    }

    :global(.message h1) { font-size: 1.125rem; }
    :global(.message h2) { font-size: 1.0625rem; }
    :global(.message h3) { font-size: 1rem; }
    :global(.message h4) { font-size: 0.9375rem; }
    :global(.message h5) { font-size: 0.875rem; }
    :global(.message h6) { font-size: 0.8125rem; }

    :global(.message p) {
        margin: 0.25rem 0;
        line-height: 1.5;
    }

    :global(.message strong, .message b) {
        font-weight: 600;
        color: rgb(var(--m3-scheme-on-surface));
    }

    :global(.message em, .message i) {
        font-style: italic;
    }

    /* Default marked inline code styling */
    :global(.message code) {
        background: rgb(var(--m3-scheme-surface-container-highest));
        color: rgb(var(--m3-scheme-on-surface));
        padding: 0.125rem 0.25rem;
        border-radius: 0.25rem;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 0.8125rem;
        border: 1px solid rgb(var(--m3-scheme-outline-variant));
    }

    /* Default marked code block styling */
    :global(.message pre) {
        background: rgb(var(--m3-scheme-surface-container-highest));
        border: 1px solid rgb(var(--m3-scheme-outline-variant));
        border-radius: 0.5rem;
        padding: 0.75rem;
        margin: 0.5rem 0;
        overflow-x: auto;
    }

    :global(.message pre code) {
        background: transparent;
        border: none;
        padding: 0;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 0.8125rem;
        color: rgb(var(--m3-scheme-on-surface));
        line-height: 1.4;
    }

    /* Default marked blockquote styling */
    :global(.message blockquote) {
        border-left: 3px solid rgb(var(--m3-scheme-primary));
        background: rgb(var(--m3-scheme-surface-container-low));
        padding: 0.5rem 0.75rem;
        margin: 0.5rem 0;
        border-radius: 0 0.5rem 0.5rem 0;
        font-style: italic;
    }

    /* Default marked list styling */
    :global(.message ul, .message ol) {
        margin: 0.5rem 0;
        padding-left: 1.25rem;
    }

    :global(.message li) {
        margin: 0.125rem 0;
        line-height: 1.4;
    }

    :global(.message ul) {
        list-style-type: disc;
    }

    :global(.message ol) {
        list-style-type: decimal;
    }

    :global(.message a) {
        color: rgb(var(--m3-scheme-primary));
        text-decoration: underline;
        text-decoration-color: rgb(var(--m3-scheme-primary) / 0.5);
        transition: text-decoration-color 0.2s ease;
    }

    :global(.message a:hover) {
        text-decoration-color: rgb(var(--m3-scheme-primary));
    }

    :global(.message hr) {
        border: none;
        border-top: 1px solid rgb(var(--m3-scheme-outline-variant));
        margin: 0.75rem 0;
    }

    /* Ensure proper spacing in markdown content */
    :global(.message > div > *:first-child) {
        margin-top: 0;
    }

    :global(.message > div > *:last-child) {
        margin-bottom: 0;
    }
</style>
