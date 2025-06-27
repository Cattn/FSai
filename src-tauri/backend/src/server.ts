import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { existsSync, statSync } from 'fs';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import { lookup } from 'mime-types';
import rateLimit from 'express-rate-limit';

// Load environment variables
dotenv.config();

const APP_NAME = 'FSai';
let settings = {
    apiKey: '',
    allowRootAccess: false,
    multimediaSupport: false
};

const resolvedHomeDir = path.resolve(os.homedir());

function isPathAllowed(p: string | undefined, allowRoot: boolean, currentPath?: string): boolean {
    if (allowRoot) return true;
    if (!p) return true; 

    let resolvedPath: string;
    if (currentPath && !path.isAbsolute(p)) {
        resolvedPath = path.resolve(currentPath, p);
    } else {
        resolvedPath = path.resolve(p);
    }

    return resolvedPath.startsWith(resolvedHomeDir);
}

function getAppDataPath(): string {
    switch (os.platform()) {
        case 'win32':
            return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support');
        case 'linux':
            return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
        default:
            return path.join(os.homedir(), '.config');
    }
}

async function loadSettings() {
    const configDir = path.join(getAppDataPath(), APP_NAME);
    const configFile = path.join(configDir, 'settings.json');
    try {
        if (existsSync(configFile)) {
            const fileContent = await fs.readFile(configFile, 'utf-8');
            const loadedSettings = JSON.parse(fileContent);
            settings = { ...settings, ...loadedSettings };
        }
    } catch (error) {
        console.warn('Could not load settings file:', error);
    }
}

async function saveSettings() {
    const configDir = path.join(getAppDataPath(), APP_NAME);
    const configFile = path.join(configDir, 'settings.json');
    try {
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(configFile, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (error) {
        console.error('Could not save settings file:', error);
    }
}

// mainly for dev-purposes -- fetches env
function readSystemEnvVariable(variableName: string): string {
  try {
    if (process.env[variableName]) {
      return process.env[variableName];
    }
    
    const command = os.platform() === 'win32' 
      ? `echo $env:${variableName}` 
      : `printenv ${variableName}`;
    
    const result = execSync(command, { encoding: 'utf8' }).trim();
    
    if (os.platform() === 'win32' && result === `%${variableName}%`) {
      throw new Error(`Environment variable ${variableName} not found`);
    }
    
    return result;
  } catch (error) {
    return '';
  }
}

// Get GEMINI_API_KEY from system environment
const systemGeminiKey = readSystemEnvVariable('GEMINI_API_KEY');
let GEMINI_API_KEY = '';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Rate limiting because my client code sucks occasionally
const aiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, 
	max: 100, 
	standardHeaders: true,
	legacyHeaders: false,
  message: 'Too many requests from this IP, please try again after 15 minutes'
});

const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, 
  max: 15, 
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again after a minute.'
});

// Types
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
  settings?: {
    allowRootAccess?: boolean;
  }
}

interface ToolCall {
  id: string;
  type: 'read_file' | 'delete_item' | 'move_file' | 'rename_file' | 'create_directory' | 'copy_file' | 'read_directory' | 'get_tree' | 'move_item' | 'write_file' | 'process_file' | 'navigate_user';
  parameters: {
    path?: string;
    from?: string;
    to?: string;
    name?: string;
    content?: string;
    sourcePath?: string;
    destinationPath?: string;
    newName?: string;
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

function createResponse<T>(success: boolean, data?: T, error?: string): ApiResponse<T> {
  return { success, data, error };
}

// Initialize Gemini AI
let genAI: GoogleGenerativeAI;

function initializeGenAI() {
    GEMINI_API_KEY = settings.apiKey || systemGeminiKey;
    if (GEMINI_API_KEY) {
        genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    }
}

// Tool function definitions for Gemini
const readFileFunction = {
  name: 'read_file',
  description: 'Reads the content of a file at the specified path. Use this when the user wants to view, open, or examine file contents.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: {
        type: SchemaType.STRING,
        description: 'The full path to the file to read'
      }
    },
    required: ['path']
  }
};
 
const processFileFunction = {
  name: 'process_file',
  description: 'Loads an image, PDF, or video file so you can analyze its contents. Use this when the user wants you to watch a video, read a document, or look at an image. After the tool runs, the file\'s content will be available to you, and you can then answer the user\'s question about it. This tool does not work for audio files.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: {
        type: SchemaType.STRING,
        description: 'The full path to the file to process.'
      }
    },
    required: ['path']
  }
};

const writeFileFunction = {
  name: 'write_file',
  description: 'Writes or creates a text file with the specified content at the given path. If the file exists, it will be overwritten. If it does not exist, it will be created. Use for text-based files like .txt, .md, .json, etc.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: {
        type: SchemaType.STRING,
        description: 'The full path to the file to write.'
      },
      content: {
        type: SchemaType.STRING,
        description: 'The content to write to the file.'
      }
    },
    required: ['path', 'content']
  }
};

const createDirectoryFunction = {
  name: 'create_directory',
  description: 'Creates a new directory inside a specified path.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: {
        type: SchemaType.STRING,
        description: 'The path of the parent directory where the new directory will be created.'
      },
      name: {
        type: SchemaType.STRING,
        description: 'The name of the new directory to create.'
      }
    },
    required: ['path', 'name']
  }
};

const readDirectoryFunction = {
  name: 'read_directory',
  description: 'Lists the files and folders in a specified directory. Use this to explore the file system.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: {
        type: SchemaType.STRING,
        description: 'The full path of the directory to list.'
      }
    },
    required: ['path']
  }
};

const getTreeFunction = {
  name: 'get_tree',
  description: 'Gets the directory tree structure for a given path, showing nested files and folders. Use this to visualize the layout of a directory.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: {
        type: SchemaType.STRING,
        description: 'The full path of the directory to get the tree for.'
      }
    },
    required: ['path']
  }
};

const moveItemFunction = {
  name: 'move_item',
  description: 'Moves a file or directory from a source path to a destination path.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      sourcePath: {
        type: SchemaType.STRING,
        description: 'The source path of the file or directory to move.'
      },
      destinationPath: {
        type: SchemaType.STRING,
        description: 'The destination path where the item should be moved. If this is a directory, the source item will be moved inside it.'
      }
    },
    required: ['sourcePath', 'destinationPath']
  }
};

const navigateUserFunction = {
  name: 'navigate_user',
  description: 'Navigates the user to a specified path on their file explorer. Use this if the user asks to navigate to a specific path, asks to find something, or asks to see a directory.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: {
        type: SchemaType.STRING,
        description: 'The path to navigate to.'
      }
    }, 
    required: ['path']
  }
};

const renameFileFunction = {
  name: 'rename_file',
  description: 'Renames a file or directory at the specified path.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: {
        type: SchemaType.STRING,
        description: 'The full path to the file or folder to rename.'
      },
      newName: {
        type: SchemaType.STRING,
        description: 'The new name for the file or folder.'
      }
    },
    required: ['path', 'newName']
  }
};

const deleteItemFunction = {
  name: 'delete_item',
  description: 'Deletes a file or directory at the specified path.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: {
        type: SchemaType.STRING,
        description: 'The full path to the file or directory to delete.'
      }
    },
    required: ['path']
  }
};

const copyFileFunction = {
  name: 'copy_file',
  description: 'Copies a file from a source path to a destination path.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: {
        type: SchemaType.STRING,
        description: 'The full path to the file to copy.'
      },
      destinationPath: {
        type: SchemaType.STRING,
        description: 'The destination path where the file should be copied.'
      }
    },
    required: ['path', 'destinationPath']
  }
};

function generateToolCallId(): string {
  return 'tc_' + Math.random().toString(36).substring(2, 11);
}

function determineRisk(toolType: string, parameters: any): 'low' | 'high' {
  switch (toolType) {
    case 'read_file':
    case 'read_directory':
    case 'get_tree':
    case 'navigate_user':
    case 'process_file':
    case 'create_directory':
    case 'copy_file':
      return 'low';
    case 'write_file':
    case 'delete_item':
    case 'move_item':
    case 'rename_file':
      return 'high';
    default:
      return 'high';
  }
}

function truncateChatHistory(messages: Array<{type: string, content: string, timestamp: Date}>, maxTokens: number = 2000): Array<{type: string, content: string, timestamp: Date}> {
  if (!messages || messages.length === 0) return [];
  
  const recent = messages.slice().reverse();
  const truncated = [];
  let totalLength = 0;
  
  for (const message of recent) {
    const messageLength = message.content.length;
    if (totalLength + messageLength > maxTokens && truncated.length > 0) {
      break;
    }
    truncated.unshift(message);
    totalLength += messageLength;
  }
  
  return truncated;
}

async function processWithAI(prompt: string, context: AIContext): Promise<AIResponse> {
  try {
    if (!genAI) {
        return { response: 'AI is not configured. Please set the API key in settings.' };
    }

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0 }
    });

    let chatHistoryText = '';
    if (context.chatHistory?.messages && context.chatHistory.messages.length > 0) {
      const truncatedHistory = truncateChatHistory(context.chatHistory.messages, 1500);
      chatHistoryText = `\nRecent conversation history:\n${truncatedHistory.map(msg => 
        `${msg.type.toUpperCase()}: ${msg.content}`
      ).join('\n')}\n`;
    }

    let fileContentsText = '';
    if (context.chatHistory?.fileContents && context.chatHistory.fileContents.length > 0) {
      fileContentsText = `\nPreviously read files:\n${context.chatHistory.fileContents.map(file => 
        `File: ${file.path}\nContent: ${file.content.substring(0, 1000)}${file.content.length > 1000 ? '...(truncated)' : ''}`
      ).join('\n\n')}\n`;
    }

    const contextPrompt = `You are a helpful file system assistant. Be concise and direct in your responses unless the user specifically asks for detailed explanations.

Current directory context:
- Current path: ${context.currentPath}
- Folders: ${context.folders.join(', ') || 'None'}
- Files: ${context.files.join(', ') || 'None'}
${chatHistoryText}${fileContentsText}
User request: ${prompt}

You can help with file, directory, and navigation operations. When appropriate, use the available tools to complete the user's request.
Specifically, for the get_tree tool, you should make use of it if you are unsure about the user's request. Try to be specific in your use of the get_tree tool.
Keep responses brief and focused unless detailed explanation is requested.`;

    const functionDeclarations = [readFileFunction, readDirectoryFunction, getTreeFunction, moveItemFunction, createDirectoryFunction, writeFileFunction, navigateUserFunction, renameFileFunction, deleteItemFunction, copyFileFunction];
    if (settings.multimediaSupport) {
      functionDeclarations.push(processFileFunction);
    }

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: contextPrompt }] }],
      tools: [{
        functionDeclarations: functionDeclarations
      }]
    });

    const response = result.response;
    const toolCalls: ToolCall[] = [];

    const candidateFunctionCalls = response.functionCalls();
    if (candidateFunctionCalls && candidateFunctionCalls.length > 0) {
      for (const functionCall of candidateFunctionCalls) {
        let description = '';
        switch(functionCall.name) {
          case 'read_file':
            description = `Read file: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'process_file':
            description = `Process file: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'write_file':
            description = `Write to file: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'read_directory':
            description = `List contents of: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'get_tree':
            description = `Get tree for: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'move_item':
            description = `Move item from ${ (functionCall.args as any)?.sourcePath } to ${ (functionCall.args as any)?.destinationPath }`;
            break;
          case 'create_directory':
            description = `Create directory '${(functionCall.args as any)?.name}' in '${(functionCall.args as any)?.path}'`;
            break;
          case 'navigate_user':
            description = `Navigate to: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'rename_file':
            description = `Rename file: ${(functionCall.args as any)?.path || 'unknown path'} to ${(functionCall.args as any)?.newName || 'unknown name'}`;
            break;
          case 'delete_item':
            description = `Delete item: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'copy_file':
            description = `Copy file: ${(functionCall.args as any)?.path || 'unknown path'} to ${(functionCall.args as any)?.destinationPath || 'unknown destination path'}`;
            break;
          default:
            description = `Execute ${functionCall.name}`;
        }
        
        const toolCall: ToolCall = {
          id: generateToolCallId(),
          type: functionCall.name as any,
          parameters: functionCall.args as any,
          description: description,
          risk: determineRisk(functionCall.name, functionCall.args)
        };
        toolCalls.push(toolCall);
      }
    }

    return {
      response: response.text() || 'I can help you with file operations.',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    };
  } catch (error) {
    console.error('AI processing error:', error);
    throw error;
  }
}

async function generateTree(dirPath: string, prefix = ''): Promise<string> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
    });

    let treeString = '';
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        treeString += `${prefix}${connector}${entry.name}\n`;
        if (entry.isDirectory()) {
            const newPrefix = prefix + (isLast ? '    ' : '│   ');
            try {
                treeString += await generateTree(path.join(dirPath, entry.name), newPrefix);
            } catch (error) {
                treeString += `${newPrefix}└── [error reading directory]\n`;
            }
        }
    }
    return treeString;
}

async function processFollowUpWithAI(originalPrompt: string, context: AIContext, toolResults: any): Promise<AIResponse> {
  try {
    if (!genAI) {
        return { response: 'AI is not configured. Please set the API key in settings.' };
    }

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0 }
    });

    let toolResultsText = '';
    const fileParts: any[] = [];
    const results = Array.isArray(toolResults) ? toolResults : [toolResults];
    let hasNavigation = false;
    let navigationPath = '';

    for (const toolResult of results) {
        if (toolResult.status === 'denied') {
            toolResultsText += `Tool call for '${toolResult.toolCallId}' was denied by the user.\n\n`;
            continue;
        }

        if (toolResult.result?.isFile && toolResult.result?.mimeType && toolResult.result?.data) { // process_file
            fileParts.push({ 
                inlineData: { 
                    mimeType: toolResult.result.mimeType, 
                    data: toolResult.result.data 
                } 
            });
            toolResultsText += `The file ${toolResult.result.path} has been processed and is included in the context for analysis.\n\n`;
        } else if (toolResult.result?.content) { // read_file
            const path = toolResult.result.path || 'unknown file';
            const content = toolResult.result.content;
            if (content.length > 2000) {
                toolResultsText += `Content of ${path} (first 2000 characters):\n${content.substring(0, 2000)}\n...(content truncated)\n\n`;
            } else {
                toolResultsText += `Content of ${path}:\n${content}\n\n`;
            }
        } else if (toolResult.result?.files) { // read_directory
            const path = toolResult.result.path || 'unknown directory';
            const fileList = (toolResult.result.files as FileItem[]).map(f => `${f.isDirectory ? '📁' : '📄'} ${f.name}`).join('\n');
            toolResultsText += `Directory listing for ${path}:\n${fileList}\n\n`;
        } else if (toolResult.result?.tree) { // get_tree
            const path = toolResult.result.path || 'unknown directory';
            toolResultsText += `Directory tree for ${path}:\n${toolResult.result.tree}\n\n`;
        } else if (toolResult.result?.navigationPath) { // navigate_user
            hasNavigation = true;
            navigationPath = toolResult.result.navigationPath;
            toolResultsText += `Successfully navigated the user to: ${navigationPath}\n\n`;
        } else if (toolResult.result?.message) { // move_item and others
             toolResultsText += `Tool call for '${toolResult.toolCallId}' completed successfully: ${toolResult.result.message}\n\n`;
        } else if (toolResult.error) {
            toolResultsText += `Tool execution for '${toolResult.toolCallId}' failed: ${toolResult.error}\n\n`;
        } else {
            toolResultsText += `Tool result for '${toolResult.toolCallId}': ${JSON.stringify(toolResult.result, null, 2)}\n\n`;
        }
    }
    
    if (results.length > 1) {
        toolResultsText = `I have executed multiple tool calls and retrieved the following information:\n${toolResultsText}`;
    } else {
        toolResultsText = `I have executed a tool call and retrieved the following information:\n${toolResultsText}`;
    }

    let chatHistoryText = '';
    if (context.chatHistory?.messages && context.chatHistory.messages.length > 0) {
      const truncatedHistory = truncateChatHistory(context.chatHistory.messages, 1000);
      chatHistoryText = `\nRecent conversation history:\n${truncatedHistory.map(msg => 
        `${msg.type.toUpperCase()}: ${msg.content}`
      ).join('\n')}\n`;
    }

    let fileContentsText = '';
    if (context.chatHistory?.fileContents && context.chatHistory.fileContents.length > 0) {
      fileContentsText = `\nPreviously read files:\n${context.chatHistory.fileContents.map(file => 
        `File: ${file.path}\nContent: ${file.content.substring(0, 500)}${file.content.length > 500 ? '...(truncated)' : ''}`
      ).join('\n\n')}\n`;
    }

    const navigationContext = hasNavigation 
        ? `- Current path: ${context.currentPath} (just navigated here from previous location)`
        : `- Current path: ${context.currentPath}`;

    const followUpPrompt = `You are a helpful file system assistant. Be concise and direct in your responses unless the user specifically asks for detailed explanations.

Current directory context:
${navigationContext}
- Folders: ${context.folders.join(', ') || 'None'}
- Files: ${context.files.join(', ') || 'None'}
${chatHistoryText}${fileContentsText}
Original user request: ${originalPrompt}

I have executed a tool call and retrieved the following information:
${toolResultsText}

Now, analyze the results. If the original request is fully addressed, provide a final, concise response. If more steps are needed, you can use tools again. For example, after reading a file, you might need to move it. Also, inform the user about any actions they denied.`;

    const functionDeclarations = [readFileFunction, readDirectoryFunction, getTreeFunction, moveItemFunction, createDirectoryFunction, writeFileFunction, navigateUserFunction, renameFileFunction, deleteItemFunction, copyFileFunction];
    if (settings.multimediaSupport) {
      functionDeclarations.push(processFileFunction);
    }
    
    const userParts = [{ text: followUpPrompt }, ...fileParts];

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: userParts }],
      tools: [{
        functionDeclarations: functionDeclarations
      }]
    });

    const response = result.response;
    const toolCalls: ToolCall[] = [];

    const candidateFunctionCalls = response.functionCalls();
    if (candidateFunctionCalls && candidateFunctionCalls.length > 0) {
      for (const functionCall of candidateFunctionCalls) {
        let description = '';
        switch(functionCall.name) {
          case 'read_file':
            description = `Read file: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'process_file':
            description = `Process file: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'write_file':
            description = `Write to file: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'read_directory':
            description = `List contents of: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'get_tree':
            description = `Get tree for: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'move_item':
            description = `Move item from ${ (functionCall.args as any)?.sourcePath } to ${ (functionCall.args as any)?.destinationPath }`;
            break;
          case 'create_directory':
            description = `Create directory '${(functionCall.args as any)?.name}' in '${(functionCall.args as any)?.path}'`;
            break;
          case 'navigate_user':
            description = `Navigate to: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'rename_file':
            description = `Rename file: ${(functionCall.args as any)?.path || 'unknown path'} to ${(functionCall.args as any)?.newName || 'unknown name'}`;
            break;
          case 'delete_item':
            description = `Delete item: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'copy_file':
            description = `Copy file: ${(functionCall.args as any)?.path || 'unknown path'} to ${(functionCall.args as any)?.destinationPath || 'unknown destination path'}`;
            break;
          default:
            description = `Execute ${functionCall.name}`;
        }
        
        const toolCall: ToolCall = {
          id: generateToolCallId(),
          type: functionCall.name as any,
          parameters: functionCall.args as any,
          description: description,
          risk: determineRisk(functionCall.name, functionCall.args)
        };
        toolCalls.push(toolCall);
      }
    }

    return {
      response: response.text() || 'I have processed the tool results but cannot provide a response.',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    };
  } catch (error) {
    console.error('Follow-up AI processing error:', error);
    throw error;
  }
}

app.get('/health', (req, res) => {
  res.json(createResponse(true, { message: 'FSai Backend is running' }));
});

app.get('/api/settings', (req, res) => {
    res.json(createResponse(true, settings));
});

app.post('/api/settings', async (req, res) => {
    try {
        const newSettings = req.body;
        settings = { ...settings, ...newSettings };
        await saveSettings();
        
        if (newSettings.apiKey !== undefined) {
            initializeGenAI();
        }
        
        res.json(createResponse(true, settings));
    } catch (error) {
        res.json(createResponse(false, null, `Failed to save settings: ${error}`));
    }
});

app.get('/api/fs/home', (req, res) => {
  try {
    const homeDir = os.homedir();
    
    const normalizedHomeDir = path.resolve(homeDir);
    
    res.json(createResponse(true, { 
      path: normalizedHomeDir,
      platform: os.platform()
    }));
  } catch (error) {
    res.json(createResponse(false, null, `Failed to get home directory: ${error}`));
  }
});

app.post('/api/fs/list', async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    
    if (!dirPath || typeof dirPath !== 'string') {
      return res.json(createResponse(false, null, 'Path is required'));
    }

    if (!isPathAllowed(dirPath, settings.allowRootAccess)) {
        return res.json(createResponse(false, null, `Access to path '${dirPath}' is disallowed by settings.`));
    }

    const normalizedPath = path.resolve(dirPath);
    
    if (!existsSync(normalizedPath)) {
      return res.json(createResponse(false, null, 'Directory does not exist'));
    }

    const stat = statSync(normalizedPath);
    if (!stat.isDirectory()) {
      return res.json(createResponse(false, null, 'Path is not a directory'));
    }

    const entries = await fs.readdir(normalizedPath);
    const files: FileItem[] = [];

    for (const entry of entries) {
      try {
        const fullPath = path.join(normalizedPath, entry);
        const entryStat = statSync(fullPath);
        
        files.push({
          name: entry,
          isDirectory: entryStat.isDirectory(),
          isFile: entryStat.isFile(),
          path: fullPath
        });
      } catch (e) {
        console.warn(`Could not read entry ${entry}:`, e);
      }
    }

    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json(createResponse(true, files));
  } catch (error) {
    res.json(createResponse(false, null, `Failed to list directory: ${error}`));
  }
});

// Read file content
app.post('/api/fs/read', async (req, res) => {
  try {
    const { path: filePath } = req.body;
    
    if (!filePath || typeof filePath !== 'string') {
      return res.json(createResponse(false, null, 'Path is required'));
    }

    if (!isPathAllowed(filePath, settings.allowRootAccess)) {
        return res.json(createResponse(false, null, `Access to path '${filePath}' is disallowed by settings.`));
    }

    const normalizedPath = path.resolve(filePath);
    
    if (!existsSync(normalizedPath)) {
      return res.json(createResponse(false, null, 'File does not exist'));
    }

    const stat = statSync(normalizedPath);
    if (!stat.isFile()) {
      return res.json(createResponse(false, null, 'Path is not a file'));
    }

    const content = await fs.readFile(normalizedPath, 'utf8');
    res.json(createResponse(true, { content, path: normalizedPath }));
  } catch (error) {
    res.json(createResponse(false, null, `Failed to read file: ${error}`));
  }
});

// Write file content
app.post('/api/fs/write', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    
    if (!filePath || typeof filePath !== 'string') {
      return res.json(createResponse(false, null, 'Path is required'));
    }

    if (!isPathAllowed(filePath, settings.allowRootAccess)) {
        return res.json(createResponse(false, null, `Access to path '${filePath}' is disallowed by settings.`));
    }

    if (typeof content !== 'string') {
      return res.json(createResponse(false, null, 'Content must be a string'));
    }

    const normalizedPath = path.resolve(filePath);
    
    const dir = path.dirname(normalizedPath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(normalizedPath, content, 'utf8');
    res.json(createResponse(true, { message: 'File written successfully', path: normalizedPath }));
  } catch (error) {
    res.json(createResponse(false, null, `Failed to write file: ${error}`));
  }
});

// Delete file or directory
app.post('/api/fs/delete', async (req, res) => {
  try {
    const { path: targetPath } = req.body;
    
    if (!targetPath || typeof targetPath !== 'string') {
      return res.json(createResponse(false, null, 'Path is required'));
    }

    if (!isPathAllowed(targetPath, settings.allowRootAccess)) {
        return res.json(createResponse(false, null, `Access to path '${targetPath}' is disallowed by settings.`));
    }

    const normalizedPath = path.resolve(targetPath);
    
    if (!existsSync(normalizedPath)) {
      return res.json(createResponse(false, null, 'File or directory does not exist'));
    }

    const stat = statSync(normalizedPath);
    
    if (stat.isDirectory()) {
      await fs.rmdir(normalizedPath, { recursive: true });
      res.json(createResponse(true, { message: 'Directory deleted successfully', path: normalizedPath }));
    } else {
      await fs.unlink(normalizedPath);
      res.json(createResponse(true, { message: 'File deleted successfully', path: normalizedPath }));
    }
  } catch (error) {
    res.json(createResponse(false, null, `Failed to delete: ${error}`));
  }
});

// Rename file or directory
app.post('/api/fs/rename', async (req, res) => {
  try {
    const { path: targetPath, newName } = req.body;
    
    if (!targetPath || typeof targetPath !== 'string') {
      return res.json(createResponse(false, null, 'Path is required'));
    }

    if (!newName || typeof newName !== 'string') {
      return res.json(createResponse(false, null, 'New name is required'));
    }

    if (!isPathAllowed(targetPath, settings.allowRootAccess)) {
        return res.json(createResponse(false, null, `Access to path '${targetPath}' is disallowed by settings.`));
    }

    const normalizedPath = path.resolve(targetPath);
    
    if (!existsSync(normalizedPath)) {
      return res.json(createResponse(false, null, 'File or directory does not exist'));
    }

    const parentDir = path.dirname(normalizedPath);
    const newPath = path.join(parentDir, newName);

    if (existsSync(newPath)) {
      return res.json(createResponse(false, null, `A file or directory with the name '${newName}' already exists`));
    }

    await fs.rename(normalizedPath, newPath);
    res.json(createResponse(true, { message: `Renamed '${path.basename(normalizedPath)}' to '${newName}'`, path: newPath }));
  } catch (error) {
    res.json(createResponse(false, null, `Failed to rename: ${error}`));
  }
});

// Copy file
app.post('/api/fs/copy', async (req, res) => {
  try {
    const { path: sourcePath, destinationPath } = req.body;
    
    if (!sourcePath || typeof sourcePath !== 'string') {
      return res.json(createResponse(false, null, 'Source path is required'));
    }

    if (!destinationPath || typeof destinationPath !== 'string') {
      return res.json(createResponse(false, null, 'Destination path is required'));
    }

    if (!isPathAllowed(sourcePath, settings.allowRootAccess) || !isPathAllowed(destinationPath, settings.allowRootAccess)) {
        return res.json(createResponse(false, null, `Access to one or more paths is disallowed by settings.`));
    }

    const normalizedSourcePath = path.resolve(sourcePath);
    const normalizedDestinationPath = path.resolve(destinationPath);
    
    if (!existsSync(normalizedSourcePath)) {
      return res.json(createResponse(false, null, 'Source file does not exist'));
    }

    const sourceStat = statSync(normalizedSourcePath);
    if (!sourceStat.isFile()) {
      return res.json(createResponse(false, null, 'Source path is not a file. Only files can be copied.'));
    }

    let finalDestinationPath = normalizedDestinationPath;
    if (existsSync(normalizedDestinationPath) && statSync(normalizedDestinationPath).isDirectory()) {
      finalDestinationPath = path.join(normalizedDestinationPath, path.basename(normalizedSourcePath));
    }

    const destDir = path.dirname(finalDestinationPath);
    await fs.mkdir(destDir, { recursive: true });

    await fs.copyFile(normalizedSourcePath, finalDestinationPath);
    res.json(createResponse(true, { message: `File copied from '${normalizedSourcePath}' to '${finalDestinationPath}'`, path: finalDestinationPath }));
  } catch (error) {
    res.json(createResponse(false, null, `Failed to copy file: ${error}`));
  }
});

// Check if a file is text or binary
app.post('/api/fs/check-type', async (req, res) => {
  try {
    const { path: filePath } = req.body;

    if (!filePath || typeof filePath !== 'string') {
      return res.json(createResponse(false, null, 'Path is required'));
    }

    if (!isPathAllowed(filePath, settings.allowRootAccess)) {
        return res.json(createResponse(false, null, `Access to path '${filePath}' is disallowed by settings.`));
    }

    const normalizedPath = path.resolve(filePath);

    if (!existsSync(normalizedPath)) {
      return res.json(createResponse(false, { isText: false, reason: 'File does not exist' }, 'File does not exist'));
    }

    const stat = statSync(normalizedPath);
    if (!stat.isFile()) {
      return res.json(createResponse(false, { isText: false, reason: 'Path is not a file' }, 'Path is not a file'));
    }

    const buffer = Buffer.alloc(512);
    const fd = await fs.open(normalizedPath, 'r');
    const { bytesRead } = await fd.read(buffer, 0, 512, 0);
    await fd.close();

    const chunk = buffer.slice(0, bytesRead);
    let isText = true;
    for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0) {
            isText = false;
            break;
        }
    }

    res.json(createResponse(true, { isText }));
  } catch (error) {
    res.json(createResponse(false, null, `Failed to check file type: ${error}`));
  }
});

// Create directory
app.post('/api/fs/mkdir', async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    
    if (!dirPath || typeof dirPath !== 'string') {
      return res.json(createResponse(false, null, 'Path is required'));
    }

    if (!isPathAllowed(dirPath, settings.allowRootAccess)) {
        return res.json(createResponse(false, null, `Access to path '${dirPath}' is disallowed by settings.`));
    }

    const normalizedPath = path.resolve(dirPath);
    
    if (existsSync(normalizedPath)) {
      return res.json(createResponse(false, null, 'Directory already exists'));
    }

    await fs.mkdir(normalizedPath, { recursive: true });
    res.json(createResponse(true, { message: 'Directory created successfully', path: normalizedPath }));
  } catch (error) {
    res.json(createResponse(false, null, `Failed to create directory: ${error}`));
  }
});

// AI processing endpoint
app.post('/api/ai/process', strictLimiter, async (req, res) => {
  try {
    const { prompt, context }: AIRequest = req.body;
    
    if (!prompt || typeof prompt !== 'string') {
      return res.json(createResponse(false, null, 'Prompt is required'));
    }

    if (!context || !context.currentPath) {
      return res.json(createResponse(false, null, 'Context with currentPath is required'));
    }

    const aiResponse = await processWithAI(prompt, context);
    res.json(createResponse(true, aiResponse));
  } catch (error) {
    res.json(createResponse(false, null, `AI processing failed: ${error}`));
  }
});

// Execute tool call endpoint (for confirmed tool calls)
app.post('/api/ai/execute-tool', aiLimiter, async (req, res) => {
  try {
    const { toolCall, context }: { toolCall: ToolCall; context?: AIContext } = req.body;
    
    if (!toolCall || !toolCall.id || !toolCall.type) {
      return res.json(createResponse(false, null, 'Valid toolCall is required'));
    }

    const allowRootAccess = context?.settings?.allowRootAccess ?? settings.allowRootAccess;

    switch (toolCall.type) {
      case 'read_file':
        if (!toolCall.parameters.path) {
          return res.json(createResponse(false, null, 'Path parameter is required for read_file'));
        }
        if (!isPathAllowed(toolCall.parameters.path, allowRootAccess, context?.currentPath)) {
          return res.json(createResponse(false, null, `Access to path '${toolCall.parameters.path}' is disallowed.`));
        }
        
        let normalizedPath: string;
        if (context?.currentPath && !path.isAbsolute(toolCall.parameters.path)) {
          normalizedPath = path.resolve(context.currentPath, toolCall.parameters.path);
        } else {
          normalizedPath = path.resolve(toolCall.parameters.path);
        }
        
        if (!existsSync(normalizedPath)) {
          return res.json(createResponse(false, null, `File does not exist: ${normalizedPath}`));
        }

        const stat = statSync(normalizedPath);
        if (!stat.isFile()) {
          return res.json(createResponse(false, null, 'Path is not a file'));
        }

        const content = await fs.readFile(normalizedPath, 'utf8');
        res.json(createResponse(true, { 
          toolCallId: toolCall.id,
          result: { content, path: normalizedPath },
          message: 'File read successfully'
        }));
        break;
        
      case 'read_directory':
        if (!toolCall.parameters.path) {
            return res.json(createResponse(false, null, 'Path parameter is required for read_directory'));
        }
        if (!isPathAllowed(toolCall.parameters.path, allowRootAccess, context?.currentPath)) {
            return res.json(createResponse(false, null, `Access to path '${toolCall.parameters.path}' is disallowed.`));
        }

        const dirPath = toolCall.parameters.path;
        let normalizedDirPath: string;
        if (context?.currentPath && !path.isAbsolute(dirPath)) {
          normalizedDirPath = path.resolve(context.currentPath, dirPath);
        } else {
          normalizedDirPath = path.resolve(dirPath);
        }

        if (!existsSync(normalizedDirPath)) {
            return res.json(createResponse(false, null, `Directory does not exist: ${normalizedDirPath}`));
        }

        const dirStat = statSync(normalizedDirPath);
        if (!dirStat.isDirectory()) {
            return res.json(createResponse(false, null, 'Path is not a directory'));
        }

        const entries = await fs.readdir(normalizedDirPath);
        const files: FileItem[] = [];

        for (const entry of entries) {
            try {
                const fullPath = path.join(normalizedDirPath, entry);
                const entryStat = statSync(fullPath);
                
                files.push({
                    name: entry,
                    isDirectory: entryStat.isDirectory(),
                    isFile: entryStat.isFile(),
                    path: fullPath
                });
            } catch (e) {
                console.warn(`Could not read entry ${entry}:`, e);
            }
        }

        files.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
        
        res.json(createResponse(true, {
            toolCallId: toolCall.id,
            result: { files, path: normalizedDirPath },
            message: 'Directory listed successfully'
        }));
        break;

      case 'get_tree': {
        if (!toolCall.parameters.path) {
          return res.json(createResponse(false, null, 'Path parameter is required for get_tree'));
        }
        if (!isPathAllowed(toolCall.parameters.path, allowRootAccess, context?.currentPath)) {
          return res.json(createResponse(false, null, `Access to path '${toolCall.parameters.path}' is disallowed.`));
        }

        const treeDirPath = toolCall.parameters.path;
        let normalizedTreePath: string;
        if (context?.currentPath && !path.isAbsolute(treeDirPath)) {
          normalizedTreePath = path.resolve(context.currentPath, treeDirPath);
        } else {
          normalizedTreePath = path.resolve(treeDirPath);
        }

        if (!existsSync(normalizedTreePath)) {
          return res.json(createResponse(false, null, `Directory does not exist: ${normalizedTreePath}`));
        }

        const treeDirStat = statSync(normalizedTreePath);
        if (!treeDirStat.isDirectory()) {
          return res.json(createResponse(false, null, 'Path is not a directory'));
        }

        const tree = await generateTree(normalizedTreePath);
        res.json(createResponse(true, {
          toolCallId: toolCall.id,
          result: { tree, path: normalizedTreePath },
          message: 'Directory tree generated successfully'
        }));
        break;
      }

      case 'move_item': {
        const { sourcePath, destinationPath } = toolCall.parameters;

        if (!sourcePath || !destinationPath) {
          return res.json(createResponse(false, null, 'sourcePath and destinationPath are required for move_item'));
        }
        if (!isPathAllowed(sourcePath, allowRootAccess, context?.currentPath) || !isPathAllowed(destinationPath, allowRootAccess, context?.currentPath)) {
            return res.json(createResponse(false, null, `Access to one or more paths is disallowed.`));
        }

        let normalizedSourcePath: string;
        if (context?.currentPath && !path.isAbsolute(sourcePath)) {
          normalizedSourcePath = path.resolve(context.currentPath, sourcePath);
        } else {
          normalizedSourcePath = path.resolve(sourcePath);
        }

        let normalizedDestinationPath: string;
        if (context?.currentPath && !path.isAbsolute(destinationPath)) {
          normalizedDestinationPath = path.resolve(context.currentPath, destinationPath);
        } else {
          normalizedDestinationPath = path.resolve(destinationPath);
        }
        
        if (!existsSync(normalizedSourcePath)) {
          return res.json(createResponse(false, null, `Source path does not exist: ${normalizedSourcePath}`));
        }

        let finalDestinationPath = normalizedDestinationPath;
        if (existsSync(normalizedDestinationPath) && statSync(normalizedDestinationPath).isDirectory()) {
            finalDestinationPath = path.join(normalizedDestinationPath, path.basename(normalizedSourcePath));
        }
        
        await fs.rename(normalizedSourcePath, finalDestinationPath);

        res.json(createResponse(true, {
          toolCallId: toolCall.id,
          result: { message: `Moved '${normalizedSourcePath}' to '${finalDestinationPath}'` },
          message: 'Item moved successfully'
        }));
        break;
      }

      case 'create_directory': {
        const { path: dirPath, name: folderName } = toolCall.parameters;

        if (!dirPath || !folderName) {
          return res.json(createResponse(false, null, 'path and name parameters are required for create_directory'));
        }
        if (!isPathAllowed(dirPath, allowRootAccess, context?.currentPath)) {
            return res.json(createResponse(false, null, `Access to path '${dirPath}' is disallowed.`));
        }

        let normalizedPath: string;
        if (context?.currentPath && !path.isAbsolute(dirPath)) {
          normalizedPath = path.resolve(context.currentPath, dirPath, folderName);
        } else {
          normalizedPath = path.resolve(dirPath, folderName);
        }
        
        if (existsSync(normalizedPath)) {
          return res.json(createResponse(false, null, `Directory already exists: ${normalizedPath}`));
        }

        await fs.mkdir(normalizedPath, { recursive: true });
        res.json(createResponse(true, {
          toolCallId: toolCall.id,
          result: { message: `Directory '${folderName}' created at '${dirPath}'` },
          message: 'Directory created successfully'
        }));
        break;
      }

      case 'write_file': {
        const { path: filePath, content: fileContent } = toolCall.parameters;
        if (!filePath || fileContent === undefined) {
          return res.json(createResponse(false, null, 'Path and content parameters are required for write_file'));
        }
        if (!isPathAllowed(filePath, allowRootAccess, context?.currentPath)) {
            return res.json(createResponse(false, null, `Access to path '${filePath}' is disallowed.`));
        }

        let resolvedPath: string;
        if (context?.currentPath && !path.isAbsolute(filePath)) {
          resolvedPath = path.resolve(context.currentPath, filePath);
        } else {
          resolvedPath = path.resolve(filePath);
        }

        const dir = path.dirname(resolvedPath);
        await fs.mkdir(dir, { recursive: true });

        await fs.writeFile(resolvedPath, fileContent, 'utf8');

        res.json(createResponse(true, {
            toolCallId: toolCall.id,
            result: { message: `File written successfully to ${resolvedPath}` },
            message: 'File written successfully'
        }));
        break;
      }

      case 'process_file': {
        if (!toolCall.parameters.path) {
          return res.json(createResponse(false, null, 'Path parameter is required for process_file'));
        }
        if (!isPathAllowed(toolCall.parameters.path, allowRootAccess, context?.currentPath)) {
          return res.json(createResponse(false, null, `Access to path '${toolCall.parameters.path}' is disallowed.`));
        }

        let normalizedPath: string;
        if (context?.currentPath && !path.isAbsolute(toolCall.parameters.path)) {
          normalizedPath = path.resolve(context.currentPath, toolCall.parameters.path);
        } else {
          normalizedPath = path.resolve(toolCall.parameters.path);
        }

        if (!existsSync(normalizedPath)) {
          return res.json(createResponse(false, null, `File does not exist: ${normalizedPath}`));
        }
        
        const stat = statSync(normalizedPath);
        if (!stat.isFile()) {
          return res.json(createResponse(false, null, 'Path is not a file'));
        }

        const mimeType = lookup(normalizedPath) || 'application/octet-stream';

        const supportedImageMimes = ['image/png', 'image/jpeg', 'image/webp'];
        const supportedPdfMimes = ['application/pdf'];
        const supportedVideoMimes = ['video/x-flv', 'video/quicktime', 'video/mpeg', 'video/mp4', 'video/webm', 'video/wmv', 'video/3gpp'];
        const isSupportedImage = supportedImageMimes.includes(mimeType);
        const isSupportedPdf = supportedPdfMimes.includes(mimeType);
        const isSupportedVideo = supportedVideoMimes.includes(mimeType);

        if (!isSupportedImage && !isSupportedPdf && !isSupportedVideo) {
          return res.json(createResponse(false, null, `Unsupported file type: ${mimeType}. This tool supports images (PNG, JPEG, WEBP), PDFs, and videos.`));
        }

        const MAX_IMAGE_PDF_SIZE = 7 * 1024 * 1024; // 7 MB
        const MAX_VIDEO_SIZE = 45 * 1024 * 1024; // 45 MB

        if ((isSupportedImage || isSupportedPdf) && stat.size > MAX_IMAGE_PDF_SIZE) {
          return res.json(createResponse(false, null, `File size (${(stat.size / 1024 / 1024).toFixed(2)} MB) exceeds the 7 MB limit for images and PDFs.`));
        }
        if (isSupportedVideo && stat.size > MAX_VIDEO_SIZE) {
          return res.json(createResponse(false, null, `File size (${(stat.size / 1024 / 1024).toFixed(2)} MB) exceeds the 45 MB limit for videos.`));
        }

        const data = await fs.readFile(normalizedPath, 'base64');

        res.json(createResponse(true, { 
          toolCallId: toolCall.id,
          result: { path: normalizedPath, mimeType, data, isFile: true },
          message: 'File processed successfully'
        }));
        break;
      }

      case 'navigate_user': {
        if (!toolCall.parameters.path) {
          return res.json(createResponse(false, null, 'Path parameter is required for navigate_user'));
        }
        if (!isPathAllowed(toolCall.parameters.path, allowRootAccess, context?.currentPath)) {
          return res.json(createResponse(false, null, `Access to path '${toolCall.parameters.path}' is disallowed.`));
        }

        let navigationPath: string;
        if (context?.currentPath && !path.isAbsolute(toolCall.parameters.path)) {
          navigationPath = path.resolve(context.currentPath, toolCall.parameters.path);
        } else {
          navigationPath = path.resolve(toolCall.parameters.path);
        }

        if (!existsSync(navigationPath)) {
          return res.json(createResponse(false, null, `Path does not exist: ${navigationPath}`));
        }

        const navigationStat = statSync(navigationPath);
        if (!navigationStat.isDirectory()) {
          return res.json(createResponse(false, null, 'Path is not a directory'));
        }

        res.json(createResponse(true, {
          toolCallId: toolCall.id,
          result: { 
            navigationPath: navigationPath, 
            message: `Navigate to: ${navigationPath}` 
          },
          message: 'Navigation path validated successfully'
        }));
        break;
      }

      case 'rename_file': {
        const { path: filePath, newName } = toolCall.parameters;

        if (!filePath || !newName) {
          return res.json(createResponse(false, null, 'path and newName parameters are required for rename_file'));
        }
        if (!isPathAllowed(filePath, allowRootAccess, context?.currentPath)) {
          return res.json(createResponse(false, null, `Access to path '${filePath}' is disallowed.`));
        }

        let normalizedPath: string;
        if (context?.currentPath && !path.isAbsolute(filePath)) {
          normalizedPath = path.resolve(context.currentPath, filePath);
        } else {
          normalizedPath = path.resolve(filePath);
        }

        if (!existsSync(normalizedPath)) {
          return res.json(createResponse(false, null, `File or directory does not exist: ${normalizedPath}`));
        }

        const parentDir = path.dirname(normalizedPath);
        const newPath = path.join(parentDir, newName);

        if (existsSync(newPath)) {
          return res.json(createResponse(false, null, `A file or directory with the name '${newName}' already exists`));
        }

        await fs.rename(normalizedPath, newPath);

        res.json(createResponse(true, {
          toolCallId: toolCall.id,
          result: { message: `Renamed '${path.basename(normalizedPath)}' to '${newName}'` },
          message: 'Item renamed successfully'
        }));
        break;
      }

      case 'delete_item': {
        const { path: filePath } = toolCall.parameters;

        if (!filePath) {
          return res.json(createResponse(false, null, 'path parameter is required for delete_item'));
        }
        if (!isPathAllowed(filePath, allowRootAccess, context?.currentPath)) {
          return res.json(createResponse(false, null, `Access to path '${filePath}' is disallowed.`));
        }

        let normalizedPath: string;
        if (context?.currentPath && !path.isAbsolute(filePath)) {
          normalizedPath = path.resolve(context.currentPath, filePath);
        } else {
          normalizedPath = path.resolve(filePath);
        }

        if (!existsSync(normalizedPath)) {
          return res.json(createResponse(false, null, `File or directory does not exist: ${normalizedPath}`));
        }

        const stat = statSync(normalizedPath);
        
        if (stat.isDirectory()) {
          await fs.rmdir(normalizedPath, { recursive: true });
          res.json(createResponse(true, {
            toolCallId: toolCall.id,
            result: { message: `Directory '${path.basename(normalizedPath)}' deleted successfully` },
            message: 'Directory deleted successfully'
          }));
        } else {
          await fs.unlink(normalizedPath);
          res.json(createResponse(true, {
            toolCallId: toolCall.id,
            result: { message: `File '${path.basename(normalizedPath)}' deleted successfully` },
            message: 'File deleted successfully'
          }));
        }
        break;
      }

      case 'copy_file': {
        const { path: sourcePath, destinationPath } = toolCall.parameters;

        if (!sourcePath || !destinationPath) {
          return res.json(createResponse(false, null, 'path and destinationPath parameters are required for copy_file'));
        }
        if (!isPathAllowed(sourcePath, allowRootAccess, context?.currentPath) || !isPathAllowed(destinationPath, allowRootAccess, context?.currentPath)) {
          return res.json(createResponse(false, null, `Access to one or more paths is disallowed.`));
        }

        let normalizedSourcePath: string;
        if (context?.currentPath && !path.isAbsolute(sourcePath)) {
          normalizedSourcePath = path.resolve(context.currentPath, sourcePath);
        } else {
          normalizedSourcePath = path.resolve(sourcePath);
        }

        let normalizedDestinationPath: string;
        if (context?.currentPath && !path.isAbsolute(destinationPath)) {
          normalizedDestinationPath = path.resolve(context.currentPath, destinationPath);
        } else {
          normalizedDestinationPath = path.resolve(destinationPath);
        }

        if (!existsSync(normalizedSourcePath)) {
          return res.json(createResponse(false, null, `Source file does not exist: ${normalizedSourcePath}`));
        }

        const sourceStat = statSync(normalizedSourcePath);
        if (!sourceStat.isFile()) {
          return res.json(createResponse(false, null, 'Source path is not a file. Only files can be copied with this tool.'));
        }

        let finalDestinationPath = normalizedDestinationPath;
        if (existsSync(normalizedDestinationPath) && statSync(normalizedDestinationPath).isDirectory()) {
          finalDestinationPath = path.join(normalizedDestinationPath, path.basename(normalizedSourcePath));
        }

        const destDir = path.dirname(finalDestinationPath);
        await fs.mkdir(destDir, { recursive: true });

        await fs.copyFile(normalizedSourcePath, finalDestinationPath);

        res.json(createResponse(true, {
          toolCallId: toolCall.id,
          result: { message: `File copied from '${normalizedSourcePath}' to '${finalDestinationPath}'` },
          message: 'File copied successfully'
        }));
        break;
      }
        
      default:
        res.json(createResponse(false, null, `Tool type '${toolCall.type}' not yet implemented`));
    }
  } catch (error) {
    res.json(createResponse(false, null, `Tool execution failed: ${error}`));
  }
});

// Follow-up AI processing after tool execution
app.post('/api/ai/process-followup', strictLimiter, async (req, res) => {
  try {
    const { originalPrompt, context, toolResults } = req.body;
    
    if (!originalPrompt || typeof originalPrompt !== 'string') {
      return res.json(createResponse(false, null, 'Original prompt is required'));
    }

    if (!context || !context.currentPath) {
      return res.json(createResponse(false, null, 'Context with currentPath is required'));
    }

    if (!toolResults) {
      return res.json(createResponse(false, null, 'Tool results are required'));
    }

    const aiResponse = await processFollowUpWithAI(originalPrompt, context, toolResults);
    res.json(createResponse(true, aiResponse));
  } catch (error) {
    res.json(createResponse(false, null, `Follow-up AI processing failed: ${error}`));
  }
});

async function startServer() {
    await loadSettings();
    initializeGenAI();

    const server = app.listen(PORT, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
            const actualPort = address.port;
            console.log(`BACKEND_PORT:${actualPort}`);
        }
    });

    process.on('SIGTERM', () => {
        server.close(() => {
            process.exit(0);
        });
    });

    process.on('SIGINT', () => {
        server.close(() => {
            process.exit(0);
        });
    });
}

const PORT = parseInt(process.env.PORT || '0'); 

startServer();