import React, { useState, useEffect } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { PdfTextExtractor, ExtractedDocumentText } from '@/core/engine/pdf-text-extractor';
import {
  X,
  FileText,
  Copy,
  Download,
  Check,
  Search,
  Loader2,
  AlertCircle,
  FileCode,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const ExtractTextModal: React.FC = () => {
  const { isExtractTextModalOpen, setExtractTextModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === 'dark';

  const [isLoading, setIsLoading] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedDocumentText | null>(null);
  const [selectedPageNum, setSelectedPageNum] = useState<number | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    if (!isExtractTextModalOpen || !pdfDocProxy) return;

    let isMounted = true;

    async function loadText() {
      setIsLoading(true);
      setExtractedData(null);
      try {
        const result = await PdfTextExtractor.extractText(pdfDocProxy!, (cur, tot) => {
          if (isMounted) setProgress({ current: cur, total: tot });
        });
        if (isMounted) {
          setExtractedData(result);
        }
      } catch (err) {
        console.error('Text extraction failed:', err);
        addToast('Metin çıkarılırken bir hata oluştu.', 'error');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadText();
    return () => {
      isMounted = false;
    };
  }, [isExtractTextModalOpen, pdfDocProxy]);

  if (!isExtractTextModalOpen || !currentDocument) return null;

  const currentDisplayContent = () => {
    if (!extractedData) return '';
    if (selectedPageNum === 'all') return extractedData.fullText;
    const pageItem = extractedData.pages.find((p) => p.pageNumber === selectedPageNum);
    return pageItem ? pageItem.text : '';
  };

  const displayText = currentDisplayContent();

  const handleCopy = async () => {
    if (!displayText) return;
    const ok = await PdfTextExtractor.copyToClipboard(displayText);
    if (ok) {
      setCopied(true);
      addToast('Metin panoya kopyalandı!', 'success');
      setTimeout(() => setCopied(false), 2000);
    } else {
      addToast('Panoya kopyalama başarısız oldu.', 'error');
    }
  };

  const handleDownloadTxt = () => {
    if (!displayText) return;
    const filename =
      selectedPageNum === 'all'
        ? currentDocument.name
        : `${currentDocument.name}_sayfa_${selectedPageNum}`;
    PdfTextExtractor.downloadAsTxt(filename, displayText);
    addToast('TXT dosyası indirildi.', 'success');
  };

  const handleDownloadJson = () => {
    if (!extractedData) return;
    PdfTextExtractor.downloadAsJson(currentDocument.name, extractedData);
    addToast('Yapılandırılmış JSON dosyası indirildi.', 'success');
  };

  const isLikelyScanned =
    extractedData && extractedData.totalWords === 0 && extractedData.totalChars === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className={cn(
          'w-full max-w-4xl h-[85vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden transition-colors',
          isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        )}
      >
        {/* Header */}
        <div
          className={cn(
            'px-6 py-4 border-b flex items-center justify-between shrink-0',
            isDark ? 'border-slate-800 bg-slate-900/80' : 'border-slate-100 bg-slate-50'
          )}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 text-sky-500 flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">Metin Çıkarma & Dışa Aktarma</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                PDF içerisindeki metinleri ayrıştırın, panoya kopyalayın veya TXT/JSON formatında indirin.
              </p>
            </div>
          </div>

          <button
            onClick={() => setExtractTextModalOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats Banner */}
        {extractedData && (
          <div
            className={cn(
              'px-6 py-2.5 border-b flex items-center justify-between gap-4 text-xs shrink-0',
              isDark ? 'bg-slate-800/40 border-slate-800' : 'bg-slate-100/60 border-slate-200'
            )}
          >
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-1.5 font-medium">
                <BookOpen className="w-4 h-4 text-sky-500" />
                <span>Sayfa: <strong>{extractedData.pages.length}</strong></span>
              </div>
              <div className="flex items-center gap-1.5 font-medium">
                <FileText className="w-4 h-4 text-emerald-500" />
                <span>Kelime: <strong>{extractedData.totalWords.toLocaleString()}</strong></span>
              </div>
              <div className="flex items-center gap-1.5 font-medium">
                <FileCode className="w-4 h-4 text-purple-500" />
                <span>Karakter: <strong>{extractedData.totalChars.toLocaleString()}</strong></span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                disabled={!displayText}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs transition-all shadow-xs disabled:opacity-50"
                title="Görüntülenen Metni Panoya Kopyala"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Kopyalandı!' : 'Panoya Kopyala'}</span>
              </button>

              <button
                onClick={handleDownloadTxt}
                disabled={!displayText}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs border transition-all disabled:opacity-50',
                  isDark
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                )}
                title="TXT Dosyası Olarak İndir"
              >
                <Download className="w-3.5 h-3.5" />
                <span>TXT İndir</span>
              </button>

              <button
                onClick={handleDownloadJson}
                disabled={!extractedData}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs border transition-all disabled:opacity-50',
                  isDark
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                )}
                title="Yapılandırılmış JSON Olarak İndir"
              >
                <FileCode className="w-3.5 h-3.5 text-purple-400" />
                <span>JSON İndir</span>
              </button>
            </div>
          </div>
        )}

        {/* Filter and Search Bar */}
        {extractedData && (
          <div className="px-6 py-2.5 border-b flex items-center justify-between gap-4 shrink-0">
            {/* Page Selector */}
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-slate-500">Sayfa Seç:</span>
              <select
                value={selectedPageNum}
                onChange={(e) =>
                  setSelectedPageNum(e.target.value === 'all' ? 'all' : Number(e.target.value))
                }
                className={cn(
                  'px-2.5 py-1 rounded-lg border text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-500',
                  isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'
                )}
              >
                <option value="all">Tüm Sayfalar ({extractedData.pages.length})</option>
                {extractedData.pages.map((p) => (
                  <option key={p.pageNumber} value={p.pageNumber}>
                    Sayfa {p.pageNumber} ({p.wordCount} kelime)
                  </option>
                ))}
              </select>
            </div>

            {/* Quick Filter */}
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Metin içinde ara..."
                className={cn(
                  'w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-sky-500',
                  isDark ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-900'
                )}
              />
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 p-6 overflow-y-auto font-mono text-xs leading-relaxed">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
              <p className="font-sans text-sm">
                Metinler ayrıştırılıyor ({progress.current} / {progress.total} sayfa)...
              </p>
            </div>
          ) : isLikelyScanned ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 max-w-md mx-auto text-center font-sans">
              <div className="w-12 h-12 rounded-full bg-amber-500/15 text-amber-500 flex items-center justify-center">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100">
                Gömülü Vektör Metin Bulunamadı
              </h3>
              <p className="text-xs text-slate-500 leading-normal">
                Bu döküman taranmış bir resim veya faks görüntüsü olabilir. Dökümanda seçilebilir dijital metin katmanı yer almıyor.
              </p>
            </div>
          ) : (
            <div
              className={cn(
                'p-4 rounded-xl border min-h-full whitespace-pre-wrap select-text font-mono transition-colors',
                isDark ? 'bg-slate-950/60 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
              )}
            >
              {displayText}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
