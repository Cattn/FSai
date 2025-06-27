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
        type ChatMessage,
        type ReadFileContent
    } from '$lib/store.js';
    import { quintOut } from 'svelte/easing';
    import { fade } from 'svelte/transition';

    let initialToolCallCount = 0;
    let floatingBarHeight = 0;

    // Subscribe to stores
    $: if ($pendingToolCalls.length > 0) {
        if (initialToolCallCount === 0) {
            initialToolCallCount = $pendingToolCalls.length;
        }

        confirmationDetails.set({
            toolCalls: $pendingToolCalls,
            onAccept: (toolCall) => handleToolAction(toolCall, 'accept'),
            onDeny: (toolCall) => handleToolAction(toolCall, 'deny')
        });
    } else {
        confirmationDetails.set(null);
    }

    // When all tools have been actioned, run the follow-up
    $: if (
        $executedToolResults.length > 0 &&
        $executedToolResults.length === initialToolCallCount &&
        $originalPrompt
    ) {
        processFollowUp($executedToolResults);
    }

    function generateMessageId(): string {
        return 'msg_' + Math.random().toString(36).substring(2, 11);
    }

    function buildAIContext(): AIContext {
        // Get current chat messages, excluding system messages for context
        const contextMessages = $chatMessages
            .filter((msg) => msg.type !== 'system')
            .slice(-10) // Keep last 10 messages to limit context size
            .map((msg) => ({
                type: msg.type,
                content: msg.content,
                timestamp: msg.timestamp
            }));

        // Get file contents, keep only the most recent 3 files to limit context size
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
            }
        };
    }

    function addChatMessage(type: 'user' | 'ai' | 'system', content: any) {
        // Ensure content is always a string
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
        console.log('AI Prompt submitted:', inputValue);

        // Add user message to chat
        addChatMessage('user', inputValue);

        aiProcessing.set(true);

        try {
            // Build enhanced context with chat history
            const context = buildAIContext();

            console.log('Sending enhanced context to AI:', context);

            // Send to AI for processing
            const result = await FSaiAPI.processWithAI(inputValue, context);

            if (result.success && result.data) {
                console.log('AI Response:', result.data.response);

                // Add AI response to chat
                addChatMessage('ai', result.data.response);

                // If there are tool calls, show confirmation
                if (result.data.toolCalls && result.data.toolCalls.length > 0) {
                    pendingToolCalls.set(result.data.toolCalls);
                    originalPrompt.set(inputValue); // Store the original prompt for follow-up
                    executedToolResults.set([]); // Clear previous results
                    initialToolCallCount = 0; // Reset count
                    addChatMessage(
                        'system',
                        `Requesting permission for ${result.data.toolCalls.length} action(s).`
                    );
                }
            } else {
                console.error('AI processing failed:', result.error);
                addChatMessage('system', `Error: ${result.error || 'AI processing failed'}`);
            }
        } catch (error) {
            console.error('Error processing AI request:', error);
            addChatMessage('system', `Error: ${error}`);
        } finally {
            aiProcessing.set(false);
        }
    }

    async function handleToolAction(toolCall: ToolCall, action: 'accept' | 'deny') {
        // Optimistically remove from pending list
        pendingToolCalls.update((calls) => calls.filter((c) => c.id !== toolCall.id));

        if (action === 'deny') {
            console.log('Tool call denied:', toolCall.id);
            addChatMessage('system', `Permission denied for: ${toolCall.description}`);
            executedToolResults.update((results) => [
                ...results,
                { toolCallId: toolCall.id, status: 'denied' }
            ]);
            return;
        }

        console.log('Tool call accepted:', toolCall.id);
        addChatMessage('system', `Permission granted for: ${toolCall.description}`);

        try {
            // Execute the tool call
            const context = buildAIContext();
            const result = await FSaiAPI.executeToolCall(toolCall, context);

            if (result.success) {
                console.log('Tool call executed successfully:', result.data);
                addChatMessage('system', `✅ ${toolCall.description} completed`);
                executedToolResults.update((results) => [
                    ...results,
                    { toolCallId: toolCall.id, status: 'success', result: result.data.result }
                ]);

                // Store file content if it was a read operation
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
                console.log('Follow-up Response:', followUpResult.data.response);
                if (followUpResult.data.response) {
                    addChatMessage('ai', followUpResult.data.response);
                }

                if (followUpResult.data.toolCalls && followUpResult.data.toolCalls.length > 0) {
                    pendingToolCalls.set(followUpResult.data.toolCalls);
                    executedToolResults.set([]);
                    initialToolCallCount = 0;
                    addChatMessage(
                        'system',
                        `Requesting permission for ${followUpResult.data.toolCalls.length} more action(s).`
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
            console.error('Error in follow-up processing:', followUpError);
            addChatMessage('system', `Error in follow-up: ${followUpError}`);
            cleanupAfterFollowUp();
        }
    }

    function cleanupAfterFollowUp() {
        aiProcessing.set(false);
        pendingToolCalls.set([]);
        originalPrompt.set('');
        executedToolResults.set([]);
        initialToolCallCount = 0;
    }

    function handleFloatingBarDeny() {
        // This function is now managed by the component per-item
        // but we can keep it for a "Deny All" button if we add one.
        // For now, it does nothing if called.
        console.log('Deny All requested');
        const calls = $pendingToolCalls;
        calls.forEach((toolCall) => handleToolAction(toolCall, 'deny'));
    }

    function handleChatClose() {
        chatVisible.set(false);
    }

    function handleNewChat() {
        // Clear chat messages
        chatMessages.set([]);
        // Clear file contents from context
        readFileContents.set([]);
        // Add a welcome message
        addChatMessage('system', 'New chat started');
    }

    onMount(() => {
        function handleKeydown(event: KeyboardEvent) {
            // Check for Cmd+K (Mac) or Ctrl+K (Windows/Linux)
            if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
                event.preventDefault();
                chatVisible.update((v) => !v);
            }

            // Hide bottom bar on Escape
            if (event.key === 'Escape') {
                chatVisible.set(false);
                confirmationDetails.set(null);
                pendingToolCalls.set([]);
                executedToolResults.set([]);
                initialToolCallCount = 0;
            }

            // Enter to accept single, low-risk tool call
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
</script>

<slot />

<Chat
    visible={$chatVisible}
    messages={$chatMessages}
    onSubmit={handleBottomBarSubmit}
    onNewChat={handleNewChat}
    onClose={handleChatClose}
    confirmationVisible={$confirmationDetails !== null}
    floatingBarHeight={$confirmationDetails ? floatingBarHeight : 0}
/>

{#if $confirmationDetails}
    <FloatingBottomBar
        visible={true}
        toolCalls={$confirmationDetails.toolCalls}
        onAccept={(toolCall) => $confirmationDetails?.onAccept(toolCall)}
        onDeny={(toolCall) => $confirmationDetails?.onDeny(toolCall)}
        on:heightChange={(e) => (floatingBarHeight = e.detail)}
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