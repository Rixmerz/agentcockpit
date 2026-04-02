/**
 * Security Scan Service
 *
 * Auto-scans projects for vulnerabilities using DCC security tools
 * (Trivy/Semgrep). Runs on project open, debounced to avoid repeated scans.
 */

import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { callDccTool } from './dcc/_dccInternal';

// =====================================================
// Constants
// =====================================================

const SCAN_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between scans
const SCAN_STATUS_FILE = '.agentcockpit/security-scan.json';

// =====================================================
// Types
// =====================================================

export interface ScanStatus {
  lastScan: number;       // timestamp
  scanners: string[];     // available scanners
  findingsCount: number;
  riskGrade: string;      // S/A/B/C/D or N/A
  criticalCount: number;
  highCount: number;
}

// =====================================================
// Module-level singleton state
// =====================================================

let _currentScan: Promise<ScanStatus | null> | null = null;
let _lastStatus: ScanStatus | null = null;

// =====================================================
// Internal: File I/O
// =====================================================

async function _loadScanStatus(projectPath: string): Promise<ScanStatus | null> {
  try {
    const path = `${projectPath}/${SCAN_STATUS_FILE}`;
    if (!(await exists(path))) return null;
    const content = await readTextFile(path);
    return JSON.parse(content) as ScanStatus;
  } catch {
    return null;
  }
}

async function _saveScanStatus(projectPath: string, status: ScanStatus): Promise<void> {
  try {
    const path = `${projectPath}/${SCAN_STATUS_FILE}`;
    await writeTextFile(path, JSON.stringify(status, null, 2));
  } catch {
    // Non-fatal: status display is best-effort
  }
}

// =====================================================
// Internal: Scan logic
// =====================================================

async function _doScan(projectPath: string): Promise<ScanStatus | null> {
  try {
    // 1. Check which scanners are available
    const scannersResult = await callDccTool('cube_check_scanners', {}, projectPath) as Record<string, unknown> | null;
    if (!scannersResult) return null;

    const available = (scannersResult.available ?? scannersResult.scanners ?? []) as unknown[];
    const scannerNames = Array.isArray(available)
      ? available
          .map((s) => (typeof s === 'string' ? s : (s as Record<string, unknown>).name))
          .filter((n): n is string => typeof n === 'string' && n.length > 0)
      : [];

    if (scannerNames.length === 0) {
      // No scanners installed — record status but don't fail
      const status: ScanStatus = {
        lastScan: Date.now(),
        scanners: [],
        findingsCount: 0,
        riskGrade: 'N/A',
        criticalCount: 0,
        highCount: 0,
      };
      await _saveScanStatus(projectPath, status);
      return status;
    }

    // 2. Run scan (Trivy/Semgrep — can take a while)
    await callDccTool('cube_scan_project', {
      project_path: projectPath,
      scanners: scannerNames,
      timeout: 300,
    }, projectPath);

    // 3. Calculate risk scores
    await callDccTool('cube_calculate_risks', {}, projectPath);

    // 4. Get aggregated stats
    const stats = await callDccTool('cube_finding_stats', {}, projectPath) as Record<string, unknown> | null;

    let findingsCount = 0;
    let criticalCount = 0;
    let highCount = 0;
    let riskGrade = 'A';

    if (stats) {
      const bySeverity = (stats.by_severity ?? {}) as Record<string, number>;
      criticalCount = bySeverity.critical ?? 0;
      highCount = bySeverity.high ?? 0;
      findingsCount = Object.values(bySeverity).reduce((sum, v) => sum + (Number(v) || 0), 0);

      // Derive grade from critical/high counts
      if (criticalCount > 0) riskGrade = 'D';
      else if (highCount > 3) riskGrade = 'C';
      else if (highCount > 0) riskGrade = 'B';
      else riskGrade = 'A';
    }

    const status: ScanStatus = {
      lastScan: Date.now(),
      scanners: scannerNames,
      findingsCount,
      riskGrade,
      criticalCount,
      highCount,
    };

    await _saveScanStatus(projectPath, status);
    console.log(`[SecurityScan] Scan complete: ${findingsCount} findings, grade ${riskGrade}`);
    return status;
  } catch (e) {
    console.warn('[SecurityScan] Scan failed (non-fatal):', e);
    return null;
  }
}

// =====================================================
// Public API
// =====================================================

/**
 * Scan project for security vulnerabilities.
 * Debounced: skips if last scan was less than 1 hour ago.
 * Non-blocking: returns in-flight promise if scan is already running.
 */
export async function scanProject(projectPath: string): Promise<ScanStatus | null> {
  // Return in-flight scan if already running
  if (_currentScan) return _currentScan;

  // Check cooldown against persisted status
  const cached = await _loadScanStatus(projectPath);
  if (cached && Date.now() - cached.lastScan < SCAN_COOLDOWN_MS) {
    _lastStatus = cached;
    return cached;
  }

  // Grace period: let the UI settle before starting heavy scan processes
  await new Promise<void>(r => setTimeout(r, 5000));

  // Re-check: another call may have started a scan during the grace period
  if (_currentScan) return _currentScan;

  _currentScan = _doScan(projectPath);
  try {
    const result = await _currentScan;
    _lastStatus = result;
    return result;
  } finally {
    _currentScan = null;
  }
}

/** Returns the most recent scan result without triggering a new scan. */
export function getLastStatus(): ScanStatus | null {
  return _lastStatus;
}

/** Returns true while a scan is in progress. */
export function isScanning(): boolean {
  return _currentScan !== null;
}
