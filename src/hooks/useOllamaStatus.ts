import { useState, useEffect, useCallback } from 'react';
import { ollamaService } from '../services/ollamaService';

export function useOllamaStatus() {
  const [running, setRunning] = useState<boolean | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const status = await ollamaService.getStatus();
      setRunning(status.running);
      setModel(status.model);
      setError(status.error);
    } catch {
      setRunning(false);
    }
  }, []);

  const handleStart = useCallback(async () => {
    setLoading(true);
    try {
      await ollamaService.start();
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [loadStatus]);

  return { running, model, loading, error, loadStatus, handleStart };
}
