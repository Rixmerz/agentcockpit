/**
 * DCC Analysis Service — All read-only query functions
 */

import type {
  IndexStats, TensionInfo, DebtInfo, ImpactResult, WaveResult,
  SmellsResult, ClonesResult, SuggestionsResult, DriftResult,
  GraphResult, GraphMetric, CentralityResult, ContractInfo,
  DeltaInfo, ClusterResult, SurfaceResult, CompareResult,
  TemporalResult, FixSuggestionResult,
} from './dccTypes';
import {
  dccState, callDccTool, pathMatchesProject, filterFilesByProject,
  parseDebtResultForProject,
} from './_dccInternal';

export async function getIndexStats(projectPath: string): Promise<IndexStats | null> {
  if (dccState.indexingInProgress || !projectPath) return null;
  try {
    const result = await callDccTool('cube_get_debt', {}, projectPath);
    return parseDebtResultForProject(result, projectPath);
  } catch (e) {
    console.error('[DCC] Stats error:', e);
    return null;
  }
}

export async function getTensions(projectPath: string): Promise<TensionInfo[]> {
  if (dccState.indexingInProgress || !projectPath) return [];
  try {
    const result = await callDccTool('cube_get_tensions', { limit: 50 }, projectPath);

    const tensions = Array.isArray(result) ? result
      : (result && typeof result === 'object' && 'tensions' in (result as Record<string, unknown>))
        ? (result as Record<string, unknown>).tensions as unknown[]
        : [];

    if (!Array.isArray(tensions)) return [];

    const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';

    return tensions
      .map((t: unknown) => {
        const item = t as Record<string, unknown>;
        return {
          id: String(item.id || ''),
          fileA: String(item.caller_path || item.file_a || item.fileA || ''),
          fileB: String(item.callee_path || item.file_b || item.fileB || ''),
          distance: Number(item.current_distance || item.distance || 0),
          type: String(item.type || 'unknown'),
          magnitude: Number(item.tension_magnitude || 0),
          percent: Number(item.tension_percent || 0),
          status: String(item.status || 'detected'),
          suggestedAction: item.suggested_action ? String(item.suggested_action) : null,
        };
      })
      .filter(t => pathMatchesProject(t.fileA, prefix) || pathMatchesProject(t.fileB, prefix));
  } catch (e) {
    console.error('[DCC] Tensions error:', e);
    return [];
  }
}

export async function getDebt(projectPath: string): Promise<DebtInfo[]> {
  if (dccState.indexingInProgress || !projectPath) return [];
  try {
    const result = await callDccTool('cube_get_debt', {}, projectPath);

    if (result && typeof result === 'object') {
      const data = result as Record<string, unknown>;
      const allFiles = Array.isArray(data.all_files) ? data.all_files
        : Array.isArray(data.top_debt_files) ? data.top_debt_files
        : Array.isArray(result) ? result : [];

      const filtered = filterFilesByProject(allFiles as Record<string, unknown>[], projectPath);

      return filtered.map((d) => ({
        file: String(d.file_path || d.file_name || d.file || ''),
        score: Number(d.score || 0),
        grade: String(d.grade || 'F'),
        issues: Array.isArray(d.recommendations) ? d.recommendations.map(String) :
                Array.isArray(d.issues) ? d.issues.map(String) : [],
      }));
    }

    return [];
  } catch (e) {
    console.error('[DCC] Debt error:', e);
    return [];
  }
}

export async function resolveTension(projectPath: string, tensionId: string, status: 'reviewed' | 'resolved' | 'ignored'): Promise<{ success: boolean; message: string }> {
  try {
    const result = await callDccTool('cube_resolve_tension', { tension_id: tensionId, status }, projectPath);
    const data = result as Record<string, unknown>;
    return { success: !!data.success, message: String(data.message || '') };
  } catch (e) {
    console.error('[DCC] Resolve tension error:', e);
    return { success: false, message: String(e) };
  }
}

export async function analyzeImpact(projectPath: string, filePath: string): Promise<ImpactResult | null> {
  try {
    const result = await callDccTool('cube_analyze_impact', { path: filePath }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const d = result as Record<string, unknown>;
    return {
      file: String(d.file || filePath),
      riskLevel: String(d.risk_level || 'unknown'),
      totalAffected: Number(d.total_affected || 0),
      highImpactFiles: Number(d.high_impact_files || 0),
      mediumImpactFiles: Number(d.medium_impact_files || 0),
      maxPropagationDepth: Number(d.max_propagation_depth || 0),
      naturalBoundaries: Array.isArray(d.natural_boundaries) ? d.natural_boundaries.map(String) : [],
      recommendation: String(d.recommendation || ''),
      reviewOrder: Array.isArray(d.review_order) ? (d.review_order as Record<string, unknown>[]).map(r => ({
        priority: Number(r.priority || 0),
        file: String(r.file || ''),
        intensity: Number(r.intensity || 0),
        distance: Number(r.distance || 0),
      })) : [],
    };
  } catch (e) {
    console.error('[DCC] Impact analysis error:', e);
    return null;
  }
}

export async function simulateWave(projectPath: string, sourcePath: string, intensity = 1.0): Promise<WaveResult | null> {
  try {
    const result = await callDccTool('cube_simulate_wave', { source_path: sourcePath, intensity }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const d = result as Record<string, unknown>;
    return {
      sourceFile: String(d.source_file || sourcePath),
      initialIntensity: Number(d.initial_intensity || intensity),
      totalAffected: Number(d.total_affected || 0),
      maxDepth: Number(d.max_depth || 0),
      boundariesCount: Number(d.boundaries_count || 0),
      boundaries: Array.isArray(d.boundaries) ? d.boundaries.map(String) : [],
      reviewOrder: Array.isArray(d.review_order) ? (d.review_order as Record<string, unknown>[]).map(r => ({
        priority: Number(r.priority || 0),
        file: String(r.file || ''),
        intensity: Number(r.intensity || 0),
        distance: Number(r.distance || 0),
      })) : [],
      affectedFiles: Array.isArray(d.affected_files) ? (d.affected_files as Record<string, unknown>[]).map(f => ({
        filePath: String(f.file_path || ''),
        fileName: String(f.file_name || ''),
        waveIntensity: Number(f.wave_intensity || 0),
        distanceFromSource: Number(f.distance_from_source || 0),
        isBarrier: !!f.is_boundary,
      })) : [],
    };
  } catch (e) {
    console.error('[DCC] Wave simulation error:', e);
    return null;
  }
}

export async function predictImpact(projectPath: string, filePath: string): Promise<ImpactResult | null> {
  try {
    const result = await callDccTool('cube_predict_impact', { path: filePath }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const d = result as Record<string, unknown>;
    return {
      file: String(d.file || filePath),
      riskLevel: String(d.risk_level || 'unknown'),
      totalAffected: Number(d.total_affected || 0),
      highImpactFiles: Number(d.high_impact_files || 0),
      mediumImpactFiles: Number(d.medium_impact_files || 0),
      maxPropagationDepth: Number(d.max_propagation_depth || 0),
      naturalBoundaries: Array.isArray(d.natural_boundaries) ? d.natural_boundaries.map(String) : [],
      recommendation: String(d.recommendation || ''),
      reviewOrder: Array.isArray(d.review_order) ? (d.review_order as Record<string, unknown>[]).map(r => ({
        priority: Number(r.priority || 0),
        file: String(r.file || ''),
        intensity: Number(r.intensity || 0),
        distance: Number(r.distance || 0),
      })) : [],
    };
  } catch (e) {
    console.error('[DCC] Predict impact error:', e);
    return null;
  }
}

export async function detectSmells(projectPath: string): Promise<SmellsResult | null> {
  try {
    const result = await callDccTool('cube_detect_smells', {}, projectPath);
    if (!result || typeof result !== 'object') return null;
    const d = result as Record<string, unknown>;
    const byType = d.by_type as Record<string, number> | undefined;
    const smells = Array.isArray(d.smells) ? (d.smells as Record<string, unknown>[]).map(s => ({
      type: String(s.type || ''),
      severity: String(s.severity || ''),
      filePath: String(s.file_path || ''),
      fileName: String(s.file_name || ''),
      description: String(s.description || ''),
      suggestion: String(s.suggestion || ''),
    })) : [];

    const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
    const projectSmells = smells.filter(s => pathMatchesProject(s.filePath, prefix));

    const filteredBySev = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const s of projectSmells) {
      if (s.severity in filteredBySev) {
        filteredBySev[s.severity as keyof typeof filteredBySev]++;
      }
    }

    return {
      totalSmells: projectSmells.length,
      bySeverity: filteredBySev,
      byType: byType || {},
      smells: projectSmells,
    };
  } catch (e) {
    console.error('[DCC] Detect smells error:', e);
    return null;
  }
}

export async function detectClones(projectPath: string): Promise<ClonesResult | null> {
  try {
    const result = await callDccTool('cube_detect_clones', {}, projectPath);
    if (!result || typeof result !== 'object') return null;
    const d = result as Record<string, unknown>;
    const byType = d.by_type as Record<string, number> | undefined;
    const clones = Array.isArray(d.clones) ? (d.clones as Record<string, unknown>[]).map(c => ({
      fileA: String(c.file_a || ''),
      fileB: String(c.file_b || ''),
      similarity: Number(c.similarity || 0),
    })) : [];

    const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
    const projectClones = clones.filter(c => pathMatchesProject(c.fileA, prefix) || pathMatchesProject(c.fileB, prefix));

    return {
      totalClones: projectClones.length,
      byType: {
        exact: byType?.exact || 0,
        parameterized: byType?.parameterized || 0,
        nearMiss: byType?.['near-miss'] || 0,
      },
      clones: projectClones,
    };
  } catch (e) {
    console.error('[DCC] Detect clones error:', e);
    return null;
  }
}

export async function getSuggestions(projectPath: string): Promise<SuggestionsResult | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_get_suggestions', {}, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : []) as Record<string, unknown>[];
    const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
    const projectSuggestions = suggestions.filter(s => {
      const targets = (Array.isArray(s.target_files) ? s.target_files : []) as string[];
      return targets.some(f => pathMatchesProject(f, prefix));
    });
    return {
      totalSuggestions: projectSuggestions.length,
      byAction: (data.by_action || {}) as Record<string, number>,
      byPriority: (data.by_priority || {}) as Record<string, number>,
      suggestions: projectSuggestions.map(s => ({
        action: String(s.action || ''),
        priority: String(s.priority || ''),
        impact: String(s.impact || ''),
        effort: String(s.effort || ''),
        targetFiles: (Array.isArray(s.target_files) ? s.target_files : []) as string[],
        description: String(s.description || ''),
        rationale: String(s.rationale || ''),
        steps: (Array.isArray(s.steps) ? s.steps : []) as string[],
      })),
    };
  } catch (e) {
    console.error('[DCC] Suggestions error:', e);
    return null;
  }
}

export async function detectDrift(projectPath: string): Promise<DriftResult | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_detect_drift', {}, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    const drifts = (Array.isArray(data.drifts) ? data.drifts : []) as Record<string, unknown>[];
    const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
    const projectDrifts = drifts.filter(d => {
      const fA = String(d.file_a || d.fileA || '');
      const fB = String(d.file_b || d.fileB || '');
      return pathMatchesProject(fA, prefix) || pathMatchesProject(fB, prefix);
    });
    return {
      totalDrifts: projectDrifts.length,
      bySeverity: (data.by_severity || {}) as Record<string, number>,
      byType: (data.by_type || {}) as Record<string, number>,
      drifts: projectDrifts.map(d => ({
        type: String(d.type || ''),
        severity: String(d.severity || 'medium'),
        fileA: String(d.file_a || d.fileA || ''),
        fileB: String(d.file_b || d.fileB || ''),
        description: String(d.description || ''),
        recommendation: String(d.recommendation || ''),
      })),
    };
  } catch (e) {
    console.error('[DCC] Drift error:', e);
    return null;
  }
}

export async function analyzeGraph(projectPath: string, topN = 10): Promise<GraphResult | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_analyze_graph', { top_n: topN }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    const mapMetrics = (arr: unknown): GraphMetric[] => {
      if (!Array.isArray(arr)) return [];
      return arr.map(item => {
        const m = item as Record<string, unknown>;
        return { file: String(m.file || m.path || ''), value: Number(m.value || m.score || 0) };
      });
    };
    return {
      totalFiles: Number(data.total_files || data.total_nodes || 0),
      totalEdges: Number(data.total_edges || data.total_contracts || 0),
      topPageRank: mapMetrics(data.top_pagerank),
      topHub: mapMetrics(data.top_hub),
      topAuthority: mapMetrics(data.top_authority),
      topBetweenness: mapMetrics(data.top_betweenness),
    };
  } catch (e) {
    console.error('[DCC] Graph analysis error:', e);
    return null;
  }
}

export async function getCentrality(projectPath: string, filePath: string): Promise<CentralityResult | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_get_centrality', { path: filePath }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    if (data.error) return null;
    return {
      file: String(data.file || data.path || filePath),
      pagerank: Number(data.pagerank || 0),
      hubScore: Number(data.hub_score || 0),
      authorityScore: Number(data.authority_score || 0),
      betweenness: Number(data.betweenness || 0),
      inDegree: Number(data.in_degree || 0),
      outDegree: Number(data.out_degree || 0),
      interpretation: (Array.isArray(data.interpretation) ? data.interpretation : []) as string[],
    };
  } catch (e) {
    console.error('[DCC] Centrality error:', e);
    return null;
  }
}

export async function getContracts(projectPath: string, filePath?: string, direction = 'both'): Promise<ContractInfo[]> {
  if (dccState.indexingInProgress) return [];
  try {
    const args: Record<string, unknown> = { direction, limit: 200 };
    if (filePath) args.path = filePath;
    const result = await callDccTool('cube_get_contracts', args, projectPath);
    if (!result || typeof result !== 'object') return [];
    const data = result as Record<string, unknown>;
    const contracts = (Array.isArray(data.contracts) ? data.contracts : []) as Record<string, unknown>[];
    return contracts.map(c => ({
      caller: String(c.caller || c.caller_path || ''),
      callee: String(c.callee || c.callee_path || ''),
      baselineDistance: Number(c.baseline_distance || 0),
      type: String(c.type || c.contract_type || 'import'),
    }));
  } catch (e) {
    console.error('[DCC] Contracts error:', e);
    return [];
  }
}

export async function getDeltas(projectPath: string, limit = 20): Promise<DeltaInfo[]> {
  if (dccState.indexingInProgress) return [];
  try {
    const result = await callDccTool('cube_get_deltas', { limit }, projectPath);
    if (!result || typeof result !== 'object') return [];
    const data = result as Record<string, unknown>;
    const deltas = (Array.isArray(data.deltas) ? data.deltas : []) as Record<string, unknown>[];
    return deltas.map(d => ({
      file: String(d.file || d.file_path || ''),
      timestamp: String(d.timestamp || d.created_at || ''),
      magnitude: Number(d.magnitude || d.total_magnitude || 0),
      lexicalDelta: Number(d.lexical_delta || d.lexical || 0),
      structuralDelta: Number(d.structural_delta || d.structural || 0),
      semanticDelta: Number(d.semantic_delta || d.semantic || 0),
    }));
  } catch (e) {
    console.error('[DCC] Deltas error:', e);
    return [];
  }
}

export async function clusterFiles(projectPath: string, k?: number): Promise<ClusterResult | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const args: Record<string, unknown> = {};
    if (k !== undefined) args.k = k;
    const result = await callDccTool('cube_cluster_files', args, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    const clusters = (Array.isArray(data.clusters) ? data.clusters : []) as Record<string, unknown>[];
    return {
      totalClusters: Number(data.total_clusters || clusters.length),
      silhouetteScore: Number(data.silhouette_score || 0),
      clusters: clusters.map(c => ({
        id: Number(c.id || c.cluster_id || 0),
        name: String(c.name || c.label || `Cluster ${c.id || 0}`),
        size: Number(c.size || 0),
        characteristics: (Array.isArray(c.characteristics) ? c.characteristics : []) as string[],
        files: (Array.isArray(c.files) ? c.files : []).map((f: unknown) =>
          typeof f === 'string' ? f : String((f as Record<string, unknown>).path || (f as Record<string, unknown>).name || f)
        ),
      })),
      outliers: (Array.isArray(data.outliers) ? data.outliers : []).map((o: unknown) =>
        typeof o === 'string' ? o : String((o as Record<string, unknown>).path || (o as Record<string, unknown>).name || o)
      ),
      misclassified: (Array.isArray(data.misclassified) ? data.misclassified : []).map((m: unknown) => {
        const mc = m as Record<string, unknown>;
        return {
          file: String(mc.path || mc.name || mc.file || ''),
          currentCluster: Number(mc.current_cluster || 0),
          suggestedCluster: Number(mc.suggested_cluster || 0),
        };
      }),
    };
  } catch (e) {
    console.error('[DCC] Clustering error:', e);
    return null;
  }
}

export async function analyzeSurface(projectPath: string): Promise<SurfaceResult | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_analyze_surface', {}, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    const modules = (Array.isArray(data.modules) ? data.modules : []) as Record<string, unknown>[];
    const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
    const projectModules = modules.filter(m => pathMatchesProject(String(m.file || m.path || ''), prefix));
    return {
      totalModules: projectModules.length,
      totalExports: Number(data.total_exports || 0),
      modules: projectModules.map(m => ({
        file: String(m.file || m.path || ''),
        exports: (Array.isArray(m.exports) ? m.exports : []) as string[],
        importCount: Number(m.import_count || m.dependents || 0),
        riskLevel: String(m.risk_level || m.risk || 'low'),
      })),
    };
  } catch (e) {
    console.error('[DCC] Surface error:', e);
    return null;
  }
}

export async function compareFiles(projectPath: string, fileA: string, fileB: string): Promise<CompareResult | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_compare', { path_a: fileA, path_b: fileB }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    return {
      fileA: String(data.file_a || data.path_a || fileA),
      fileB: String(data.file_b || data.path_b || fileB),
      overallDistance: Number(data.overall_distance || data.distance || 0),
      similarity: Number(data.similarity || 0),
      lexicalDistance: Number(data.lexical_distance || data.lexical || 0),
      structuralDistance: Number(data.structural_distance || data.structural || 0),
      semanticDistance: Number(data.semantic_distance || data.semantic || 0),
      insights: (Array.isArray(data.insights) ? data.insights : []) as string[],
    };
  } catch (e) {
    console.error('[DCC] Compare error:', e);
    return null;
  }
}

export async function getTemporalFeatures(projectPath: string, filePath: string): Promise<TemporalResult | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_get_temporal', { path: filePath }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    const features = (data.features || {}) as Record<string, unknown>;
    return {
      path: String(data.path || filePath),
      features: {
        fileAge: Number(features.file_age || 0),
        changeFrequency: Number(features.change_frequency || 0),
        authorDiversity: Number(features.author_diversity || 0),
        daysSinceChange: Number(features.days_since_change || 0),
        stabilityScore: Number(features.stability_score || 0),
      },
      interpretation: (Array.isArray(data.interpretation) ? data.interpretation : []) as string[],
    };
  } catch (e) {
    console.error('[DCC] Temporal error:', e);
    return null;
  }
}

export async function suggestFix(projectPath: string, tensionId?: string, filePath?: string): Promise<FixSuggestionResult | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const args: Record<string, unknown> = {};
    if (tensionId) args.tension_id = tensionId;
    if (filePath) args.file_path = filePath;
    const result = await callDccTool('cube_suggest_fix', args, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    return {
      changeType: String(data.change_type || ''),
      severity: String(data.severity || ''),
      causes: (Array.isArray(data.causes) ? data.causes : []) as string[],
      suggestedActions: (Array.isArray(data.suggested_actions) ? data.suggested_actions : []) as string[],
      guidance: (Array.isArray(data.guidance) ? data.guidance : Array.isArray(data.steps) ? data.steps : []) as string[],
    };
  } catch (e) {
    console.error('[DCC] Suggest fix error:', e);
    return null;
  }
}
