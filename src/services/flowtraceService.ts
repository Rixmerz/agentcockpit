/**
 * FlowTrace Service — Barrel re-export
 *
 * All functionality is split into focused sub-modules under ./flowtrace/.
 * This file re-exports everything to preserve existing import paths.
 *
 * Note: _flowtraceInternal is intentionally NOT re-exported
 * as it is shared infrastructure for sibling modules only.
 */

export * from './flowtrace/flowtraceInstallService';
