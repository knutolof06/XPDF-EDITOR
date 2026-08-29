import React, { useEffect, useRef } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { PdfSearchEngine } from '@/core/pdf/pdf-search';
import { Search, ChevronUp, ChevronDown, X, CaseSensitive } from 'lucide-react';
import { cn } from '@/utils/cn';

export const SearchOverlay: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { pdfDocProxy, setActivePageIndex } = useDocumentStore();
  const {
    searchState,
    closeSearch,
    setSearchQuery,
    setMatchCase,
    setSearchResults,
    nextSearchResult,
    prevSearchResult,
    setSearching,
  } = useViewerStore();

  useEffect(() => {
    if (searchState.isOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [searchState.isOpen]);

  // Execute search when query or matchCase changes
  useEffect(() => {
    let isCancelled = false;

    async function performSearch() {
      if (!pdfDocProxy || !searchState.query || searchState.query.trim().length === 0) {
        setSearchResults([]);
        return;
      }

      setSearching(true);
      try {
        const results = await PdfSearchEngine.search(
          pdfDocProxy,
          searchState.query,
          searchState.matchCase
        );
        if (!isCancelled) {
          setSearchResults(results);
          if (results.length > 0) {
            setActivePageIndex(results[0].pageIndex);
          }
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        if (!isCancelled) setSearching(false);
      }
    }

    const timer = setTimeout(performSearch, 200);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [pdfDocProxy, searchState.query, searchState.matchCase]);

  // Jump to page on next / prev result
  const handleNext = () => {
    nextSearchResult();
    const curr = searchState.results[searchState.currentIndex + 1] || searchState.results[0];
    if (curr) {
      setActivePageIndex(curr.pageIndex);
    }
  };

  const handlePrev = () => {
    prevSearchResult();
    const curr = searchState.results[searchState.currentIndex - 1] || searchState.results[searchState.results.length - 1];
    if (curr) {
      setActivePageIndex(curr.pageIndex);
    }
  };

  if (!searchState.isOpen) return null;

  const totalResults = searchState.results.length;
  const currentResultIndex = totalResults > 0 ? searchState.currentIndex + 1 : 0;

  return (
    <div className="absolute top-4 right-8 z-40 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl p-2 flex items-center gap-2 backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-200 text-slate-800 dark:text-slate-100">
      <div className="flex items-center gap-2 px-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
        <Search className="w-4 h-4 text-sky-500 dark:text-sky-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={searchState.query}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="PDF içinde ara..."
          className="bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 py-1.5 focus:outline-none w-48 sm:w-64"
        />
        {/* Match case button */}
        <button
          onClick={() => setMatchCase(!searchState.matchCase)}
          className={cn(
            'p-1 rounded-md text-xs transition-colors',
            searchState.matchCase ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-bold' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          )}
          title="Büyük/Küçük Harf Duyarlı"
        >
          <CaseSensitive className="w-4 h-4" />
        </button>
      </div>

      {/* Result counter */}
      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 min-w-[70px] text-center">
        {searchState.isSearching ? (
          <span className="text-slate-400">Aranıyor...</span>
        ) : searchState.query ? (
          totalResults > 0 ? (
            `${currentResultIndex} / ${totalResults}`
          ) : (
            <span className="text-rose-500 dark:text-rose-400">Sonuç yok</span>
          )
        ) : null}
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center gap-1">
        <button
          onClick={handlePrev}
          disabled={totalResults === 0}
          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 transition-colors"
          title="Önceki Sonuç"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          onClick={handleNext}
          disabled={totalResults === 0}
          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 transition-colors"
          title="Sonraki Sonuç"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
        <button
          onClick={closeSearch}
          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors ml-1"
          title="Kapat (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
