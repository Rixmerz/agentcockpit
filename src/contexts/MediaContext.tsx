/**
 * MediaContext - Global media playback state
 * Shares media state from browser webviews across the app
 */

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { type MediaState } from '../services/browserService';

interface MediaContextValue {
  isPlaying: boolean;
  currentMedia: MediaState | null;
  allMediaStates: Map<string, MediaState>;
}

const MediaContext = createContext<MediaContextValue>({
  isPlaying: false,
  currentMedia: null,
  allMediaStates: new Map(),
});

export function MediaProvider({ children }: { children: ReactNode }) {
  const [mediaStates, setMediaStates] = useState<Map<string, MediaState>>(new Map());

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let lastIsPlaying: boolean | null = null;

    // Listen directly to Tauri events
    listen<{
      tab_id: string;
      platform: string;
      title: string;
      is_playing: boolean;
      duration: number;
      current_time: number;
    }>('media-state-changed', (event) => {
      const { tab_id, platform, title, is_playing, duration, current_time } = event.payload;

      // Only update state if isPlaying changed (avoid re-renders for time updates)
      if (is_playing !== lastIsPlaying) {
        lastIsPlaying = is_playing;
        setMediaStates(prev => {
          const newMap = new Map(prev);
          newMap.set(tab_id, {
            tabId: tab_id,
            platform: platform as MediaState['platform'],
            title,
            isPlaying: is_playing,
            duration,
            currentTime: current_time,
          });
          return newMap;
        });
      }
    }).then(fn => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Find any playing media
  const currentMedia = Array.from(mediaStates.values()).find(s => s.isPlaying) || null;
  const isPlaying = currentMedia !== null;

  return (
    <MediaContext.Provider value={{ isPlaying, currentMedia, allMediaStates: mediaStates }}>
      {children}
    </MediaContext.Provider>
  );
}

export function useMedia() {
  return useContext(MediaContext);
}

export function useIsMediaPlaying() {
  const { isPlaying } = useContext(MediaContext);
  return isPlaying;
}
