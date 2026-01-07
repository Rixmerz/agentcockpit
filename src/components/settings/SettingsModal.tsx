import { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { useAppSettings } from '../../contexts/AppContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableIDEs: string[];
}

export function SettingsModal({ isOpen, onClose, availableIDEs }: SettingsModalProps) {
  const {
    defaultIDE,
    backgroundImage,
    backgroundOpacity,
    terminalOpacity,
    idleTimeout,
    setDefaultIDE,
    setBackgroundImage,
    setBackgroundOpacity,
    setTerminalOpacity,
    setIdleTimeout,
  } = useAppSettings();

  const [localImage, setLocalImage] = useState(backgroundImage || '');
  const [localOpacity, setLocalOpacity] = useState(backgroundOpacity);
  const [localTerminalOpacity, setLocalTerminalOpacity] = useState(terminalOpacity);
  const [localIdleTimeout, setLocalIdleTimeout] = useState(idleTimeout);

  // Sync local state when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalImage(backgroundImage || '');
      setLocalOpacity(backgroundOpacity);
      setLocalTerminalOpacity(terminalOpacity);
      setLocalIdleTimeout(idleTimeout);
    }
  }, [isOpen, backgroundImage, backgroundOpacity, terminalOpacity, idleTimeout]);

  const handleSave = () => {
    setBackgroundImage(localImage || undefined);
    setBackgroundOpacity(localOpacity);
    setTerminalOpacity(localTerminalOpacity);
    setIdleTimeout(localIdleTimeout);
    onClose();
  };

  const handleCancel = () => {
    setLocalImage(backgroundImage || '');
    setLocalOpacity(backgroundOpacity);
    setLocalTerminalOpacity(terminalOpacity);
    setLocalIdleTimeout(idleTimeout);
    onClose();
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
