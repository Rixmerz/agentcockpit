/**
 * DeltaCodeCube Types — All exported interfaces
 */

export interface IndexStats {
  totalFiles: number;
  codebaseScore: number;
  grade: string;
  distribution: GradeDistribution;
}

export interface GradeDistribution {
  A: number;
  B: number;
  C: number;
  D: number;
  F: number;
}

export interface TensionInfo {
  id: string;
  fileA: string;
  fileB: string;
  distance: number;
  type: string;
  magnitude: number;
  percent: number;
  status: string;
  suggestedAction: string | null;
}

export interface DebtInfo {
  file: string;
  score: number;
  grade: string;
  issues: string[];
}

export interface ImpactResult {
  file: string;
  riskLevel: string;
  totalAffected: number;
  highImpactFiles: number;
  mediumImpactFiles: number;
  maxPropagationDepth: number;
  naturalBoundaries: string[];
  recommendation: string;
  reviewOrder: { priority: number; file: string; intensity: number; distance: number }[];
}

export interface WaveResult {
  sourceFile: string;
  initialIntensity: number;
  totalAffected: number;
  maxDepth: number;
  boundariesCount: number;
  boundaries: string[];
  reviewOrder: { priority: number; file: string; intensity: number; distance: number }[];
  affectedFiles: { filePath: string; fileName: string; waveIntensity: number; distanceFromSource: number; isBarrier: boolean }[];
}

export interface SmellInfo {
  type: string;
  severity: string;
  filePath: string;
  fileName: string;
  description: string;
  suggestion: string;
}

export interface SmellsResult {
  totalSmells: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  byType: Record<string, number>;
  smells: SmellInfo[];
}

export interface CloneInfo {
  fileA: string;
  fileB: string;
  similarity: number;
}

export interface ClonesResult {
  totalClones: number;
  byType: { exact: number; parameterized: number; nearMiss: number };
  clones: CloneInfo[];
}

export interface SuggestionInfo {
  action: string;
  priority: string;
  impact: string;
  effort: string;
  targetFiles: string[];
  description: string;
  rationale: string;
  steps: string[];
}

export interface SuggestionsResult {
  totalSuggestions: number;
  byAction: Record<string, number>;
  byPriority: Record<string, number>;
  suggestions: SuggestionInfo[];
}

export interface DriftInfo {
  type: string;
  severity: string;
  fileA: string;
  fileB: string;
  description: string;
  recommendation: string;
}

export interface DriftResult {
  totalDrifts: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  drifts: DriftInfo[];
}

export interface GraphMetric {
  file: string;
  value: number;
}

export interface GraphResult {
  totalFiles: number;
  totalEdges: number;
  topPageRank: GraphMetric[];
  topHub: GraphMetric[];
  topAuthority: GraphMetric[];
  topBetweenness: GraphMetric[];
}

export interface CentralityResult {
  file: string;
  pagerank: number;
  hubScore: number;
  authorityScore: number;
  betweenness: number;
  inDegree: number;
  outDegree: number;
  interpretation: string[];
}

export interface ContractInfo {
  caller: string;
  callee: string;
  baselineDistance: number;
  type: string;
}

export interface DeltaInfo {
  file: string;
  timestamp: string;
  magnitude: number;
  lexicalDelta: number;
  structuralDelta: number;
  semanticDelta: number;
}

export interface ClusterInfo {
  id: number;
  name: string;
  size: number;
  characteristics: string[];
  files: string[];
}

export interface ClusterResult {
  totalClusters: number;
  silhouetteScore: number;
  clusters: ClusterInfo[];
  outliers: string[];
  misclassified: { file: string; currentCluster: number; suggestedCluster: number }[];
}

export interface SurfaceModule {
  file: string;
  exports: string[];
  importCount: number;
  riskLevel: string;
}

export interface SurfaceResult {
  totalModules: number;
  totalExports: number;
  modules: SurfaceModule[];
}

export interface CompareResult {
  fileA: string;
  fileB: string;
  overallDistance: number;
  similarity: number;
  lexicalDistance: number;
  structuralDistance: number;
  semanticDistance: number;
  insights: string[];
}

export interface TemporalResult {
  path: string;
  features: {
    fileAge: number;
    changeFrequency: number;
    authorDiversity: number;
    daysSinceChange: number;
    stabilityScore: number;
  };
  interpretation: string[];
}

export interface FixSuggestionResult {
  changeType: string;
  severity: string;
  causes: string[];
  suggestedActions: string[];
  guidance: string[];
}
