import type { DebugAPI } from './debug';

declare global {
  interface Window {
    __debug: DebugAPI;
  }
}
