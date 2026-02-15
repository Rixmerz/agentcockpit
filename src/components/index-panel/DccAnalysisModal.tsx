/**
 * DCC Analysis Modal
 *
 * Full-screen modal exposing ALL DeltaCodeCube capabilities.
 * Sidebar navigation with panels for each feature category.
 */

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X, BarChart3, AlertTriangle, FileWarning, Bug, Copy,
  Network, Grid3X3, Flame, Clock, Zap, Waves, FolderTree,
  Loader2, RefreshCw, Eye, EyeOff, Maximize2, Minimize2,
  Lightbulb, GitBranch, Box, ArrowLeftRight, History, Layers,
} from 'lucide-react';
import {
  isDccServerRunningFor,
  getIndexStats,
  getTensions,
  getDebt,
  resolveTension,
  analyzeImpact,
  simulateWave,
  detectSmells,
  detectClones,
  getSuggestions,
  detectDrift,
  analyzeGraph,
  getDeltas,
  clusterFiles,
  compareFiles,
  exportCubeHtml,
  generateArchitecture,
  generateMatrix,
  generateTimeline,
  generateHeatmap,
  type IndexStats,
  type TensionInfo,
  type DebtInfo,
  type ImpactResult,
  type WaveResult,
  type SmellsResult,
  type ClonesResult,
  type SuggestionsResult,
  type DriftResult,
  type GraphResult,
  type DeltaInfo,
  type ClusterResult,
  type CompareResult,
} from '../../services/deltacodecubeService';

export interface DccPreloadedData {
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

interface DccAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string | null;
  preloaded?: DccPreloadedData;
}

type Section =
  | 'overview' | 'tensions' | 'debt' | 'smells' | 'clones'
  | 'suggestions' | 'drift' | 'graph' | 'deltas' | 'clusters' | 'compare'
  | 'architecture' | 'matrix' | 'heatmap' | 'timeline' | 'cube3d'
  | 'impact' | 'wave';

const NAV_ITEMS: { key: Section; label: string; icon: React.ReactNode; group: string }[] = [
  { key: 'overview', label: 'Overview', icon: <BarChart3 size={14} />, group: 'Health' },
  { key: 'tensions', label: 'Tensions', icon: <AlertTriangle size={14} />, group: 'Health' },
  { key: 'debt', label: 'Tech Debt', icon: <FileWarning size={14} />, group: 'Health' },
  { key: 'suggestions', label: 'Suggestions', icon: <Lightbulb size={14} />, group: 'Health' },
  { key: 'smells', label: 'Code Smells', icon: <Bug size={14} />, group: 'Quality' },
  { key: 'clones', label: 'Clones', icon: <Copy size={14} />, group: 'Quality' },
  { key: 'drift', label: 'Drift', icon: <GitBranch size={14} />, group: 'Quality' },
  { key: 'impact', label: 'Impact Analysis', icon: <Zap size={14} />, group: 'Analysis' },
  { key: 'wave', label: 'Wave Simulation', icon: <Waves size={14} />, group: 'Analysis' },
  { key: 'graph', label: 'Graph Analysis', icon: <Network size={14} />, group: 'Analysis' },
  { key: 'compare', label: 'Compare Files', icon: <ArrowLeftRight size={14} />, group: 'Analysis' },
  { key: 'clusters', label: 'Clusters', icon: <Layers size={14} />, group: 'Analysis' },
  { key: 'deltas', label: 'Deltas', icon: <History size={14} />, group: 'Analysis' },
  { key: 'architecture', label: 'Architecture', icon: <Network size={14} />, group: 'Visualizations' },
  { key: 'matrix', label: 'Dep. Matrix', icon: <Grid3X3 size={14} />, group: 'Visualizations' },
  { key: 'heatmap', label: 'Heatmap', icon: <Flame size={14} />, group: 'Visualizations' },
  { key: 'timeline', label: 'Timeline', icon: <Clock size={14} />, group: 'Visualizations' },
  { key: 'cube3d', label: '3D Cube', icon: <Box size={14} />, group: 'Visualizations' },
];

export function DccAnalysisModal({ isOpen, onClose, projectPath, preloaded }: DccAnalysisModalProps) {
  const [activeSection, setActiveSection] = useState<Section>('overview');

  // Data states
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [tensions, setTensions] = useState<TensionInfo[]>([]);
  const [debt, setDebt] = useState<DebtInfo[]>([]);
  const [smellsData, setSmellsData] = useState<SmellsResult | null>(null);
  const [clonesData, setClonesData] = useState<ClonesResult | null>(null);
  const [suggestionsData, setSuggestionsData] = useState<SuggestionsResult | null>(null);
  const [driftData, setDriftData] = useState<DriftResult | null>(null);
  const [graphData, setGraphData] = useState<GraphResult | null>(null);
  const [deltasData, setDeltasData] = useState<DeltaInfo[]>([]);
  const [clustersData, setClustersData] = useState<ClusterResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Compare state
  const [compareFileA, setCompareFileA] = useState('');
  const [compareFileB, setCompareFileB] = useState('');
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  // Viz states
  const [archHtml, setArchHtml] = useState<string | null>(null);
  const [matrixHtml, setMatrixHtml] = useState<string | null>(null);
  const [heatmapHtml, setHeatmapHtml] = useState<string | null>(null);
  const [timelineHtml, setTimelineHtml] = useState<string | null>(null);
  const [cubeHtml, setCubeHtml] = useState<string | null>(null);
  const [vizLoading, setVizLoading] = useState<string | null>(null);
  const [expandedViz, setExpandedViz] = useState(false);

  // Impact/Wave states
  const [impactFile, setImpactFile] = useState('');
  const [impactResult, setImpactResult] = useState<ImpactResult | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [waveFile, setWaveFile] = useState('');
  const [waveIntensity, setWaveIntensity] = useState(1.0);
  const [waveResult, setWaveResult] = useState<WaveResult | null>(null);
  const [waveLoading, setWaveLoading] = useState(false);

  // Tension actions
  const [tensionLoadingId, setTensionLoadingId] = useState<string | null>(null);
  const [tensionImpacts, setTensionImpacts] = useState<Record<string, ImpactResult | null>>({});
  const [expandedTensionId, setExpandedTensionId] = useState<string | null>(null);

  // Load core data on open — use preloaded if available
  useEffect(() => {
    if (!isOpen || !projectPath || dataLoaded) return;

    // If parent already loaded all data, seed from props
    if (preloaded) {
      setStats(preloaded.stats);
      setTensions(preloaded.tensions);
      setDebt(preloaded.debt);
      setSmellsData(preloaded.smells);
      setClonesData(preloaded.clones);
      setSuggestionsData(preloaded.suggestions);
      setDriftData(preloaded.drift);
      setGraphData(preloaded.graph);
      setDeltasData(preloaded.deltas);
      setClustersData(preloaded.clusters);
      setDataLoaded(true);
      return;
    }

    // Fallback: fetch everything if no preloaded data
    if (!isDccServerRunningFor(projectPath)) return;

    setLoading(true);
    Promise.all([
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
    ]).then(([s, t, d, sm, cl, sg, dr, gr, dl, clu]) => {
      setStats(s);
      setTensions(t);
      setDebt(d);
      setSmellsData(sm);
      setClonesData(cl);
      setSuggestionsData(sg);
      setDriftData(dr);
      setGraphData(gr);
      setDeltasData(dl);
      setClustersData(clu);
      setDataLoaded(true);
    }).finally(() => setLoading(false));
  }, [isOpen, projectPath, dataLoaded, preloaded]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setDataLoaded(false);
      setArchHtml(null);
      setMatrixHtml(null);
      setHeatmapHtml(null);
      setTimelineHtml(null);
      setCubeHtml(null);
      setImpactResult(null);
      setWaveResult(null);
      setCompareResult(null);
      setExpandedTensionId(null);
      setTensionImpacts({});
    }
  }, [isOpen]);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Viz generator
  const handleGenerateViz = useCallback(async (type: 'architecture' | 'matrix' | 'heatmap' | 'timeline' | 'cube3d') => {
    if (!projectPath) return;
    setVizLoading(type);
    try {
      const generators = { architecture: generateArchitecture, matrix: generateMatrix, heatmap: generateHeatmap, timeline: generateTimeline, cube3d: exportCubeHtml };
      const html = await generators[type](projectPath);
      const setters = { architecture: setArchHtml, matrix: setMatrixHtml, heatmap: setHeatmapHtml, timeline: setTimelineHtml, cube3d: setCubeHtml };
      setters[type](html);
    } catch (e) {
      console.error(`[DccModal] ${type} error:`, e);
    } finally {
      setVizLoading(null);
    }
  }, [projectPath]);

  // Compare handler
  const handleCompare = useCallback(async () => {
    if (!projectPath || !compareFileA.trim() || !compareFileB.trim()) return;
    setCompareLoading(true);
    try {
      const absA = compareFileA.startsWith('/') ? compareFileA : `${projectPath}/${compareFileA}`;
      const absB = compareFileB.startsWith('/') ? compareFileB : `${projectPath}/${compareFileB}`;
      const result = await compareFiles(projectPath, absA, absB);
      setCompareResult(result);
    } catch (e) {
      console.error('[DccModal] Compare error:', e);
    } finally {
      setCompareLoading(false);
    }
  }, [projectPath, compareFileA, compareFileB]);

  // Impact analysis
  const handleImpact = useCallback(async () => {
    if (!projectPath || !impactFile.trim()) return;
    setImpactLoading(true);
    try {
      const absPath = impactFile.startsWith('/') ? impactFile : `${projectPath}/${impactFile}`;
      const result = await analyzeImpact(projectPath, absPath);
      setImpactResult(result);
    } catch (e) {
      console.error('[DccModal] Impact error:', e);
    } finally {
      setImpactLoading(false);
    }
  }, [projectPath, impactFile]);

  // Wave simulation
  const handleWave = useCallback(async () => {
    if (!projectPath || !waveFile.trim()) return;
    setWaveLoading(true);
    try {
      const absPath = waveFile.startsWith('/') ? waveFile : `${projectPath}/${waveFile}`;
      const result = await simulateWave(projectPath, absPath, waveIntensity);
      setWaveResult(result);
    } catch (e) {
      console.error('[DccModal] Wave error:', e);
    } finally {
      setWaveLoading(false);
    }
  }, [projectPath, waveFile, waveIntensity]);

  // Tension resolve
  const handleResolveTension = useCallback(async (id: string, action: 'resolved' | 'ignored') => {
    if (!projectPath) return;
    setTensionLoadingId(id);
    try {
      const result = await resolveTension(projectPath, id, action);
      if (result.success) setTensions(prev => prev.map(t => t.id === id ? { ...t, status: action } : t));
    } finally {
      setTensionLoadingId(null);
    }
  }, [projectPath]);

  // Tension impact
  const handleTensionImpact = useCallback(async (id: string, filePath: string) => {
    if (!projectPath) return;
    if (tensionImpacts[id]) { setExpandedTensionId(prev => prev === id ? null : id); return; }
    setExpandedTensionId(id);
    setTensionLoadingId(id);
    try {
      const result = await analyzeImpact(projectPath, filePath);
      setTensionImpacts(prev => ({ ...prev, [id]: result }));
    } finally {
      setTensionLoadingId(null);
    }
  }, [projectPath, tensionImpacts]);

  if (!isOpen) return null;

  const maxDist = stats ? Math.max(stats.distribution.A, stats.distribution.B, stats.distribution.C, stats.distribution.D, stats.distribution.F, 1) : 1;
  const activeTensions = tensions.filter(t => t.status === 'detected' || t.status === 'reviewed');
  const resolvedTensions = tensions.filter(t => t.status === 'resolved' || t.status === 'ignored');

  // Group nav items
  const groups = [...new Set(NAV_ITEMS.map(n => n.group))];

  return createPortal(
    <div className="dcc-modal-overlay" onClick={onClose}>
      <div className="dcc-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="dcc-modal-header">
          <FolderTree size={16} />
          <span>DeltaCodeCube Analysis</span>
          {projectPath && <span className="dcc-modal-project">{projectPath.split('/').pop()}</span>}
          <button className="dcc-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="dcc-modal-body">
          {/* Sidebar Nav */}
          <nav className="dcc-modal-nav">
            {groups.map(group => (
              <div key={group}>
                <div className="dcc-modal-nav-group">{group}</div>
                {NAV_ITEMS.filter(n => n.group === group).map(item => (
                  <button
                    key={item.key}
                    className={`dcc-modal-nav-item ${activeSection === item.key ? 'active' : ''}`}
                    onClick={() => setActiveSection(item.key)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {item.key === 'tensions' && activeTensions.length > 0 && (
                      <span className="dcc-modal-badge">{activeTensions.length}</span>
                    )}
                    {item.key === 'smells' && smellsData && smellsData.totalSmells > 0 && (
                      <span className="dcc-modal-badge">{smellsData.totalSmells}</span>
                    )}
                    {item.key === 'clones' && clonesData && clonesData.totalClones > 0 && (
                      <span className="dcc-modal-badge">{clonesData.totalClones}</span>
                    )}
                    {item.key === 'suggestions' && suggestionsData && suggestionsData.totalSuggestions > 0 && (
                      <span className="dcc-modal-badge">{suggestionsData.totalSuggestions}</span>
                    )}
                    {item.key === 'drift' && driftData && driftData.totalDrifts > 0 && (
                      <span className="dcc-modal-badge">{driftData.totalDrifts}</span>
                    )}
                    {item.key === 'deltas' && deltasData.length > 0 && (
                      <span className="dcc-modal-badge">{deltasData.length}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {/* Content Area */}
          <div className="dcc-modal-content">
            {loading ? (
              <div className="dcc-modal-loading"><Loader2 size={32} className="animate-spin" /><span>Loading analysis data...</span></div>
            ) : (
              <>
                {/* === OVERVIEW === */}
                {activeSection === 'overview' && (
                  <div className="dcc-panel">
                    <h3>Codebase Overview</h3>
                    {stats ? (
                      <>
                        <div className="dcc-overview-grid">
                          <div className="dcc-stat-card">
                            <span className={`index-grade-badge index-grade-badge--${stats.grade}`} style={{ width: 48, height: 48, fontSize: '1.5rem' }}>{stats.grade}</span>
                            <div><span className="dcc-stat-value">{stats.codebaseScore}</span><span className="dcc-stat-label">Codebase Score</span></div>
                          </div>
                          <div className="dcc-stat-card">
                            <span className="dcc-stat-value">{stats.totalFiles}</span><span className="dcc-stat-label">Files Indexed</span>
                          </div>
                          <div className="dcc-stat-card">
                            <span className="dcc-stat-value">{activeTensions.length}</span><span className="dcc-stat-label">Active Tensions</span>
                          </div>
                          <div className="dcc-stat-card">
                            <span className="dcc-stat-value">{smellsData?.totalSmells || 0}</span><span className="dcc-stat-label">Code Smells</span>
                          </div>
                        </div>
                        <h4>Grade Distribution</h4>
                        <div className="index-distribution" style={{ maxWidth: 400 }}>
                          {(['A', 'B', 'C', 'D', 'F'] as const).map(g => (
                            <div key={g} className="index-dist-row">
                              <span className={`index-dist-grade index-grade-text--${g}`}>{g}</span>
                              <div className="index-dist-bar"><div className={`index-dist-fill index-dist-fill--${g}`} style={{ width: `${(stats.distribution[g] / maxDist) * 100}%` }} /></div>
                              <span className="index-dist-count">{stats.distribution[g]}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="dcc-empty">No index data. Index the project first.</p>
                    )}
                  </div>
                )}

                {/* === TENSIONS === */}
                {activeSection === 'tensions' && (
                  <div className="dcc-panel">
                    <h3>Tensions ({activeTensions.length} active, {resolvedTensions.length} resolved)</h3>
                    {tensions.length === 0 ? (
                      <p className="dcc-empty">No tensions detected. Reindex after making changes to detect tensions.</p>
                    ) : (
                      <div className="dcc-tension-list">
                        {activeTensions.map(t => {
                          const sevColor = t.magnitude > 0.5 ? '#ff3d00' : t.magnitude > 0.2 ? '#ff9100' : '#ffc400';
                          const isExpanded = expandedTensionId === t.id;
                          const impact = tensionImpacts[t.id];
                          return (
                            <div key={t.id} className="dcc-tension-card" style={{ borderLeftColor: sevColor }}>
                              <div className="dcc-tension-row">
                                <code className="dcc-tension-file">{shortenPath(t.fileA)}</code>
                                <span className="dcc-tension-arrow">&harr;</span>
                                <code className="dcc-tension-file">{shortenPath(t.fileB)}</code>
                              </div>
                              <div className="dcc-tension-meta-row">
                                <span style={{ color: sevColor, fontWeight: 700 }}>{t.magnitude.toFixed(3)}</span>
                                {t.percent > 0 && <span className="dcc-muted">+{t.percent.toFixed(0)}%</span>}
                                <span className="dcc-muted">d={t.distance.toFixed(2)}</span>
                                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                                  <button className="dcc-action-btn" onClick={() => handleTensionImpact(t.id, t.fileA)} disabled={tensionLoadingId === t.id}>
                                    {tensionLoadingId === t.id ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />} Impact
                                  </button>
                                  <button className="dcc-action-btn" onClick={() => handleResolveTension(t.id, 'resolved')} disabled={tensionLoadingId === t.id}><Eye size={10} /> Resolve</button>
                                  <button className="dcc-action-btn" onClick={() => handleResolveTension(t.id, 'ignored')} disabled={tensionLoadingId === t.id}><EyeOff size={10} /> Ignore</button>
                                </div>
                              </div>
                              {t.suggestedAction && <div className="dcc-suggestion">{t.suggestedAction}</div>}
                              {isExpanded && impact && (
                                <div className="dcc-impact-detail">
                                  <div className="dcc-impact-header">
                                    <span className={`index-risk-badge index-risk-badge--${impact.riskLevel}`}>{impact.riskLevel}</span>
                                    <span>{impact.totalAffected} files affected</span>
                                    <span>depth {impact.maxPropagationDepth}</span>
                                  </div>
                                  {impact.recommendation && <div className="dcc-suggestion">{impact.recommendation}</div>}
                                  {impact.reviewOrder.slice(0, 8).map((r, i) => (
                                    <div key={i} className="dcc-review-item">
                                      <span className="dcc-muted">#{r.priority}</span>
                                      <code>{shortenPath(r.file)}</code>
                                      <span style={{ opacity: Math.max(0.3, r.intensity) }}>{(r.intensity * 100).toFixed(0)}%</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {resolvedTensions.length > 0 && (
                          <details style={{ marginTop: 8 }}>
                            <summary className="dcc-muted" style={{ cursor: 'pointer', fontSize: '0.75rem' }}>Resolved/Ignored ({resolvedTensions.length})</summary>
                            {resolvedTensions.map(t => (
                              <div key={t.id} className="dcc-tension-card" style={{ opacity: 0.5, borderLeftColor: 'var(--text-muted)' }}>
                                <div className="dcc-tension-row">
                                  <code className="dcc-tension-file">{shortenPath(t.fileA)}</code>
                                  <span className="dcc-tension-arrow">&harr;</span>
                                  <code className="dcc-tension-file">{shortenPath(t.fileB)}</code>
                                </div>
                                <div className="dcc-tension-meta-row"><span className="dcc-muted">{t.status}</span></div>
                              </div>
                            ))}
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* === DEBT === */}
                {activeSection === 'debt' && (
                  <div className="dcc-panel">
                    <h3>Technical Debt ({debt.length} files)</h3>
                    {debt.length === 0 ? <p className="dcc-empty">No technical debt detected.</p> : (
                      <div className="dcc-debt-list">
                        {debt.map(d => (
                          <div key={d.file} className="dcc-debt-row">
                            <span className={`index-grade-badge index-grade-badge--${d.grade}`} style={{ width: 24, height: 24, fontSize: '0.7rem' }}>{d.grade}</span>
                            <code className="dcc-debt-file" title={d.file}>{shortenPath(d.file)}</code>
                            <span className={`index-grade-text--${d.grade}`} style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{d.score}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* === SMELLS === */}
                {activeSection === 'smells' && (
                  <div className="dcc-panel">
                    <h3>Code Smells ({smellsData?.totalSmells || 0})</h3>
                    {!smellsData || smellsData.totalSmells === 0 ? <p className="dcc-empty">No code smells detected.</p> : (
                      <>
                        <div className="dcc-smells-summary">
                          {smellsData.bySeverity.critical > 0 && <span className="index-smell-badge index-smell-badge--critical">{smellsData.bySeverity.critical} critical</span>}
                          {smellsData.bySeverity.high > 0 && <span className="index-smell-badge index-smell-badge--high">{smellsData.bySeverity.high} high</span>}
                          {smellsData.bySeverity.medium > 0 && <span className="index-smell-badge index-smell-badge--medium">{smellsData.bySeverity.medium} medium</span>}
                          {smellsData.bySeverity.low > 0 && <span className="index-smell-badge index-smell-badge--low">{smellsData.bySeverity.low} low</span>}
                        </div>
                        <div className="dcc-smell-list">
                          {smellsData.smells.map((s, i) => (
                            <div key={i} className={`dcc-smell-card dcc-smell-card--${s.severity}`}>
                              <div className="dcc-smell-header">
                                <span className={`index-smell-badge index-smell-badge--${s.severity}`}>{formatSmellType(s.type)}</span>
                                <code title={s.filePath}>{shortenPath(s.filePath || s.fileName)}</code>
                              </div>
                              <p>{s.description}</p>
                              {s.suggestion && <p className="dcc-suggestion">{s.suggestion}</p>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* === CLONES === */}
                {activeSection === 'clones' && (
                  <div className="dcc-panel">
                    <h3>Code Clones ({clonesData?.totalClones || 0})</h3>
                    {!clonesData || clonesData.totalClones === 0 ? <p className="dcc-empty">No code clones detected.</p> : (
                      <>
                        <div className="dcc-smells-summary">
                          {clonesData.byType.exact > 0 && <span className="index-smell-badge index-smell-badge--critical">{clonesData.byType.exact} exact</span>}
                          {clonesData.byType.parameterized > 0 && <span className="index-smell-badge index-smell-badge--high">{clonesData.byType.parameterized} parameterized</span>}
                          {clonesData.byType.nearMiss > 0 && <span className="index-smell-badge index-smell-badge--medium">{clonesData.byType.nearMiss} near-miss</span>}
                        </div>
                        <div className="dcc-clone-list">
                          {clonesData.clones.map((c, i) => (
                            <div key={i} className="dcc-clone-card">
                              <div className="dcc-tension-row">
                                <code className="dcc-tension-file">{shortenPath(c.fileA)}</code>
                                <span className="dcc-tension-arrow">&harr;</span>
                                <code className="dcc-tension-file">{shortenPath(c.fileB)}</code>
                              </div>
                              <span className="dcc-muted">Similarity: {(c.similarity * 100).toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* === IMPACT ANALYSIS === */}
                {activeSection === 'impact' && (
                  <div className="dcc-panel">
                    <h3>Impact Analysis</h3>
                    <p className="dcc-description">Predict the blast radius of changing a file. Shows which files are affected and the recommended review order.</p>
                    <div className="dcc-input-row">
                      <input className="dcc-input" placeholder="File path (relative or absolute)" value={impactFile} onChange={e => setImpactFile(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleImpact()} />
                      <button className="dcc-btn" onClick={handleImpact} disabled={impactLoading || !impactFile.trim()}>
                        {impactLoading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Analyze
                      </button>
                    </div>
                    {impactResult && (
                      <div className="dcc-impact-detail" style={{ marginTop: 12 }}>
                        <div className="dcc-impact-header">
                          <span className={`index-risk-badge index-risk-badge--${impactResult.riskLevel}`}>{impactResult.riskLevel} risk</span>
                          <span>{impactResult.totalAffected} files affected</span>
                          <span>max depth {impactResult.maxPropagationDepth}</span>
                        </div>
                        {impactResult.recommendation && <div className="dcc-suggestion">{impactResult.recommendation}</div>}
                        {impactResult.naturalBoundaries.length > 0 && (
                          <div><span className="dcc-muted">Natural boundaries:</span> {impactResult.naturalBoundaries.map(b => shortenPath(b)).join(', ')}</div>
                        )}
                        <h4>Review Order</h4>
                        {impactResult.reviewOrder.map((r, i) => (
                          <div key={i} className="dcc-review-item">
                            <span className="dcc-muted">#{r.priority}</span>
                            <code>{shortenPath(r.file)}</code>
                            <span>{(r.intensity * 100).toFixed(0)}%</span>
                            <span className="dcc-muted">d={r.distance}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* === WAVE SIMULATION === */}
                {activeSection === 'wave' && (
                  <div className="dcc-panel">
                    <h3>Wave Simulation</h3>
                    <p className="dcc-description">Simulate how a change propagates through the dependency graph. See which files get affected and where the wave stops.</p>
                    <div className="dcc-input-row">
                      <input className="dcc-input" placeholder="Source file path" value={waveFile} onChange={e => setWaveFile(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleWave()} />
                      <input className="dcc-input" type="number" min={0.1} max={1} step={0.1} value={waveIntensity} onChange={e => setWaveIntensity(Number(e.target.value))} style={{ width: 70 }} title="Intensity" />
                      <button className="dcc-btn" onClick={handleWave} disabled={waveLoading || !waveFile.trim()}>
                        {waveLoading ? <Loader2 size={14} className="animate-spin" /> : <Waves size={14} />} Simulate
                      </button>
                    </div>
                    {waveResult && (
                      <div className="dcc-impact-detail" style={{ marginTop: 12 }}>
                        <div className="dcc-impact-header">
                          <span>{waveResult.totalAffected} files affected</span>
                          <span>max depth {waveResult.maxDepth}</span>
                          <span>{waveResult.boundariesCount} boundaries</span>
                        </div>
                        <h4>Affected Files ({waveResult.affectedFiles.length})</h4>
                        {waveResult.affectedFiles.slice(0, 20).map((f, i) => (
                          <div key={i} className="dcc-review-item">
                            <span style={{ width: 50, opacity: Math.max(0.3, f.waveIntensity) }}>{(f.waveIntensity * 100).toFixed(0)}%</span>
                            <code>{shortenPath(f.filePath)}</code>
                            <span className="dcc-muted">d={f.distanceFromSource}</span>
                            {f.isBarrier && <span className="index-smell-badge index-smell-badge--low">boundary</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* === SUGGESTIONS === */}
                {activeSection === 'suggestions' && (
                  <div className="dcc-panel">
                    <h3>Refactoring Suggestions ({suggestionsData?.totalSuggestions || 0})</h3>
                    {!suggestionsData || suggestionsData.totalSuggestions === 0 ? <p className="dcc-empty">No refactoring suggestions. Codebase looks clean!</p> : (
                      <>
                        <div className="dcc-smells-summary">
                          {Object.entries(suggestionsData.byAction).map(([action, count]) => (
                            count > 0 && <span key={action} className="index-smell-badge index-smell-badge--medium">{count} {action}</span>
                          ))}
                        </div>
                        <div className="dcc-suggestion-list">
                          {suggestionsData.suggestions.map((s, i) => (
                            <div key={i} className="dcc-suggestion-card">
                              <div className="dcc-suggestion-header">
                                <span className={`index-smell-badge index-smell-badge--${s.priority === 'high' ? 'critical' : s.priority === 'medium' ? 'high' : 'medium'}`}>
                                  {s.priority} / {s.action}
                                </span>
                                {s.impact && <span className="dcc-muted">Impact: {s.impact}</span>}
                                {s.effort && <span className="dcc-muted">Effort: {s.effort}</span>}
                              </div>
                              <p style={{ margin: '4px 0' }}>{s.description}</p>
                              {s.targetFiles.length > 0 && (
                                <div className="dcc-suggestion-files">
                                  {s.targetFiles.map((f, j) => <code key={j}>{shortenPath(f)}</code>)}
                                </div>
                              )}
                              {s.rationale && <p className="dcc-suggestion" style={{ marginTop: 4 }}>{s.rationale}</p>}
                              {s.steps.length > 0 && (
                                <details style={{ marginTop: 4 }}>
                                  <summary className="dcc-muted" style={{ cursor: 'pointer', fontSize: '0.75rem' }}>Steps ({s.steps.length})</summary>
                                  <ol style={{ margin: '4px 0 0 16px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    {s.steps.map((step, j) => <li key={j}>{step}</li>)}
                                  </ol>
                                </details>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* === DRIFT === */}
                {activeSection === 'drift' && (
                  <div className="dcc-panel">
                    <h3>Code Drift ({driftData?.totalDrifts || 0})</h3>
                    <p className="dcc-description">Detects files that are diverging unexpectedly — semantic, contract, or temporal drift.</p>
                    {!driftData || driftData.totalDrifts === 0 ? <p className="dcc-empty">No code drift detected.</p> : (
                      <>
                        <div className="dcc-smells-summary">
                          {Object.entries(driftData.byType).map(([type, count]) => (
                            count > 0 && <span key={type} className="index-smell-badge index-smell-badge--medium">{count} {type}</span>
                          ))}
                        </div>
                        <div className="dcc-drift-list">
                          {driftData.drifts.map((d, i) => (
                            <div key={i} className={`dcc-smell-card dcc-smell-card--${d.severity}`}>
                              <div className="dcc-tension-row">
                                <span className={`index-smell-badge index-smell-badge--${d.severity === 'high' ? 'critical' : d.severity}`}>{d.type}</span>
                                <code className="dcc-tension-file">{shortenPath(d.fileA)}</code>
                                <span className="dcc-tension-arrow">&harr;</span>
                                <code className="dcc-tension-file">{shortenPath(d.fileB)}</code>
                              </div>
                              <p>{d.description}</p>
                              {d.recommendation && <p className="dcc-suggestion">{d.recommendation}</p>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* === GRAPH ANALYSIS === */}
                {activeSection === 'graph' && (
                  <div className="dcc-panel">
                    <h3>Dependency Graph Analysis</h3>
                    <p className="dcc-description">Centrality metrics reveal the most important, connected, and bridging files in your codebase.</p>
                    {!graphData ? <p className="dcc-empty">No graph data available.</p> : (
                      <>
                        <div className="dcc-overview-grid">
                          <div className="dcc-stat-card"><span className="dcc-stat-value">{graphData.totalFiles}</span><span className="dcc-stat-label">Nodes</span></div>
                          <div className="dcc-stat-card"><span className="dcc-stat-value">{graphData.totalEdges}</span><span className="dcc-stat-label">Edges</span></div>
                        </div>
                        {([
                          { key: 'topPageRank', label: 'PageRank (Critical Modules)', desc: 'Most important files — changes here affect many' },
                          { key: 'topAuthority', label: 'Authority (Core Utilities)', desc: 'Foundational code that others depend on' },
                          { key: 'topHub', label: 'Hub (Aggregators)', desc: 'Index/barrel files that re-export' },
                          { key: 'topBetweenness', label: 'Betweenness (Bridges)', desc: 'Breaking these isolates modules' },
                        ] as const).map(metric => {
                          const items = graphData[metric.key];
                          if (!items || items.length === 0) return null;
                          return (
                            <div key={metric.key} style={{ marginTop: 12 }}>
                              <h4 style={{ margin: '0 0 2px' }}>{metric.label}</h4>
                              <p className="dcc-muted" style={{ margin: '0 0 6px', fontSize: '0.7rem' }}>{metric.desc}</p>
                              {items.map((m, i) => (
                                <div key={i} className="dcc-review-item">
                                  <span className="dcc-muted">#{i + 1}</span>
                                  <code>{shortenPath(m.file)}</code>
                                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{m.value.toFixed(4)}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}

                {/* === COMPARE === */}
                {activeSection === 'compare' && (
                  <div className="dcc-panel">
                    <h3>Compare Files</h3>
                    <p className="dcc-description">Compare two files in the 63D feature space. Shows distance across lexical, structural, and semantic axes.</p>
                    <div className="dcc-input-row">
                      <input className="dcc-input" placeholder="File A (relative or absolute)" value={compareFileA} onChange={e => setCompareFileA(e.target.value)} />
                      <input className="dcc-input" placeholder="File B (relative or absolute)" value={compareFileB} onChange={e => setCompareFileB(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCompare()} />
                      <button className="dcc-btn" onClick={handleCompare} disabled={compareLoading || !compareFileA.trim() || !compareFileB.trim()}>
                        {compareLoading ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />} Compare
                      </button>
                    </div>
                    {compareResult && (
                      <div className="dcc-impact-detail" style={{ marginTop: 12 }}>
                        <div className="dcc-overview-grid">
                          <div className="dcc-stat-card"><span className="dcc-stat-value">{(compareResult.similarity * 100).toFixed(1)}%</span><span className="dcc-stat-label">Similarity</span></div>
                          <div className="dcc-stat-card"><span className="dcc-stat-value">{compareResult.overallDistance.toFixed(3)}</span><span className="dcc-stat-label">Distance</span></div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <div className="dcc-stat-card" style={{ flex: 1 }}><span className="dcc-stat-value" style={{ fontSize: '0.9rem' }}>{compareResult.lexicalDistance.toFixed(3)}</span><span className="dcc-stat-label">Lexical</span></div>
                          <div className="dcc-stat-card" style={{ flex: 1 }}><span className="dcc-stat-value" style={{ fontSize: '0.9rem' }}>{compareResult.structuralDistance.toFixed(3)}</span><span className="dcc-stat-label">Structural</span></div>
                          <div className="dcc-stat-card" style={{ flex: 1 }}><span className="dcc-stat-value" style={{ fontSize: '0.9rem' }}>{compareResult.semanticDistance.toFixed(3)}</span><span className="dcc-stat-label">Semantic</span></div>
                        </div>
                        {compareResult.insights.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <h4>Insights</h4>
                            {compareResult.insights.map((insight, i) => (
                              <p key={i} className="dcc-suggestion">{insight}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* === CLUSTERS === */}
                {activeSection === 'clusters' && (
                  <div className="dcc-panel">
                    <h3>File Clusters</h3>
                    <p className="dcc-description">Files grouped by similarity in 86D feature space using K-means clustering.</p>
                    {!clustersData ? <p className="dcc-empty">No clustering data available.</p> : (
                      <>
                        <div className="dcc-overview-grid">
                          <div className="dcc-stat-card"><span className="dcc-stat-value">{clustersData.totalClusters}</span><span className="dcc-stat-label">Clusters</span></div>
                          <div className="dcc-stat-card"><span className="dcc-stat-value">{clustersData.silhouetteScore.toFixed(2)}</span><span className="dcc-stat-label">Silhouette</span></div>
                          <div className="dcc-stat-card"><span className="dcc-stat-value">{clustersData.outliers.length}</span><span className="dcc-stat-label">Outliers</span></div>
                        </div>
                        {clustersData.clusters.map(cluster => (
                          <details key={cluster.id} style={{ marginTop: 8 }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}>
                              {cluster.name} ({cluster.size} files)
                            </summary>
                            {cluster.characteristics.length > 0 && (
                              <div className="dcc-smells-summary" style={{ marginTop: 4 }}>
                                {cluster.characteristics.map((c, i) => <span key={i} className="index-smell-badge index-smell-badge--low">{c}</span>)}
                              </div>
                            )}
                            <div style={{ marginTop: 4 }}>
                              {cluster.files.slice(0, 15).map((f, i) => (
                                <div key={i} className="dcc-review-item"><code>{shortenPath(f)}</code></div>
                              ))}
                              {cluster.files.length > 15 && <span className="dcc-muted">...and {cluster.files.length - 15} more</span>}
                            </div>
                          </details>
                        ))}
                        {clustersData.outliers.length > 0 && (
                          <details style={{ marginTop: 8 }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', color: 'var(--warning)' }}>
                              Outliers ({clustersData.outliers.length})
                            </summary>
                            {clustersData.outliers.map((f, i) => (
                              <div key={i} className="dcc-review-item"><code>{shortenPath(f)}</code></div>
                            ))}
                          </details>
                        )}
                        {clustersData.misclassified.length > 0 && (
                          <details style={{ marginTop: 8 }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', color: 'var(--warning)' }}>
                              Misclassified ({clustersData.misclassified.length})
                            </summary>
                            {clustersData.misclassified.map((m, i) => (
                              <div key={i} className="dcc-review-item">
                                <code>{shortenPath(m.file)}</code>
                                <span className="dcc-muted">cluster {m.currentCluster} → {m.suggestedCluster}</span>
                              </div>
                            ))}
                          </details>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* === DELTAS === */}
                {activeSection === 'deltas' && (
                  <div className="dcc-panel">
                    <h3>Recent Deltas ({deltasData.length})</h3>
                    <p className="dcc-description">Code movements in the 63D feature space. Each delta records what changed (lexical, structural, semantic) and by how much.</p>
                    {deltasData.length === 0 ? <p className="dcc-empty">No deltas recorded yet. Reindex after making changes.</p> : (
                      <div className="dcc-debt-list">
                        {deltasData.map((d, i) => (
                          <div key={i} className="dcc-tension-card" style={{ borderLeftColor: d.magnitude > 0.5 ? '#ff3d00' : d.magnitude > 0.2 ? '#ff9100' : '#ffc400' }}>
                            <div className="dcc-tension-row">
                              <code className="dcc-tension-file">{shortenPath(d.file)}</code>
                              <span className="dcc-muted">{d.timestamp}</span>
                            </div>
                            <div className="dcc-tension-meta-row">
                              <span style={{ fontWeight: 700, color: d.magnitude > 0.5 ? '#ff3d00' : d.magnitude > 0.2 ? '#ff9100' : '#ffc400' }}>
                                mag: {d.magnitude.toFixed(3)}
                              </span>
                              <span className="dcc-muted">lex: {d.lexicalDelta.toFixed(3)}</span>
                              <span className="dcc-muted">struct: {d.structuralDelta.toFixed(3)}</span>
                              <span className="dcc-muted">sem: {d.semanticDelta.toFixed(3)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* === VISUALIZATIONS === */}
                {(activeSection === 'architecture' || activeSection === 'matrix' || activeSection === 'heatmap' || activeSection === 'timeline' || activeSection === 'cube3d') && (
                  <div className="dcc-panel">
                    <VizPanel
                      type={activeSection}
                      html={activeSection === 'architecture' ? archHtml : activeSection === 'matrix' ? matrixHtml : activeSection === 'heatmap' ? heatmapHtml : activeSection === 'cube3d' ? cubeHtml : timelineHtml}
                      loading={vizLoading === activeSection}
                      expanded={expandedViz}
                      onGenerate={() => handleGenerateViz(activeSection)}
                      onToggleExpand={() => setExpandedViz(prev => !prev)}
                      disabled={!projectPath}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// =====================================================
// Sub-components
// =====================================================

function VizPanel({ type, html, loading, expanded, onGenerate, onToggleExpand, disabled }: {
  type: string; html: string | null; loading: boolean; expanded: boolean;
  onGenerate: () => void; onToggleExpand: () => void; disabled: boolean;
}) {
  const titles: Record<string, string> = { architecture: 'Architecture Diagram', matrix: 'Dependency Matrix', heatmap: 'Codebase Heatmap', timeline: 'Evolution Timeline', cube3d: '3D Code Cube' };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{titles[type] || type}</h3>
        <button className="dcc-btn" onClick={onGenerate} disabled={loading || disabled}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Generate
        </button>
        {html && (
          <button className="dcc-btn" onClick={onToggleExpand}>
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />} {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>
      {html ? (
        <iframe srcDoc={html} sandbox="allow-scripts" style={{ width: '100%', height: expanded ? '80vh' : '500px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: '#1a1a2e', transition: 'height 0.2s ease' }} title={titles[type]} />
      ) : (
        <p className="dcc-empty">{loading ? 'Generating...' : 'Click Generate to create the visualization.'}</p>
      )}
    </>
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

function formatSmellType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
