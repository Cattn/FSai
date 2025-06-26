import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { existsSync, statSync } from 'fs';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import dotenv from 'dotenv';
import { execSync } from 'child_process';

// Load environment variables
dotenv.config();

// Function to read environment variable from system
function readSystemEnvVariable(variableName: string): string {
  try {
    // Try process.env first
    if (process.env[variableName]) {
      return process.env[variableName];
    }
    
    // If not found, try to read from system environment
    const command = os.platform() === 'win32' 
      ? `echo $env:${variableName}` 
      : `printenv ${variableName}`;
    
    const result = execSync(command, { encoding: 'utf8' }).trim();
    
    // On Windows, if the variable doesn't exist, it returns %VARIABLE_NAME%
    if (os.platform() === 'win32' && result === `%${variableName}%`) {
      throw new Error(`Environment variable ${variableName} not found`);
    }
    
    return result;
  } catch (error) {
    console.warn(`Failed to read environment variable ${variableName}:`, error);
    return '';
  }
}

// Get GEMINI_API_KEY from system environment
const GEMINI_API_KEY = readSystemEnvVariable('GEMINI_API_KEY');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

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
}

interface ToolCall {
  id: string;
  type: 'read_file' | 'delete_file' | 'move_file' | 'rename_file' | 'create_directory' | 'copy_file' | 'read_directory';
  parameters: {
    path?: string;
    from?: string;
    to?: string;
    name?: string;
    content?: string;
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
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || '');

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

function generateToolCallId(): string {
  return 'tc_' + Math.random().toString(36).substring(2, 11);
}

function determineRisk(toolType: string, parameters: any): 'low' | 'high' {
  switch (toolType) {
    case 'read_file':
    case 'read_directory':
      return 'low';
    case 'delete_file':
    case 'move_file':
      return 'high';
    case 'rename_file':
    case 'create_directory':
    case 'copy_file':
      return 'low';
    default:
      return 'high';
  }
}

function truncateChatHistory(messages: Array<{type: string, content: string, timestamp: Date}>, maxTokens: number = 2000): Array<{type: string, content: string, timestamp: Date}> {
  if (!messages || messages.length === 0) return [];
  
  // Start from the most recent messages and work backwards
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
    console.log('🤖 Processing AI request with prompt:', prompt.substring(0, 50) + '...');
    console.log('🔑 API key available for request:', !!GEMINI_API_KEY);
    
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0 }
    });

    // Build chat history context
    let chatHistoryText = '';
    if (context.chatHistory?.messages && context.chatHistory.messages.length > 0) {
      const truncatedHistory = truncateChatHistory(context.chatHistory.messages, 1500);
      chatHistoryText = `\nRecent conversation history:\n${truncatedHistory.map(msg => 
        `${msg.type.toUpperCase()}: ${msg.content}`
      ).join('\n')}\n`;
    }

    // Build file contents context
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

You can help with file operations. When appropriate, use the available tools to complete the user's request.
Keep responses brief and focused unless detailed explanation is requested.`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: contextPrompt }] }],
      tools: [{
        functionDeclarations: [readFileFunction, readDirectoryFunction]
      }]
    });

    const response = result.response;
    const toolCalls: ToolCall[] = [];

    // Check for function calls
    const candidateFunctionCalls = response.functionCalls();
    if (candidateFunctionCalls && candidateFunctionCalls.length > 0) {
      for (const functionCall of candidateFunctionCalls) {
        let description = '';
        switch(functionCall.name) {
          case 'read_file':
            description = `Read file: ${(functionCall.args as any)?.path || 'unknown path'}`;
            break;
          case 'read_directory':
            description = `List contents of: ${(functionCall.args as any)?.path || 'unknown path'}`;
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

async function processFollowUpWithAI(originalPrompt: string, context: AIContext, toolResults: any): Promise<AIResponse> {
  try {
    console.log('🤖 Processing follow-up AI request with original prompt:', originalPrompt.substring(0, 50) + '...');
    console.log('🔧 Tool results:', JSON.stringify(toolResults).substring(0, 100) + '...');
    
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0 }
    });

    let toolResultsText = '';
    const results = Array.isArray(toolResults) ? toolResults : [toolResults];

    for (const toolResult of results) {
        if (toolResult.status === 'denied') {
            toolResultsText += `Tool call for '${toolResult.toolCallId}' was denied by the user.\n\n`;
            continue;
        }

        if (toolResult.result?.content) { // read_file
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

    // Build chat history context
    let chatHistoryText = '';
    if (context.chatHistory?.messages && context.chatHistory.messages.length > 0) {
      const truncatedHistory = truncateChatHistory(context.chatHistory.messages, 1000);
      chatHistoryText = `\nRecent conversation history:\n${truncatedHistory.map(msg => 
        `${msg.type.toUpperCase()}: ${msg.content}`
      ).join('\n')}\n`;
    }

    // Build file contents context
    let fileContentsText = '';
    if (context.chatHistory?.fileContents && context.chatHistory.fileContents.length > 0) {
      fileContentsText = `\nPreviously read files:\n${context.chatHistory.fileContents.map(file => 
        `File: ${file.path}\nContent: ${file.content.substring(0, 500)}${file.content.length > 500 ? '...(truncated)' : ''}`
      ).join('\n\n')}\n`;
    }

    const followUpPrompt = `You are a helpful file system assistant. Be concise and direct in your responses unless the user specifically asks for detailed explanations.

Current directory context:
- Current path: ${context.currentPath}
- Folders: ${context.folders.join(', ') || 'None'}
- Files: ${context.files.join(', ') || 'None'}
${chatHistoryText}${fileContentsText}
Original user request: ${originalPrompt}

I have executed a tool call and retrieved the following information:
${toolResultsText}

Now, please provide a focused response to the original user request using the information I've gathered. Analyze the content, answer their question concisely, and provide any key insights based on what you found. Also, inform the user about any actions they denied.`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: followUpPrompt }] }]
    });

    const response = result.response;

    return {
      response: response.text() || 'I have processed the tool results but cannot provide a response.',
      toolCalls: undefined // Follow-up responses don't generate new tool calls
    };
  } catch (error) {
    console.error('Follow-up AI processing error:', error);
    throw error;
  }
}

app.get('/health', (req, res) => {
  res.json(createResponse(true, { message: 'FSai Backend is running' }));
});

app.get('/api/fs/home', (req, res) => {
  try {
    const homeDir = os.homedir();
    console.log('Home directory from os.homedir():', homeDir);
    console.log('Platform:', os.platform());
    
    // Use path.resolve to normalize path for current platform
    const normalizedHomeDir = path.resolve(homeDir);
    console.log('Normalized home directory:', normalizedHomeDir);
    
    res.json(createResponse(true, { 
      path: normalizedHomeDir,
      platform: os.platform()
    }));
  } catch (error) {
    console.error('Error getting home directory:', error);
    res.json(createResponse(false, null, `Failed to get home directory: ${error}`));
  }
});

app.post('/api/fs/list', async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    
    if (!dirPath || typeof dirPath !== 'string') {
      return res.json(createResponse(false, null, 'Path is required'));
    }

    // Normalize path for Windows
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
        // Skip entries we can't read
        console.warn(`Could not read entry ${entry}:`, e);
      }
    }

    // Sort: directories first, then files, both alphabetically
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json(createResponse(true, files));
  } catch (error) {
    console.error('Error listing directory:', error);
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
    console.error('Error reading file:', error);
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

    if (typeof content !== 'string') {
      return res.json(createResponse(false, null, 'Content must be a string'));
    }

    const normalizedPath = path.resolve(filePath);
    
    // Ensure directory exists
    const dir = path.dirname(normalizedPath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(normalizedPath, content, 'utf8');
    res.json(createResponse(true, { message: 'File written successfully', path: normalizedPath }));
  } catch (error) {
    console.error('Error writing file:', error);
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
    console.error('Error deleting:', error);
    res.json(createResponse(false, null, `Failed to delete: ${error}`));
  }
});

// Create directory
app.post('/api/fs/mkdir', async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    
    if (!dirPath || typeof dirPath !== 'string') {
      return res.json(createResponse(false, null, 'Path is required'));
    }

    const normalizedPath = path.resolve(dirPath);
    
    if (existsSync(normalizedPath)) {
      return res.json(createResponse(false, null, 'Directory already exists'));
    }

    await fs.mkdir(normalizedPath, { recursive: true });
    res.json(createResponse(true, { message: 'Directory created successfully', path: normalizedPath }));
  } catch (error) {
    console.error('Error creating directory:', error);
    res.json(createResponse(false, null, `Failed to create directory: ${error}`));
  }
});

// AI processing endpoint
app.post('/api/ai/process', async (req, res) => {
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
    console.error('Error in AI processing:', error);
    res.json(createResponse(false, null, `AI processing failed: ${error}`));
  }
});

// Execute tool call endpoint (for confirmed tool calls)
app.post('/api/ai/execute-tool', async (req, res) => {
  try {
    const { toolCall, context }: { toolCall: ToolCall; context?: AIContext } = req.body;
    
    if (!toolCall || !toolCall.id || !toolCall.type) {
      return res.json(createResponse(false, null, 'Valid toolCall is required'));
    }

    // Execute the tool call based on type
    switch (toolCall.type) {
      case 'read_file':
        if (!toolCall.parameters.path) {
          return res.json(createResponse(false, null, 'Path parameter is required for read_file'));
        }
        
        console.log('🔍 Tool call path received:', toolCall.parameters.path);
        console.log('🔍 Context currentPath:', context?.currentPath);
        
        // Resolve path relative to context directory if available, otherwise use current working directory
        let normalizedPath: string;
        if (context?.currentPath && !path.isAbsolute(toolCall.parameters.path)) {
          normalizedPath = path.resolve(context.currentPath, toolCall.parameters.path);
        } else {
          normalizedPath = path.resolve(toolCall.parameters.path);
        }
        
        console.log('🔍 Normalized path:', normalizedPath);
        console.log('🔍 Path exists:', existsSync(normalizedPath));
        
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
        
      default:
        res.json(createResponse(false, null, `Tool type '${toolCall.type}' not yet implemented`));
    }
  } catch (error) {
    console.error('Error executing tool call:', error);
    res.json(createResponse(false, null, `Tool execution failed: ${error}`));
  }
});

// Follow-up AI processing after tool execution
app.post('/api/ai/process-followup', async (req, res) => {
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
    console.error('Error in follow-up AI processing:', error);
    res.json(createResponse(false, null, `Follow-up AI processing failed: ${error}`));
  }
});

// Start server
const PORT = parseInt(process.env.PORT || '0'); // Parse to number

const server = app.listen(PORT, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object') {
    const actualPort = address.port;
    console.log(`BACKEND_PORT:${actualPort}`);
    console.log(`FSai backend server running on http://127.0.0.1:${actualPort}`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});