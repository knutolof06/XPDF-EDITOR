import React, { useState, useEffect, useTransition } from 'react';
import {
  X,
  Search,
  Replace,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { useDocumentStore } from '@/store/document-store';
import { PdfReplaceEngine, TextMatchItem } from '@/core/engine/pdf-replace-engine';
import { historyManager, ReplaceTextCommand } from '@/core/history/command-manager';
import { binaryStore } from '@/core/storage/binary-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';

export const FindReplaceModal: React.FC = () => {
  const { isFindReplaceModalOpen, setFindReplaceModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy, setActivePageIndex, setDocument } = useDocumentStore();

  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [scope, setScope] = useState<'all' | 'current'>('all');

  const [matches, setMatches] = useState<TextMatchItem[]>([]);
  const [currentMatchIdx, setCurrentMatchIdx] = useState<number>(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [, startTransition] = useTransition();

  // Reset state when opened
  useEffect(() => {
    if (isFindReplaceModalOpen) {
      setMatches([]);
      setCurrentMatchIdx(-1);
    }
  }, [isFindReplaceModalOpen]);

  // Real-time or debounced search when findText / options change
  useEffect(() => {
    if (!isFindReplaceModalOpen || !pdfDocProxy || !findText.trim()) {
      setMatches([]);
      setCurrentMatchIdx(-1);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await PdfReplaceEngine.findMatches(pdfDocProxy, findText, {
          matchCase,
          wholeWord,
          scope,
          currentPageIndex: currentDocument?.activePageIndex || 0,
        });
        startTransition(() => {
          setMatches(results);
          if (results.length > 0) {
            setCurrentMatchIdx(0);
            // Navigate viewer to the page of the first match
            setActivePageIndex(results[0].pageIndex);
          } else {
            setCurrentMatchIdx(-1);
          }
        });
      } catch (err) {
        console.warn('FindMatches error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [findText, matchCase, wholeWord, scope, isFindReplaceModalOpen, pdfDocProxy, currentDocument?.activePageIndex]);

  if (!isFindReplaceModalOpen) return null;

  const currentMatch = currentMatchIdx >= 0 && currentMatchIdx < matches.length ? matches[currentMatchIdx] : null;

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

  // Replace single match
  const handleReplaceCurrent = async () => {
    if (!currentMatch || !currentDocument) return;
    setIsReplacing(true);
    try {
      const oldBuffer = binaryStore.get(currentDocument.id);
      if (!oldBuffer) throw new Error('Döküman verisi bulunamadı');

      const clonedOldBuffer = oldBuffer.slice(0);
      const newBuffer = await PdfReplaceEngine.applyReplacements(
        currentDocument.id,
        [currentMatch],
        replaceText
      );

      // Save to binary store and reload into document store
      binaryStore.set(currentDocument.id, newBuffer.slice(0));
      const { model, pdfDoc } = await PdfLoader.loadDocument(
        currentDocument.name,
        newBuffer.slice(0),
        currentDocument.filePath
      );
      setDocument(model, pdfDoc);

      // Add to Undo/Redo
      historyManager.push(
        new ReplaceTextCommand(
          clonedOldBuffer,
          newBuffer.slice(0),
          currentDocument.name,
          currentDocument.filePath,
          1
        )
      );

      addToast(`1 eşleşme değiştirildi. (Geri almak için Ctrl+Z)`, 'success');

      // Refresh matches
      const updatedMatches = await PdfReplaceEngine.findMatches(pdfDoc, findText, {
        matchCase,
        wholeWord,
        scope,
        currentPageIndex: currentDocument.activePageIndex,
      });
      setMatches(updatedMatches);
      if (updatedMatches.length > 0) {
        const nextIdx = Math.min(currentMatchIdx, updatedMatches.length - 1);
        setCurrentMatchIdx(nextIdx);
        setActivePageIndex(updatedMatches[nextIdx].pageIndex);
      } else {
        setCurrentMatchIdx(-1);
      }
    } catch (err: any) {
      addToast(err.message || 'Değiştirme sırasında hata oluştu', 'error');
    } finally {
      setIsReplacing(false);
    }
  };

  // Replace all matches
  const handleReplaceAll = async () => {
    if (matches.length === 0 || !currentDocument) return;
    setIsReplacing(true);
    const count = matches.length;
    try {
      const oldBuffer = binaryStore.get(currentDocument.id);
      if (!oldBuffer) throw new Error('Döküman verisi bulunamadı');

      const clonedOldBuffer = oldBuffer.slice(0);
      const newBuffer = await PdfReplaceEngine.applyReplacements(
        currentDocument.id,
        matches,
        replaceText
      );

      binaryStore.set(currentDocument.id, newBuffer.slice(0));
      const { model, pdfDoc } = await PdfLoader.loadDocument(
        currentDocument.name,
        newBuffer.slice(0),
        currentDocument.filePath
      );
      setDocument(model, pdfDoc);

      // Add to history
      historyManager.push(
        new ReplaceTextCommand(
          clonedOldBuffer,
          newBuffer.slice(0),
          currentDocument.name,
          currentDocument.filePath,
          count
        )
      );

      addToast(`${count} adet eşleşme başarıyla değiştirildi! (Geri almak için Ctrl+Z)`, 'success');
      setMatches([]);
      setCurrentMatchIdx(-1);
      setFindReplaceModalOpen(false);
    } catch (err: any) {
      addToast(err.message || 'Toplu değiştirme sırasında hata oluştu', 'error');
    } finally {
      setIsReplacing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 dark:bg-sky-500/20 flex items-center justify-center text-sky-600 dark:text-sky-400">
              <Replace className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-100">
                PDF İçi Bul ve Değiştir
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Belge içindeki metinleri arayıp anında yenisiyle değiştirin
              </p>
            </div>
          </div>
          <button
            onClick={() => setFindReplaceModalOpen(false)}
            className="w-7 h-7 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4">
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

          {/* Replace input */}
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

          {/* Search Options Checkboxes */}
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
          <div className="pt-1 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Arama Kapsamı:</span>
            <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setScope('all')}
                className={`px-3 py-1 rounded-md transition-colors ${
                  scope === 'all'
                    ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 font-semibold shadow-xs'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                Tüm Belge
              </button>
              <button
                type="button"
                onClick={() => setScope('current')}
                className={`px-3 py-1 rounded-md transition-colors ${
                  scope === 'current'
                    ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 font-semibold shadow-xs'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                Bu Sayfa ({currentDocument ? currentDocument.activePageIndex + 1 : 1})
              </button>
            </div>
          </div>

          {/* Match Status Bar */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2">
              {findText.trim() === '' ? (
                <span className="text-xs text-slate-400">Aramak için bir kelime yazın</span>
              ) : matches.length > 0 ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    <span className="text-sky-600 dark:text-sky-400 font-bold">{currentMatchIdx + 1}</span> / {matches.length} eşleşme (Sayfa {currentMatch ? currentMatch.pageIndex + 1 : '-'})
                  </span>
                </>
              ) : !isSearching ? (
                <>
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-xs text-amber-600 dark:text-amber-400">Eşleşme bulunamadı</span>
                </>
              ) : null}
            </div>

            {matches.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={goToPrevMatch}
                  title="Önceki eşleşme"
                  className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={goToNextMatch}
                  title="Sonraki eşleşme"
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
            onClick={() => setFindReplaceModalOpen(false)}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            Kapat
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={matches.length === 0 || isReplacing}
              onClick={handleReplaceCurrent}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isReplacing ? 'Değiştiriliyor...' : 'Değiştir'}
            </button>
            <button
              type="button"
              disabled={matches.length === 0 || isReplacing}
              onClick={handleReplaceAll}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {isReplacing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  İşleniyor...
                </>
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
