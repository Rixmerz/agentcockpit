/**
 * Index Dashboard Panel (DeltaCodeCube)
 *
 * Shows codebase health score, grade distribution, tensions, debt, smells, and visualizations.
 * Self-hides when DeltaCodeCube is not installed.
 * Loads data automatically if DCC server is already running, otherwise shows Load button.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Database, AlertTriangle, FileWarning, RefreshCw, Loader2, Bug, Eye, EyeOff, Zap, Maximize2 } from 'lucide-react';
import { DccAnalysisModal } from './DccAnalysisModal';
import { useIndexEvent } from '../../core/utils/indexEventBus';
import {
  isDeltaCodeCubeInstalled,
  getIndexStats,
  getTensions,
  getDebt,
  resolveTension,
  analyzeImpact,
  detectSmells,
  detectClones,
  getSuggestions,
  detectDrift,
  analyzeGraph,
  getDeltas,
  clusterFiles,
  type IndexStats,
  type TensionInfo,
  type DebtInfo,
  type ImpactResult,
  type SmellsResult,
  type ClonesResult,
  type SuggestionsResult,
  type DriftResult,
  type GraphResult,
  type DeltaInfo,
  type ClusterResult,
} from '../../services/deltacodecubeService';

interface IndexDashboardPanelProps {
  projectPath: string | null;
}

type TabType = 'overview' | 'tensions' | 'debt';

interface CacheEntry {
  stats: IndexStats | null;
  tensions: TensionInfo[];
  debt: DebtInfo[];
  smells: SmellsResult | null;
  clones: ClonesResult | null;
  suggestions: SuggestionsResult | null;
  drift: DriftResult | null;
  graph: GraphResult | null;
  deltas: DeltaInfo[];
  clusters: ClusterResult | null;
}

export function IndexDashboardPanel({ projectPath }: IndexDashboardPanelProps) {
  const [installed, setInstalled] = useState(false);
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [tensions, setTensions] = useState<TensionInfo[]>([]);
  const [debt, setDebt] = useState<DebtInfo[]>([]);
  const [smells, setSmells] = useState<SmellsResult | null>(null);
  const [clones, setClones] = useState<ClonesResult | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionsResult | null>(null);
  const [drift, setDrift] = useState<DriftResult | null>(null);
  const [graph, setGraph] = useState<GraphResult | null>(null);
  const [deltas, setDeltas] = useState<DeltaInfo[]>([]);
  const [clusters, setClusters] = useState<ClusterResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Tension detail states
  const [expandedTension, setExpandedTension] = useState<string | null>(null);
  const [tensionImpact, setTensionImpact] = useState<Record<string, ImpactResult | null>>({});
  const [tensionLoadingId, setTensionLoadingId] = useState<string | null>(null);

  // Analysis modal
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Per-project cache
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());

  // Load all data from DCC (sidebar + modal data in one shot)
  const loadData = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const [
        statsResult, tensionsResult, debtResult, smellsResult,
        clonesResult, suggestionsResult, driftResult, graphResult, deltasResult, clustersResult,
      ] = await Promise.all([
        getIndexStats(projectPath).catch(() => null),
        getTensions(projectPath).catch(() => []),
        getDebt(projectPath).catch(() => []),
        detectSmells(projectPath).catch(() => null),
        detectClones(projectPath).catch(() => null),
        getSuggestions(projectPath).catch(() => null),
        detectDrift(projectPath).catch(() => null),
        analyzeGraph(projectPath).catch(() => null),
        getDeltas(projectPath).catch(() => []),
        clusterFiles(projectPath).catch(() => null),
      ]);
      setStats(statsResult);
      setTensions(tensionsResult);
      setDebt(debtResult);
      setSmells(smellsResult);
      setClones(clonesResult);
      setSuggestions(suggestionsResult);
      setDrift(driftResult);
      setGraph(graphResult);
      setDeltas(deltasResult);
      setClusters(clustersResult);
      cacheRef.current.set(projectPath, {
        stats: statsResult,
        tensions: tensionsResult,
        debt: debtResult,
        smells: smellsResult,
        clones: clonesResult,
        suggestions: suggestionsResult,
        drift: driftResult,
        graph: graphResult,
        deltas: deltasResult,
        clusters: clustersResult,
      });
    } catch {
      // Silent — errors show as empty data
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // On project change: restore cache or load if server running
  useEffect(() => {
    if (!projectPath) {
      setStats(null);
      setTensions([]);
      setDebt([]);
      setSmells(null);
      setClones(null);
      setSuggestions(null);
      setDrift(null);
      setGraph(null);
      setDeltas([]);
      setClusters(null);
      return;
    }

    const cached = cacheRef.current.get(projectPath);
    if (cached) {
      setStats(cached.stats);
      setTensions(cached.tensions);
      setDebt(cached.debt);
      setSmells(cached.smells);
      setClones(cached.clones);
      setSuggestions(cached.suggestions);
      setDrift(cached.drift);
      setGraph(cached.graph);
      setDeltas(cached.deltas);
      setClusters(cached.clusters);
    } else {
      setStats(null);
      setTensions([]);
      setDebt([]);
      setSmells(null);
      setClones(null);
      setSuggestions(null);
      setDrift(null);
      setGraph(null);
      setDeltas([]);
      setClusters(null);
    }

    // Reset tension detail state on project switch
    setExpandedTension(null);
    setTensionImpact({});

    isDeltaCodeCubeInstalled().then(isInstalled => {
      setInstalled(isInstalled);
      // Data loaded on-demand via Load button, not automatically
    }).catch(() => {});
  }, [projectPath]);

  // Auto-refresh on index events
  useIndexEvent('indexed', (data) => {
    if (data.projectPath === projectPath) {
      loadData();
    }
  }, [projectPath, loadData]);

  // Handle tension resolve/ignore
  const handleResolveTension = useCallback(async (tensionId: string, action: 'resolved' | 'ignored') => {
    if (!projectPath) return;
    setTensionLoadingId(tensionId);
    try {
      const result = await resolveTension(projectPath, tensionId, action);
      if (result.success) {
        setTensions(prev => prev.map(t =>
          t.id === tensionId ? { ...t, status: action } : t
        ));
      }
    } catch (e) {
      console.error('[IndexDashboard] Resolve tension error:', e);
    } finally {
      setTensionLoadingId(null);
    }
  }, [projectPath]);

  // Handle impact analysis for a tension file
  const handleAnalyzeImpact = useCallback(async (tensionId: string, filePath: string) => {
    if (!projectPath) return;
    if (tensionImpact[tensionId]) {
      // Toggle collapse
      setExpandedTension(prev => prev === tensionId ? null : tensionId);
      return;
    }
    setExpandedTension(tensionId);
    setTensionLoadingId(tensionId);
    try {
      const result = await analyzeImpact(projectPath, filePath);
      setTensionImpact(prev => ({ ...prev, [tensionId]: result }));
    } catch (e) {
      console.error('[IndexDashboard] Impact analysis error:', e);
    } finally {
      setTensionLoadingId(null);
    }
  }, [projectPath, tensionImpact]);

  if (!installed) return null;

  const hasData = !!stats;
  const maxDistCount = stats
    ? Math.max(stats.distribution.A, stats.distribution.B, stats.distribution.C, stats.distribution.D, stats.distribution.F, 1)
    : 1;

  const activeTensions = tensions.filter(t => t.status === 'detected' || t.status === 'reviewed');
  const resolvedTensions = tensions.filter(t => t.status === 'resolved' || t.status === 'ignored');

  return (
    <div className="index-dashboard">
      <div className="index-section-header" style={{ display: 'flex', alignItems: 'center' }}>
        Codebase Index
        {hasData && (
          <button
            className="index-refresh-btn"
            onClick={loadData}
            disabled={loading}
            title="Refresh stats"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6, padding: '2px' }}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="index-tabs">
        {([
          { key: 'overview' as TabType, label: 'Overview' },
          { key: 'tensions' as TabType, label: `Tensions${activeTensions.length > 0 ? ` (${activeTensions.length})` : ''}` },
          { key: 'debt' as TabType, label: `Debt${debt.length > 0 ? ` (${debt.length})` : ''}` },
        ]).map(tab => (
          <button
            key={tab.key}
            className={`index-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <button
          className="index-tab index-tab--action"
          onClick={() => setIsModalOpen(true)}
          title="Open full DCC analysis"
          disabled={!hasData}
        >
          <Maximize2 size={10} />
          Full
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="index-overview">
          {loading ? (
            <div className="index-empty">
              <Loader2 size={24} className="animate-spin" />
              <span>Loading index data...</span>
            </div>
          ) : stats ? (
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

              {/* Quick summary row */}
              <div className="index-summary-row">
                {activeTensions.length > 0 && (
                  <span className="index-summary-chip index-summary-chip--warning">
                    <AlertTriangle size={10} /> {activeTensions.length} tensions
                  </span>
                )}
                {smells && smells.totalSmells > 0 && (
                  <span className="index-summary-chip index-summary-chip--info">
                    <Bug size={10} /> {smells.totalSmells} smells
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="index-empty">
              <Database size={24} />
              <span>No index data yet.</span>
              <button
                className="index-load-btn"
                onClick={loadData}
                disabled={loading}
                style={{
                  marginTop: '8px',
                  padding: '4px 12px',
                  fontSize: '0.75rem',
                  background: 'var(--color-accent, #0ea5e9)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  opacity: loading ? 0.5 : 1,
                }}
              >
                {loading ? 'Loading...' : 'Load Index'}
              </button>
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
            <>
              {/* Active tensions */}
              {activeTensions.length > 0 && (
                <>
                  <div className="index-tension-section-label">Active ({activeTensions.length})</div>
                  {activeTensions.slice(0, 30).map((tension) => (
                    <TensionItem
                      key={tension.id}
                      tension={tension}
                      expanded={expandedTension === tension.id}
                      impact={tensionImpact[tension.id] || null}
                      loadingId={tensionLoadingId}
                      onToggleExpand={() => handleAnalyzeImpact(tension.id, tension.fileA)}
                      onResolve={(action) => handleResolveTension(tension.id, action)}
                    />
                  ))}
                </>
              )}

              {/* Resolved tensions (collapsed) */}
              {resolvedTensions.length > 0 && (
                <details className="index-tension-resolved-group">
                  <summary className="index-tension-section-label" style={{ cursor: 'pointer' }}>
                    Resolved/Ignored ({resolvedTensions.length})
                  </summary>
                  {resolvedTensions.slice(0, 10).map((tension) => (
                    <div key={tension.id} className="index-tension-item index-tension-item--resolved">
                      <div className="index-tension-files">
                        <span>{shortenPath(tension.fileA)}</span>
                        <span className="index-tension-arrow">&harr;</span>
                        <span>{shortenPath(tension.fileB)}</span>
                      </div>
                      <span className="index-tension-distance">
                        {tension.status} | {tension.magnitude.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </details>
              )}
            </>
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

      {/* DCC Analysis Modal */}
      <DccAnalysisModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        projectPath={projectPath}
        preloaded={stats ? {
          stats, tensions, debt, smells,
          clones, suggestions, drift, graph, deltas, clusters,
        } : undefined}
      />
    </div>
  );
}

// =====================================================
// Sub-components
// =====================================================

interface TensionItemProps {
  tension: TensionInfo;
  expanded: boolean;
  impact: ImpactResult | null;
  loadingId: string | null;
  onToggleExpand: () => void;
  onResolve: (action: 'resolved' | 'ignored') => void;
}

function TensionItem({ tension, expanded, impact, loadingId, onToggleExpand, onResolve }: TensionItemProps) {
  const isLoading = loadingId === tension.id;
  const severityColor = tension.magnitude > 0.5 ? '#ff3d00' : tension.magnitude > 0.2 ? '#ff9100' : '#ffc400';

  return (
    <div className="index-tension-item" style={{ borderLeftColor: severityColor }}>
      <div className="index-tension-files">
        <span>{shortenPath(tension.fileA)}</span>
        <span className="index-tension-arrow">&harr;</span>
        <span>{shortenPath(tension.fileB)}</span>
      </div>

      <div className="index-tension-meta">
        <span className="index-tension-magnitude" style={{ color: severityColor }}>
          {tension.magnitude.toFixed(2)}
        </span>
        {tension.percent > 0 && (
          <span className="index-tension-percent">+{tension.percent.toFixed(0)}%</span>
        )}
        <span className="index-tension-distance">
          d={tension.distance.toFixed(2)}
        </span>
      </div>

      {/* Actions */}
      <div className="index-tension-actions">
        <button
          className="index-tension-action-btn"
          onClick={onToggleExpand}
          disabled={isLoading}
          title="Analyze impact"
        >
          {isLoading ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
          <span>Impact</span>
        </button>
        <button
          className="index-tension-action-btn"
          onClick={() => onResolve('resolved')}
          disabled={isLoading}
          title="Mark as resolved"
        >
          <Eye size={10} />
          <span>Resolve</span>
        </button>
        <button
          className="index-tension-action-btn"
          onClick={() => onResolve('ignored')}
          disabled={isLoading}
          title="Ignore this tension"
        >
          <EyeOff size={10} />
          <span>Ignore</span>
        </button>
      </div>

      {/* Suggested action */}
      {tension.suggestedAction && (
        <div className="index-tension-suggestion">
          {tension.suggestedAction}
        </div>
      )}

      {/* Impact analysis detail */}
      {expanded && impact && (
        <div className="index-tension-impact">
          <div className="index-tension-impact-header">
            <span className={`index-risk-badge index-risk-badge--${impact.riskLevel}`}>
              {impact.riskLevel}
            </span>
            <span>{impact.totalAffected} files affected</span>
            <span>depth {impact.maxPropagationDepth}</span>
          </div>
          {impact.recommendation && (
            <div className="index-tension-impact-rec">{impact.recommendation}</div>
          )}
          {impact.reviewOrder.length > 0 && (
            <div className="index-tension-impact-files">
              {impact.reviewOrder.slice(0, 5).map((r, i) => (
                <div key={i} className="index-tension-impact-file">
                  <span className="index-tension-impact-priority">#{r.priority}</span>
                  <span className="index-tension-impact-name" title={r.file}>{shortenPath(r.file)}</span>
                  <span className="index-tension-impact-intensity" style={{ opacity: Math.max(0.3, r.intensity) }}>
                    {(r.intensity * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================
// Helpers
// =====================================================

function shortenPath(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 2) return path;
  return `.../${parts.slice(-2).join('/')}`;
}
