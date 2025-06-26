import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { existsSync, statSync } from 'fs';

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

function createResponse<T>(success: boolean, data?: T, error?: string): ApiResponse<T> {
  return { success, data, error };
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

// AI analyze endpoint (placeholder for future AI integration)
app.post('/api/ai/analyze', async (req, res) => {
  try {
    const { data } = req.body;
    
    // Placeholder response - you can integrate actual AI logic here
    res.json(createResponse(true, { 
      message: 'AI analysis placeholder - not yet implemented',
      analyzedData: data 
    }));
  } catch (error) {
    console.error('Error in AI analysis:', error);
    res.json(createResponse(false, null, `AI analysis failed: ${error}`));
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