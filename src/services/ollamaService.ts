/**
 * Ollama Service — Manages local Ollama container for semantic embeddings.
 * Auto-starts Podman container on app launch, provides status for ControlBar.
 */
import { invoke } from '@tauri-apps/api/core';

let _running: boolean | null = null;
let _model: string | null = null;
let _checkInterval: ReturnType<typeof setInterval> | null = null;
const CHECK_INTERVAL_MS = 30_000;

async function exec(cmd: string): Promise<string> {
  return invoke<string>('execute_command', { cmd, cwd: '/' });
}

async function start(): Promise<void> {
  try {
    await exec('which podman');

    const containers = await exec('podman ps -a --filter name=^ollama$ --format {{.Names}}');

    if (containers.trim().includes('ollama')) {
      const running = await exec('podman ps --filter name=^ollama$ --format {{.Names}}');
      if (!running.trim().includes('ollama')) {
        await exec('podman start ollama');
      }
    } else {
      await exec('podman run -d --name ollama -p 11434:11434 --device nvidia.com/gpu=all docker.io/ollama/ollama');
    }

    // Poll for readiness (up to 4 attempts × 500ms = 2s max, but exits early)
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const check = await exec('curl -sf http://localhost:11434/api/tags 2>/dev/null');
        if (check && check.trim()) break; // Ollama is ready
      } catch {
        // Not ready yet, retry
      }
    }

    const models = await exec('podman exec ollama ollama list');
    if (!models.includes('nomic-embed-text')) {
      exec('podman exec ollama ollama pull nomic-embed-text').catch(() => {});
    }

    _running = true;
    _model = 'nomic-embed-text';

    if (_checkInterval) clearInterval(_checkInterval);
    _checkInterval = setInterval(checkHealth, CHECK_INTERVAL_MS);
  } catch {
    _running = false;
    _model = null;
  }
}

async function stop(): Promise<void> {
  if (_checkInterval) {
    clearInterval(_checkInterval);
    _checkInterval = null;
  }
  // Don't stop the container — other processes may use it
}

async function getStatus(): Promise<{ running: boolean; model: string | null; error: string | null }> {
  try {
    const result = await exec('curl -s -o /dev/null -w "%{http_code}" http://localhost:11434/api/tags');
    const isRunning = result.trim() === '200';
    _running = isRunning;

    if (isRunning) {
      const models = await exec('curl -s http://localhost:11434/api/tags');
      const data = JSON.parse(models) as { models?: { name: string }[] };
      const modelNames = (data.models || []).map((m: { name: string }) => m.name);
      _model = modelNames.find((n: string) => n.includes('nomic-embed-text')) || modelNames[0] || null;
    }

    return { running: _running, model: _model, error: null };
  } catch (e) {
    _running = false;
    return { running: false, model: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkHealth(): Promise<void> {
  try {
    const result = await exec('curl -s -o /dev/null -w "%{http_code}" http://localhost:11434/api/tags');
    _running = result.trim() === '200';
  } catch {
    _running = false;
  }
}

function isRunning(): boolean | null {
  return _running;
}

export const ollamaService = { start, stop, getStatus, isRunning };
