import { useEffect } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

const MODAL_TITLE_ID = 'modal-title';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  // ESC key to close
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
      return () => window.removeEventListener('keydown', handleEsc);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby={MODAL_TITLE_ID}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id={MODAL_TITLE_ID} className="modal-title">{title}</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        <div className="modal-content">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
