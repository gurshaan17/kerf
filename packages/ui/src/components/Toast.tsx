import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../cx';
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

export function ToastViewport({ items, onDismiss }: ToastViewportProps) {
  return (
    <div className="k-toast-viewport" aria-live="polite" aria-atomic="false">
      {items.map((item) => {
        const tone = item.tone ?? 'info';
        return (
          <div
            key={item.id}
            className={cx('k-toast', `k-toast--${tone}`)}
            role={tone === 'error' ? 'alert' : 'status'}
          >
            <div className="k-toast__copy">
              <p className="k-toast__title">{item.title}</p>
              {item.description ? (
                <p className="k-toast__description">{item.description}</p>
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
