import React from 'react';
import { useTabStore } from '@/store/tab-store';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { FileText, X, Plus } from 'lucide-react';
import { cn } from '@/utils/cn';

export const TabBar: React.FC = () => {
  const { tabs, activeTabId, setActiveTab, closeTab, addTab } = useTabStore();
  const { setDocument } = useDocumentStore();
  const { addToast } = useUIStore();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  if (tabs.length === 0) return null;

  const handleTabClick = (tabId: string) => {
    const targetTab = tabs.find((t) => t.id === tabId);
    if (targetTab) {
      setActiveTab(tabId);
      setDocument(targetTab.model, targetTab.pdfDocProxy);
    }
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
    const remaining = tabs.filter((t) => t.id !== tabId);
    if (remaining.length > 0) {
      const nextActive = remaining[0];
      setDocument(nextActive.model, nextActive.pdfDocProxy);
    }
  };

  const handleOpenNewPdfTab = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      addToast(`"${file.name}" yeni sekmede açılıyor...`, 'info');
      const arrayBuffer = await file.arrayBuffer();
      const { model, pdfDoc } = await PdfLoader.loadDocument(file.name, arrayBuffer);
      setDocument(model, pdfDoc);
      addTab(model, pdfDoc);
      addToast(`"${file.name}" açıldı.`, 'success');
    } catch (err: any) {
      console.error(err);
      addToast('Yeni sekme açılamadı.', 'error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="h-9 bg-slate-200 dark:bg-slate-950 border-b border-slate-300 dark:border-slate-800/80 px-2 flex items-center gap-1 select-none overflow-x-auto z-25 shrink-0 transition-colors">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleOpenNewPdfTab}
        accept="application/pdf"
        className="hidden"
      />

      {/* List of Document Tabs */}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            className={cn(
              'group h-8 px-3 rounded-t-lg flex items-center gap-2 text-xs font-medium cursor-pointer transition-all border-t border-x shrink-0 max-w-[200px]',
              isActive
                ? 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-800 text-sky-600 dark:text-sky-400 shadow-sm font-semibold'
                : 'bg-slate-300/60 dark:bg-slate-900/40 border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-200'
            )}
          >
            <FileText className="w-3.5 h-3.5 shrink-0 text-sky-500 dark:text-sky-400" />
            <span className="truncate flex-1">{tab.name}</span>

            {/* Close Tab Button */}
            <button
              onClick={(e) => handleCloseTab(e, tab.id)}
              className="opacity-60 hover:opacity-100 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              title="Sekmeyi Kapat"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}

      {/* Add New Tab Button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className="p-1 rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-300/80 dark:hover:bg-slate-800 transition-colors ml-1"
        title="Yeni PDF Sekmesi Aç"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
};
