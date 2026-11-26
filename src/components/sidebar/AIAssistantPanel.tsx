import React, { useState, useEffect, useRef } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { AIService } from '@/core/ai/ai-service';
import { useAIStore, AI_PROVIDER_DEFAULTS } from '@/core/ai/ai-store';
import type { AIChatMessage, AIProvider } from '@/types/advanced';
import {
  Sparkles,
  Send,
  HelpCircle,
  Bot,
  User,
  Settings,
  Trash2,
  StopCircle,
  Eye,
  EyeOff,
  FileText,
  X,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/utils/cn';

const WELCOME_MESSAGE: AIChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Merhaba! Bu belgenin tüm sayfalarını indeksleyip sorularınızı yanıtlayabilir, özet çıkarabilir veya ilgili sayfa referanslarını bulabilirim.',
  timestamp: 0,
};

function resolveIsDark(theme: 'dark' | 'light' | 'system'): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return true;
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

function renderInlineFormatting(
  text: string,
  totalPages: number,
  onJumpToPage: (pageNumber: number) => void,
  keyPrefix: string
): React.ReactNode[] {
  // Match [Sayfa N], **bold**, *italic*, `code`
  const tokenRegex = /(\[Sayfa\s+\d+\]|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/gi;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let tokIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    const pageMatch = token.match(/^\[Sayfa\s+(\d+)\]$/i);

    if (pageMatch) {
      const pageNum = parseInt(pageMatch[1], 10);
      const valid = pageNum >= 1 && pageNum <= totalPages;
      parts.push(
        <button
          key={`${keyPrefix}_pg_${tokIdx++}`}
          type="button"
          disabled={!valid}
          onClick={() => valid && onJumpToPage(pageNum)}
          title={valid ? `Sayfa ${pageNum}'e git` : undefined}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 rounded-md bg-sky-500/15 hover:bg-sky-500/25 text-sky-600 dark:text-sky-300 border border-sky-500/30 font-semibold text-[10px] transition-colors align-baseline cursor-pointer disabled:opacity-50"
        >
          <FileText className="w-2.5 h-2.5" />
          Sayfa {pageNum}
        </button>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`${keyPrefix}_b_${tokIdx++}`} className="font-bold">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(
        <em key={`${keyPrefix}_i_${tokIdx++}`} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={`${keyPrefix}_c_${tokIdx++}`}
          className="px-1 py-0.5 rounded bg-slate-200/80 dark:bg-slate-700/80 font-mono text-[10px]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else {
      parts.push(token);
    }

    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return parts;
}

const FormattedMessageContent: React.FC<{
  content: string;
  totalPages: number;
  onJumpToPage: (pageNumber: number) => void;
}> = ({ content, totalPages, onJumpToPage }) => {
  const lines = content.split('\n');
  return (
    <div className="space-y-1.5 break-words">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-1" />;

        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={idx} className="font-bold text-xs pt-1">
              {renderInlineFormatting(trimmed.slice(4), totalPages, onJumpToPage, `h_${idx}`)}
            </h4>
          );
        }

        if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
          return (
            <div key={idx} className="flex items-start gap-1.5 pl-1">
              <span className="text-sky-500 font-bold select-none">•</span>
              <span className="flex-1">
                {renderInlineFormatting(trimmed.slice(2), totalPages, onJumpToPage, `ul_${idx}`)}
              </span>
            </div>
          );
        }

        const numMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-1.5 pl-1">
              <span className="font-semibold text-sky-500 select-none shrink-0">{numMatch[1]}</span>
              <span className="flex-1">
                {renderInlineFormatting(numMatch[2], totalPages, onJumpToPage, `ol_${idx}`)}
              </span>
            </div>
          );
        }

        return (
          <p key={idx}>
            {renderInlineFormatting(trimmed, totalPages, onJumpToPage, `p_${idx}`)}
          </p>
        );
      })}
    </div>
  );
};

export const AIAssistantPanel: React.FC = () => {
  const { currentDocument, pdfDocProxy, setActivePageIndex } = useDocumentStore();
  const { addToast } = useUIStore();
  const theme = useViewerStore((s) => s.theme);
  const appDesignTheme = useViewerStore((s) => s.appDesignTheme) || 'fluent';

  const {
    config,
    chatsByDoc,
    generatingByDoc,
    setConfig,
    resetConfig,
    addMessage,
    clearChat,
    setDocGenerating,
  } = useAIStore();

  const [isDark, setIsDark] = useState<boolean>(() => resolveIsDark(theme));
  const [inputQuestion, setInputQuestion] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    setIsDark(resolveIsDark(theme));
    if (theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setIsDark(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [theme]);

  const docId = currentDocument?.id || '';
  const storedMessages = docId ? chatsByDoc[docId] || [] : [];
  const messages = storedMessages.length > 0 ? storedMessages : [WELCOME_MESSAGE];
  const isGenerating = docId ? Boolean(generatingByDoc[docId]) : false;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isGenerating, docId]);

  useEffect(() => {
    const controllers = abortControllersRef.current;
    return () => {
      controllers.forEach((ctrl) => ctrl.abort());
      controllers.clear();
    };
  }, []);

  if (!currentDocument || !pdfDocProxy) return null;

  const isExternalReady = AIService.isExternalProviderReady(config);
  const providerMeta = AI_PROVIDER_DEFAULTS[config.provider];
  const modeLabel = isExternalReady
    ? `${providerMeta.label} • ${config.model}`
    : 'Yerel Belge Analizi (API Anahtarı Yok)';

  const handleJumpToPage = (pageNumber: number) => {
    const targetIdx = pageNumber - 1;
    if (targetIdx >= 0 && targetIdx < currentDocument.pages.length) {
      setActivePageIndex(targetIdx);
    }
  };

  const handleAbortActive = () => {
    const ctrl = abortControllersRef.current.get(docId);
    if (ctrl) {
      ctrl.abort();
      abortControllersRef.current.delete(docId);
      setDocGenerating(docId, false);
      addToast('AI yanıt üretimi durduruldu.', 'info');
    }
  };

  const runAssistantTask = async (
    userText: string,
    executor: (signal: AbortSignal, historySnapshot: AIChatMessage[]) => Promise<{
      content: string;
      sources: { pageNumber: number; snippet: string }[];
    }>
  ) => {
    const targetDocId = currentDocument.id;
    const targetProxy = pdfDocProxy;
    if (!targetDocId || !targetProxy || generatingByDoc[targetDocId]) return;

    const historySnapshot = [...(useAIStore.getState().chatsByDoc[targetDocId] || [])];
    const userMsg: AIChatMessage = {
      id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      role: 'user',
      content: userText,
      timestamp: Date.now(),
    };
    addMessage(targetDocId, userMsg);

    const controller = new AbortController();
    abortControllersRef.current.set(targetDocId, controller);
    setDocGenerating(targetDocId, true);

    try {
      const result = await executor(controller.signal, historySnapshot);
      if (controller.signal.aborted) return;

      const aiMsg: AIChatMessage = {
        id: 'ai_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
        sources: result.sources.length > 0 ? result.sources : undefined,
      };
      addMessage(targetDocId, aiMsg);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      console.error('AI assistant error:', err);
      const errMsg = err instanceof Error ? err.message : 'Yanıt üretilirken hata oluştu.';
      addToast(errMsg, 'error');
      addMessage(targetDocId, {
        id: 'err_' + Date.now(),
        role: 'assistant',
        content: `⚠️ **Hata:** ${errMsg}`,
        timestamp: Date.now(),
      });
    } finally {
      if (abortControllersRef.current.get(targetDocId) === controller) {
        abortControllersRef.current.delete(targetDocId);
      }
      setDocGenerating(targetDocId, false);
    }
  };

  const handleQuickSummarize = () => {
    const targetProxy = pdfDocProxy;
    const targetName = currentDocument.name;
    runAssistantTask('Bu PDF dökümanını özetle.', (signal, history) =>
      AIService.generateSummary(targetProxy, targetName, { config, history, signal })
    );
  };

  const handleQuickQuestions = () => {
    const targetProxy = pdfDocProxy;
    runAssistantTask('Dökümandaki önemli soruları ve konuları çıkar.', (signal, history) =>
      AIService.extractKeyQuestions(targetProxy, { config, history, signal })
    );
  };

  const handleSendQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    const q = inputQuestion.trim();
    if (!q || isGenerating) return;
    setInputQuestion('');
    const targetProxy = pdfDocProxy;
    runAssistantTask(q, (signal, history) =>
      AIService.answerQuestion(targetProxy, q, { config, history, signal })
    );
  };

  return (
    <div
      className={cn(
        'flex-1 flex flex-col overflow-hidden transition-colors',
        appDesignTheme === 'linear'
          ? 'bg-[#08090a] text-slate-200'
          : isDark
          ? 'bg-slate-900/50 text-slate-100'
          : 'bg-slate-50/70 text-slate-800'
      )}
    >
      {/* Status & Controls Header */}
      <div
        className={cn(
          'p-3 border-b space-y-2 shrink-0',
          isDark ? 'border-slate-800' : 'border-slate-200 bg-white/80'
        )}
      >
        <div className="flex items-center justify-between gap-1.5">
          <span
            className={cn(
              'text-[10px] font-semibold px-2 py-0.5 rounded-full truncate border',
              isExternalReady
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
            )}
            title={modeLabel}
          >
            {modeLabel}
          </span>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              title="AI Sağlayıcı ve Model Ayarları"
              aria-label="AI Ayarları"
              className={cn(
                'p-1.5 rounded-lg transition-colors',
                showSettings
                  ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800'
              )}
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                clearChat(docId);
                addToast('Bu belgenin sohbet geçmişi temizlendi.', 'info', 2000);
              }}
              disabled={storedMessages.length === 0 || isGenerating}
              title="Bu Belgenin Sohbetini Temizle"
              aria-label="Sohbeti Temizle"
              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-500 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Inline AI Settings Drawer */}
        {showSettings && (
          <div
            className={cn(
              'p-2.5 rounded-xl border space-y-2.5 text-[11px]',
              isDark ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-200'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700 dark:text-slate-200">
                Yapay Zeka Sağlayıcı Ayarları
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={resetConfig}
                  title="Varsayılana Sıfırla"
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  aria-label="Ayarları Kapat"
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Sağlayıcı
              </label>
              <select
                value={config.provider}
                onChange={(e) => setConfig({ provider: e.target.value as AIProvider })}
                className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {(Object.keys(AI_PROVIDER_DEFAULTS) as AIProvider[]).map((p) => (
                  <option key={p} value={p}>
                    {AI_PROVIDER_DEFAULTS[p].label}
                  </option>
                ))}
              </select>
            </div>

            {config.provider !== 'local' && (
              <>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                    Model Adı
                  </label>
                  <input
                    type="text"
                    value={config.model}
                    onChange={(e) => setConfig({ model: e.target.value })}
                    placeholder={providerMeta.defaultModel}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                {config.provider !== 'ollama' && (
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                      API Anahtarı (Tarayıcıda Yerel Saklanır)
                    </label>
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={config.apiKey || ''}
                        onChange={(e) => setConfig({ apiKey: e.target.value })}
                        placeholder="sk-..."
                        className="w-full pl-2 pr-7 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((s) => !s)}
                        aria-label={showApiKey ? 'API anahtarını gizle' : 'API anahtarını göster'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                    API Taban URL
                  </label>
                  <input
                    type="text"
                    value={config.baseUrl || ''}
                    onChange={(e) => setConfig({ baseUrl: e.target.value })}
                    placeholder={providerMeta.defaultBaseUrl}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* Quick Action Badges */}
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={handleQuickSummarize}
            disabled={isGenerating}
            className="px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 disabled:opacity-50 text-sky-700 dark:text-sky-300 text-[11px] font-semibold border border-sky-500/30 flex items-center gap-1 transition-colors"
          >
            <Sparkles className="w-3 h-3 text-sky-500 dark:text-sky-400" />
            Dökümanı Özetle
          </button>
          <button
            type="button"
            onClick={handleQuickQuestions}
            disabled={isGenerating}
            className="px-2.5 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 disabled:opacity-50 text-purple-700 dark:text-purple-300 text-[11px] font-semibold border border-purple-500/30 flex items-center gap-1 transition-colors"
          >
            <HelpCircle className="w-3 h-3 text-purple-500 dark:text-purple-400" />
            Konu & Soruları Bul
          </button>
        </div>
      </div>

      {/* Chat Messages Log */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 select-text">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'flex gap-2 text-xs leading-relaxed',
              m.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            {m.role === 'assistant' && (
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500 to-sky-500 flex items-center justify-center text-white shrink-0 shadow-sm mt-0.5">
                <Bot className="w-3.5 h-3.5" />
              </div>
            )}

            <div className="max-w-[86%] space-y-1.5">
              <div
                className={cn(
                  'p-3 rounded-2xl',
                  m.role === 'user'
                    ? 'bg-sky-600 text-white rounded-tr-sm'
                    : isDark
                    ? 'bg-slate-800/90 border border-slate-700/70 text-slate-200 rounded-tl-sm'
                    : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-2xs'
                )}
              >
                <FormattedMessageContent
                  content={m.content}
                  totalPages={currentDocument.pages.length}
                  onJumpToPage={handleJumpToPage}
                />
              </div>

              {m.sources && m.sources.length > 0 && (
                <div className="flex flex-wrap gap-1 px-1">
                  {m.sources.map((src, sIdx) => (
                    <button
                      key={`${m.id}_src_${sIdx}`}
                      type="button"
                      onClick={() => handleJumpToPage(src.pageNumber)}
                      title={src.snippet}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-slate-200/80 dark:bg-slate-800 hover:bg-sky-500/15 hover:text-sky-600 dark:hover:text-sky-300 text-slate-600 dark:text-slate-300 border border-slate-300/60 dark:border-slate-700 transition-colors cursor-pointer"
                    >
                      <FileText className="w-2.5 h-2.5 text-sky-500" />
                      <span>Sayfa {src.pageNumber}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {m.role === 'user' && (
              <div className="w-6 h-6 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5" />
              </div>
            )}
          </div>
        ))}

        {isGenerating && (
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500 to-sky-500 flex items-center justify-center text-white shrink-0 animate-pulse">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <span>Belge analiz ediliyor...</span>
            </div>
            <button
              type="button"
              onClick={handleAbortActive}
              className="px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-[10px] font-semibold flex items-center gap-1"
            >
              <StopCircle className="w-3 h-3" />
              <span>Durdur</span>
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Question Form */}
      <form
        onSubmit={handleSendQuestion}
        className={cn(
          'p-3 border-t flex items-center gap-1.5 shrink-0',
          isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
        )}
      >
        <input
          type="text"
          value={inputQuestion}
          onChange={(e) => setInputQuestion(e.target.value)}
          placeholder="PDF hakkında bir soru sorun..."
          className={cn(
            'flex-1 px-3 py-2 border rounded-xl text-xs focus:outline-none focus:border-sky-500',
            isDark
              ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500'
              : 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400'
          )}
        />
        <button
          type="submit"
          disabled={!inputQuestion.trim() || isGenerating}
          className="p-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white transition-colors"
          title="Gönder"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
