<script lang="ts">
    import '../app.css';
    import '../main.css';
    import { onMount } from 'svelte';

    import BottomBar from '$lib/components/BottomBar.svelte';
    import FloatingBottomBar from '$lib/components/FloatingBottomBar.svelte';
    import FSaiAPI, { type AIContext, type ToolCall } from '$lib/api.js';
    import { pendingToolCall, aiProcessing, showBottomBar, curPath, curFolders, curFiles } from '$lib/store.js';

    let bottomBarVisible = false;
    let floatingBarVisible = false;
    let floatingBarMessage = "Move item to destination?";
    let currentToolCall: ToolCall | null = null;

    // Subscribe to stores
    $: if ($showBottomBar !== bottomBarVisible) {
        bottomBarVisible = $showBottomBar;
    }

    $: if ($pendingToolCall) {
        currentToolCall = $pendingToolCall;
        floatingBarMessage = currentToolCall.description;
        floatingBarVisible = true;
    }

    async function handleBottomBarSubmit(inputValue: string) {
        console.log('AI Prompt submitted:', inputValue);
        
        // Hide bottom bar and start processing
        bottomBarVisible = false;
        showBottomBar.set(false);
        aiProcessing.set(true);

        try {
            // Build context from current state
            const context: AIContext = {
                currentPath: $curPath,
                folders: $curFolders,
                files: $curFiles
            };

            console.log('Sending context to AI:', context);

            // Send to AI for processing
            const result = await FSaiAPI.processWithAI(inputValue, context);
            
            if (result.success && result.data) {
                console.log('AI Response:', result.data.response);
                
                // If there are tool calls, show confirmation
                if (result.data.toolCalls && result.data.toolCalls.length > 0) {
                    const toolCall = result.data.toolCalls[0]; // Handle first tool call
                    pendingToolCall.set(toolCall);
                } else {
                    // Just a text response, show it somehow
                    console.log('AI responded with:', result.data.response);
                }
            } else {
                console.error('AI processing failed:', result.error);
            }
        } catch (error) {
            console.error('Error processing AI request:', error);
        } finally {
            aiProcessing.set(false);
        }
    }

    async function handleFloatingBarAccept() {
        console.log('Tool call accepted');
        floatingBarVisible = false;
        
        if (currentToolCall) {
            try {
                aiProcessing.set(true);
                
                // Execute the tool call
                const result = await FSaiAPI.executeToolCall(currentToolCall);
                
                if (result.success) {
                    console.log('Tool call executed successfully:', result.data);
                    
                    // Handle specific tool call results
                    if (currentToolCall.type === 'read_file' && result.data?.result?.content) {
                        // You might want to display the file content or update stores
                        console.log('File content:', result.data.result.content);
                    }
                } else {
                    console.error('Tool call execution failed:', result.error);
                }
            } catch (error) {
                console.error('Error executing tool call:', error);
            } finally {
                aiProcessing.set(false);
                pendingToolCall.set(null);
                currentToolCall = null;
            }
        }
    }

    function handleFloatingBarDeny() {
        console.log('Tool call denied');
        floatingBarVisible = false;
        pendingToolCall.set(null);
        currentToolCall = null;
    }

    onMount(() => {
        function handleKeydown(event: KeyboardEvent) {
            // Check for Cmd+K (Mac) or Ctrl+K (Windows/Linux)
            if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
                event.preventDefault();
                bottomBarVisible = true;
                showBottomBar.set(true);
            }
            
            // Hide bottom bar on Escape
            if (event.key === 'Escape') {
                bottomBarVisible = false;
                showBottomBar.set(false);
                floatingBarVisible = false;
                pendingToolCall.set(null);
                currentToolCall = null;
            }

            // Auto-confirm low risk operations with Enter (but NOT high risk)
            if (event.key === 'Enter' && currentToolCall && currentToolCall.risk === 'low' && floatingBarVisible) {
                event.preventDefault();
                handleFloatingBarAccept();
            }
            
            // Prevent Enter on high risk operations
            if (event.key === 'Enter' && currentToolCall && currentToolCall.risk === 'high' && floatingBarVisible) {
                event.preventDefault();
                console.log('High risk operation - must click to confirm');
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
        message={floatingBarMessage}
        risk={currentToolCall?.risk || 'low'}
        onAccept={handleFloatingBarAccept}
        onDeny={handleFloatingBarDeny}
    />
    <BottomBar 
        visible={bottomBarVisible}
        onSubmit={handleBottomBarSubmit}
    />
</div>