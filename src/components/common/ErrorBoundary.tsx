import React from 'react';
import { AlertTriangle, RefreshCw, XCircle, RotateCcw } from 'lucide-react';
import { useTabStore } from '@/store/tab-store';
import { useDocumentStore } from '@/store/document-store';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  scope?: 'app' | 'viewer';
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.scope || 'app'}]`, error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  private handleCloseCurrentTab = () => {
    try {
      const tabState = useTabStore.getState();
      const docState = useDocumentStore.getState();
      const targetId = tabState.activeTabId || docState.currentDocument?.id;

      if (targetId) {
        const currentIdx = tabState.tabs.findIndex((t) => t.id === targetId);
        tabState.closeTab(targetId);
        const remaining = useTabStore.getState().tabs;
        if (remaining.length > 0) {
          const nextIdx = Math.max(0, Math.min(currentIdx > 0 ? currentIdx - 1 : 0, remaining.length - 1));
          const nextTab = remaining[nextIdx];
          useTabStore.getState().setActiveTab(nextTab.id);
          docState.setDocument(
            { ...nextTab.model, activePageIndex: nextTab.activePageIndex ?? 0 },
            nextTab.pdfDocProxy
          );
        } else {
          docState.closeDocument();
        }
      } else {
        docState.closeDocument();
      }
    } catch (err) {
      console.error('Error closing crashed tab:', err);
    }
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  public render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const hasActiveTab =
      useTabStore.getState().tabs.length > 0 || Boolean(useDocumentStore.getState().currentDocument);

    return (
      <div
        role="alert"
        className="flex-1 w-full h-full flex items-center justify-center p-6 bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      >
        <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Beklenmeyen Bir Hata Oluştu
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                {this.props.scope === 'viewer'
                  ? 'Belge görüntülenirken bir sorun oluştu. Sekmeyi kapatabilir veya yeniden deneyebilirsiniz.'
                  : 'Uygulama arayüzü beklenmeyen bir hatayla karşılaştı. Verilerinizi kaybetmeden devam etmeyi deneyebilirsiniz.'}
              </p>
            </div>
          </div>

          {this.state.error?.message && (
            <details className="rounded-xl bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/70 p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-300 select-none">
                Teknik Hata Detayı
              </summary>
              <pre className="mt-2 text-[11px] font-mono text-rose-600 dark:text-rose-400 whitespace-pre-wrap break-words max-h-32 overflow-auto">
                {this.state.error.message}
              </pre>
            </details>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors shadow-sm"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Tekrar Dene</span>
            </button>

            {hasActiveTab && (
              <button
                type="button"
                onClick={this.handleCloseCurrentTab}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-xs font-semibold transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Sekmeyi Kapat</span>
              </button>
            )}

            <button
              type="button"
              onClick={this.handleReload}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Uygulamayı Yenile</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
