/**
 * AudioVisualizer - BF3 Style Equalizer Bars
 * CSS animation with smooth JS-controlled wind-down
 */

import { useMemo, useRef, useEffect, useState } from 'react';
import { useIsMediaPlaying } from '../../contexts/MediaContext';

interface AudioVisualizerProps {
  barCount?: number;
  active?: boolean;
  color?: string;
}

export function AudioVisualizer({
  barCount = 24,
  active: activeOverride,
  color = 'var(--color-accent-primary, #00d4aa)'
}: AudioVisualizerProps) {
  const isMediaPlaying = useIsMediaPlaying();
  const active = activeOverride !== undefined ? activeOverride : isMediaPlaying;
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lastPositions = useRef<number[]>(Array(barCount).fill(0.08));
  const [isWindingDown, setIsWindingDown] = useState(false);
  const wasActive = useRef(active);

  // Pre-calculate bar max heights (asymmetric curve)
  const barHeights = useMemo(() => {
    return Array.from({ length: barCount }, (_, i) => {
      const t = i / (barCount - 1);
      let height: number;
      if (t < 0.15) {
        const localT = t / 0.15;
        height = 0.35 - (1 - Math.pow(1 - localT, 3)) * 0.30;
      } else if (t < 0.88) {
        const localT = (t - 0.15) / 0.73;
        const eased = localT < 0.5 ? 4 * localT * localT * localT : 1 - Math.pow(-2 * localT + 2, 3) / 2;
        height = 0.05 + eased * 0.95;
      } else {
        const localT = (t - 0.88) / 0.12;
        height = 1.0 - localT * localT * 0.35;
      }
      return Math.max(0.05, height);
    });
  }, [barCount]);

  // Periodically sample bar positions while active
  useEffect(() => {
    if (!active) return;

    const samplePositions = () => {
      barRefs.current.forEach((el, i) => {
        if (!el) return;
        const computed = window.getComputedStyle(el);
        const matrix = computed.transform;
        if (matrix && matrix !== 'none') {
          const values = matrix.match(/matrix\(([^)]+)\)/);
          if (values) {
            const parts = values[1].split(',').map(Number);
            lastPositions.current[i] = parts[3] || 0.08;
          }
        }
      });
    };

    const interval = setInterval(samplePositions, 100);
    return () => clearInterval(interval);
  }, [active]);

  // Handle transition from active to idle
  useEffect(() => {
    if (wasActive.current && !active) {
      // Start wind-down animation
      setIsWindingDown(true);

      barRefs.current.forEach((el, i) => {
        if (!el) return;
        const startPos = lastPositions.current[i] || 0.5;
        el.style.transform = `scaleY(${startPos})`;
        el.style.transition = 'none';
      });

      // Force reflow then animate
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          barRefs.current.forEach((el, i) => {
            if (!el) return;
            el.style.transition = `transform 1.2s cubic-bezier(0.4, 0, 0.2, 1) ${i * 25}ms`;
            el.style.transform = 'scaleY(0.08)';
          });

          // Clear wind-down state after animation completes
          setTimeout(() => {
            setIsWindingDown(false);
            barRefs.current.forEach((el) => {
              if (!el) return;
              el.style.transform = '';
              el.style.transition = '';
            });
          }, 1200 + barCount * 25);
        });
      });
    } else if (!wasActive.current && active) {
      // Starting playback - clear any inline styles
      setIsWindingDown(false);
      barRefs.current.forEach((el) => {
        if (!el) return;
        el.style.transform = '';
        el.style.transition = '';
      });
    }

    wasActive.current = active;
  }, [active, barCount]);

  // Determine CSS class
  const getClassName = () => {
    if (active) return 'audio-visualizer audio-visualizer--active';
    if (isWindingDown) return 'audio-visualizer audio-visualizer--winding-down';
    return 'audio-visualizer audio-visualizer--idle';
  };

  return (
    <div
      className={getClassName()}
      style={{ '--av-color': color } as React.CSSProperties}
    >
      <div className="audio-visualizer__container">
        <svg
          className="audio-visualizer__curve"
          viewBox="0 0 100 20"
          preserveAspectRatio="none"
        >
          <path
            d="M0,12 Q10,18 20,18 Q50,18 75,2 Q90,0 100,6"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            opacity="0.25"
          />
        </svg>

        <div className="audio-visualizer__bars">
          {barHeights.map((maxHeight, i) => (
            <div
              key={i}
              ref={(el) => { barRefs.current[i] = el; }}
              className="audio-visualizer__bar"
              style={{
                '--bar-max': maxHeight,
                '--bar-delay': `${i * 0.05}s`,
              } as React.CSSProperties}
            />
          ))}
        </div>

        {active && <div className="audio-visualizer__glow" />}
      </div>
    </div>
  );
}
