import React from 'react';
import { useUIStore } from '@/store/ui-store';
import { AlertCircle, CheckCircle2, Info, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/utils/cn';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useUIStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-14 right-6 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
      {toasts.map((toast) => {
        const icons = {
          info: <Info className="w-5 h-5 text-sky-400 shrink-0" />,
          success: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />,
          warning: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
          error: <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />,
        };

        const bgColors = {
          info: 'bg-slate-900/95 border-sky-500/30 text-slate-100',
          success: 'bg-slate-900/95 border-emerald-500/30 text-slate-100',
          warning: 'bg-slate-900/95 border-amber-500/30 text-slate-100',
          error: 'bg-slate-900/95 border-rose-500/30 text-slate-100',
        };

        return (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-5',
              bgColors[toast.type]
            )}
          >
            <div className="flex items-center gap-3">
              {icons[toast.type]}
              <p className="text-sm font-medium leading-snug">{toast.message}</p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
