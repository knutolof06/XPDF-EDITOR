import React, { useState } from 'react';
import { useTabStore } from '@/store/tab-store';
import { PageView } from '../viewer/PageView';
import { X, Columns, Lock, Unlock } from 'lucide-react';
import { cn } from '@/utils/cn';

export const CompareModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { tabs } = useTabStore();
  const [docAIndex, setDocAIndex] = useState(0);
  const [docBIndex, setDocBIndex] = useState(tabs.length > 1 ? 1 : 0);
  const [pageA, setPageA] = useState(0);
  const [pageB, setPageB] = useState(0);
  const [syncScroll, setSyncScroll] = useState(true);

  if (!isOpen || tabs.length === 0) return null;

  const docA = tabs[docAIndex]?.model || tabs[0]?.model;
  const docB = tabs[docBIndex]?.model || tabs[0]?.model;

  const handleNextPageA = () => {
    if (docA && pageA < docA.pages.length - 1) {
      setPageA(pageA + 1);
      if (syncScroll && docB && pageB < docB.pages.length - 1) setPageB(pageB + 1);
    }
  };

  const handlePrevPageA = () => {
    if (pageA > 0) {
      setPageA(pageA - 1);
      if (syncScroll && pageB > 0) setPageB(pageB - 1);
    }
  };

  const handleNextPageB = () => {
    if (docB && pageB < docB.pages.length - 1) {
      setPageB(pageB + 1);
      if (syncScroll && docA && pageA < docA.pages.length - 1) setPageA(pageA + 1);
    }
  };

  const handlePrevPageB = () => {
    if (pageB > 0) {
      setPageB(pageB - 1);
      if (syncScroll && pageA > 0) setPageA(pageA - 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 dark:bg-slate-950/95 backdrop-blur-md flex flex-col animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between text-slate-800 dark:text-slate-100 select-none shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
            <Columns className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">PDF Karşılaştırma & Split View</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">İki belgeyi yan yana inceleyin</p>
          </div>
        </div>

        {/* Sync Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSyncScroll(!syncScroll)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
              syncScroll
                ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-400'
                : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
            )}
          >
            {syncScroll ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            <span>Senkronize Kaydırma: {syncScroll ? 'Açık' : 'Kapalı'}</span>
          </button>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Split Screens */}
      <div className="flex-1 flex overflow-hidden divide-x divide-slate-200 dark:divide-slate-800">
        {/* Left Document View */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-100/70 dark:bg-slate-950/60 p-4">
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-200 dark:border-slate-800 text-xs">
            <select
              value={docAIndex}
              onChange={(e) => {
                setDocAIndex(parseInt(e.target.value, 10));
                setPageA(0);
              }}
              className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 text-slate-800 dark:text-slate-200 font-semibold shadow-sm focus:outline-none"
            >
              {tabs.map((t, idx) => (
                <option key={t.id} value={idx}>
                  Sol: {t.name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevPageA}
                disabled={pageA <= 0}
                className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-transparent rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-300"
              >
                Önceki
              </button>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Sayfa {pageA + 1} / {docA?.totalPages || 1}
              </span>
              <button
                onClick={handleNextPageA}
                disabled={pageA >= (docA?.totalPages || 1) - 1}
                className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-transparent rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-300"
              >
                Sonraki
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto flex items-center justify-center">
            {docA?.pages[pageA] && (
              <PageView page={docA.pages[pageA]} index={pageA} scale={0.75} />
            )}
          </div>
        </div>

        {/* Right Document View */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-100/70 dark:bg-slate-950/60 p-4">
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-200 dark:border-slate-800 text-xs">
            <select
              value={docBIndex}
              onChange={(e) => {
                setDocBIndex(parseInt(e.target.value, 10));
                setPageB(0);
              }}
              className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 text-slate-800 dark:text-slate-200 font-semibold shadow-sm focus:outline-none"
            >
              {tabs.map((t, idx) => (
                <option key={t.id} value={idx}>
                  Sağ: {t.name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevPageB}
                disabled={pageB <= 0}
                className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-transparent rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-300"
              >
                Önceki
              </button>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Sayfa {pageB + 1} / {docB?.totalPages || 1}
              </span>
              <button
                onClick={handleNextPageB}
                disabled={pageB >= (docB?.totalPages || 1) - 1}
                className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-transparent rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-300"
              >
                Sonraki
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto flex items-center justify-center">
            {docB?.pages[pageB] && (
              <PageView page={docB.pages[pageB]} index={pageB} scale={0.75} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
