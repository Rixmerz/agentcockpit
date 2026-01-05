/**
 * Gemini Launcher
 *
 * Launch button with gradient border for gemini CLI.
 * Part of the gemini-cli plugin.
 */

import { useCallback } from 'react';
import { Rocket } from 'lucide-react';
import type { LauncherProps } from '../../../plugins/types/plugin';

// Gemini gradient colors: yellow, red, green, blue
const gradientStyle = {
  background: 'linear-gradient(90deg, #FABC12, #F94543, #08B962, #3186FF)',
  padding: '2px',
  borderRadius: '8px',
};

const innerButtonStyle = {
  background: 'var(--bg-secondary)',
  borderRadius: '6px',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '8px 16px',
  color: 'var(--text-primary)',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background 0.2s',
};

const disabledStyle = {
  opacity: 0.5,
  cursor: 'not-allowed',
};

export function GeminiLauncher({
  projectPath,
  hasActiveTerminal,
  onLaunch,
}: LauncherProps) {
  const handleLaunch = useCallback(() => {
    onLaunch('gemini');
  }, [onLaunch]);

  const canLaunch = hasActiveTerminal && projectPath;

  return (
    <div className="panel-section">
      <div
        style={{
          ...gradientStyle,
          ...(canLaunch ? {} : disabledStyle),
        }}
      >
        <button
          style={innerButtonStyle}
          onClick={handleLaunch}
          disabled={!canLaunch}
          title={!canLaunch ? 'Necesitas un proyecto con terminal activa' : 'Iniciar Gemini'}
          onMouseEnter={(e) => {
            if (canLaunch) {
              e.currentTarget.style.background = 'var(--bg-tertiary)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-secondary)';
          }}
        >
          <Rocket size={16} />
          Iniciar Gemini
        </button>
      </div>

      {!hasActiveTerminal && (
        <div className="text-center text-xs text-muted opacity-60" style={{ marginTop: '8px' }}>
          Crea una terminal primero
        </div>
      )}
    </div>
  );
}
