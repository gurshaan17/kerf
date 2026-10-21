import { useEffect, useId, useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }

    const handleCancel = (event: Event) => {
      event.preventDefault();
      onOpenChange(false);
    };
    const handleClose = () => {
      onOpenChange(false);
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
    };
  }, [onOpenChange]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      onOpenChange(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="k-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={handleBackdropClick}
    >
      <div className="k-dialog__panel">
        <header className="k-dialog__header">
          <div>
            <h2 id={titleId} className="k-dialog__title">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="k-dialog__description">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton
            label="Close dialog"
            size="sm"
            icon={<X size={15} />}
            onClick={() => onOpenChange(false)}
          />
        </header>
        <div className="k-dialog__body">{children}</div>
        {footer ? <footer className="k-dialog__footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
