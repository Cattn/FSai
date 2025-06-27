<script lang="ts">
	import { fly, scale, fade } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import type { ToolCall } from '$lib/api';
	import { createEventDispatcher } from 'svelte';

	export let visible = false;
	export let toolCalls: ToolCall[] = [];
	export let onAccept: (toolCall: ToolCall) => void = () => {};
	export let onDeny: (toolCall: ToolCall) => void = () => {};

	let height = 0;
	const dispatch = createEventDispatcher<{ heightChange: number }>();

	$: if (height > 0) {
		dispatch('heightChange', height);
	}

	function handleAccept(toolCall: ToolCall) {
		onAccept(toolCall);
	}

	function handleDeny(toolCall: ToolCall) {
		onDeny(toolCall);
	}
</script>

{#if visible && toolCalls.length > 0}
	<div
		bind:clientHeight={height}
		class="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-[200] max-w-[800px] w-[90%] md:bottom-6 md:w-[calc(100%-2rem)] max-[480px]:bottom-20"
		transition:fly={{ y: 50, duration: 400, easing: backOut }}
	>
		<div
			class="backdrop-blur-[16px] rounded-lg p-4 flex flex-col gap-3"
			style="background: rgb(var(--m3-scheme-surface-container-high)); border: 1px solid rgb(var(--m3-scheme-outline-variant)); border-radius: var(--m3-util-rounding-extra-large); box-shadow: var(--m3-util-elevation-4);"
		>
			<div
				class="text-sm font-medium pb-2 border-b"
				style="color: rgb(var(--m3-scheme-on-surface)); border-color: rgb(var(--m3-scheme-outline-variant));"
			>
				FSai wants to perform the following actions:
			</div>
			<div class="flex flex-col gap-2 max-h-[40vh] overflow-y-auto pr-2">
				{#each toolCalls as toolCall (toolCall.id)}
					<div
						in:fly={{ y: 10, duration: 300, delay: 100, easing: backOut }}
						out:fly={{ y: -10, duration: 200 }}
						class="flex items-center justify-between p-3 rounded-lg gap-4"
						style="background: rgb(var(--m3-scheme-surface-container-highest));"
					>
						<div class="flex-1 min-w-0">
							<div
								class="text-sm truncate"
								style="color: rgb(var(--m3-scheme-on-surface-variant));"
								title={toolCall.description}
							>
								{toolCall.description}
							</div>
							{#if toolCall.risk === 'high'}
								<div
									class="text-xs font-semibold"
									style="color: rgb(var(--m3-scheme-error));"
								>
									High Risk
								</div>
							{/if}
						</div>
						<div class="flex items-center gap-2 flex-shrink-0">
							<!-- svelte-ignore a11y_consider_explicit_label -->
							<button
								on:click={() => handleDeny(toolCall)}
								class="flex items-center justify-center w-8 h-8 rounded-full transition-colors"
								style="background-color: rgb(var(--m3-scheme-surface-container-high)); color: rgb(var(--m3-scheme-error));"
								title="Deny"
							>
								<svg width="18" height="18" viewBox="0 0 24 24">
									<path
										fill="currentColor"
										d="m12 13.4l-4.9 4.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.9-4.9l-4.9-4.9q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l4.9 4.9l4.9-4.9q.275-.275.7-.275t.7.275t.275.7t-.275.7L13.4 12l4.9 4.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275z"
									/>
								</svg>
							</button>
							<!-- svelte-ignore a11y_consider_explicit_label -->
							<button
								on:click={() => handleAccept(toolCall)}
								class="flex items-center justify-center w-8 h-8 rounded-full transition-colors"
								style="background-color: rgb(var(--m3-scheme-primary)); color: rgb(var(--m3-scheme-on-primary));"
								title="Accept"
							>
								<svg width="18" height="18" viewBox="0 0 24 24">
									<path
										fill="currentColor"
										d="m9.55 15.15l8.475-8.475q.3-.3.7-.3t.7.3t.3.713t-.3.712l-9.175 9.2q-.3.3-.7.3t-.7-.3L4.55 13q-.3-.3-.288-.712t.313-.713t.713-.3t.712.3z"
									/>
								</svg>
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
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
</style>