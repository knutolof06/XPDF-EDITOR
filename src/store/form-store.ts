import { create } from 'zustand';
import { useDocumentStore } from './document-store';

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

  /** Clears all values for a document */
  clearForm: (docId: string) => void;
}

export const useFormStore = create<FormState>((set, get) => ({
  valuesByDoc: {},

  setFieldValue: (docId, fieldName, value) => {
    set((state) => {
      const docValues = state.valuesByDoc[docId] || {};
      return {
        valuesByDoc: {
          ...state.valuesByDoc,
          [docId]: {
            ...docValues,
            [fieldName]: value,
          },
        },
      };
    });

    // Mark current document as modified
    const currentDoc = useDocumentStore.getState().currentDocument;
    if (currentDoc && currentDoc.id === docId && !currentDoc.isModified) {
      useDocumentStore.setState((s) => {
        if (s.currentDocument) {
          s.currentDocument.isModified = true;
        }
      });
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
    set((state) => ({
      valuesByDoc: {
        ...state.valuesByDoc,
        [docId]: {
          ...(state.valuesByDoc[docId] || {}),
          ...values,
        },
      },
    }));

    const currentDoc = useDocumentStore.getState().currentDocument;
    if (currentDoc && currentDoc.id === docId) {
      useDocumentStore.setState((s) => {
        if (s.currentDocument) {
          s.currentDocument.isModified = true;
        }
      });
    }
  },

  clearForm: (docId) => {
    set((state) => {
      const next = { ...state.valuesByDoc };
      delete next[docId];
      return { valuesByDoc: next };
    });
  },
}));
