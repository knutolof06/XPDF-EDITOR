import { RecentDocumentItem } from '@/types/document';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { useUIStore } from '@/store/ui-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { binaryStore } from '@/core/storage/binary-store';

function isPasswordError(err: unknown): err is {
  isPasswordProtected: true;
  fileName?: string;
  buffer?: ArrayBuffer;
  filePath?: string;
} {
  return Boolean(
    err &&
      typeof err === 'object' &&
      (err as { isPasswordProtected?: boolean }).isPasswordProtected
  );
}

export async function openRecentDocument(item: RecentDocumentItem): Promise<boolean> {
  const { setDocument, addRecentDocument, setLoading } = useDocumentStore.getState();
  const { addTab } = useTabStore.getState();
  const { addToast, setPasswordModalOpen } = useUIStore.getState();
  const electron = typeof window !== 'undefined' ? window.electronAPI : undefined;

  setLoading(true);

  try {
    // 1. If file path is known and running in Electron
    if (item.filePath && electron?.readFile) {
      addToast(`"${item.name}" açılıyor...`, 'info', 1500);
      try {
        const fileData = await electron.readFile(item.filePath);
        if (fileData && fileData.buffer) {
          const offset = typeof fileData.byteOffset === 'number' ? fileData.byteOffset : 0;
          const length =
            typeof fileData.byteLength === 'number'
              ? fileData.byteLength
              : fileData.buffer.byteLength;
          const safeBuffer = fileData.buffer.slice(offset, offset + length);
          const { model, pdfDoc } = await PdfLoader.loadDocument(
            fileData.name || item.name,
            safeBuffer,
            fileData.path || item.filePath
          );
          setDocument(model, pdfDoc);
          addTab(model, pdfDoc);
          addRecentDocument({
            id: model.id,
            name: model.name,
            filePath: fileData.path || item.filePath,
            fileSize: model.fileSize,
            pageCount: model.totalPages,
            lastOpened: Date.now(),
          });
          addToast(`"${item.name}" başarıyla açıldı.`, 'success');
          return true;
        }
      } catch (readErr: unknown) {
        if (isPasswordError(readErr)) {
          setPasswordModalOpen(true, {
            name: readErr.fileName || item.name,
            buffer: readErr.buffer || new ArrayBuffer(0),
            filePath: readErr.filePath || item.filePath,
          });
          addToast('Bu döküman parola ile korunmaktadır.', 'warning');
          return false;
        }
        console.warn('Could not read from exact filePath, trying relocate fallback:', readErr);
      }
    } else {
      // 2. For session/browser-opened items without disk path (or outside Electron), check in-memory binaryStore
      const cachedBuffer = binaryStore.get(item.id);
      if (cachedBuffer) {
        const { model, pdfDoc } = await PdfLoader.loadDocument(
          item.name,
          cachedBuffer,
          item.filePath
        );
        setDocument(model, pdfDoc);
        addTab(model, pdfDoc);
        addRecentDocument({
          id: model.id,
          name: model.name,
          filePath: item.filePath,
          fileSize: model.fileSize,
          pageCount: model.totalPages,
          lastOpened: Date.now(),
        });
        addToast(`"${item.name}" açıldı.`, 'success');
        return true;
      }
    }

    // 3. Fallback for Electron: File might have been moved/renamed, prompt to re-locate
    if (electron?.showOpenDialog) {
      addToast(
        `"${item.name}" dosyası bulunamadı. Lütfen dosyanın yeni konumunu seçin.`,
        'warning',
        4000
      );
      const res = await electron.showOpenDialog({
        title: `"${item.name}" Dosyasını Seçin`,
        filters: [{ name: 'PDF Dosyaları', extensions: ['pdf'] }],
      });

      if (!res || res.canceled || !res.filePaths || res.filePaths.length === 0) {
        return false;
      }

      const newPath = res.filePaths[0];
      const preloadedFile = res.files?.[0];
      const fileData =
        preloadedFile && preloadedFile.buffer
          ? preloadedFile
          : electron.readFile
            ? await electron.readFile(newPath)
            : null;

      if (!fileData || !fileData.buffer) {
        addToast(`"${item.name}" dosyası diskten okunamadı.`, 'error');
        return false;
      }

      const offset = typeof fileData.byteOffset === 'number' ? fileData.byteOffset : 0;
      const length =
        typeof fileData.byteLength === 'number'
          ? fileData.byteLength
          : fileData.buffer.byteLength;
      const safeBuffer = fileData.buffer.slice(offset, offset + length);
      const resolvedName = fileData.name || item.name;
      const resolvedPath = fileData.path || newPath;

      const { model, pdfDoc } = await PdfLoader.loadDocument(
        resolvedName,
        safeBuffer,
        resolvedPath
      );
      setDocument(model, pdfDoc);
      addTab(model, pdfDoc);
      addRecentDocument({
        id: model.id,
        name: model.name,
        filePath: resolvedPath,
        fileSize: model.fileSize,
        pageCount: model.totalPages,
        lastOpened: Date.now(),
      });
      addToast(`"${resolvedName}" başarıyla açıldı.`, 'success');
      return true;
    }

    addToast(`"${item.name}" dosyası açılamadı. Konumu değişmiş olabilir.`, 'error');
    return false;
  } catch (err: unknown) {
    console.error('Failed to open recent document:', err);
    if (isPasswordError(err)) {
      setPasswordModalOpen(true, {
        name: err.fileName || item.name,
        buffer: err.buffer || new ArrayBuffer(0),
        filePath: err.filePath || item.filePath,
      });
      addToast('Bu döküman parola ile korunmaktadır. Lütfen parolayı girin.', 'warning');
    } else {
      addToast('Döküman açılamadı.', 'error');
    }
    return false;
  } finally {
    setLoading(false);
  }
}
