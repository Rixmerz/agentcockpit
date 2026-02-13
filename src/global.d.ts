import type { DebugAPI } from './core/debug';

declare global {
  interface Window {
    __debug: DebugAPI;
  }
}
