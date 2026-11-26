import React, { useState, useEffect } from 'react';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { useUIStore } from '@/store/ui-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { historyManager, DocumentStateSnapshotCommand } from '@/core/history/command-manager';
import { SynthesisOptions } from '@/core/engine/page-layout-engine';
import {
  X,
  Grid2X2,
  Columns,
  Layers,
  Sparkles,
  LayoutGrid,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import {
  readAuthorizedDocBuffer,
  syncReplacedActiveDocument,
  useModalEscape,
} from './modal-utils';

function getGridDimensions(
  layout: SynthesisOptions['layout'],
  orientation: SynthesisOptions['orientation'],
  gridCols: number,
  gridRows: number
): { cols: number; rows: number } {
  if (layout === 'grid') {
    return {
      cols: Math.max(1, Math.min(6, gridCols || 2)),
      rows: Math.max(1, Math.min(6, gridRows || 2)),
    };
  }
  if (layout === '2-up') {
    return orientation === 'landscape' ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
  }
  if (layout === '4-up') {
    return { cols: 2, rows: 2 };
  }
  if (layout === '6-up') {
    return orientation === 'landscape' ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
  }
  return orientation === 'landscape' ? { cols: 4, rows: 2 } : { cols: 2, rows: 4 };
}

function safeHeaderFallback(text: string): string {
  return text
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ı/g, 'i').replace(/İ/g, 'I');
}

export const PageLayoutSynthesisModal: React.FC = () => {
  const { currentDocument, pdfDocProxy, setDocument, addRecentDocument } = useDocumentStore();
  const { addTab } = useTabStore();
  const { isPageLayoutModalOpen, setPageLayoutModalOpen, addToast } = useUIStore();

  const [layout, setLayout] = useState<SynthesisOptions['layout']>('4-up');
  const [gridCols, setGridCols] = useState(3);
  const [gridRows, setGridRows] = useState(3);
  const [pageSize, setPageSize] = useState<SynthesisOptions['pageSize']>('A4');
  const [orientation, setOrientation] = useState<SynthesisOptions['orientation']>('portrait');
  const [margin, setMargin] = useState(20);
  const [spacing, setSpacing] = useState(15);
  const [drawBorder, setDrawBorder] = useState(true);
  const [headerText, setHeaderText] = useState('');
  const [sourceScope, setSourceScope] = useState<'selected' | 'all'>('selected');
  const [destination, setDestination] = useState<'new-tab' | 'replace'>('new-tab');
  const [isProcessing, setIsProcessing] = useState(false);

  const selectedPages =
    currentDocument?.pages.filter((p) => currentDocument.selectedPageIds.includes(p.id)) || [];

  useEffect(() => {
    if (isPageLayoutModalOpen) {
      setSourceScope(selectedPages.length > 0 ? 'selected' : 'all');
    }
  }, [isPageLayoutModalOpen, selectedPages.length]);

  useModalEscape(isPageLayoutModalOpen, () => setPageLayoutModalOpen(false), isProcessing);

  if (!isPageLayoutModalOpen || !currentDocument) return null;

  const pagesToUse =
    sourceScope === 'selected' && selectedPages.length > 0
      ? selectedPages
      : currentDocument.pages;

  const { cols, rows } = getGridDimensions(layout, orientation, gridCols, gridRows);
  const slotsPerPage = cols * rows;
  const totalOutputPages = Math.max(1, Math.ceil(pagesToUse.length / slotsPerPage));

  const handleSynthesize = async () => {
    if (pagesToUse.length === 0) {
      addToast('Birleştirilecek sayfa bulunamadı.', 'warning');
      return;
    }

    try {
      setIsProcessing(true);
      addToast('Sayfalar N-up mizanpaj düzeninde birleştiriliyor...', 'info');

      const outDoc = await PDFDocument.create();
      outDoc.registerFontkit(fontkit);

      let headerFont = await outDoc.embedFont(StandardFonts.Helvetica);
      let isCustomFont = false;
      if (headerText.trim()) {
        for (const p of ['./fonts/font-regular.ttf', '/fonts/font-regular.ttf']) {
          try {
            const resp = await fetch(p);
            if (resp.ok) {
              headerFont = await outDoc.embedFont(await resp.arrayBuffer(), { subset: true });
              isCustomFont = true;
              break;
            }
          } catch {
            // try next
          }
        }
      }

      let pageWidth = 595.28;
      let pageHeight = 841.89;
      if (pageSize === 'A3') {
        pageWidth = 841.89;
        pageHeight = 1190.55;
      } else if (pageSize === 'Letter') {
        pageWidth = 612;
        pageHeight = 792;
      }
      if (orientation === 'landscape') {
        const tmp = pageWidth;
        pageWidth = pageHeight;
        pageHeight = tmp;
      }

      const safeMargin = Math.max(0, margin);
      const safeSpacing = Math.max(0, spacing);
      const headerReserved = headerText.trim() ? 22 : 0;

      const availableWidth = Math.max(20, pageWidth - safeMargin * 2 - (cols - 1) * safeSpacing);
      const availableHeight = Math.max(
        20,
        pageHeight - safeMargin * 2 - headerReserved - (rows - 1) * safeSpacing
      );

      const cellWidth = availableWidth / cols;
      const cellHeight = availableHeight / rows;

      const rawBuffer = await readAuthorizedDocBuffer(currentDocument.id, currentDocument.filePath);
      const srcDoc = await PDFDocument.load(rawBuffer.slice(0), { ignoreEncryption: true });

      for (let outIdx = 0; outIdx < totalOutputPages; outIdx++) {
        const outPage = outDoc.addPage([pageWidth, pageHeight]);

        if (headerText.trim()) {
          const textToDraw = isCustomFont
            ? headerText.trim()
            : safeHeaderFallback(headerText.trim());
          outPage.drawText(textToDraw, {
            x: Math.max(12, safeMargin),
            y: pageHeight - Math.max(16, safeMargin + 10),
            size: 10,
            font: headerFont,
            color: rgb(0.3, 0.35, 0.45),
          });
        }

        const chunk = pagesToUse.slice(outIdx * slotsPerPage, (outIdx + 1) * slotsPerPage);
        for (let i = 0; i < chunk.length; i++) {
          const slot = chunk[i];
          const [embeddedPage] = await outDoc.embedPdf(srcDoc, [slot.sourcePageIndex]);

          const col = i % cols;
          const row = Math.floor(i / cols);
          const cellX = safeMargin + col * (cellWidth + safeSpacing);
          const cellY =
            pageHeight -
            safeMargin -
            headerReserved -
            (row + 1) * cellHeight -
            row * safeSpacing;

          const rot = ((slot.rotation || 0) % 360 + 360) % 360;
          const isQuarterTurn = rot === 90 || rot === 270;
          const srcW = isQuarterTurn ? embeddedPage.height : embeddedPage.width;
          const srcH = isQuarterTurn ? embeddedPage.width : embeddedPage.height;

          const scale = Math.min(cellWidth / srcW, cellHeight / srcH);
          const drawW = embeddedPage.width * scale;
          const drawH = embeddedPage.height * scale;
          const fittedW = srcW * scale;
          const fittedH = srcH * scale;

          const boxLeft = cellX + (cellWidth - fittedW) / 2;
          const boxBottom = cellY + (cellHeight - fittedH) / 2;

          let drawX = boxLeft;
          let drawY = boxBottom;
          if (rot === 90) {
            drawX = boxLeft + fittedW;
            drawY = boxBottom;
          } else if (rot === 180) {
            drawX = boxLeft + fittedW;
            drawY = boxBottom + fittedH;
          } else if (rot === 270) {
            drawX = boxLeft;
            drawY = boxBottom + fittedH;
          }

          if (drawBorder) {
            outPage.drawRectangle({
              x: cellX,
              y: cellY,
              width: cellWidth,
              height: cellHeight,
              borderColor: rgb(0.8, 0.85, 0.9),
              borderWidth: 0.75,
            });
          }

          outPage.drawPage(embeddedPage, {
            x: drawX,
            y: drawY,
            width: drawW,
            height: drawH,
            rotate: rot !== 0 ? degrees(-rot) : undefined,
          });
        }
      }

      const pdfBytes = await outDoc.save();
      const outBuffer = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength
      ) as ArrayBuffer;
      const outName = `${currentDocument.name.replace(/\.pdf$/i, '')}_mizanpaj_${cols}x${rows}.pdf`;

      const result = await PdfLoader.loadDocument(outName, outBuffer);

      if (destination === 'replace') {
        const prevDoc = currentDocument;
        const prevProxy = pdfDocProxy;
        const synced = syncReplacedActiveDocument(result.model, result.pdfDoc, prevDoc, {
          isModified: true,
        });
        historyManager.push(
          new DocumentStateSnapshotCommand(
            `${pagesToUse.length} sayfa ${cols}x${rows} düzene dönüştürüldü`,
            prevDoc,
            prevProxy,
            synced,
            result.pdfDoc
          )
        );
      } else {
        setDocument(result.model, result.pdfDoc);
        addTab(result.model, result.pdfDoc);
        addRecentDocument({
          id: result.model.id,
          name: result.model.name,
          fileSize: result.model.fileSize,
          pageCount: result.model.totalPages,
          lastOpened: Date.now(),
        });
      }

      addToast(
        `${pagesToUse.length} kaynak sayfa ${totalOutputPages} çıkış sayfasına (${cols}×${rows}) yerleştirildi!`,
        'success'
      );
      setPageLayoutModalOpen(false);
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Birleştirme sırasında hata oluştu.';
      addToast(msg, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={() => !isProcessing && setPageLayoutModalOpen(false)}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Grid2X2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Sayfa Düzeni Sentezi (N-up & Izgara)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {pagesToUse.length} kaynak sayfa → {totalOutputPages} adet {pageSize} çıkış sayfası ({cols}×{rows})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !isProcessing && setPageLayoutModalOpen(false)}
            disabled={isProcessing}
            aria-label="Kapat"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-sm overflow-y-auto">
          {/* Source Scope */}
          <div className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Kaynak Sayfalar:</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={selectedPages.length === 0}
                onClick={() => setSourceScope('selected')}
                className={cn(
                  'px-2.5 py-1 rounded-lg font-semibold transition-colors disabled:opacity-40',
                  sourceScope === 'selected'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                )}
              >
                Seçili ({selectedPages.length})
              </button>
              <button
                type="button"
                onClick={() => setSourceScope('all')}
                className={cn(
                  'px-2.5 py-1 rounded-lg font-semibold transition-colors',
                  sourceScope === 'all'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                )}
              >
                Tümü ({currentDocument.pages.length})
              </button>
            </div>
          </div>

          {/* Layout Presets */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-2">
              Sayfa Dizilim Düzeni (N-up Layout)
            </label>
            <div className="grid grid-cols-5 gap-2">
              {[
                { id: '2-up', label: '2-up', icon: Columns },
                { id: '4-up', label: '4-up', icon: Grid2X2 },
                { id: '6-up', label: '6-up', icon: Layers },
                { id: '8-up', label: '8-up', icon: Sparkles },
                { id: 'grid', label: 'Özel Grid', icon: LayoutGrid },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLayout(item.id as SynthesisOptions['layout'])}
                    className={cn(
                      'p-2.5 rounded-xl border text-center transition-all flex flex-col items-center gap-1',
                      layout === item.id
                        ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-semibold'
                        : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-[11px]">{item.label}</span>
                  </button>
                );
              })}
            </div>

            {layout === 'grid' && (
              <div className="grid grid-cols-2 gap-3 mt-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Sütun Sayısı (1–6)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={gridCols}
                    onChange={(e) => setGridCols(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
                    className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-center font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Satır Sayısı (1–6)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={gridRows}
                    onChange={(e) => setGridRows(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
                    className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-center font-bold"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Orientation & Page Size */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                Kağıt Boyutu
              </label>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value as SynthesisOptions['pageSize'])}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
              >
                <option value="A4">A4 (Standart)</option>
                <option value="A3">A3 (Büyük Boy)</option>
                <option value="Letter">US Letter</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                Yönlendirme
              </label>
              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as SynthesisOptions['orientation'])}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
              >
                <option value="portrait">Dikey (Portrait)</option>
                <option value="landscape">Yatay (Landscape)</option>
              </select>
            </div>
          </div>

          {/* Header Text */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              Üst Başlık (Opsiyonel)
            </label>
            <input
              type="text"
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
              placeholder="Örn: Toplantı Sunumu — Baskı Mizanpajı"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Margins & Spacing */}
          <div className="grid grid-cols-2 gap-4 pt-1">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                Kenar Boşluğu: {margin} pt
              </label>
              <input
                type="range"
                min="0"
                max="50"
                value={margin}
                onChange={(e) => setMargin(parseInt(e.target.value, 10))}
                className="w-full accent-sky-500 h-1 bg-slate-300 dark:bg-slate-700 rounded-lg cursor-pointer"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                Sayfalar Arası Boşluk: {spacing} pt
              </label>
              <input
                type="range"
                min="0"
                max="40"
                value={spacing}
                onChange={(e) => setSpacing(parseInt(e.target.value, 10))}
                className="w-full accent-sky-500 h-1 bg-slate-300 dark:bg-slate-700 rounded-lg cursor-pointer"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={drawBorder}
                onChange={(e) => setDrawBorder(e.target.checked)}
                className="accent-sky-500 rounded"
              />
              <span>Hücrelerin etrafına sınır çizgisi çiz</span>
            </label>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDestination('new-tab')}
                className={cn(
                  'px-2.5 py-1 rounded-lg font-semibold border',
                  destination === 'new-tab'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500'
                )}
              >
                Yeni Sekmede Aç
              </button>
              <button
                type="button"
                onClick={() => setDestination('replace')}
                className={cn(
                  'px-2.5 py-1 rounded-lg font-semibold border',
                  destination === 'replace'
                    ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500'
                )}
              >
                Mevcut Belgeyi Değiştir
              </button>
            </div>
          </div>

          {destination === 'replace' && (
            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                Mevcut sekme içeriği yeni N-up düzeniyle değiştirilecektir (Ctrl+Z ile geri alınabilir).
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setPageLayoutModalOpen(false)}
            disabled={isProcessing}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-40"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleSynthesize}
            disabled={isProcessing || pagesToUse.length === 0}
            className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 shadow-md shadow-purple-600/20"
          >
            <Sparkles className="w-4 h-4" />
            {isProcessing
              ? 'Oluşturuluyor...'
              : `${totalOutputPages} Sayfa Olarak Oluştur`}
          </button>
        </div>
      </div>
    </div>
  );
};
