import React, { useState, useEffect, useMemo } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
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
import {
  saveBinaryOrBlobFile,
  useModalEscape,
  useResolvedDarkMode,
} from './modal-utils';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const ExtractTextModal: React.FC = () => {
  const { isExtractTextModalOpen, setExtractTextModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const isDark = useResolvedDarkMode();

  const [isLoading, setIsLoading] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedDocumentText | null>(null);
  const [selectedPageNum, setSelectedPageNum] = useState<number | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    if (!isExtractTextModalOpen) return;
    setSelectedPageNum('all');
    setSearchQuery('');
    setCopied(false);
  }, [isExtractTextModalOpen, currentDocument?.id]);

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
  }, [isExtractTextModalOpen, pdfDocProxy, addToast]);

  useModalEscape(isExtractTextModalOpen, () => setExtractTextModalOpen(false));

  const { displayText, matchCount } = useMemo(() => {
    if (!extractedData) return { displayText: '', matchCount: 0 };

    const rawBaseText =
      selectedPageNum === 'all'
        ? extractedData.fullText
        : extractedData.pages.find((p) => p.pageNumber === selectedPageNum)?.text || '';

    const q = searchQuery.trim();
    if (!q) {
      return { displayText: rawBaseText, matchCount: 0 };
    }

    const qLower = q.toLocaleLowerCase('tr-TR');
    const lines = rawBaseText.split('\n');
    const matchingLines = lines.filter(
      (line) =>
        line.toLocaleLowerCase('tr-TR').includes(qLower) ||
        (selectedPageNum === 'all' && line.startsWith('--- Sayfa '))
    );

    // Strip section headers that have no matching content beneath them
    const cleaned: string[] = [];
    for (let i = 0; i < matchingLines.length; i++) {
      const line = matchingLines[i];
      if (selectedPageNum === 'all' && line.startsWith('--- Sayfa ')) {
        const nextLine = matchingLines[i + 1];
        if (!nextLine || nextLine.startsWith('--- Sayfa ')) continue;
        if (cleaned.length > 0) cleaned.push('');
      }
      cleaned.push(line);
    }

    const filteredText = cleaned.join('\n').trim();
    const regex = new RegExp(escapeRegExp(q), 'gi');
    const count = (rawBaseText.match(regex) || []).length;

    return { displayText: filteredText, matchCount: count };
  }, [extractedData, selectedPageNum, searchQuery]);

  const highlightedSegments = useMemo(() => {
    const q = searchQuery.trim();
    if (!q || !displayText) return null;
    const regex = new RegExp(`(${escapeRegExp(q)})`, 'gi');
    return displayText.split(regex);
  }, [displayText, searchQuery]);

  if (!isExtractTextModalOpen || !currentDocument) return null;

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

  const handleDownloadTxt = async () => {
    if (!displayText) return;
    const baseName = currentDocument.name.replace(/\.[^/.]+$/, '');
    const defaultName =
      selectedPageNum === 'all'
        ? `${baseName}_metin.txt`
        : `${baseName}_sayfa_${selectedPageNum}_metin.txt`;

    try {
      const res = await saveBinaryOrBlobFile({
        data: displayText,
        defaultName,
        dialogTitle: 'Çıkarılan Metni TXT Olarak Kaydet',
        filters: [{ name: 'Metin Dosyası', extensions: ['txt'] }],
        mimeType: 'text/plain;charset=utf-8',
      });
      if (res.status === 'saved') {
        addToast('TXT dosyası kaydedildi.', 'success');
      }
    } catch {
      addToast('TXT dosyası kaydedilemedi.', 'error');
    }
  };

  const handleDownloadJson = async () => {
    if (!extractedData) return;
    const baseName = currentDocument.name.replace(/\.[^/.]+$/, '');
    try {
      const res = await saveBinaryOrBlobFile({
        data: JSON.stringify(extractedData, null, 2),
        defaultName: `${baseName}_metin_verisi.json`,
        dialogTitle: 'Yapılandırılmış JSON Olarak Kaydet',
        filters: [{ name: 'JSON Dosyası', extensions: ['json'] }],
        mimeType: 'application/json;charset=utf-8',
      });
      if (res.status === 'saved') {
        addToast('Yapılandırılmış JSON dosyası kaydedildi.', 'success');
      }
    } catch {
      addToast('JSON dosyası kaydedilemedi.', 'error');
    }
  };

  const isLikelyScanned =
    extractedData && extractedData.totalWords === 0 && extractedData.totalChars === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => setExtractTextModalOpen(false)}
    >
      <div
        className={cn(
          'w-full max-w-4xl h-[85vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden transition-colors',
          isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        )}
        onClick={(e) => e.stopPropagation()}
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
                PDF içerisindeki metinleri ayrıştırın, filtreleyin, kopyalayın veya TXT/JSON olarak kaydedin.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setExtractTextModalOpen(false)}
            aria-label="Kapat"
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

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                disabled={!displayText}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs transition-all shadow-xs disabled:opacity-50"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Kopyalandı!' : 'Panoya Kopyala'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadTxt}
                disabled={!displayText}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs border transition-all disabled:opacity-50',
                  isDark
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                )}
              >
                <Download className="w-3.5 h-3.5" />
                <span>TXT Kaydet</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadJson}
                disabled={!extractedData}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs border transition-all disabled:opacity-50',
                  isDark
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                )}
              >
                <FileCode className="w-3.5 h-3.5 text-purple-400" />
                <span>JSON Kaydet</span>
              </button>
            </div>
          </div>
        )}

        {/* Filter and Search Bar */}
        {extractedData && (
          <div
            className={cn(
              'px-6 py-2.5 border-b flex items-center justify-between gap-4 shrink-0',
              isDark ? 'border-slate-800' : 'border-slate-200'
            )}
          >
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

            <div className="flex items-center gap-2">
              {searchQuery.trim() && (
                <span className="text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                  {matchCount} eşleşme
                </span>
              )}
              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Metin içinde ara & filtrele..."
                  className={cn(
                    'w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-sky-500',
                    isDark ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-900'
                  )}
                />
              </div>
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
              {searchQuery.trim() && !displayText ? (
                <span className="font-sans text-slate-400">
                  &quot;{searchQuery.trim()}&quot; aramasıyla eşleşen satır bulunamadı.
                </span>
              ) : highlightedSegments ? (
                highlightedSegments.map((part, idx) =>
                  idx % 2 === 1 ? (
                    <mark
                      key={idx}
                      className="bg-amber-300 dark:bg-amber-500/50 text-slate-900 dark:text-white rounded px-0.5"
                    >
                      {part}
                    </mark>
                  ) : (
                    <React.Fragment key={idx}>{part}</React.Fragment>
                  )
                )
              ) : (
                displayText
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
