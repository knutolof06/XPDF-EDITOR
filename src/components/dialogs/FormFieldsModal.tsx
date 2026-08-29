import React, { useEffect, useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { PdfFormsEngine } from '@/core/pdf/pdf-forms';
import { FormFieldModel } from '@/types/advanced';
import { X, CheckSquare, CheckCircle2 } from 'lucide-react';

export const FormFieldsModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { currentDocument, setDocument } = useDocumentStore();
  const { addToast } = useUIStore();

  const [fields, setFields] = useState<FormFieldModel[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string | boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function loadFields() {
      if (!currentDocument || !isOpen) return;
      setIsLoading(true);
      try {
        const list = await PdfFormsEngine.getFormFields(currentDocument.id);
        setFields(list);

        const initial: Record<string, string | boolean> = {};
        list.forEach((f) => {
          initial[f.name] = f.value;
        });
        setFormValues(initial);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }

    loadFields();
  }, [currentDocument, isOpen]);

  if (!isOpen || !currentDocument) return null;

  const handleSave = async () => {
    try {
      setIsSaving(true);
      addToast('Form alanları kaydediliyor...', 'info');

      const result = await PdfFormsEngine.fillFormFields(
        currentDocument.id,
        currentDocument.name,
        formValues
      );

      setDocument(result.model, result.pdfDoc);
      addToast('PDF form alanları başarıyla kaydedildi!', 'success');
      onClose();
    } catch (err: any) {
      console.error(err);
      addToast('Form kaydedilirken hata oluştu.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <CheckSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">PDF Form Alanları</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Dökümandaki interaktif form alanlarını doldurun</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          {isLoading ? (
            <div className="text-center py-8 text-xs text-slate-500 dark:text-slate-400">
              <div className="w-6 h-6 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin mx-auto mb-2" />
              Form alanları taranıyor...
            </div>
          ) : fields.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500 dark:text-slate-400">
              <CheckSquare className="w-8 h-8 text-slate-400 dark:text-slate-600 mx-auto mb-2" />
              <p className="font-semibold text-slate-700 dark:text-slate-300">Form Alanı Bulunamadı</p>
              <p className="mt-1 text-[11px] text-slate-500">Bu PDF'de doldurulabilir interaktif form (AcroForm) alanı bulunmuyor.</p>
            </div>
          ) : (
            fields.map((f) => (
              <div key={f.name} className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">{f.name}</label>
                {f.type === 'checkbox' ? (
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(formValues[f.name])}
                      onChange={(e) =>
                        setFormValues((prev) => ({ ...prev, [f.name]: e.target.checked }))
                      }
                      className="accent-sky-500 rounded"
                    />
                    <span>İşaretle / Onayla</span>
                  </label>
                ) : f.type === 'dropdown' && f.options ? (
                  <select
                    value={String(formValues[f.name] || '')}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, [f.name]: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
                  >
                    {f.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={String(formValues[f.name] || '')}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, [f.name]: e.target.value }))
                    }
                    className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
                  />
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
          >
            Kapat
          </button>
          {fields.length > 0 && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 shadow-md shadow-sky-600/20"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isSaving ? 'Kaydediliyor...' : 'Değerleri Uygula'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
