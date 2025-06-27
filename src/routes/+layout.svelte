<script lang="ts">
    import '../app.css';
    import '../main.css';
    import { onMount } from 'svelte';
    import Chat from '$lib/components/Chat.svelte';
    import FloatingBottomBar from '$lib/components/FloatingBottomBar.svelte';
    import FSaiAPI, { type AIContext, type ToolCall } from '$lib/api.js';
    import {
        chatMessages,
        chatVisible,
        confirmationDetails,
        curFiles,
        curFolders,
        curPath,
        originalPrompt,
        pendingToolCalls,
        readFileContents,
        aiProcessing,
        executedToolResults,
        initialToolCallCount,
        type ChatMessage,
        type ReadFileContent,
        settings
    } from '$lib/store.js';
    import { quintOut } from 'svelte/easing';
    import { fade } from 'svelte/transition';
    import type { LayoutProps } from './$types.js';

    let { children }: LayoutProps = $props();

    let floatingBarHeight = $state(0);

    onMount(() => {
        FSaiAPI.getSettings().then((result) => {
            if (result.success && result.data) {
                settings.set(result.data);
            }
        });

        function handleKeydown(event: KeyboardEvent) {
            if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
                event.preventDefault();
                chatVisible.update((v) => !v);
            }

            if (event.key === 'Escape') {
                chatVisible.set(false);
                confirmationDetails.set(null);
                pendingToolCalls.set([]);
                executedToolResults.set([]);
            }

            if (
                event.key === 'Enter' &&
                $pendingToolCalls.length === 1 &&
                $pendingToolCalls[0].risk === 'low' &&
                $confirmationDetails
            ) {
                event.preventDefault();
                handleToolAction($pendingToolCalls[0], 'accept');
            }
        }

        window.addEventListener('keydown', handleKeydown);

        return () => {
            window.removeEventListener('keydown', handleKeydown);
        };
    });

    $effect(() => {
        const calls = $pendingToolCalls;
        if (calls.length > 0) {
            confirmationDetails.set({
                toolCalls: calls,
                onAccept: (toolCall) => handleToolAction(toolCall, 'accept'),
                onDeny: (toolCall) => handleToolAction(toolCall, 'deny')
            });
        } else {
            confirmationDetails.set(null);
        }
    });

    $effect(() => {
        const results = $executedToolResults;
        const prompt = $originalPrompt;
        const pendingCount = $pendingToolCalls.length;
        const initialCount = $initialToolCallCount;
        const isProcessing = $aiProcessing;

        if (
            results.length > 0 &&
            pendingCount === 0 &&
            prompt &&
            results.length === initialCount &&
            !isProcessing
        ) {
            processFollowUp(results);
        }
    });

    function generateMessageId(): string {
        return 'msg_' + Math.random().toString(36).substring(2, 11);
    }

    function buildAIContext(): AIContext {
        const contextMessages = $chatMessages
            .filter((msg) => msg.type !== 'system')
            .slice(-10) // Keep last 10 messages to limit context size
            .map((msg) => ({
                type: msg.type,
                content: msg.content,
                timestamp: msg.timestamp
            }));

        const recentFileContents = $readFileContents.slice(-3).map((file) => ({
            path: file.path,
            content: file.content
        }));

        return {
            currentPath: $curPath,
            folders: $curFolders,
            files: $curFiles,
            chatHistory: {
                messages: contextMessages,
                fileContents: recentFileContents
            },
            settings: $settings
        };
    }

    function addChatMessage(type: 'user' | 'ai' | 'system', content: any) {
        let stringContent: string;
        if (typeof content === 'string') {
            stringContent = content;
        } else if (content !== null && content !== undefined) {
            stringContent = JSON.stringify(content, null, 2);
        } else {
            stringContent = String(content);
        }

        const newMessage: ChatMessage = {
            id: generateMessageId(),
            type,
            content: stringContent,
            timestamp: new Date()
        };

        chatMessages.update((messages) => [...messages, newMessage]);
        chatVisible.set(true);
    }

    async function handleBottomBarSubmit(inputValue: string) {
        addChatMessage('user', inputValue);

        aiProcessing.set(true);

        try {
            const context = buildAIContext();
            const result = await FSaiAPI.processWithAI(inputValue, context);

            if (result.success && result.data) {
                addChatMessage('ai', result.data.response);

                if (result.data.toolCalls && result.data.toolCalls.length > 0) {
                    const toolCalls = result.data.toolCalls;
                    pendingToolCalls.set(toolCalls);
                    initialToolCallCount.set(toolCalls.length);
                    originalPrompt.set(inputValue);
                    executedToolResults.set([]);
                    addChatMessage(
                        'system',
                        `Requesting permission for ${toolCalls.length} action(s).`
                    );
                }
            } else {
                addChatMessage('system', `Error: ${result.error || 'AI processing failed'}`);
            }
        } catch (error) {
            addChatMessage('system', `Error: ${error}`);
        } finally {
            aiProcessing.set(false);
        }
    }

    async function handleToolAction(toolCall: ToolCall, action: 'accept' | 'deny') {
        pendingToolCalls.update((calls) => calls.filter((c) => c.id !== toolCall.id));

        if (action === 'deny') {
            addChatMessage('system', `Permission denied for: ${toolCall.description}`);
            executedToolResults.update((results) => [
                ...results,
                { toolCallId: toolCall.id, status: 'denied' }
            ]);
            return;
        }

        addChatMessage('system', `Permission granted for: ${toolCall.description}`);

        try {
            const context = buildAIContext();
            const result = await FSaiAPI.executeToolCall(toolCall, context);

            if (result.success) {
                addChatMessage('system', `✅ ${toolCall.description} completed`);
                executedToolResults.update((results) => [
                    ...results,
                    { toolCallId: toolCall.id, status: 'success', result: result.data.result }
                ]);

                if (toolCall.type === 'read_file' && result.data?.result?.content) {
                    const newFileContent: ReadFileContent = {
                        path: result.data.result.path,
                        content: result.data.result.content,
                        timestamp: new Date()
                    };
                    readFileContents.update((files) => {
                        const filtered = files.filter((f) => f.path !== newFileContent.path);
                        return [...filtered, newFileContent].slice(-5);
                    });
                }
            } else {
                console.error('Tool call execution failed:', result.error);
                addChatMessage('system', `❌ ${toolCall.description} failed: ${result.error}`);
                executedToolResults.update((results) => [
                    ...results,
                    { toolCallId: toolCall.id, status: 'error', error: result.error }
                ]);
            }
        } catch (error) {
            console.error('Error executing tool call:', error);
            addChatMessage('system', `❌ Error executing ${toolCall.description}: ${error}`);
            executedToolResults.update((results) => [
                ...results,
                { toolCallId: toolCall.id, status: 'error', error: String(error) }
            ]);
        }
    }

    async function processFollowUp(results: any[]) {
        if (results.length === 0) {
            cleanupAfterFollowUp();
            return;
        }

        addChatMessage('system', 'All actions handled. Getting final response...');
        aiProcessing.set(true);

        try {
            const enhancedContext = buildAIContext();
            const followUpResult = await FSaiAPI.processFollowUp(
                $originalPrompt,
                enhancedContext,
                results
            );

            if (followUpResult.success && followUpResult.data) {
                if (followUpResult.data.response) {
                    addChatMessage('ai', followUpResult.data.response);
                }

                if (followUpResult.data.toolCalls && followUpResult.data.toolCalls.length > 0) {
                    const toolCalls = followUpResult.data.toolCalls;
                    pendingToolCalls.set(toolCalls);
                    initialToolCallCount.set(toolCalls.length);
                    executedToolResults.set([]);
                    addChatMessage(
                        'system',
                        `Requesting permission for ${toolCalls.length} more action(s).`
                    );
                    aiProcessing.set(false);
                } else {
                    cleanupAfterFollowUp();
                }
            } else {
                console.error('Follow-up processing failed:', followUpResult.error);
                addChatMessage(
                    'system',
                    `Follow-up failed: ${followUpResult.error || 'Could not get response'}`
                );
                cleanupAfterFollowUp();
            }
        } catch (followUpError) {
            addChatMessage('system', `Error in follow-up: ${followUpError}`);
            cleanupAfterFollowUp();
        }
    }

    function cleanupAfterFollowUp() {
        aiProcessing.set(false);
        pendingToolCalls.set([]);
        originalPrompt.set('');
        executedToolResults.set([]);
        initialToolCallCount.set(0);
    }

    function handleChatClose() {
        chatVisible.set(false);
    }

    function handleNewChat() {
        chatMessages.set([]);
        readFileContents.set([]);
        addChatMessage('system', 'New chat started');
    }
</script>

{@render children()}

<Chat
    visible={$chatVisible}
    messages={$chatMessages}
    onSubmit={handleBottomBarSubmit}
    onNewChat={handleNewChat}
    onClose={handleChatClose}
    confirmationVisible={$confirmationDetails !== null}
    floatingBarHeight={$confirmationDetails ? floatingBarHeight : 0}
    pendingToolCalls={$pendingToolCalls}
/>

{#if $confirmationDetails}
    <FloatingBottomBar
        visible={true}
        toolCalls={$confirmationDetails.toolCalls}
        onAccept={(toolCall) => $confirmationDetails?.onAccept(toolCall)}
        onDeny={(toolCall) => $confirmationDetails?.onDeny(toolCall)}
        onHeightChange={(height) => (floatingBarHeight = height)}
    />
{/if}

<div class="fixed top-2 right-2 z-[999]">
    {#if $aiProcessing}
        <div
            class="px-3 py-1.5 rounded-md text-xs"
            style="background: rgb(var(--m3-scheme-secondary-container)); color: rgb(var(--m3-scheme-on-secondary-container)); border: 1px solid rgb(var(--m3-scheme-outline-variant));"
        >
            FSai is thinking...
        </div>
    {/if}
</div>