<script lang="ts">
  import { Card, Button, TextField, Switch } from "m3-svelte";
  import FSaiAPI from '$lib/api.js';
  import { settings } from '$lib/store.js';
  import { onMount } from "svelte";

  let apiKey = $state('');
  let allowRootAccess = $state(false);
  let statusMessage = $state('');

  onMount(async () => {
    const result = await FSaiAPI.getSettings();
    if (result.success && result.data) {
        settings.set(result.data);
    }
  });

  $effect(() => {
    apiKey = $settings.apiKey;
    allowRootAccess = $settings.allowRootAccess;
  });

  async function saveSettings() {
    statusMessage = 'Saving...';
    const newSettings = {
        apiKey: apiKey,
        allowRootAccess: allowRootAccess
    };
    const result = await FSaiAPI.saveSettings(newSettings);
    if (result.success && result.data) {
        settings.set(result.data);
        statusMessage = 'Settings saved successfully!';
    } else {
        statusMessage = `Error saving settings: ${result.error}`;
    }
    setTimeout(() => statusMessage = '', 3000);
  }
</script>

<main class="m3-container">
  <div class="header-section">
    <h1 class="m3-font-display-large">Settings</h1>
    <p class="m3-font-title-medium subtitle">Configure FSai behavior</p>
    <div class="subtitle-decoration"></div>
  </div>

  <div class="settings-container">
    <Card variant="elevated">
        <div class="settings-content">
            <h2 class="m3-font-headline-small">General Settings</h2>
            <div class="setting-item">
                <div class="setting-text">
                    <p class="m3-font-body-large">Gemini API Key</p>
                    <p class="m3-font-body-medium" style="color: rgb(var(--m3-scheme-on-surface-variant));">Your Google AI API key. This is stored locally and sent securely to the backend.</p>
                </div>
                <TextField 
                    bind:value={apiKey} 
                    label="API Key"
                    type="password"
                />
            </div>

            <div class="setting-item">
                <div class="setting-text">
                    <p class="m3-font-body-large">Allow Root Access</p>
                    <p class="m3-font-body-medium" style="color: rgb(var(--m3-scheme-on-surface-variant));">Allow the AI to access files outside of your home directory. Use with caution.</p>
                </div>
                <Switch bind:checked={allowRootAccess} />
            </div>

            <div class="actions">
                <Button variant="filled" click={saveSettings}>Save Settings</Button>
                <a href="/"><Button variant="outlined">Back to Files</Button></a>
            </div>

            {#if statusMessage}
                <p class="status-message m3-font-body-medium">{statusMessage}</p>
            {/if}
        </div>
    </Card>
  </div>
</main>

<style>
  .m3-container {
    max-width: 900px;
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

  .settings-container {
    margin-top: 2rem;
  }
  
  .settings-content {
      padding: 2rem;
  }

  .settings-content h2 {
      margin-bottom: 2rem;
      color: rgb(var(--m3-scheme-on-surface));
  }

  .setting-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.5rem 0;
      border-bottom: 1px solid rgb(var(--m3-scheme-outline-variant));
  }

  .setting-item:last-of-type {
      border-bottom: none;
  }

  .setting-text {
      flex: 1;
      margin-right: 2rem;
  }

  .setting-text p {
      margin: 0;
  }

  .actions {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
      margin-top: 2rem;
  }

  .status-message {
      margin-top: 1.5rem;
      text-align: right;
      color: rgb(var(--m3-scheme-primary));
  }
</style>
