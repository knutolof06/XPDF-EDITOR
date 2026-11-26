import { ActiveTool } from '@/types/viewer';
import { PdfDocumentModel } from '@/types/document';
import { useAnnotationStore } from '@/store/annotation-store';
import { useViewerStore } from '@/store/viewer-store';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { useUIStore } from '@/store/ui-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { PdfExporter } from '@/core/engine/pdf-exporter';

export function syncActiveTool(tool: ActiveTool): void {
  const annStore = useAnnotationStore.getState();
  const viewerStore = useViewerStore.getState();

  if (annStore.activeTool !== tool) {
    annStore.setActiveTool(tool);
  }
  if (viewerStore.activeTool !== tool) {
    viewerStore.setActiveTool(tool);
  }
}

function normalizeBufferData(
  buffer: ArrayBuffer | Uint8Array,
  byteOffset?: number,
  byteLength?: number
): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) {
    if (typeof byteOffset === 'number' && typeof byteLength === 'number') {
      return buffer.slice(byteOffset, byteOffset + byteLength);
    }
    return buffer.slice(0);
  }
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export async function openPdfFromBuffer(
  name: string,
  rawBuffer: ArrayBuffer | Uint8Array,
  filePath?: string,
  options?: { showLoadingToast?: boolean }
): Promise<boolean> {
  const { setDocument, setLoading, setError, addRecentDocument } = useDocumentStore.getState();
  const { addTab } = useTabStore.getState();
  const { addToast, setPasswordModalOpen } = useUIStore.getState();

  const arrayBuffer = normalizeBufferData(rawBuffer);

  try {
    setLoading(true);
    if (options?.showLoadingToast !== false) {
      addToast(`"${name}" yükleniyor...`, 'info', 2000);
    }

    const { model, pdfDoc } = await PdfLoader.loadDocument(name, arrayBuffer, filePath || undefined);
    setDocument(model, pdfDoc);
    addTab(model, pdfDoc);
    addRecentDocument({
      id: model.id,
      name: model.name,
      filePath: filePath || undefined,
      fileSize: model.fileSize,
      pageCount: model.totalPages,
      lastOpened: Date.now(),
    });
    addToast(`"${model.name}" başarıyla açıldı (${model.totalPages} sayfa).`, 'success');
    return true;
  } catch (err: unknown) {
    console.error('PDF açma hatası:', err);
    const e = err as { isPasswordProtected?: boolean; fileName?: string; buffer?: ArrayBuffer; filePath?: string; message?: string };
    if (e?.isPasswordProtected) {
      setLoading(false);
      setPasswordModalOpen(true, {
        name: e.fileName || name,
        buffer: e.buffer || arrayBuffer,
        filePath: e.filePath || filePath,
      });
      addToast('Bu belge parola ile korunmaktadır. Lütfen parolayı girin.', 'warning');
    } else {
      setError(e?.message || 'PDF dosyası yüklenemedi.');
      addToast('PDF açılamadı. Dosya bozuk veya desteklenmiyor olabilir.', 'error');
    }
    return false;
  }
}

export async function openPdfFiles(files: FileList | File[]): Promise<void> {
  const list = Array.from(files).filter(
    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
  );
  if (list.length === 0) {
    useUIStore.getState().addToast('Lütfen geçerli bir .pdf dosyası seçin.', 'warning');
    return;
  }

  for (const file of list) {
    const buffer = await file.arrayBuffer();
    const filePath = (file as File & { path?: string }).path || undefined;
    await openPdfFromBuffer(file.name, buffer, filePath);
  }
}

export async function openPdfFileDialog(fallbackInput?: HTMLInputElement | null): Promise<void> {
  const electron = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (electron?.showOpenDialog && electron?.readFile) {
    try {
      const dialogRes = await electron.showOpenDialog({
        title: 'PDF Dosyası Aç',
        filters: [{ name: 'PDF Dosyaları', extensions: ['pdf'] }],
        multiSelections: true,
      });
      if (dialogRes.canceled || !dialogRes.filePaths || dialogRes.filePaths.length === 0) {
        return;
      }

      for (const filePath of dialogRes.filePaths) {
        const fileData = await electron.readFile(filePath);
        if (fileData?.buffer) {
          const cleanBuf = normalizeBufferData(
            fileData.buffer,
            fileData.byteOffset,
            fileData.byteLength
          );
          await openPdfFromBuffer(fileData.name || filePath.split(/[\\/]/).pop() || 'Belge.pdf', cleanBuf, fileData.path || filePath);
        }
      }
      return;
    } catch (err) {
      console.error('Electron open dialog error:', err);
      useUIStore.getState().addToast('Dosya açma penceresi başlatılamadı.', 'error');
      return;
    }
  }

  fallbackInput?.click();
}

function markDocumentSaved(docId: string, newPath?: string, newName?: string): void {
  let updatedDoc: PdfDocumentModel | null = null;
  useDocumentStore.setState((state) => {
    if (state.currentDocument && state.currentDocument.id === docId) {
      state.currentDocument.isModified = false;
      if (newPath) state.currentDocument.filePath = newPath;
      if (newName) state.currentDocument.name = newName;
      updatedDoc = { ...state.currentDocument };
    }
  });

  if (updatedDoc) {
    useTabStore.getState().updateTabModel(updatedDoc);
  } else {
    const existingTab = useTabStore.getState().tabs.find((t) => t.id === docId);
    if (existingTab) {
      useTabStore.getState().updateTabModel({
        ...existingTab.model,
        isModified: false,
        filePath: newPath || existingTab.model.filePath,
        name: newName || existingTab.model.name,
      });
    }
  }
}

export async function saveDocument(doc: PdfDocumentModel, saveAs = false): Promise<boolean> {
  const { addToast } = useUIStore.getState();
  const { addRecentDocument } = useDocumentStore.getState();
  const electron = typeof window !== 'undefined' ? window.electronAPI : undefined;

  try {
    addToast(saveAs ? 'Farklı kaydediliyor...' : 'Kaydediliyor...', 'info', 1500);
    const rawOut = await PdfExporter.exportDocumentWithAnnotations(doc);

    if (!saveAs && electron?.saveFile && doc.filePath) {
      const result = await electron.saveFile(doc.filePath, rawOut);
      if (result?.success) {
        markDocumentSaved(doc.id);
        addToast(`"${doc.name}" kaydedildi!`, 'success');
        return true;
      }
      addToast('Kaydetme hatası: ' + (result?.error || 'bilinmeyen hata'), 'error');
      return false;
    }

    if (electron?.showSaveDialog && electron?.saveFile) {
      const defaultName = saveAs
        ? doc.name.replace(/\.pdf$/i, '') + '_duzenlenmis.pdf'
        : doc.name;
      const dialogRes = await electron.showSaveDialog({
        title: saveAs ? 'Farklı Kaydet' : 'PDF Olarak Kaydet',
        defaultPath: defaultName,
        filters: [{ name: 'PDF Dosyaları', extensions: ['pdf'] }],
      });

      if (dialogRes.canceled || !dialogRes.filePath) {
        return false;
      }

      const savePath = dialogRes.filePath;
      const result = await electron.saveFile(savePath, rawOut);
      if (result?.success) {
        const savedName = savePath.split(/[\\/]/).pop() || doc.name;
        markDocumentSaved(doc.id, savePath, savedName);
        addRecentDocument({
          id: doc.id,
          name: savedName,
          filePath: savePath,
          fileSize: rawOut.byteLength,
          pageCount: doc.totalPages,
          lastOpened: Date.now(),
        });
        addToast(`"${savedName}" kaydedildi!`, 'success');
        return true;
      }
      addToast('Kaydetme hatası: ' + (result?.error || 'bilinmeyen hata'), 'error');
      return false;
    }

    // Browser download fallback
    const fileName = saveAs
      ? doc.name.replace(/\.pdf$/i, '') + '_duzenlenmis.pdf'
      : doc.name;
    const blob = new Blob([rawOut], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    markDocumentSaved(doc.id);
    addToast(`"${fileName}" kaydedildi!`, 'success');
    return true;
  } catch (err) {
    console.error('Save error:', err);
    addToast('Kaydetme sırasında hata oluştu.', 'error');
    return false;
  }
}

export async function printDocumentWithAnnotations(doc: PdfDocumentModel): Promise<void> {
  const { addToast } = useUIStore.getState();
  const electron = typeof window !== 'undefined' ? window.electronAPI : undefined;

  try {
    addToast('Yazdırma hazırlanıyor...', 'info', 2000);
    const rawOut = await PdfExporter.exportDocumentWithAnnotations(doc);
    const blob = new Blob([rawOut], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);

    const printIframe = document.createElement('iframe');
    printIframe.style.position = 'fixed';
    printIframe.style.right = '0';
    printIframe.style.bottom = '0';
    printIframe.style.width = '0';
    printIframe.style.height = '0';
    printIframe.style.border = '0';
    printIframe.setAttribute('aria-hidden', 'true');
    printIframe.src = blobUrl;
    document.body.appendChild(printIframe);

    printIframe.onload = () => {
      try {
        printIframe.contentWindow?.focus();
        printIframe.contentWindow?.print();
      } catch {
        if (electron?.printDocument) {
          electron.printDocument().catch(() => window.print());
        } else {
          window.print();
        }
      }
      setTimeout(() => {
        try {
          if (document.body.contains(printIframe)) {
            document.body.removeChild(printIframe);
          }
          URL.revokeObjectURL(blobUrl);
        } catch {
          // ignore
        }
      }, 60000);
    };
  } catch (err) {
    console.error('Print error:', err);
    if (electron?.printDocument) {
      electron.printDocument().catch(() => window.print());
    } else {
      window.print();
    }
  }
}
