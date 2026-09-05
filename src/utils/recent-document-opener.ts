import { RecentDocumentItem } from '@/types/document';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { useUIStore } from '@/store/ui-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { binaryStore } from '@/core/storage/binary-store';

export async function openRecentDocument(item: RecentDocumentItem): Promise<boolean> {
  const { setDocument, addRecentDocument, setLoading } = useDocumentStore.getState();
  const { addTab } = useTabStore.getState();
  const { addToast, setPasswordModalOpen } = useUIStore.getState();
  const electron = typeof window !== 'undefined' ? (window as any).electronAPI : null;

  setLoading(true);

  try {
    // 1. If file path is known and running in Electron
    if (item.filePath && electron?.readFile) {
      addToast(`"${item.name}" açılıyor...`, 'info', 1500);
      try {
        const fileData = await electron.readFile(item.filePath);
        if (fileData && fileData.buffer) {
          const { model, pdfDoc } = await PdfLoader.loadDocument(
            fileData.name || item.name,
            fileData.buffer,
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
      } catch (readErr: any) {
        if (readErr?.isPasswordProtected) {
          setPasswordModalOpen(true, {
            name: readErr.fileName || item.name,
            buffer: readErr.buffer || new ArrayBuffer(0),
            filePath: readErr.filePath || item.filePath,
          });
          addToast('Bu döküman parola ile korunmaktadır.', 'warning');
          return false;
        }
        console.warn('Could not read from exact filePath, trying fallbacks:', readErr);
      }
    }

    // 2. Check if binary data is still held in memory from current session
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

    // 3. Fallback for Electron: File might have been moved/renamed, prompt to re-locate
    if (electron?.showOpenDialog) {
      addToast(`"${item.name}" dosyası bulunamadı. Lütfen dosyanın yeni konumunu seçin.`, 'warning', 4000);
      const res = await electron.showOpenDialog({
        title: `"${item.name}" Dosyasını Seçin`,
        filters: [{ name: 'PDF Dosyaları', extensions: ['pdf'] }],
      });

      if (!res.canceled && res.filePaths && res.filePaths[0]) {
        const newPath = res.filePaths[0];
        const fileData = await electron.readFile(newPath);
        const { model, pdfDoc } = await PdfLoader.loadDocument(
          fileData.name,
          fileData.buffer,
          fileData.path
        );
        setDocument(model, pdfDoc);
        addTab(model, pdfDoc);
        addRecentDocument({
          id: model.id,
          name: model.name,
          filePath: fileData.path,
          fileSize: model.fileSize,
          pageCount: model.totalPages,
          lastOpened: Date.now(),
        });
        addToast(`"${fileData.name}" başarıyla açıldı.`, 'success');
        return true;
      }
    } else {
      addToast(`"${item.name}" dosyası açılamadı. Konumu değişmiş olabilir.`, 'error');
    }

    return false;
  } catch (err: any) {
    console.error('Failed to open recent document:', err);
    if (err?.isPasswordProtected) {
      setPasswordModalOpen(true, {
        name: err.fileName || item.name,
        buffer: err.buffer,
        filePath: item.filePath,
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
