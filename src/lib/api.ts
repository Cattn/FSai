import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

interface FileItem {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  path: string;
  size?: number;
}

interface AIContext {
  currentPath: string;
  folders: string[];
  files: string[];
  chatHistory?: {
    messages: Array<{
      type: 'user' | 'ai' | 'system';
      content: string;
      timestamp: Date;
    }>;
    fileContents?: Array<{
      path: string;
      content: string;
    }>;
  };
}

interface ToolCall {
  id: string;
  type: 'read_file' | 'delete_file' | 'move_file' | 'rename_file' | 'create_directory' | 'copy_file' | 'read_directory' | 'get_tree' | 'move_item';
  parameters: {
    path?: string;
    from?: string;
    to?: string;
    name?: string;
    content?: string;
    sourcePath?: string;
    destinationPath?: string;
  };
  description: string;
  risk: 'low' | 'high';
}

interface AIRequest {
  prompt: string;
  context: AIContext;
}

interface AIResponse {
  response: string;
  toolCalls?: ToolCall[];
}

class FSaiAPI {
  private static backendPort: number | null = null;
  private static backendReady = false;
  private static readyPromise: Promise<void> | null = null;

  static async initialize(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = new Promise((resolve) => {
      // Listen for backend ready event
      listen('backend-ready', (event) => {
        this.backendPort = event.payload as number;
        this.backendReady = true;
        console.log(`FSai backend ready on port ${this.backendPort}`);
        resolve();
      });

      this.pollForBackend().then(resolve);
    });

    return this.readyPromise;
  }

  private static async pollForBackend(): Promise<void> {
    while (!this.backendPort) {
      try {
        const port = await invoke<number | null>('get_backend_port');
        if (port) {
          this.backendPort = port;
          this.backendReady = true;
          console.log(`FSai backend found on port ${this.backendPort}`);
          break;
        }
      } catch (e) {
        console.log('Waiting for backend...', e);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private static async ensureBackendReady(): Promise<void> {
    if (!this.backendReady) {
      await this.initialize();
    }
  }

  private static async makeRequest<T>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    await this.ensureBackendReady();
    
    const response = await fetch(`http://127.0.0.1:${this.backendPort}/api${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {})
    });
    
    return response.json();
  }

  static async listDirectory(path: string): Promise<ApiResponse<FileItem[]>> {
    return this.makeRequest('/fs/list', { path });
  }

  static async readFile(path: string): Promise<ApiResponse<{ content: string; path: string }>> {
    return this.makeRequest('/fs/read', { path });
  }

  static async writeFile(path: string, content: string): Promise<ApiResponse<{ message: string; path: string }>> {
    return this.makeRequest('/fs/write', { path, content });
  }

  static async deleteFile(path: string): Promise<ApiResponse<{ message: string; path: string }>> {
    return this.makeRequest('/fs/delete', { path });
  }

  static async createDirectory(path: string): Promise<ApiResponse<{ message: string; path: string }>> {
    return this.makeRequest('/fs/mkdir', { path });
  }

  static async healthCheck(): Promise<ApiResponse> {
    await this.ensureBackendReady();
    
    const response = await fetch(`http://127.0.0.1:${this.backendPort}/health`);
    return response.json();
  }

  static async getHomeDirectory(): Promise<ApiResponse<{ path: string; platform?: string }>> {
    await this.ensureBackendReady();
    
    const response = await fetch(`http://127.0.0.1:${this.backendPort}/api/fs/home`);
    return response.json();
  }

  static async processWithAI(prompt: string, context: AIContext): Promise<ApiResponse<AIResponse>> {
    return this.makeRequest('/ai/process', { prompt, context });
  }

  static async executeToolCall(toolCall: ToolCall, context?: AIContext): Promise<ApiResponse> {
    return this.makeRequest('/ai/execute-tool', { toolCall, context });
  }

  static async processFollowUp(originalPrompt: string, context: AIContext, toolResults: any): Promise<ApiResponse<AIResponse>> {
    return this.makeRequest('/ai/process-followup', { originalPrompt, context, toolResults });
  }

  static async checkFileType(path: string): Promise<ApiResponse<{ isText: boolean; reason?: string }>> {
    try {
      return await this.makeRequest('/fs/check-type', { path });
    } catch (error) {
      console.error('checkFileType API call failed:', error);
      return {
        success: false,
        error: `API call failed: ${error}`
      };
    }
  }
}

export default FSaiAPI;
export type { ApiResponse, FileItem, AIContext, ToolCall, AIRequest, AIResponse }; 