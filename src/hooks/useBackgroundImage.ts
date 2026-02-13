import { useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * Hook to convert local file paths to asset:// protocol for Tauri background images.
 */
export function useBackgroundImage() {
  const getBackgroundUrl = useCallback((path: string | undefined): string => {
    if (!path) return 'none';
    // URLs (http/https) use directly
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return `url("${path}")`;
    }
    // Local paths need conversion to asset:// protocol
    if (path.startsWith('/')) {
      return `url("${convertFileSrc(path)}")`;
    }
    return `url("${path}")`;
  }, []);

  return { getBackgroundUrl };
}
