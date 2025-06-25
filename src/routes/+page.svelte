<script lang="ts">
  import { onMount } from 'svelte';
  import FSaiAPI, { type FileItem } from '$lib/api.js';

  let backendStatus = 'Connecting...';
  let currentPath = 'C:\\';
  let files: FileItem[] = [];
  let selectedFile: FileItem | null = null;
  let fileContent = '';
  let newFileName = '';
  let newDirName = '';
  let error = '';

  onMount(async () => {
    try {
      await FSaiAPI.initialize();
      const health = await FSaiAPI.healthCheck();
      if (health.success) {
        backendStatus = `Connected - ${health.data?.message}`;
        await loadDirectory();
      } else {
        backendStatus = 'Backend connection failed';
      }
    } catch (e) {
      backendStatus = `Error: ${e}`;
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

  async function selectFile(file: FileItem) {
    selectedFile = file;
    if (file.isFile) {
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
    } else {
      fileContent = '';
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

  async function createFile() {
    if (!newFileName) return;
    
    const filePath = `${currentPath}\\${newFileName}`;
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
    
    const dirPath = `${currentPath}\\${newDirName}`;
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

<main class="container">
  <h1>FSai - Filesystem AI Assistant</h1>
  
  <div class="status">
    <strong>Backend Status:</strong> {backendStatus}
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="file-explorer">
    <div class="path-bar">
      <strong>Current Path:</strong> 
      <input bind:value={currentPath} on:change={loadDirectory} />
      <button on:click={loadDirectory}>Refresh</button>
    </div>

    <div class="actions">
      <input bind:value={newFileName} placeholder="New file name" />
      <button on:click={createFile}>Create File</button>
      
      <input bind:value={newDirName} placeholder="New directory name" />
      <button on:click={createDirectory}>Create Directory</button>
      
      {#if selectedFile}
        <button on:click={deleteSelected} class="danger">Delete Selected</button>
      {/if}
    </div>

    <div class="files-panel">
      <h3>Files & Directories</h3>
      <ul class="file-list">
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        {#if currentPath !== 'C:\\'}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li class="file-item directory" on:click={() => navigateToPath(currentPath.split('\\').slice(0, -1).join('\\') || 'C:')}>
            📁 .. (Parent Directory)
          </li>
        {/if}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        {#each files as file}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li 
            class="file-item {file.isDirectory ? 'directory' : 'file'} {selectedFile?.path === file.path ? 'selected' : ''}"
            on:click={() => selectFile(file)}
            on:dblclick={() => file.isDirectory && navigateToPath(file.path)}
          >
            {file.isDirectory ? '📁' : '📄'} {file.name}
          </li>
        {/each}
      </ul>
    </div>
  </div>

  {#if selectedFile && selectedFile.isFile}
    <div class="file-editor">
      <h3>File Editor: {selectedFile.name}</h3>
      <textarea bind:value={fileContent} rows="20" cols="80"></textarea>
      <br>
      <button on:click={saveFile}>Save File</button>
    </div>
  {/if}
</main>

<style>
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
    font-family: Arial, sans-serif;
  }

  .status {
    padding: 10px;
    background: #e8f5e8;
    border: 1px solid #4caf50;
    border-radius: 4px;
    margin-bottom: 20px;
  }

  .error {
    padding: 10px;
    background: #ffeaa7;
    border: 1px solid #fdcb6e;
    border-radius: 4px;
    margin-bottom: 20px;
    color: #e17055;
  }

  .file-explorer {
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 20px;
  }

  .path-bar {
    margin-bottom: 15px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .path-bar input {
    flex: 1;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }

  .actions {
    margin-bottom: 15px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .actions input {
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }

  button {
    padding: 8px 16px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  button:hover {
    background: #0056b3;
  }

  button.danger {
    background: #dc3545;
  }

  button.danger:hover {
    background: #c82333;
  }

  .file-list {
    list-style: none;
    padding: 0;
    max-height: 400px;
    overflow-y: auto;
  }

  .file-item {
    padding: 8px;
    cursor: pointer;
    border-bottom: 1px solid #eee;
  }

  .file-item:hover {
    background: #f8f9fa;
  }

  .file-item.selected {
    background: #007bff;
    color: white;
  }

  .file-item.directory {
    font-weight: bold;
  }

  .file-editor {
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 20px;
  }

  .file-editor textarea {
    width: 100%;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    resize: vertical;
  }
</style>
