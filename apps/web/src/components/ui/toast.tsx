import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (input: { title: string; description?: string; variant?: ToastVariant }) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const icons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const styles: Record<ToastVariant, { icon: string; rule: string }> = {
  success: { icon: 'bg-primary/10 text-primary', rule: 'bg-primary' },
  error: { icon: 'bg-destructive/10 text-destructive', rule: 'bg-destructive' },
  info: { icon: 'bg-accent/20 text-accent-foreground dark:text-accent', rule: 'bg-accent' },
  warning: { icon: 'bg-warning/10 text-warning', rule: 'bg-warning' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = React.useCallback<ToastContextValue['toast']>(
    ({ title, description, variant = 'info' }) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((current) => [...current.slice(-3), { id, title, description, variant }]);
      window.setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
      >
        {toasts.map((item) => {
          const Icon = icons[item.variant];
          return (
            <div
              key={item.id}
              className="pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-2xl border border-border bg-card p-3.5 shadow-lift animate-in slide-in-from-bottom-2"
            >
              <span className={cn('absolute inset-y-0 left-0 w-0.5', styles[item.variant].rule)} />
              <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', styles[item.variant].icon)}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="flex-1 pt-0.5">
                <p className="text-xs font-semibold text-foreground">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{item.description}</p>
                ) : null}
              </div>
              <button
                onClick={() => dismiss(item.id)}
                className="rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
