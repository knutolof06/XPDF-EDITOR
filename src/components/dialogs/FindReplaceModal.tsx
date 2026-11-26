import React, { useState, useEffect, useTransition } from 'react';
import { PDFDocument, rgb } from 'pdf-lib';
import {
  X,
  Search,
  Replace,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Loader2,
  EyeOff,
} from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { useDocumentStore } from '@/store/document-store';
import { PdfReplaceEngine, TextMatchItem } from '@/core/engine/pdf-replace-engine';
import { historyManager, ReplaceTextCommand } from '@/core/history/command-manager';
import { binaryStore } from '@/core/storage/binary-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { cn } from '@/utils/cn';
import { syncReplacedActiveDocument, useModalEscape } from './modal-utils';

async function applyBlackRedactionMask(
  buffer: ArrayBuffer,
  matches: TextMatchItem[]
): Promise<ArrayBuffer> {
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  for (const m of matches) {
    if (m.pageIndex < 0 || m.pageIndex >= pages.length) continue;
    const page = pages[m.pageIndex];
    page.drawRectangle({
      x: Math.max(0, m.x - 1),
      y: Math.max(0, m.y - 1.5),
      width: m.width + 2,
      height: m.height + 3,
      color: rgb(0.05, 0.05, 0.05),
    });
  }
  const bytes = await pdfDoc.save();
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

export const FindReplaceModal: React.FC = () => {
  const { isFindReplaceModalOpen, setFindReplaceModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy, setActivePageIndex } = useDocumentStore();

  const [mode, setMode] = useState<'replace' | 'redact'>('replace');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [scope, setScope] = useState<'all' | 'current'>('all');

  const [matches, setMatches] = useState<TextMatchItem[]>([]);
  const [currentMatchIdx, setCurrentMatchIdx] = useState<number>(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (isFindReplaceModalOpen) {
      setMatches([]);
      setCurrentMatchIdx(-1);
      setSearchError(null);
    }
  }, [isFindReplaceModalOpen]);

  useModalEscape(
    isFindReplaceModalOpen,
    () => setFindReplaceModalOpen(false),
    isReplacing
  );

  // NOTE: Intentionally omit currentDocument?.activePageIndex from deps so stepping across pages preserves currentMatchIdx!
  useEffect(() => {
    if (!isFindReplaceModalOpen || !pdfDocProxy || !findText.trim()) {
      setMatches([]);
      setCurrentMatchIdx(-1);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const activeIdx = useDocumentStore.getState().currentDocument?.activePageIndex || 0;
        const results = await PdfReplaceEngine.findMatches(pdfDocProxy, findText, {
          matchCase,
          wholeWord,
          scope,
          currentPageIndex: activeIdx,
        });
        if (cancelled) return;
        startTransition(() => {
          setMatches(results);
          if (results.length > 0) {
            setCurrentMatchIdx(0);
            useDocumentStore.getState().setActivePageIndex(results[0].pageIndex);
          } else {
            setCurrentMatchIdx(-1);
          }
        });
      } catch (err: unknown) {
        if (cancelled) return;
        console.warn('FindMatches error:', err);
        setSearchError('Arama sırasında bir hata oluştu.');
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [findText, matchCase, wholeWord, scope, isFindReplaceModalOpen, pdfDocProxy]);

  if (!isFindReplaceModalOpen) return null;

  const currentMatch =
    currentMatchIdx >= 0 && currentMatchIdx < matches.length ? matches[currentMatchIdx] : null;

  const goToNextMatch = () => {
    if (matches.length === 0) return;
    const next = (currentMatchIdx + 1) % matches.length;
    setCurrentMatchIdx(next);
    setActivePageIndex(matches[next].pageIndex);
  };

  const goToPrevMatch = () => {
    if (matches.length === 0) return;
    const prev = (currentMatchIdx - 1 + matches.length) % matches.length;
    setCurrentMatchIdx(prev);
    setActivePageIndex(matches[prev].pageIndex);
  };

  const executeReplacement = async (targetMatches: TextMatchItem[], closeAfter: boolean) => {
    if (targetMatches.length === 0 || !currentDocument) return;
    setIsReplacing(true);
    try {
      const oldBuffer = binaryStore.get(currentDocument.id);
      if (!oldBuffer) throw new Error('Döküman verisi bellekte bulunamadı.');

      const clonedOldBuffer = oldBuffer.slice(0);
      const effectiveReplacement = mode === 'redact' ? '' : replaceText;
      let newBuffer = await PdfReplaceEngine.applyReplacements(
        currentDocument.id,
        targetMatches,
        effectiveReplacement
      );

      if (mode === 'redact') {
        newBuffer = await applyBlackRedactionMask(newBuffer, targetMatches);
      }

      const { model, pdfDoc } = await PdfLoader.loadDocument(
        currentDocument.name,
        newBuffer.slice(0),
        currentDocument.filePath
      );

      syncReplacedActiveDocument(model, pdfDoc, currentDocument, {
        isModified: true,
        preserveActivePage: true,
      });

      historyManager.push(
        new ReplaceTextCommand(
          clonedOldBuffer,
          newBuffer.slice(0),
          currentDocument.name,
          currentDocument.filePath,
          targetMatches.length
        )
      );

      const actionLabel = mode === 'redact' ? 'gizlendi (karartıldı)' : 'değiştirildi';
      addToast(
        `${targetMatches.length} eşleşme ${actionLabel}. (Geri almak için Ctrl+Z)`,
        'success'
      );

      if (closeAfter) {
        setMatches([]);
        setCurrentMatchIdx(-1);
        setFindReplaceModalOpen(false);
      } else {
        const activeIdx = useDocumentStore.getState().currentDocument?.activePageIndex || 0;
        const updatedMatches = await PdfReplaceEngine.findMatches(pdfDoc, findText, {
          matchCase,
          wholeWord,
          scope,
          currentPageIndex: activeIdx,
        });
        setMatches(updatedMatches);
        if (updatedMatches.length > 0) {
          const nextIdx = Math.min(currentMatchIdx, updatedMatches.length - 1);
          setCurrentMatchIdx(nextIdx);
          setActivePageIndex(updatedMatches[nextIdx].pageIndex);
        } else {
          setCurrentMatchIdx(-1);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Değiştirme sırasında hata oluştu.';
      addToast(msg, 'error');
    } finally {
      setIsReplacing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => !isReplacing && setFindReplaceModalOpen(false)}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 dark:bg-sky-500/20 flex items-center justify-center text-sky-600 dark:text-sky-400">
              {mode === 'redact' ? <EyeOff className="w-4 h-4" /> : <Replace className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-100">
                PDF İçi Bul ve Değiştir / Karart
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Metinleri yenisiyle değiştirin veya kalıcı olarak gizleyin
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !isReplacing && setFindReplaceModalOpen(false)}
            disabled={isReplacing}
            aria-label="Kapat"
            className="w-7 h-7 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4">
          {/* Operation Mode Toggle: Replace vs Redact */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setMode('replace')}
              className={cn(
                'py-1.5 px-3 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all',
                mode === 'replace'
                  ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              )}
            >
              <Replace className="w-3.5 h-3.5" />
              <span>Metin Değiştir</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('redact')}
              className={cn(
                'py-1.5 px-3 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all',
                mode === 'redact'
                  ? 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              )}
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>Karart (Sansürle)</span>
            </button>
          </div>

          {/* Find input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
              <span>Aranan Metin:</span>
              {isSearching && (
                <span className="text-[11px] text-sky-500 flex items-center gap-1 font-normal">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Aranıyor...
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type="text"
                value={findText}
                onChange={(e) => setFindText(e.target.value)}
                placeholder="Aramak istediğiniz kelimeyi girin..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                autoFocus
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
          </div>

          {/* Replace input or Redaction warning */}
          {mode === 'replace' ? (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Yeni Metin (Değiştirilecek):
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder="Yerine yazılacak yeni metni girin..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <Replace className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-[11px] text-rose-700 dark:text-rose-300">
              Karartma modu eşleşen metinlerin üzerini kalıcı siyah sansür şeridiyle kapatır.
            </div>
          )}

          {/* Search Options */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(e) => setMatchCase(e.target.checked)}
                className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span>Büyük/küçük harf duyarlı</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={wholeWord}
                onChange={(e) => setWholeWord(e.target.checked)}
                className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span>Tam kelime eşleşmesi</span>
            </label>
          </div>

          {/* Scope Selector */}
          <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Arama Kapsamı:
            </span>
            <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setScope('all')}
                className={cn(
                  'px-3 py-1 rounded-md transition-colors',
                  scope === 'all'
                    ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 font-semibold shadow-xs'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                )}
              >
                Tüm Belge
              </button>
              <button
                type="button"
                onClick={() => setScope('current')}
                className={cn(
                  'px-3 py-1 rounded-md transition-colors',
                  scope === 'current'
                    ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 font-semibold shadow-xs'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                )}
              >
                Bu Sayfa ({currentDocument ? currentDocument.activePageIndex + 1 : 1})
              </button>
            </div>
          </div>

          {/* Match Status Bar */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2">
              {searchError ? (
                <>
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  <span className="text-xs text-rose-500">{searchError}</span>
                </>
              ) : findText.trim() === '' ? (
                <span className="text-xs text-slate-400">Aramak için bir kelime yazın</span>
              ) : matches.length > 0 ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    <span className="text-sky-600 dark:text-sky-400 font-bold">
                      {currentMatchIdx + 1}
                    </span>{' '}
                    / {matches.length} eşleşme (Sayfa {currentMatch ? currentMatch.pageIndex + 1 : '-'})
                  </span>
                </>
              ) : !isSearching ? (
                <>
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    Eşleşme bulunamadı
                  </span>
                </>
              ) : null}
            </div>

            {matches.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={goToPrevMatch}
                  title="Önceki eşleşme"
                  aria-label="Önceki eşleşme"
                  className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={goToNextMatch}
                  title="Sonraki eşleşme"
                  aria-label="Sonraki eşleşme"
                  className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={() => !isReplacing && setFindReplaceModalOpen(false)}
            disabled={isReplacing}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            Kapat
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!currentMatch || isReplacing}
              onClick={() => currentMatch && executeReplacement([currentMatch], false)}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isReplacing ? 'İşleniyor...' : mode === 'redact' ? 'Karart' : 'Değiştir'}
            </button>
            <button
              type="button"
              disabled={matches.length === 0 || isReplacing}
              onClick={() => executeReplacement(matches, true)}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5',
                mode === 'redact'
                  ? 'bg-rose-600 hover:bg-rose-500'
                  : 'bg-sky-600 hover:bg-sky-500'
              )}
            >
              {isReplacing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  İşleniyor...
                </>
              ) : mode === 'redact' ? (
                `Tümünü Karart (${matches.length})`
              ) : (
                `Tümünü Değiştir (${matches.length})`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
