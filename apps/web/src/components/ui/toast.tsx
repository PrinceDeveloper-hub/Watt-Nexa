import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
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

const styles: Record<ToastVariant, string> = {
  success: 'border-primary/30 bg-primary/10 text-primary',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-accent/30 bg-accent/10 text-accent',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
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
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-xl border bg-card p-3 shadow-lift animate-in slide-in-from-bottom-2',
                styles[item.variant],
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-foreground">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
              </div>
              <button
                onClick={() => dismiss(item.id)}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Dismiss notification"
              >
                <XCircle className="h-3.5 w-3.5" />
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
