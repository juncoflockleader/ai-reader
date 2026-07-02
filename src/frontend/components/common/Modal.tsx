// Shared modal primitive: portal + backdrop + Esc-to-close + backdrop-click +
// focus trap + focus restore. Two modes:
//   • styled (default) — renders an overlays.module.css card with header/close.
//   • unstyled — renders children directly inside the backdrop, so a consumer can
//     keep its own panel markup/classes (used by the reader's settings modals).
// Both modes share the behavior so every overlay traps focus and dismisses the
// same way.

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import styles from "./overlays.module.css";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Accessible label when there is no visible title. */
  ariaLabel?: string;
  children: ReactNode;
  hideCloseButton?: boolean;
  /** Render children as the panel instead of the default styled card. */
  unstyled?: boolean;
  size?: "default" | "wide";
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableWithin(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement
  );
}

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  ariaLabel,
  children,
  hideCloseButton,
  unstyled,
  size = "default",
}: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Move focus into the dialog so keyboard + screen-reader users land here.
    const focusables = focusableWithin(backdropRef.current);
    (focusables[0] ?? backdropRef.current)?.focus();
    return () => {
      // Restore focus to whatever was focused before the modal opened.
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = focusableWithin(backdropRef.current);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const backdrop = (panel: ReactNode) => (
    <div
      ref={backdropRef}
      className={styles.backdrop}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {panel}
    </div>
  );

  if (unstyled) {
    return createPortal(backdrop(children), document.body);
  }

  return createPortal(
    backdrop(
      <div
        className={size === "wide" ? `${styles.modal} ${styles.modalWide}` : styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : ariaLabel}
        aria-labelledby={title ? "modal-title" : undefined}
        tabIndex={-1}
      >
        {(title || !hideCloseButton) && (
          <div className={styles.modalHeader}>
            {title ? (
              <div>
                <h2 id="modal-title" className={styles.modalTitle}>
                  {title}
                </h2>
                {subtitle && <p className={styles.modalSubtitle}>{subtitle}</p>}
              </div>
            ) : (
              <span />
            )}
            {!hideCloseButton && (
              <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    ),
    document.body
  );
}
