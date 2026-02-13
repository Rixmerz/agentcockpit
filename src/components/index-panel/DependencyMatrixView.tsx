/**
 * DependencyMatrixView - Interactive dependency matrix
 *
 * Calls generateMatrix() and renders HTML in a sandboxed iframe.
 */

import { useState, useCallback } from 'react';
import { Loader2, RefreshCw, Maximize2, Minimize2 } from 'lucide-react';
import { generateMatrix } from '../../services/deltacodecubeService';

interface DependencyMatrixViewProps {
  projectPath: string | null;
}

export function DependencyMatrixView({ projectPath }: DependencyMatrixViewProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const result = await generateMatrix(projectPath);
      setHtml(result);
    } catch (err) {
      console.error('[DependencyMatrixView] Generate error:', err);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="index-section-header" style={{ borderBottom: 'none', marginBottom: 0 }}>
          Dependency Matrix
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className="btn-icon-sm"
            onClick={handleGenerate}
            disabled={loading || !projectPath}
            title="Generate / Regenerate"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          {html && (
            <button
              className="btn-icon-sm"
              onClick={() => setExpanded(prev => !prev)}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}
        </div>
      </div>

      {html ? (
        <iframe
          srcDoc={html}
          sandbox="allow-scripts"
          style={{
            width: '100%',
            height: expanded ? '600px' : '300px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: '#1a1a2e',
            transition: 'height 0.2s ease',
          }}
          title="Dependency Matrix"
        />
      ) : (
        <div className="index-empty" style={{ padding: '1rem' }}>
          <span style={{ fontSize: '0.75rem' }}>
            {loading ? 'Generating...' : 'Click refresh to generate dependency matrix'}
          </span>
        </div>
      )}
    </div>
  );
}
