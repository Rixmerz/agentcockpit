/**
 * DropdownPanel - Reusable dropdown component with BF3 styling
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { hideAllBrowserWebviews } from '../../services/browserService';

interface DropdownPanelProps {
  trigger: ReactNode;
  triggerIcon?: ReactNode;
  label: string;
  children: ReactNode;
  align?: 'left' | 'right';
  width?: 'default' | 'wide';
  badge?: string | number;
  statusDot?: 'active' | 'warning' | 'error' | 'none';
}

export function DropdownPanel({
  trigger,
  triggerIcon,
  label,
  children,
  align = 'left',
  width = 'default',
  badge,
  statusDot = 'none',
}: DropdownPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Hide browser webviews when dropdown opens (they render above everything)
  useEffect(() => {
    if (isOpen) {
      hideAllBrowserWebviews();
      document.body.classList.add('dropdown-open');
    } else {
      // Check if any other dropdowns are still open
      setTimeout(() => {
        const anyDropdownOpen = document.querySelector('.dropdown__content');
        if (!anyDropdownOpen) {
          document.body.classList.remove('dropdown-open');
          // Emit event so BrowserPanel can restore webview
          window.dispatchEvent(new CustomEvent('dropdowns-closed'));
        }
      }, 50);
    }
  }, [isOpen]);

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <div className="dropdown" ref={containerRef}>
      <button
        className="control-bar__trigger"
        onClick={toggle}
        data-state={isOpen ? 'open' : 'closed'}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {statusDot !== 'none' && (
          <span className={`control-bar__status-dot control-bar__status-dot--${statusDot}`} />
        )}
        {triggerIcon && (
          <span className="control-bar__trigger-icon">{triggerIcon}</span>
        )}
        <span>{trigger}</span>
        {badge !== undefined && (
          <span className="dropdown__item-badge">{badge}</span>
        )}
        <ChevronDown className="control-bar__trigger-chevron" />
      </button>

      {isOpen && (
        <div
          className={`dropdown__content ${align === 'right' ? 'dropdown__content--right' : ''} ${width === 'wide' ? 'dropdown__content--wide' : ''}`}
        >
          <div className="dropdown__header">
            <span className="dropdown__title">{label}</span>
          </div>
          <div className="dropdown__body">
            {typeof children === 'function'
              ? (children as (close: () => void) => ReactNode)(close)
              : children
            }
          </div>
        </div>
      )}
    </div>
  );
}

// Dropdown item component for consistency
interface DropdownItemProps {
  icon?: ReactNode;
  label: string;
  description?: string;
  badge?: string | number;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function DropdownItem({
  icon,
  label,
  description,
  badge,
  active = false,
  disabled = false,
  onClick,
}: DropdownItemProps) {
  return (
    <button
      className={`dropdown__item ${active ? 'dropdown__item--active' : ''} ${disabled ? 'dropdown__item--disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <span className="dropdown__item-icon">{icon}</span>}
      <span className="dropdown__item-label">
        {label}
        {description && (
          <span style={{
            display: 'block',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            marginTop: '2px'
          }}>
            {description}
          </span>
        )}
      </span>
      {badge !== undefined && (
        <span className="dropdown__item-badge">{badge}</span>
      )}
    </button>
  );
}

// Section divider
export function DropdownSection({
  title,
  children
}: {
  title?: string;
  children: ReactNode
}) {
  return (
    <div className="dropdown__section">
      {title && <div className="dropdown__section-title">{title}</div>}
      {children}
    </div>
  );
}
