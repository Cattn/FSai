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
  settings?: Settings;
}

interface ToolCall {
  id: string;
  type: 'read_file' | 'delete_file' | 'move_file' | 'rename_file' | 'create_directory' | 'copy_file' | 'read_directory' | 'get_tree' | 'move_item' | 'write_file';
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

export interface Settings {
  apiKey: string;
  allowRootAccess: boolean;
}

interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: any;
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

  private static async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    await this.ensureBackendReady();
    
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
    
    return response.json();
  }

  private static async makeApiRequest<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
    const url = `http://127.0.0.1:${this.backendPort}/api${endpoint}`;
    
    const fetchOptions: RequestInit = { ...options };

    if (options.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    return this.request(url, fetchOptions);
  }

  static async listDirectory(path: string): Promise<ApiResponse<FileItem[]>> {
    return this.makeApiRequest('/fs/list', { method: 'POST', body: { path } });
  }

  static async readFile(path: string): Promise<ApiResponse<{ content: string; path: string }>> {
    return this.makeApiRequest('/fs/read', { method: 'POST', body: { path } });
  }

  static async writeFile(path: string, content: string): Promise<ApiResponse<{ message: string; path: string }>> {
    return this.makeApiRequest('/fs/write', { method: 'POST', body: { path, content } });
  }

  static async deleteFile(path: string): Promise<ApiResponse<{ message: string; path: string }>> {
    return this.makeApiRequest('/fs/delete', { method: 'POST', body: { path } });
  }

  static async createDirectory(path: string): Promise<ApiResponse<{ message: string; path: string }>> {
    return this.makeApiRequest('/fs/mkdir', { method: 'POST', body: { path } });
  }

  static async healthCheck(): Promise<ApiResponse> {
    const url = `http://127.0.0.1:${this.backendPort}/health`;
    return this.request(url);
  }

  static async getHomeDirectory(): Promise<ApiResponse<{ path: string; platform?: string }>> {
    return this.makeApiRequest('/fs/home', { method: 'GET' });
  }

  static async processWithAI(prompt: string, context: AIContext): Promise<ApiResponse<AIResponse>> {
    return this.makeApiRequest('/ai/process', { method: 'POST', body: { prompt, context } });
  }

  static async executeToolCall(toolCall: ToolCall, context?: AIContext): Promise<ApiResponse> {
    return this.makeApiRequest('/ai/execute-tool', { method: 'POST', body: { toolCall, context } });
  }

  static async processFollowUp(originalPrompt: string, context: AIContext, toolResults: any[]): Promise<ApiResponse<AIResponse>> {
    return this.makeApiRequest('/ai/process-followup', {
      method: 'POST',
      body: { originalPrompt, context, toolResults }
    });
  }

  static async checkFileType(path: string): Promise<ApiResponse<{ isText: boolean; reason?: string }>> {
    try {
      return await this.makeApiRequest('/fs/check-type', { method: 'POST', body: { path } });
    } catch (error) {
      console.error('checkFileType API call failed:', error);
      return {
        success: false,
        error: `API call failed: ${error}`
      };
    }
  }

  static async getSettings(): Promise<ApiResponse<Settings>> {
    return this.makeApiRequest('/settings', { method: 'GET' });
  }

  static async saveSettings(settings: Partial<Settings>): Promise<ApiResponse<Settings>> {
    return this.makeApiRequest('/settings', {
      method: 'POST',
      body: settings
    });
  }
}

export default FSaiAPI;
export type { ApiResponse, FileItem, AIContext, ToolCall, AIRequest, AIResponse }; 