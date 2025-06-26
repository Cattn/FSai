import { writable } from "svelte/store";
import type { ToolCall } from "./api";

export const curFolders = writable<string[]>([]);
export const curFiles = writable<string[]>([]);
export const curPath = writable<string>('');
export const curFile = writable<string>('');
export const curFileContent = writable<string>('');

// AI-related stores
export const pendingToolCall = writable<ToolCall | null>(null);
export const aiProcessing = writable<boolean>(false);
export const showBottomBar = writable<boolean>(false);