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
    setDefaultIDE,
    setBackgroundImage,
    setBackgroundOpacity,
    setTerminalOpacity,
  } = useAppSettings();

  const [localImage, setLocalImage] = useState(backgroundImage || '');
  const [localOpacity, setLocalOpacity] = useState(backgroundOpacity);
  const [localTerminalOpacity, setLocalTerminalOpacity] = useState(terminalOpacity);

  // Sync local state when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalImage(backgroundImage || '');
      setLocalOpacity(backgroundOpacity);
      setLocalTerminalOpacity(terminalOpacity);
    }
  }, [isOpen, backgroundImage, backgroundOpacity, terminalOpacity]);

  const handleSave = () => {
    setBackgroundImage(localImage || undefined);
    setBackgroundOpacity(localOpacity);
    setTerminalOpacity(localTerminalOpacity);
    onClose();
  };

  const handleCancel = () => {
    setLocalImage(backgroundImage || '');
    setLocalOpacity(backgroundOpacity);
    setLocalTerminalOpacity(terminalOpacity);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title="Configuracion">
      <div className="settings-section">
        <h3 className="settings-section-title">IDE por Defecto</h3>
        <p className="settings-section-desc">
          Selecciona el editor que se abrira al hacer click en el icono de abrir proyecto
        </p>

        <div className="settings-radio-group">
          <label className="settings-radio-item">
            <input
              type="radio"
              name="ide"
              checked={!defaultIDE}
              onChange={() => setDefaultIDE(undefined)}
            />
            <span>Auto-detectar (primero disponible)</span>
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
        <h3 className="settings-section-title">Imagen de Fondo</h3>
        <p className="settings-section-desc">
          Agrega una imagen de fondo (URL o ruta local)
        </p>

        <input
          type="text"
          className="settings-input"
          placeholder="https://example.com/image.jpg o /path/to/image.png"
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
        <h3 className="settings-section-title">Opacidad de Fondo</h3>
        <p className="settings-section-desc">
          Controla la transparencia de la imagen de fondo
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
        <h3 className="settings-section-title">Opacidad de Terminal</h3>
        <p className="settings-section-desc">
          Controla que tan oscuro o claro se ve el fondo de la terminal (0% = transparente, 100% = oscuro)
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

      <div className="settings-actions">
        <button className="btn-secondary" onClick={handleCancel}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={handleSave}>
          Guardar
        </button>
      </div>
    </Modal>
  );
}
