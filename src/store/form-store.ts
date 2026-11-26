import { create } from 'zustand';
import { useDocumentStore } from './document-store';
import { historyManager, FormValuesCommand } from '@/core/history/command-manager';

export interface FormWidgetModel {
  id: string;
  pageIndex: number;
  fieldName: string;
  fieldType: 'Tx' | 'Btn' | 'Ch' | 'Sig';
  fieldValue: string | boolean;
  defaultFieldValue?: string | boolean;
  checkBox?: boolean;
  radioButton?: boolean;
  buttonValue?: string;
  options?: Array<{ displayValue: string; exportValue: string }>;
  readOnly?: boolean;
  multiline?: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FormState {
  /** docId -> fieldName -> value */
  valuesByDoc: Record<string, Record<string, string | boolean>>;

  /** Sets a single field value */
  setFieldValue: (docId: string, fieldName: string, value: string | boolean) => void;

  /** Gets a field value or falls back to defaultValue */
  getFieldValue: (docId: string, fieldName: string, fallback?: string | boolean) => string | boolean;

  /** Sets multiple field values at once (e.g. on JSON import) */
  setAllValues: (docId: string, values: Record<string, string | boolean>) => void;

  /** Clears all values for a document (undoable) */
  clearForm: (docId: string) => void;

  /** Silent cleanup when closing a document/tab */
  clearDocValues: (docId: string) => void;
}

export const useFormStore = create<FormState>((set, get) => ({
  valuesByDoc: {},

  setFieldValue: (docId, fieldName, value) => {
    const prevValues = { ...(get().valuesByDoc[docId] || {}) };
    const nextValues = {
      ...prevValues,
      [fieldName]: value,
    };

    const currentDoc = useDocumentStore.getState().currentDocument;
    const prevModified = currentDoc && currentDoc.id === docId ? currentDoc.isModified : false;

    set((state) => ({
      valuesByDoc: {
        ...state.valuesByDoc,
        [docId]: nextValues,
      },
    }));

    if (currentDoc && currentDoc.id === docId && !currentDoc.isModified) {
      useDocumentStore.setState((s) => {
        if (s.currentDocument && s.currentDocument.id === docId) {
          s.currentDocument.isModified = true;
        }
      });
    }

    if (!historyManager.isApplying()) {
      historyManager.push(
        new FormValuesCommand(
          `Form alanı "${fieldName}" güncellendi`,
          docId,
          prevValues,
          nextValues,
          prevModified,
          `form-field:${docId}:${fieldName}`
        ),
        docId
      );
    }
  },

  getFieldValue: (docId, fieldName, fallback = '') => {
    const docValues = get().valuesByDoc[docId];
    if (docValues && fieldName in docValues) {
      return docValues[fieldName];
    }
    return fallback;
  },

  setAllValues: (docId, values) => {
    const prevValues = { ...(get().valuesByDoc[docId] || {}) };
    const nextValues = {
      ...prevValues,
      ...values,
    };

    const currentDoc = useDocumentStore.getState().currentDocument;
    const prevModified = currentDoc && currentDoc.id === docId ? currentDoc.isModified : false;

    set((state) => ({
      valuesByDoc: {
        ...state.valuesByDoc,
        [docId]: nextValues,
      },
    }));

    if (currentDoc && currentDoc.id === docId) {
      useDocumentStore.setState((s) => {
        if (s.currentDocument && s.currentDocument.id === docId) {
          s.currentDocument.isModified = true;
        }
      });
    }

    if (!historyManager.isApplying()) {
      historyManager.push(
        new FormValuesCommand(
          'Form alanları güncellendi',
          docId,
          prevValues,
          nextValues,
          prevModified
        ),
        docId
      );
    }
  },

  clearForm: (docId) => {
    const prevValues = { ...(get().valuesByDoc[docId] || {}) };
    const currentDoc = useDocumentStore.getState().currentDocument;
    const prevModified = currentDoc && currentDoc.id === docId ? currentDoc.isModified : false;

    set((state) => {
      const next = { ...state.valuesByDoc };
      delete next[docId];
      return { valuesByDoc: next };
    });

    if (Object.keys(prevValues).length > 0 && currentDoc && currentDoc.id === docId) {
      useDocumentStore.setState((s) => {
        if (s.currentDocument && s.currentDocument.id === docId) {
          s.currentDocument.isModified = true;
        }
      });
    }

    if (Object.keys(prevValues).length > 0 && !historyManager.isApplying()) {
      historyManager.push(
        new FormValuesCommand(
          'Form değerleri temizlendi',
          docId,
          prevValues,
          {},
          prevModified
        ),
        docId
      );
    }
  },

  clearDocValues: (docId) =>
    set((state) => {
      if (!(docId in state.valuesByDoc)) return state;
      const next = { ...state.valuesByDoc };
      delete next[docId];
      return { valuesByDoc: next };
    }),
}));
