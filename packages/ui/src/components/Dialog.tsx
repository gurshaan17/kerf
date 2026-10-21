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
      className="w-[calc(100vw-48px)] max-w-[480px] border-0 bg-transparent p-0 text-ink backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={handleBackdropClick}
    >
      <div className="overflow-hidden rounded-lg border border-line-strong bg-surface-2 shadow-3">
        <header className="flex items-start justify-between gap-4 px-[18px] pt-[18px]">
          <div>
            <h2
              id={titleId}
              className="font-display text-[24px] leading-[1.16] font-medium"
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-[5px] max-w-[38ch] text-[12px] text-ink-muted"
              >
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
        <div className="px-[18px] pt-4 pb-5">{children}</div>
        {footer ? (
          <footer className="flex justify-end gap-2 border-t border-line bg-surface-1 px-[18px] py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}
