/**
 * Index Dashboard Panel (DeltaCodeCube)
 *
 * Shows codebase health score, grade distribution, tensions, and debt.
 * Self-hides when DeltaCodeCube is not installed.
 */

import { useState, useEffect, useCallback } from 'react';
import { Database, AlertTriangle, FileWarning } from 'lucide-react';
import { ArchitectureView } from './ArchitectureView';
import { DependencyMatrixView } from './DependencyMatrixView';
import { useIndexEvent } from '../../core/utils/indexEventBus';
import {
  isDeltaCodeCubeInstalled,
  getIndexStats,
  getTensions,
  getDebt,
  type IndexStats,
  type TensionInfo,
  type DebtInfo,
} from '../../services/deltacodecubeService';

interface IndexDashboardPanelProps {
  projectPath: string | null;
}

type TabType = 'overview' | 'tensions' | 'debt' | 'viz';

export function IndexDashboardPanel({ projectPath }: IndexDashboardPanelProps) {
  const [installed, setInstalled] = useState(false);
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [tensions, setTensions] = useState<TensionInfo[]>([]);
  const [debt, setDebt] = useState<DebtInfo[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const loadData = useCallback(async () => {
    const isInstalled = await isDeltaCodeCubeInstalled();
    setInstalled(isInstalled);

    if (!isInstalled || !projectPath) {
      setStats(null);
      setTensions([]);
      setDebt([]);
      return;
    }

    const [statsResult, tensionsResult, debtResult] = await Promise.all([
      getIndexStats(projectPath).catch(() => null),
      getTensions(projectPath).catch(() => []),
      getDebt(projectPath).catch(() => []),
    ]);

    setStats(statsResult);
    setTensions(tensionsResult);
    setDebt(debtResult);
  }, [projectPath]);

  // Clear stale data and reload when project changes
  useEffect(() => {
    setStats(null);
    setTensions([]);
    setDebt([]);

    if (!projectPath) return;

    // Check installed + load data for new project
    isDeltaCodeCubeInstalled().then(isInstalled => {
      setInstalled(isInstalled);
      if (isInstalled) {
        loadData();
      }
    }).catch(() => {});
  }, [projectPath, loadData]);

  // Auto-refresh on index events
  useIndexEvent('indexed', (data) => {
    if (data.projectPath === projectPath) {
      loadData();
    }
  }, [projectPath, loadData]);

  // Self-hide when not installed
  if (!installed) return null;

  const maxDistCount = stats
    ? Math.max(stats.distribution.A, stats.distribution.B, stats.distribution.C, stats.distribution.D, stats.distribution.F, 1)
    : 1;

  return (
    <div className="index-dashboard">
      <div className="index-section-header">Codebase Index</div>

      {/* Tabs */}
      <div className="index-tabs">
        <button
          className={`index-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={`index-tab ${activeTab === 'tensions' ? 'active' : ''}`}
          onClick={() => setActiveTab('tensions')}
        >
          Tensions{tensions.length > 0 ? ` (${tensions.length})` : ''}
        </button>
        <button
          className={`index-tab ${activeTab === 'debt' ? 'active' : ''}`}
          onClick={() => setActiveTab('debt')}
        >
          Debt{debt.length > 0 ? ` (${debt.length})` : ''}
        </button>
        <button
          className={`index-tab ${activeTab === 'viz' ? 'active' : ''}`}
          onClick={() => setActiveTab('viz')}
        >
          Viz
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="index-overview">
          {stats ? (
            <>
              <div className="index-score-display">
                <span className={`index-grade-badge index-grade-badge--${stats.grade}`}>
                  {stats.grade}
                </span>
                <div className="index-score-meta">
                  <span className="index-score-value">{stats.codebaseScore}</span>
                  <span className="index-score-label">Codebase Score</span>
                  <span className="index-score-files">{stats.totalFiles} files indexed</span>
                </div>
              </div>

              <div className="index-distribution">
                {(['A', 'B', 'C', 'D', 'F'] as const).map(grade => {
                  const count = stats.distribution[grade];
                  const pct = (count / maxDistCount) * 100;
                  return (
                    <div key={grade} className="index-dist-row">
                      <span className={`index-dist-grade index-grade-text--${grade}`}>{grade}</span>
                      <div className="index-dist-bar">
                        <div
                          className={`index-dist-fill index-dist-fill--${grade}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="index-dist-count">{count}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="index-empty">
              <Database size={24} />
              <span>No index data yet. Index a project to see stats.</span>
            </div>
          )}
        </div>
      )}

      {/* Tensions Tab */}
      {activeTab === 'tensions' && (
        <div className="index-tensions">
          {tensions.length === 0 ? (
            <div className="index-empty">
              <AlertTriangle size={24} />
              <span>No tensions detected</span>
            </div>
          ) : (
            tensions.slice(0, 20).map((tension) => (
              <div key={tension.id} className="index-tension-item">
                <div className="index-tension-files">
                  <span>{shortenPath(tension.fileA)}</span>
                  <span className="index-tension-arrow">&harr;</span>
                  <span>{shortenPath(tension.fileB)}</span>
                </div>
                <span className="index-tension-distance">
                  Distance: {tension.distance.toFixed(2)} | {tension.type}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Debt Tab */}
      {activeTab === 'debt' && (
        <div className="index-debt">
          {debt.length === 0 ? (
            <div className="index-empty">
              <FileWarning size={24} />
              <span>No technical debt detected</span>
            </div>
          ) : (
            debt.slice(0, 20).map((item) => (
              <div key={item.file} className="index-debt-item">
                <span className={`index-grade-badge index-grade-badge--${item.grade}`} style={{ width: 20, height: 20, fontSize: '0.65rem' }}>
                  {item.grade}
                </span>
                <span className="index-debt-file" title={item.file}>
                  {shortenPath(item.file)}
                </span>
                <span className={`index-debt-score index-grade-text--${item.grade}`}>
                  {item.score}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Visualizations Tab */}
      {activeTab === 'viz' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <ArchitectureView projectPath={projectPath} />
          <DependencyMatrixView projectPath={projectPath} />
        </div>
      )}
    </div>
  );
}

function shortenPath(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 2) return path;
  return `.../${parts.slice(-2).join('/')}`;
}
