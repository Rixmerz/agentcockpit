/**
 * Sound Service
 *
 * Handles notification sounds using Web Audio API.
 * Supports both bundled default sounds and custom sound files.
 */

import { convertFileSrc } from '@tauri-apps/api/core';

// Default notification sound (bundled with app)
const DEFAULT_SOUND_PATH = '/sounds/notification.mp3';

// Audio context singleton (lazy initialization)
let audioContext: AudioContext | null = null;

// Cache for loaded audio buffers
const audioBufferCache = new Map<string, AudioBuffer>();

/**
 * Get or create the audio context
 */
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/**
 * Load an audio file and cache the buffer
 */
async function loadAudioBuffer(url: string): Promise<AudioBuffer> {
  // Check cache first
  const cached = audioBufferCache.get(url);
  if (cached) {
    return cached;
  }

  const ctx = getAudioContext();

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    // Cache the buffer
    audioBufferCache.set(url, audioBuffer);

    return audioBuffer;
  } catch (error) {
    console.error('[SoundService] Failed to load audio:', url, error);
    throw error;
  }
}

/**
 * Play a synthesized notification beep as fallback
 * Creates a pleasant two-tone chime
 */
function playFallbackBeep(): void {
  try {
    const ctx = getAudioContext();

    // Create a pleasant two-tone notification sound
    const playTone = (frequency: number, startTime: number, duration: number) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      // Envelope: quick attack, sustain, quick release
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
      gainNode.gain.setValueAtTime(0.3, startTime + duration - 0.05);
      gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    // Two-tone chime: C5 then E5
    playTone(523.25, now, 0.15);       // C5
    playTone(659.25, now + 0.12, 0.2); // E5

  } catch (error) {
    console.error('[SoundService] Failed to play fallback beep:', error);
  }
}

/**
 * Play a notification sound
 * @param customPath - Optional custom sound file path (local filesystem)
 */
export async function playNotificationSound(customPath?: string | null): Promise<void> {
  try {
    const ctx = getAudioContext();

    // Resume audio context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Determine which sound to play
    let soundUrl: string;

    if (customPath) {
      // Convert local file path to Tauri asset URL
      soundUrl = convertFileSrc(customPath);
    } else {
      // Use bundled default sound
      soundUrl = DEFAULT_SOUND_PATH;
    }

    try {
      // Load and play audio file
      const buffer = await loadAudioBuffer(soundUrl);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // If audio file fails to load, play synthesized fallback
      console.log('[SoundService] Using fallback beep');
      playFallbackBeep();
    }
  } catch (error) {
    console.error('[SoundService] Failed to play notification sound:', error);
    // Non-fatal - don't throw
  }
}

/**
 * Validate that a file path points to a valid audio file
 */
export async function validateSoundFile(path: string): Promise<boolean> {
  try {
    const soundUrl = convertFileSrc(path);
    const ctx = getAudioContext();

    const response = await fetch(soundUrl);
    if (!response.ok) {
      return false;
    }

    const arrayBuffer = await response.arrayBuffer();
    await ctx.decodeAudioData(arrayBuffer);

    return true;
  } catch {
    return false;
  }
}

/**
 * Get the default notification sound path
 */
export function getDefaultSoundPath(): string {
  return DEFAULT_SOUND_PATH;
}

/**
 * Clear the audio buffer cache (useful if user changes custom sound)
 */
export function clearAudioCache(): void {
  audioBufferCache.clear();
}

/**
 * Preload the default sound for faster first playback
 */
export async function preloadDefaultSound(): Promise<void> {
  try {
    await loadAudioBuffer(DEFAULT_SOUND_PATH);
  } catch {
    // Non-fatal
  }
}
