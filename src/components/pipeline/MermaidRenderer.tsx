import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidRendererProps {
  chart: string;
  onNodeClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
}

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#1a1a2e',
    primaryTextColor: '#e0e0e0',
    primaryBorderColor: '#00d4aa',
    lineColor: '#a855f7',
    secondaryColor: '#16213e',
    tertiaryColor: '#0f3460',
    background: '#0a0a0f',
    mainBkg: '#1a1a2e',
    nodeBorder: '#00d4aa',
    clusterBkg: '#16213e',
    clusterBorder: '#a855f7',
    titleColor: '#e0e0e0',
    edgeLabelBackground: '#1a1a2e',
  },
  flowchart: {
    htmlLabels: true,
    curve: 'basis',
    nodeSpacing: 50,
    rankSpacing: 50,
    padding: 15,
  },
  securityLevel: 'loose', // Allow click events
});

export function MermaidRenderer({ chart, onNodeClick, onEdgeClick }: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const renderChart = async () => {
      if (!containerRef.current || !chart) return;

      try {
        setError(null);
        setRendered(false);

        // Clear previous content
        containerRef.current.innerHTML = '';

        // Generate unique ID for this render
        const id = `mermaid-${Date.now()}`;

        // Render the chart
        const { svg } = await mermaid.render(id, chart);

        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          setRendered(true);

          // Add click handlers to nodes
          if (onNodeClick) {
            const nodes = containerRef.current.querySelectorAll('.node');
            nodes.forEach((node) => {
              const nodeId = node.id?.replace(/^flowchart-/, '').replace(/-\d+$/, '');
              if (nodeId) {
                (node as HTMLElement).style.cursor = 'pointer';
                node.addEventListener('click', () => onNodeClick(nodeId));
              }
            });
          }

          // Add click handlers to edges
          if (onEdgeClick) {
            const edges = containerRef.current.querySelectorAll('.edgePath');
            edges.forEach((edge, index) => {
              (edge as HTMLElement).style.cursor = 'pointer';
              edge.addEventListener('click', () => onEdgeClick(`edge-${index}`));
            });
          }
        }
      } catch (e) {
        console.error('[MermaidRenderer] Failed to render:', e);
        setError(e instanceof Error ? e.message : 'Failed to render diagram');
      }
    };

    renderChart();
  }, [chart, onNodeClick, onEdgeClick]);

  if (error) {
    return (
      <div className="mermaid-error">
        <span>Failed to render graph</span>
        <small>{error}</small>
      </div>
    );
  }

  return (
    <div className="mermaid-container">
      <div
        ref={containerRef}
        className={`mermaid-diagram ${rendered ? 'rendered' : 'loading'}`}
      />
      {!rendered && !error && (
        <div className="mermaid-loading">
          Rendering graph...
        </div>
      )}
    </div>
  );
}
