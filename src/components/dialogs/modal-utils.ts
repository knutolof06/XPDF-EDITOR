import { useEffect, useState } from 'react';
import type * as pdfjsLib from 'pdfjs-dist';
import { PdfDocumentModel } from '@/types/document';
import { ElectronFileFilter } from '@/types/electron';
import { useViewerStore } from '@/store/viewer-store';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { binaryStore } from '@/core/storage/binary-store';

/**
 * Resolves dark mode accurately even when theme === 'system'.
 */
export function resolveIsDark(theme: 'dark' | 'light' | 'system'): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  if (typeof document !== 'undefined') {
    if (document.documentElement.classList.contains('dark')) return true;
    if (document.documentElement.classList.contains('light')) return false;
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

/**
 * Reactive hook tracking resolved dark mode across 'dark' | 'light' | 'system'.
 */
export function useResolvedDarkMode(): boolean {
  const theme = useViewerStore((s) => s.theme);
  const [docHasDark, setDocHasDark] = useState<boolean>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const sync = () => {
      setDocHasDark(document.documentElement.classList.contains('dark'));
    };
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    let mediaQuery: MediaQueryList | null = null;
    const onMediaChange = () => sync();
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener?.('change', onMediaChange);
    }

    return () => {
      observer.disconnect();
      mediaQuery?.removeEventListener?.('change', onMediaChange);
    };
  }, [theme]);

  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return docHasDark || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true);
}

export interface UseModalEscapeOptions {
  disabled?: boolean;
  shouldIgnore?: (e: KeyboardEvent) => boolean;
  onInterceptEscape?: (e: KeyboardEvent) => boolean;
}

/**
 * Attaches a capture-phase Escape listener when modal is open.
 * Stops propagation cleanly so App.tsx doesn't double-handle or close nested parents.
 */
export function useModalEscape(
  isOpen: boolean,
  onClose: () => void,
  disabledOrOptions?: boolean | UseModalEscapeOptions
): void {
  const disabled =
    typeof disabledOrOptions === 'boolean'
      ? disabledOrOptions
      : Boolean(disabledOrOptions?.disabled);
  const shouldIgnore =
    typeof disabledOrOptions === 'boolean' ? undefined : disabledOrOptions?.shouldIgnore;
  const onInterceptEscape =
    typeof disabledOrOptions === 'boolean' ? undefined : disabledOrOptions?.onInterceptEscape;

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (shouldIgnore?.(e)) return;

      if (onInterceptEscape?.(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, disabled, shouldIgnore, onInterceptEscape]);
}

export interface PageRangeParseResult {
  pages: number[];
  isValid: boolean;
  error?: string;
}

/**
 * Strictly parses 1-based page selections such as "1-3, 5, 8-10".
 */
export function parsePageRange(input: string, totalPages: number): PageRangeParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { pages: [], isValid: false, error: 'Lütfen en az bir sayfa veya aralık girin.' };
  }
  if (totalPages <= 0) {
    return { pages: [], isValid: false, error: 'Dökümanda geçerli sayfa bulunamadı.' };
  }

  const tokens = trimmed.split(/[,;]+/).map((t) => t.trim());
  if (tokens.some((t) => t.length === 0)) {
    return { pages: [], isValid: false, error: 'Boş veya hatalı ayraç içeren sayfa aralığı.' };
  }

  const pageSet = new Set<number>();
  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (start < 1 || end > totalPages) {
        return {
          pages: [],
          isValid: false,
          error: `Sayfa aralığı 1-${totalPages} sınırları dışında: "${token}"`,
        };
      }
      if (start > end) {
        return {
          pages: [],
          isValid: false,
          error: `Başlangıç sayfası bitişten büyük olamaz: "${token}"`,
        };
      }
      for (let p = start; p <= end; p++) {
        pageSet.add(p);
      }
      continue;
    }

    if (/^\d+$/.test(token)) {
      const pageNum = parseInt(token, 10);
      if (pageNum < 1 || pageNum > totalPages) {
        return {
          pages: [],
          isValid: false,
          error: `Sayfa numarası 1-${totalPages} aralığında olmalıdır: "${token}"`,
        };
      }
      pageSet.add(pageNum);
      continue;
    }

    return {
      pages: [],
      isValid: false,
      error: `Geçersiz sayfa ifadesi: "${token}"`,
    };
  }

  const pages = Array.from(pageSet).sort((a, b) => a - b);
  return { pages, isValid: pages.length > 0 };
}

export interface SplitRangeItem {
  from: number;
  to: number;
}

export interface SplitRangeParseResult {
  ranges: SplitRangeItem[];
  isValid: boolean;
  error?: string;
}

/**
 * Strictly parses ordered split ranges such as "1-5, 6-10, 12".
 */
export function parseSplitRanges(input: string, totalPages: number): SplitRangeParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ranges: [], isValid: false, error: 'Lütfen en az bir sayfa aralığı girin.' };
  }
  if (totalPages <= 0) {
    return { ranges: [], isValid: false, error: 'Dökümanda geçerli sayfa bulunamadı.' };
  }

  const tokens = trimmed.split(/[,;]+/).map((t) => t.trim());
  if (tokens.some((t) => t.length === 0)) {
    return { ranges: [], isValid: false, error: 'Boş veya hatalı virgül içeren sayfa aralığı.' };
  }

  const ranges: SplitRangeItem[] = [];
  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1], 10);
      const to = parseInt(rangeMatch[2], 10);
      if (from < 1 || to > totalPages) {
        return {
          ranges: [],
          isValid: false,
          error: `Sayfa aralığı 1-${totalPages} sınırları dışında: "${token}"`,
        };
      }
      if (from > to) {
        return {
          ranges: [],
          isValid: false,
          error: `Başlangıç sayfası bitişten büyük olamaz: "${token}"`,
        };
      }
      ranges.push({ from, to });
      continue;
    }

    if (/^\d+$/.test(token)) {
      const pageNum = parseInt(token, 10);
      if (pageNum < 1 || pageNum > totalPages) {
        return {
          ranges: [],
          isValid: false,
          error: `Sayfa numarası 1-${totalPages} aralığında olmalıdır: "${token}"`,
        };
      }
      ranges.push({ from: pageNum, to: pageNum });
      continue;
    }

    return {
      ranges: [],
      isValid: false,
      error: `Geçersiz aralık ifadesi: "${token}"`,
    };
  }

  return { ranges, isValid: ranges.length > 0 };
}

export interface SaveExportedFileOptions {
  data: ArrayBuffer | Uint8Array | Blob | string;
  defaultName: string;
  dialogTitle?: string;
  filters?: ElectronFileFilter[];
  mimeType?: string;
}

/**
 * Saves an exported file via Electron native dialog when available,
 * never falling back to browser download if the user cancels the Electron dialog.
 */
export async function saveBinaryOrBlobFile(
  options: SaveExportedFileOptions
): Promise<{ status: 'saved' | 'canceled'; filePath?: string }> {
  const {
    data,
    defaultName,
    dialogTitle = 'Dosyayı Kaydet',
    filters = [{ name: 'PDF Dökümanı', extensions: ['pdf'] }],
    mimeType = 'application/pdf',
  } = options;

  const electron = typeof window !== 'undefined' ? window.electronAPI : undefined;

  if (electron?.showSaveDialog && electron?.saveFile) {
    const dialogRes = await electron.showSaveDialog({
      title: dialogTitle,
      defaultPath: defaultName,
      filters,
    });

    if (dialogRes.canceled || !dialogRes.filePath) {
      return { status: 'canceled' };
    }

    let payload: ArrayBuffer | Uint8Array;
    if (data instanceof Blob) {
      payload = await data.arrayBuffer();
    } else if (typeof data === 'string') {
      payload = new TextEncoder().encode(data);
    } else {
      payload = data;
    }

    const saveRes = await electron.saveFile(dialogRes.filePath, payload);
    if (!saveRes?.success) {
      throw new Error(saveRes?.error || 'Dosya diske kaydedilemedi.');
    }

    return { status: 'saved', filePath: dialogRes.filePath };
  }

  // Web browser download fallback
  let blob: Blob;
  if (data instanceof Blob) {
    blob = data;
  } else if (typeof data === 'string') {
    blob = new Blob([data], { type: mimeType });
  } else if (data instanceof Uint8Array) {
    const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    blob = new Blob([copy], { type: mimeType });
  } else {
    blob = new Blob([data], { type: mimeType });
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return { status: 'saved' };
}

/**
 * Fetches an ArrayBuffer from binaryStore or Electron disk fallback.
 */
export async function readAuthorizedDocBuffer(
  docId: string,
  filePath?: string
): Promise<ArrayBuffer> {
  const existing = binaryStore.get(docId);
  if (existing && existing.byteLength > 0) {
    return existing.slice(0);
  }

  const electron = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (filePath && electron?.readFile) {
    const res = await electron.readFile(filePath);
    if (res?.buffer) {
      const offset = res.byteOffset ?? 0;
      const length = res.byteLength ?? res.buffer.byteLength;
      const sliced = res.buffer.slice(offset, offset + length);
      binaryStore.set(docId, sliced.slice(0));
      return sliced;
    }
  }

  throw new Error('Döküman verisi bellekte bulunamadı.');
}

/**
 * Synchronizes both DocumentStore and TabStore when replacing the active document in-place.
 */
export function syncReplacedActiveDocument(
  nextModel: PdfDocumentModel,
  nextPdfDoc: pdfjsLib.PDFDocumentProxy,
  prevModel?: PdfDocumentModel | null,
  options: { isModified?: boolean; preserveActivePage?: boolean } = {}
): PdfDocumentModel {
  const { isModified = true, preserveActivePage = false } = options;
  const clampedPageIdx = preserveActivePage && prevModel
    ? Math.max(0, Math.min(prevModel.activePageIndex, Math.max(0, nextModel.pages.length - 1)))
    : nextModel.activePageIndex;

  const syncedModel: PdfDocumentModel = {
    ...nextModel,
    filePath: prevModel?.filePath ?? nextModel.filePath,
    isModified,
    activePageIndex: clampedPageIdx,
    activePageId: nextModel.pages[clampedPageIdx]?.id ?? nextModel.activePageId,
  };

  useDocumentStore.getState().setDocument(syncedModel, nextPdfDoc);
  useTabStore.getState().replaceActiveTab(syncedModel, nextPdfDoc);
  return syncedModel;
}

/**
 * Marks currentDocument modified and keeps TabStore synchronized.
 */
export function markCurrentDocumentModified(patch?: Partial<PdfDocumentModel>): void {
  const cur = useDocumentStore.getState().currentDocument;
  if (!cur) return;
  const updated: PdfDocumentModel = {
    ...cur,
    ...patch,
    isModified: true,
  };
  useDocumentStore.setState({ currentDocument: updated });
  useTabStore.getState().updateTabModel(updated);
}
