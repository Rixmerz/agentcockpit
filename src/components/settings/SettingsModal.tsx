import { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { useAppSettings } from '../../contexts/AppContext';
import { playNotificationSound } from '../../services/soundService';
import type { ThemeId } from '../../types';

const THEME_OPTIONS: { id: ThemeId; name: string; description: string; color: string }[] = [
  { id: 'cyber-teal', name: 'Cyber Teal', description: 'Teal/cyan futuristic theme', color: '#00d4aa' },
  { id: 'battlefield', name: 'Battlefield', description: 'Orange military-tech theme', color: '#ff6b00' },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableIDEs: string[];
}

const SOUND_OPTIONS = [
  { id: 'default', name: 'Default Beep', description: 'Synthesized two-tone', path: null },
  { id: 'chime', name: 'Chime', description: 'Crystal bell tone', path: '/sounds/chime.mp3' },
  { id: 'pop', name: 'Pop', description: 'Short discrete pop', path: '/sounds/pop.mp3' },
  { id: 'ding', name: 'Ding', description: 'Soft metallic ding', path: '/sounds/ding.mp3' },
  { id: 'tada', name: 'Tada', description: 'Celebratory fanfare', path: '/sounds/tada.mp3' },
  { id: 'coin', name: 'Coin', description: 'Retro game coin', path: '/sounds/coin.mp3' },
];

export function SettingsModal({ isOpen, onClose, availableIDEs }: SettingsModalProps) {
  const {
    defaultIDE,
    theme,
    backgroundImage,
    backgroundOpacity,
    terminalOpacity,
    idleTimeout,
    terminalFinishedSound,
    terminalFinishedThreshold,
    customSoundPath,
    setDefaultIDE,
    setTheme,
    setBackgroundImage,
    setBackgroundOpacity,
    setTerminalOpacity,
    setIdleTimeout,
    setTerminalFinishedSound,
    setTerminalFinishedThreshold,
    setCustomSoundPath,
  } = useAppSettings();

  const [localTheme, setLocalTheme] = useState<ThemeId>(theme);
  const [localImage, setLocalImage] = useState(backgroundImage || '');
  const [localOpacity, setLocalOpacity] = useState(backgroundOpacity);
  const [localTerminalOpacity, setLocalTerminalOpacity] = useState(terminalOpacity);
  const [localIdleTimeout, setLocalIdleTimeout] = useState(idleTimeout);
  const [localFinishedSound, setLocalFinishedSound] = useState(terminalFinishedSound);
  const [localFinishedThreshold, setLocalFinishedThreshold] = useState(terminalFinishedThreshold);
  const [localCustomSoundPath, setLocalCustomSoundPath] = useState<string | null>(customSoundPath || null);

  // Sync local state when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalTheme(theme);
      setLocalImage(backgroundImage || '');
      setLocalOpacity(backgroundOpacity);
      setLocalTerminalOpacity(terminalOpacity);
      setLocalIdleTimeout(idleTimeout);
      setLocalFinishedSound(terminalFinishedSound);
      setLocalFinishedThreshold(terminalFinishedThreshold);
      setLocalCustomSoundPath(customSoundPath || null);
    }
  }, [isOpen, theme, backgroundImage, backgroundOpacity, terminalOpacity, idleTimeout, terminalFinishedSound, terminalFinishedThreshold, customSoundPath]);

  const handleSave = () => {
    setTheme(localTheme);
    setBackgroundImage(localImage || undefined);
    setBackgroundOpacity(localOpacity);
    setTerminalOpacity(localTerminalOpacity);
    setIdleTimeout(localIdleTimeout);
    setTerminalFinishedSound(localFinishedSound);
    setTerminalFinishedThreshold(localFinishedThreshold);
    setCustomSoundPath(localCustomSoundPath);
    onClose();
  };

  const handleCancel = () => {
    setLocalTheme(theme);
    setLocalImage(backgroundImage || '');
    setLocalOpacity(backgroundOpacity);
    setLocalTerminalOpacity(terminalOpacity);
    setLocalIdleTimeout(idleTimeout);
    setLocalFinishedSound(terminalFinishedSound);
    setLocalFinishedThreshold(terminalFinishedThreshold);
    setLocalCustomSoundPath(customSoundPath || null);
    onClose();
  };

  const handlePreviewSound = async (soundPath: string | null) => {
    try {
      await playNotificationSound(soundPath);
    } catch (error) {
      console.error('[SettingsModal] Failed to preview sound:', error);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title="Settings">
      <div className="settings-section">
        <h3 className="settings-section-title">Default IDE</h3>
        <p className="settings-section-desc">
          Select the editor that will open when clicking the open project icon
        </p>

        <div className="settings-radio-group">
          <label className="settings-radio-item">
            <input
              type="radio"
              name="ide"
              checked={!defaultIDE}
              onChange={() => setDefaultIDE(undefined)}
            />
            <span>Auto-detect (first available)</span>
          </label>

          {availableIDEs.includes('cursor') && (
            <label className="settings-radio-item">
              <input
                type="radio"
                name="ide"
                checked={defaultIDE === 'cursor'}
                onChange={() => setDefaultIDE('cursor')}
              />
              <span>Cursor</span>
            </label>
          )}

          {availableIDEs.includes('code') && (
            <label className="settings-radio-item">
              <input
                type="radio"
                name="ide"
                checked={defaultIDE === 'code'}
                onChange={() => setDefaultIDE('code')}
              />
              <span>VS Code</span>
            </label>
          )}

          {availableIDEs.includes('antigravity') && (
            <label className="settings-radio-item">
              <input
                type="radio"
                name="ide"
                checked={defaultIDE === 'antigravity'}
                onChange={() => setDefaultIDE('antigravity')}
              />
              <span>Antigravity</span>
            </label>
          )}
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Color Theme</h3>
        <p className="settings-section-desc">
          Choose the accent color theme for the interface
        </p>

        <div className="settings-theme-group">
          {THEME_OPTIONS.map(themeOption => (
            <label
              key={themeOption.id}
              className={`settings-theme-item ${localTheme === themeOption.id ? 'active' : ''}`}
              style={{ '--theme-preview-color': themeOption.color } as React.CSSProperties}
            >
              <input
                type="radio"
                name="theme"
                checked={localTheme === themeOption.id}
                onChange={() => setLocalTheme(themeOption.id)}
              />
              <span className="settings-theme-preview" />
              <div className="settings-theme-info">
                <span className="settings-theme-name">{themeOption.name}</span>
                <span className="settings-theme-desc">{themeOption.description}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Background Image</h3>
        <p className="settings-section-desc">
          Add a background image (URL or local path)
        </p>

        <input
          type="text"
          className="settings-input"
          placeholder="https://example.com/image.jpg or /path/to/image.png"
          value={localImage}
          onChange={(e) => setLocalImage(e.target.value)}
        />

        {localImage && (
          <div className="settings-preview">
            <img
              src={localImage}
              alt="Preview"
              className="settings-preview-img"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Background Opacity</h3>
        <p className="settings-section-desc">
          Control the background image transparency
        </p>

        <div className="settings-slider-container">
          <input
            type="range"
            min="0"
            max="100"
            value={localOpacity}
            onChange={(e) => setLocalOpacity(Number(e.target.value))}
            className="settings-slider"
          />
          <span className="settings-slider-value">{localOpacity}%</span>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Terminal Opacity</h3>
        <p className="settings-section-desc">
          Control how dark the terminal background appears (0% = transparent, 100% = dark)
        </p>

        <div className="settings-slider-container">
          <input
            type="range"
            min="0"
            max="100"
            value={localTerminalOpacity}
            onChange={(e) => setLocalTerminalOpacity(Number(e.target.value))}
            className="settings-slider"
          />
          <span className="settings-slider-value">{localTerminalOpacity}%</span>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Idle Mode</h3>
        <p className="settings-section-desc">
          Inactivity time before hiding the interface to show background (0 = disabled)
        </p>

        <div className="settings-slider-container">
          <input
            type="range"
            min="0"
            max="30"
            value={localIdleTimeout}
            onChange={(e) => setLocalIdleTimeout(Number(e.target.value))}
            className="settings-slider"
          />
          <span className="settings-slider-value">
            {localIdleTimeout === 0 ? 'Disabled' : `${localIdleTimeout}s`}
          </span>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Terminal Notifications</h3>
        <p className="settings-section-desc">
          Alert when terminal output stops (command finishes)
        </p>

        <label className="settings-checkbox-item">
          <input
            type="checkbox"
            checked={localFinishedSound}
            onChange={(e) => setLocalFinishedSound(e.target.checked)}
          />
          <span>Play sound when terminal finishes</span>
        </label>

        <div className="settings-slider-container" style={{ marginTop: '12px' }}>
          <label className="settings-slider-label">Detection delay</label>
          <input
            type="range"
            min="1"
            max="10"
            value={localFinishedThreshold}
            onChange={(e) => setLocalFinishedThreshold(Number(e.target.value))}
            className="settings-slider"
          />
          <span className="settings-slider-value">{localFinishedThreshold}s</span>
        </div>

        <div style={{ marginTop: '20px' }}>
          <label className="settings-slider-label">Notification Sound</label>
          <div className="settings-sound-group" style={{ marginTop: '8px' }}>
            {SOUND_OPTIONS.map(sound => (
              <div key={sound.id} className="settings-sound-item">
                <label className="settings-radio-item">
                  <input
                    type="radio"
                    name="notification-sound"
                    checked={localCustomSoundPath === sound.path}
                    onChange={() => setLocalCustomSoundPath(sound.path)}
                  />
                  <div className="sound-info">
                    <span className="sound-name">{sound.name}</span>
                    <span className="sound-description">{sound.description}</span>
                  </div>
                </label>
                <button
                  className="btn-icon-sm"
                  onClick={() => handlePreviewSound(sound.path)}
                  title="Test sound"
                >
                  🔊
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-actions">
        <button className="btn-secondary" onClick={handleCancel}>
          Cancel
        </button>
        <button className="btn-primary" onClick={handleSave}>
          Save
        </button>
      </div>
    </Modal>
  );
}
