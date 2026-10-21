import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../cn';
import { IconButton } from './IconButton';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  action?: ReactNode;
}

export interface ToastViewportProps {
  items: ToastItem[];
  onDismiss: (id: string) => void;
}

const toneClasses: Record<ToastTone, string> = {
  info: 'border-l-accent',
  success: 'border-l-ok',
  error: 'border-l-danger',
};

export function ToastViewport({ items, onDismiss }: ToastViewportProps) {
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-[var(--k-z-toast)] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((item) => {
        const tone = item.tone ?? 'info';
        return (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto flex animate-toast-in items-start gap-2 rounded-sm border border-line-strong border-l-[3px] bg-surface-3 p-2.5 pl-3 shadow-2',
              toneClasses[tone],
            )}
            role={tone === 'error' ? 'alert' : 'status'}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold">{item.title}</p>
              {item.description ? (
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  {item.description}
                </p>
              ) : null}
            </div>
            {item.action}
            <IconButton
              label="Dismiss notification"
              size="sm"
              icon={<X size={14} />}
              onClick={() => onDismiss(item.id)}
            />
          </div>
        );
      })}
    </div>
  );
}

export function useToastQueue() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID();
    setItems((current) => [...current, { ...toast, id }]);
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return { items, push, dismiss };
}
