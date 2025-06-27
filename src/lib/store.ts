import { writable } from "svelte/store";
import type { ToolCall } from "./api";

export const curFolders = writable<string[]>([]);
export const curFiles = writable<string[]>([]);
export const curPath = writable<string>('');
export const curFile = writable<string>('');
export const curFileContent = writable<string>('');

// AI-related stores
export const pendingToolCalls = writable<ToolCall[]>([]);
export const originalPrompt = writable<string>('');
export const aiProcessing = writable<boolean>(false);

// Chat-related stores
export interface ChatMessage {
  id: string;
  type: 'user' | 'ai' | 'system';
  content: string;
  timestamp: Date;
}

export const chatMessages = writable<ChatMessage[]>([]);
export const chatVisible = writable<boolean>(false);

// Confirmation (FloatingBottomBar) stores
export interface ConfirmationDetails {
    toolCalls: ToolCall[];
    onAccept: (toolCall: ToolCall) => void;
    onDeny: (toolCall: ToolCall) => void;
}

export const confirmationDetails = writable<ConfirmationDetails | null>(null);

// Store for file contents that have been read (for AI context)
export interface ReadFileContent {
  path: string;
  content: string;
  timestamp: Date;
}

export const readFileContents = writable<ReadFileContent[]>([]);

// Store for executed tool call results
export interface ToolResult {
  toolCallId: string;
  status: 'success' | 'error' | 'denied';
  result?: any;
  error?: string;
}
export const executedToolResults = writable<ToolResult[]>([]);

export const settings = writable({
    apiKey: '',
    allowRootAccess: false
});