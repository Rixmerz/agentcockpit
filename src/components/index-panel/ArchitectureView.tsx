/**
 * ArchitectureView - Interactive architecture diagram
 *
 * Calls generateArchitecture() and renders HTML in a sandboxed iframe.
 */

import { useState, useCallback, useEffect } from 'react';
import { Loader2, RefreshCw, Maximize2, Minimize2 } from 'lucide-react';
import { generateArchitecture } from '../../services/deltacodecubeService';

interface ArchitectureViewProps {
  projectPath: string | null;
}

export function ArchitectureView({ projectPath }: ArchitectureViewProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Clear stale data on project switch
  useEffect(() => {
    setHtml(null);
    setExpanded(false);
  }, [projectPath]);

  const handleGenerate = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const result = await generateArchitecture(projectPath);
      setHtml(result);
    } catch (err) {
      console.error('[ArchitectureView] Generate error:', err);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="index-section-header" style={{ borderBottom: 'none', marginBottom: 0 }}>
          Architecture
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
          title="Architecture Diagram"
        />
      ) : (
        <div className="index-empty" style={{ padding: '1rem' }}>
          <span style={{ fontSize: '0.75rem' }}>
            {loading ? 'Generating...' : 'Click refresh to generate architecture diagram'}
          </span>
        </div>
      )}
    </div>
  );
}
