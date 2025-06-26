<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, Button, TextField, Chip, LinearProgress } from "m3-svelte";
  import FSaiAPI, { type FileItem } from '$lib/api.js';
  import { curFolders, curFiles, curPath, curFile, curFileContent } from '$lib/store.js';

  let backendStatus = $state('Connecting...');
  let currentPath = $state('C:\\');
  let files = $state<FileItem[]>([]);
  let selectedFile = $state<FileItem | null>(null);
  let fileContent = $state('');
  let newFileName = $state('');
  let newDirName = $state('');
  let error = $state('');
  let isConnected = $state(false);

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit
  let filePreviewCache = new Map<string, { canPreview: boolean; reason?: string }>();
 
  $effect(() => {
    curPath.set(currentPath);
  });

  $effect(() => {
    const directories = files.filter(file => file.isDirectory).map(file => file.name);
    const fileNames = files.filter(file => file.isFile).map(file => file.name);
    curFolders.set(directories);
    curFiles.set(fileNames);
  });

  $effect(() => {
    curFile.set(selectedFile?.name || '');
  });

  $effect(() => {
    curFileContent.set(fileContent);
  });

  function getCrossPlatformHomeFallback(): string {
    // Detect platform based on user agent and path separators
    const isWindows = navigator.userAgent.includes('Windows') || navigator.platform.includes('Win');
    const isMac = navigator.userAgent.includes('Mac') || navigator.platform.includes('Mac');
    
    if (isWindows) {
      return 'C:\\Users\\cattn';
    } else if (isMac) {
      return '/Users/cattn';
    } else {
      // Linux/Unix
      return '/home/cattn';
    }
  }

  async function isFilePreviewable(file: FileItem): Promise<{ canPreview: boolean; reason?: string }> {
    if (!file.isFile) {
      return { canPreview: false, reason: 'Not a file' };
    }

    if (file.size && file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      return { canPreview: false, reason: `File too large (${sizeMB}MB). Maximum size is 5MB.` };
    }

    // Check cache first
    if (filePreviewCache.has(file.path)) {
      return filePreviewCache.get(file.path)!;
    }

    // Check if file appears to be binary by examining first few bytes
    try {
      const result = await FSaiAPI.checkFileType(file.path);
      const response = result.success 
        ? { canPreview: result.data?.isText || false, reason: result.data?.reason }
        : { canPreview: false, reason: result.error || 'Could not determine file type' };
      
      // Cache the result
      filePreviewCache.set(file.path, response);
      return response;
    } catch (e) {
      console.error('File type check failed for', file.path, ':', e);
      // Fallback to simple size-based check if API fails
      const fallbackResponse = { canPreview: true, reason: 'Using fallback detection' };
      filePreviewCache.set(file.path, fallbackResponse);
      return fallbackResponse;
    }
  }

  function getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot).toLowerCase() : '';
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  onMount(async () => {
    try {
      console.log('Initializing FSai API...');
      await FSaiAPI.initialize();
      
      console.log('Checking backend health...');
      const health = await FSaiAPI.healthCheck();
      console.log('Health check result:', health);
      
      if (health.success) {
        backendStatus = `Connected - ${health.data?.message}`;
        isConnected = true;
        
        // Get and set the user's home directory as default path
        console.log('Getting home directory...');
        try {
          const homeResult = await FSaiAPI.getHomeDirectory();
          console.log('Home directory API result:', homeResult);
          if (homeResult.success && homeResult.data?.path) {
            console.log('Current path before update:', currentPath);
            currentPath = homeResult.data.path;
            console.log('Set currentPath to:', currentPath);
          } else {
            console.error('Failed to get home directory:', homeResult.error || 'Unknown error');
            currentPath = getCrossPlatformHomeFallback();
            console.log('Using fallback path:', currentPath);
          }
        } catch (e) {
          console.error('Error getting home directory:', e);
          currentPath = getCrossPlatformHomeFallback();
          console.log('Using hardcoded fallback path:', currentPath);
        }
        
        console.log('Loading directory for path:', currentPath);
        await loadDirectory();
      } else {
        backendStatus = 'Backend connection failed';
        isConnected = false;
      }
    } catch (e) {
      console.error('Failed to initialize:', e);
      backendStatus = `Error: ${e}`;
      isConnected = false;
    }
  });

  async function loadDirectory() {
    try {
      const result = await FSaiAPI.listDirectory(currentPath);
      if (result.success) {
        files = result.data || [];
        error = '';
      } else {
        error = result.error || 'Failed to load directory';
      }
    } catch (e) {
      error = `Error loading directory: ${e}`;
    }
  }

  async function navigateToPath(path: string) {
    currentPath = path;
    await loadDirectory();
  }

  function isAtRoot(path: string): boolean {
    // Check if path is at root for either Windows or Unix
    const windowsRootPattern = /^[A-Za-z]:\\?$/;
    const unixRootPattern = /^\/$/;
    
    return windowsRootPattern.test(path) || unixRootPattern.test(path);
  }

  function getParentPath(path: string): string {
    // Detect if this is a Windows or Unix-style path
    const isWindowsPath = path.includes('\\') || /^[A-Za-z]:/.test(path);
    const separator = isWindowsPath ? '\\' : '/';
    
    // Check if already at root
    if (isAtRoot(path)) {
      return path; // Already at root
    }
    
    // Normalize path separators for consistency
    const normalizedPath = path.replace(/[\/\\]/g, separator);
    
    // Split by separator and remove empty parts
    const parts = normalizedPath.split(separator).filter(part => part !== '');
    
    if (parts.length <= 1) {
      // Go to root
      return isWindowsPath ? 'C:\\' : '/';
    }
    
    // Remove the last part to go up one level
    parts.pop();
    
    // Reconstruct the path
    if (isWindowsPath) {
      if (parts.length === 1 && parts[0].endsWith(':')) {
        return parts[0] + '\\'; // e.g., "C:\\"
      }
      return parts.join('\\');
    } else {
      return '/' + parts.join('/');
    }
  }

  async function selectFile(file: FileItem) {
    selectedFile = file;
    fileContent = '';
    
    if (file.isFile) {
      const previewCheck = await isFilePreviewable(file);
      if (!previewCheck.canPreview) {
        error = previewCheck.reason || 'File cannot be previewed';
        return;
      }
      
      try {
        const result = await FSaiAPI.readFile(file.path);
        if (result.success) {
          fileContent = result.data?.content || '';
          error = '';
        } else {
          error = result.error || 'Failed to read file';
        }
      } catch (e) {
        error = `Error reading file: ${e}`;
      }
    }
  }

  async function saveFile() {
    if (!selectedFile) return;
    
    try {
      const result = await FSaiAPI.writeFile(selectedFile.path, fileContent);
      if (result.success) {
        error = '';
        console.log('File saved successfully');
      } else {
        error = result.error || 'Failed to save file';
      }
    } catch (e) {
      error = `Error saving file: ${e}`;
    }
  }

  function joinPath(basePath: string, name: string): string {
    const isWindowsPath = basePath.includes('\\') || /^[A-Za-z]:/.test(basePath);
    const separator = isWindowsPath ? '\\' : '/';
    
    // Ensure base path doesn't end with separator
    const cleanBasePath = basePath.endsWith(separator) ? basePath.slice(0, -1) : basePath;
    return `${cleanBasePath}${separator}${name}`;
  }

  async function createFile() {
    if (!newFileName) return;
    
    const filePath = joinPath(currentPath, newFileName);
    try {
      const result = await FSaiAPI.writeFile(filePath, '');
      if (result.success) {
        await loadDirectory();
        newFileName = '';
        error = '';
      } else {
        error = result.error || 'Failed to create file';
      }
    } catch (e) {
      error = `Error creating file: ${e}`;
    }
  }

  async function createDirectory() {
    if (!newDirName) return;
    
    const dirPath = joinPath(currentPath, newDirName);
    try {
      const result = await FSaiAPI.createDirectory(dirPath);
      if (result.success) {
        await loadDirectory();
        newDirName = '';
        error = '';
      } else {
        error = result.error || 'Failed to create directory';
      }
    } catch (e) {
      error = `Error creating directory: ${e}`;
    }
  }

  async function deleteSelected() {
    if (!selectedFile) return;
    
    try {
      const result = await FSaiAPI.deleteFile(selectedFile.path);
      if (result.success) {
        await loadDirectory();
        selectedFile = null;
        fileContent = '';
        error = '';
      } else {
        error = result.error || 'Failed to delete file';
      }
    } catch (e) {
      error = `Error deleting file: ${e}`;
    }
  }
</script>

<main class="m3-container">
  <!-- Header -->
  <div class="header-section">
    <h1 class="m3-font-display-large">FSai</h1>
    <p class="m3-font-title-medium subtitle">Filesystem AI Assistant</p>
    <div class="subtitle-decoration"></div>
  </div>
  
  <!-- Status Bar -->
  <Card variant="elevated" style="margin-bottom: 1.5rem;">
    <div class="status-content">
      <div class="status-indicator {isConnected ? 'connected' : 'disconnected'}"></div>
      <span class="m3-font-label-large status-text">Backend Status:</span>
      <span class="m3-font-body-medium" style="color: rgb(var(--m3-scheme-on-surface-variant))">{backendStatus}</span>
    </div>
  </Card>

  {#if error}
    <Card variant="outlined" style="margin-bottom: 1.5rem; border-color: rgb(var(--m3-scheme-error));">
      <div class="error-content">
        <svg width="20" height="20" viewBox="0 0 20 20" style="color: rgb(var(--m3-scheme-error))">
          <path fill="currentColor" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"></path>
        </svg>
        <span class="m3-font-body-medium" style="color: rgb(var(--m3-scheme-error))">{error}</span>
      </div>
    </Card>
  {/if}

  <!-- Main Content Grid -->
  <div class="content-grid">
    <!-- File Explorer Panel -->
    <div class="explorer-panel">
      <!-- Path Bar -->
      <Card variant="filled" style="margin-bottom: 1rem;">
        <div class="path-section">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="m3-font-label-large">Current Path</label>
          <div class="path-controls">
            <TextField 
              bind:value={currentPath} 
              label="Path"
              enter={loadDirectory}
              style="flex: 1;"
            />
            <Button 
              variant="filled" 
              iconType="left"
              click={loadDirectory}
            >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
              <path fill="currentColor" d="M12 20q-3.35 0-5.675-2.325T4 12t2.325-5.675T12 4q1.725 0 3.3.712T18 6.75V5q0-.425.288-.712T19 4t.713.288T20 5v5q0 .425-.288.713T19 11h-5q-.425 0-.712-.288T13 10t.288-.712T14 9h3.2q-.8-1.4-2.187-2.2T12 6Q9.5 6 7.75 7.75T6 12t1.75 4.25T12 18q1.7 0 3.113-.862t2.187-2.313q.2-.35.563-.487t.737-.013q.4.125.575.525t-.025.75q-1.025 2-2.925 3.2T12 20" />
            </svg>
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      <!-- Actions Panel -->
      <Card variant="filled" style="margin-bottom: 1rem;">
        <div class="actions-section">
          <h3 class="m3-font-title-medium">Quick Actions</h3>
          <div class="actions-grid">
            <div class="action-group">
                             <TextField 
                 bind:value={newFileName} 
                 label="New file name"
                 style="margin-bottom: 0.5rem;"
               />
               <div class="mt-2">
                <Button 
                  variant="filled" 
                  iconType="left"
                  click={createFile}
                  style="width: 100%;"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                  </svg>
                  Create File
                </Button>
              </div>
            </div>
            
            <div class="action-group">
                             <TextField
                 bind:value={newDirName} 
                 label="New directory name"
                 style="margin-bottom: 0.5rem;"
               />
               <div class="mt-2">
              <Button 
                variant="filled" 
                iconType="left"
                click={createDirectory}
                style="width: 100%;"
              >
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                </svg>
                Create Directory
              </Button>
              </div>
            </div>
          </div>
          
          {#if selectedFile}
            <Button 
              variant="outlined" 
              iconType="left"
              click={deleteSelected}
              style="width: 100%; margin-top: 1rem; color: rgb(var(--m3-scheme-error)); border-color: rgb(var(--m3-scheme-error));"
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path fill="currentColor" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
              Delete Selected
            </Button>
          {/if}
        </div>
      </Card>

      <!-- File List -->
      <Card variant="elevated">
        <div class="file-list-header">
          <h3 class="m3-font-title-medium">
            <svg width="16" height="16" viewBox="0 0 24 24" style="margin-right: 0.5rem;">
              <path fill="currentColor" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z"></path>
            </svg>
            Files & Directories
          </h3>
        </div>
        <div class="file-list">
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          {#if !isAtRoot(currentPath)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore event_directive_deprecated -->
            <div 
              class="file-item parent-dir"
              on:click={() => navigateToPath(getParentPath(currentPath))}
            >
              <span class="file-icon">📁</span>
              <span class="m3-font-body-medium">.. (Parent Directory)</span>
            </div>
          {/if}
          
          {#each files as file}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore event_directive_deprecated -->
            <div 
              class="file-item {selectedFile?.path === file.path ? 'selected' : ''}"
              on:click={() => selectFile(file)}
              on:dblclick={() => file.isDirectory && navigateToPath(file.path)}
            >
              <span class="file-icon">{file.isDirectory ? '📁' : '📄'}</span>
              <div class="file-info">
                <span class="m3-font-body-medium {file.isDirectory ? 'directory-name' : ''}">{file.name}</span>
                {#if file.isFile && file.size !== undefined}
                  <span class="file-size m3-font-body-small">{formatFileSize(file.size)}</span>
                {/if}
                {#if file.isFile && file.size && file.size > MAX_FILE_SIZE}
                  <span class="file-warning m3-font-body-small">Too large for preview</span>
                {/if}
              </div>
              {#if file.isDirectory}
                <svg width="16" height="16" viewBox="0 0 24 24" style="margin-left: auto; color: rgb(var(--m3-scheme-outline));">
                  <path fill="currentColor" d="M9 5l7 7-7 7"></path>
                </svg>
              {/if}
            </div>
          {/each}
          
          {#if files.length === 0}
            <div class="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" style="color: rgb(var(--m3-scheme-outline)); margin-bottom: 1rem;">
                <path fill="currentColor" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z"></path>
              </svg>
              <p class="m3-font-body-medium" style="color: rgb(var(--m3-scheme-on-surface-variant))">No files or directories found</p>
            </div>
          {/if}
        </div>
      </Card>
    </div>

    <!-- File Editor Panel -->
    {#if selectedFile && selectedFile.isFile}
      <Card variant="elevated" style="height: fit-content;">
        <div class="file-editor-header">
          <h3 class="m3-font-title-medium">
            <svg width="16" height="16" viewBox="0 0 24 24" style="margin-right: 0.5rem;">
              <path fill="currentColor" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
            </svg>
            File: {selectedFile.name}
          </h3>
          {#if selectedFile.size !== undefined}
            <p class="file-details m3-font-body-small">Size: {formatFileSize(selectedFile.size)}</p>
          {/if}
        </div>

        {#await isFilePreviewable(selectedFile) then previewCheck}
          {#if previewCheck.canPreview}
            <div class="file-editor-content">
              <textarea 
                bind:value={fileContent}
                rows="20"
                class="file-textarea"
                placeholder="File content will appear here..."
              ></textarea>
              <div class="editor-actions">
                <Button
                  variant="filled" 
                  iconType="left"
                  click={saveFile}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12"></path>
                  </svg>
                  Save File
                </Button>
              </div>
            </div>
          {:else}
            <div class="non-previewable-content">
              <svg width="64" height="64" viewBox="0 0 24 24" style="color: rgb(var(--m3-scheme-outline)); margin-bottom: 1rem;">
                <path fill="currentColor" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2zM12 15.4l-3.76 2-1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 3.71 4.38.38-3.32 2.88-1 4.28L12 15.4z"></path>
              </svg>
              <h4 class="m3-font-headline-small" style="color: rgb(var(--m3-scheme-on-surface-variant)); margin-bottom: 0.5rem;">Preview Not Available</h4>
              <p class="m3-font-body-medium" style="color: rgb(var(--m3-scheme-on-surface-variant)); text-align: center;">
                {previewCheck.reason}
              </p>
            </div>
          {/if}
        {/await}
      </Card>
    {:else}
      <Card variant="outlined" style="height: fit-content; border-style: dashed;">
        <div class="placeholder-content">
          <svg width="64" height="64" viewBox="0 0 24 24" style="color: rgb(var(--m3-scheme-outline)); margin-bottom: 1rem;">
            <path fill="currentColor" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          <h3 class="m3-font-headline-small" style="color: rgb(var(--m3-scheme-on-surface-variant)); margin-bottom: 0.5rem;">No File Selected</h3>
          <p class="m3-font-body-medium" style="color: rgb(var(--m3-scheme-on-surface-variant))">Select a file from the list to view and edit its contents</p>
        </div>
      </Card>
    {/if}
  </div>
</main>

<style>
  .m3-container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem;
    min-height: 100vh;
    background: rgb(var(--m3-scheme-background));
  }

  .header-section {
    margin-bottom: 2rem;
    text-align: center;
  }

  .header-section h1 {
    color: rgb(var(--m3-scheme-primary));
    margin: 0 0 0.5rem 0;
  }

  .header-section p {
    margin: 0;
  }

  .subtitle {
    color: rgb(var(--m3-scheme-on-surface));
    font-weight: 400;
    letter-spacing: 0.02em;
    margin-bottom: 1rem;
    opacity: 0.87;
  }

  .subtitle-decoration {
    width: 60px;
    height: 3px;
    background: linear-gradient(90deg, rgb(var(--m3-scheme-primary)), rgb(var(--m3-scheme-tertiary)));
    border-radius: var(--m3-util-rounding-full);
    margin: 0 auto;
  }

  .status-content {
    display: flex;
    align-items: center;
    padding: 1rem;
    gap: 0.75rem;
  }

  .status-indicator {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  .status-indicator.connected {
    background: rgb(var(--m3-scheme-tertiary));
  }

  .status-indicator.disconnected {
    background: rgb(var(--m3-scheme-error));
  }

  .status-text {
    color: rgb(var(--m3-scheme-on-surface));
  }

  .error-content {
    display: flex;
    align-items: center;
    padding: 1rem;
    gap: 0.75rem;
  }

  .content-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
  }

  @media (max-width: 1024px) {
    .content-grid {
      grid-template-columns: 1fr;
    }
  }

  .explorer-panel {
    display: flex;
    flex-direction: column;
  }

  .path-section {
    padding: 1rem;
  }

  .path-section label {
    display: block;
    margin-bottom: 0.75rem;
    color: rgb(var(--m3-scheme-on-surface));
  }

  .path-controls {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
  }

  @media (max-width: 640px) {
    .path-controls {
      flex-direction: column;
      align-items: stretch;
    }
  }

  .actions-section {
    padding: 1rem;
  }

  .actions-section h3 {
    margin: 0 0 1rem 0;
    color: rgb(var(--m3-scheme-on-surface));
  }

  .actions-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  @media (max-width: 640px) {
    .actions-grid {
      grid-template-columns: 1fr;
    }
  }

  .action-group {
    display: flex;
    flex-direction: column;
  }

  .file-list-header {
    padding: 1rem 1rem 0 1rem;
    border-bottom: 1px solid rgb(var(--m3-scheme-outline-variant));
    margin-bottom: 0;
  }

  .file-list-header h3 {
    margin: 0 0 1rem 0;
    color: rgb(var(--m3-scheme-on-surface));
    display: flex;
    align-items: center;
  }

  .file-list {
    max-height: 400px;
    overflow-y: auto;
  }

  .file-item {
    display: flex;
    align-items: center;
    padding: 0.75rem 1rem;
    cursor: pointer;
    border-bottom: 1px solid rgb(var(--m3-scheme-outline-variant));
    transition: background-color 0.2s ease;
    gap: 0.75rem;
  }

  .file-item:hover {
    background: rgb(var(--m3-scheme-surface-container-low));
  }

  .file-item.selected {
    background: rgb(var(--m3-scheme-primary-container));
    color: rgb(var(--m3-scheme-on-primary-container));
  }

  .file-item.parent-dir {
    font-weight: 500;
    color: rgb(var(--m3-scheme-on-surface-variant));
  }

  .file-icon {
    font-size: 1.2rem;
    flex-shrink: 0;
  }

  .file-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .file-size {
    color: rgb(var(--m3-scheme-on-surface-variant));
    margin-top: 0.125rem;
  }

  .file-warning {
    color: rgb(var(--m3-scheme-error));
    margin-top: 0.125rem;
    font-style: italic;
  }

  .directory-name {
    font-weight: 500;
  }

  .empty-state {
    padding: 3rem 1rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .file-editor-header {
    padding: 1rem 1rem 0 1rem;
    border-bottom: 1px solid rgb(var(--m3-scheme-outline-variant));
    margin-bottom: 1rem;
  }

  .file-editor-header h3 {
    margin: 0 0 0.5rem 0;
    color: rgb(var(--m3-scheme-on-surface));
    display: flex;
    align-items: center;
  }

  .file-details {
    margin: 0 0 1rem 0;
    color: rgb(var(--m3-scheme-on-surface-variant));
  }

  .file-editor-content {
    padding: 0 1rem 1rem 1rem;
  }

  .non-previewable-content {
    padding: 3rem 2rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .file-textarea {
    width: 100%;
    height: 400px;
    padding: 1rem;
    border: 1px solid rgb(var(--m3-scheme-outline));
    border-radius: var(--m3-util-rounding-medium);
    background: rgb(var(--m3-scheme-surface-container-low));
    color: rgb(var(--m3-scheme-on-surface));
    font-family: 'Roboto Mono', monospace;
    font-size: 0.875rem;
    line-height: 1.5;
    resize: vertical;
    box-sizing: border-box;
  }

  .file-textarea:focus {
    outline: 2px solid rgb(var(--m3-scheme-primary));
    outline-offset: -2px;
  }

  .editor-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1rem;
  }

  .placeholder-content {
    padding: 3rem 2rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
</style>
