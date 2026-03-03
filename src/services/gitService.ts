/**
 * Git Service — Barrel re-export
 *
 * All functionality is split into focused sub-modules under ./git/.
 * This file re-exports everything to preserve existing import paths.
 *
 * Note: gitCore (execGit, execGitSafe) is intentionally NOT re-exported
 * as it was never part of the public API.
 */

export * from './git/gitRepoService';
export * from './git/gitStatusService';
export * from './git/gitRemoteService';
export * from './git/gitStagingService';
export * from './git/gitTagService';
export * from './git/gitHistoryService';
export * from './git/gitPushService';
