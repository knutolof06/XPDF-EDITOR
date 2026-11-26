import { PdfPageModel, PdfDocumentModel } from '@/types/document';
import { AnyAnnotation, HeaderFooterConfig, PageNumberConfig, PdfNativeObject } from '@/types/annotations';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { useNativeObjectStore } from '@/store/native-object-store';
import { useFormStore } from '@/store/form-store';
import { binaryStore } from '@/core/storage/binary-store';
import { clearDocumentCaches } from '@/core/cache/render-cache';
import { PdfLoader } from '@/core/pdf/pdf-loader';

export interface ICommand {
  description: string;
  docId?: string;
  mergeKey?: string;
  mergeWith?: (next: ICommand) => boolean;
  execute(): void | Promise<void>;
  undo(): void | Promise<void>;
}

export function cloneAnnotation(ann: AnyAnnotation): AnyAnnotation {
  const cloned = { ...ann } as AnyAnnotation;
  if ('points' in cloned && Array.isArray(cloned.points)) {
    cloned.points = cloned.points.map((pt) => ({ ...pt }));
  }
  return cloned;
}

export function clonePageModel(page: PdfPageModel): PdfPageModel {
  return {
    ...page,
    crop: page.crop ? { ...page.crop } : undefined,
    annotations: Array.isArray(page.annotations) ? page.annotations.map(cloneAnnotation) : [],
  };
}

export function cloneDocumentModel(doc: PdfDocumentModel): PdfDocumentModel {
  return {
    ...doc,
    pages: doc.pages.map(clonePageModel),
    selectedPageIds: [...doc.selectedPageIds],
    metadata: { ...doc.metadata },
  };
}

function isPromiseLike(val: unknown): val is Promise<unknown> {
  return Boolean(val && typeof (val as Promise<unknown>).then === 'function');
}

function syncTabIfPresent(model: PdfDocumentModel, pdfProxy?: unknown): void {
  const tabState = useTabStore.getState();
  const existing = tabState.tabs.find((t) => t.id === model.id);
  if (existing) {
    tabState.updateTabModel(model);
    if (pdfProxy && existing.pdfDocProxy !== pdfProxy) {
      useTabStore.setState((s) => {
        const tab = s.tabs.find((t) => t.id === model.id);
        if (tab) {
          tab.pdfDocProxy = pdfProxy as typeof tab.pdfDocProxy;
        }
      });
    }
  }
}

export class MovePageCommand implements ICommand {
  public description: string;
  public docId?: string;
  private fromIndex: number;
  private toIndex: number;

  constructor(fromIndex: number, toIndex: number, docId?: string) {
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
    this.docId = docId ?? useDocumentStore.getState().currentDocument?.id;
    this.description = `Sayfa ${fromIndex + 1} -> ${toIndex + 1} taşındı`;
  }

  public execute(): void {
    useDocumentStore.getState().reorderPages(this.fromIndex, this.toIndex);
  }

  public undo(): void {
    useDocumentStore.getState().reorderPages(this.toIndex, this.fromIndex);
  }
}

export class MoveMultiplePagesCommand implements ICommand {
  public description: string;
  public docId?: string;
  private pageIds: string[];
  private targetIndex: number;
  private position: 'before' | 'after';
  private originalOrder: PdfPageModel[] = [];
  private originalActivePageId: string = '';
  private originalActivePageIndex: number = 0;
  private originalSelectedPageIds: string[] = [];

  constructor(pageIds: string[], targetIndex: number, position: 'before' | 'after', docId?: string) {
    this.pageIds = [...pageIds];
    this.targetIndex = targetIndex;
    this.position = position;
    this.description = `${pageIds.length} sayfa taşındı`;
    const doc = useDocumentStore.getState().currentDocument;
    this.docId = docId ?? doc?.id;
    if (doc) {
      this.originalOrder = doc.pages.map(clonePageModel);
      this.originalActivePageId = doc.activePageId;
      this.originalActivePageIndex = doc.activePageIndex;
      this.originalSelectedPageIds = [...doc.selectedPageIds];
    }
  }

  public execute(): void {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc || this.pageIds.length === 0) return;

    const pages = doc.pages.map(clonePageModel);
    const targetPage = pages[this.targetIndex];
    if (!targetPage) return;

    const idSet = new Set(this.pageIds);
    const movingPages = pages.filter((p) => idSet.has(p.id));
    const remainingPages = pages.filter((p) => !idSet.has(p.id));

    let insertIndex = remainingPages.findIndex((p) => p.id === targetPage.id);
    if (insertIndex === -1) {
      insertIndex = Math.max(0, Math.min(this.targetIndex, remainingPages.length));
    } else if (this.position === 'after') {
      insertIndex += 1;
    }

    remainingPages.splice(insertIndex, 0, ...movingPages);
    const updatedPages = remainingPages.map((p, idx) => ({
      ...p,
      displayPageNumber: idx + 1,
    }));

    const newActiveIdx = updatedPages.findIndex((p) => p.id === doc.activePageId);
    const clampedIdx =
      newActiveIdx !== -1
        ? newActiveIdx
        : Math.max(0, Math.min(doc.activePageIndex, updatedPages.length - 1));
    const nextActiveId = updatedPages[clampedIdx]?.id ?? '';

    const nextDoc: PdfDocumentModel = {
      ...doc,
      pages: updatedPages,
      activePageIndex: clampedIdx,
      activePageId: nextActiveId,
      selectedPageIds: [...this.pageIds],
      isModified: true,
    };

    useDocumentStore.setState({ currentDocument: nextDoc });
    syncTabIfPresent(nextDoc);
  }

  public undo(): void {
    const doc = useDocumentStore.getState().currentDocument;
    if (doc && this.originalOrder.length > 0) {
      const restoredPages = this.originalOrder.map((p, idx) => ({
        ...clonePageModel(p),
        displayPageNumber: idx + 1,
      }));
      const foundActiveIdx = restoredPages.findIndex((p) => p.id === this.originalActivePageId);
      const clampedIdx =
        foundActiveIdx !== -1
          ? foundActiveIdx
          : Math.max(0, Math.min(this.originalActivePageIndex, restoredPages.length - 1));
      const nextActiveId = restoredPages[clampedIdx]?.id ?? '';

      const restoredDoc: PdfDocumentModel = {
        ...doc,
        pages: restoredPages,
        totalPages: restoredPages.length,
        activePageIndex: clampedIdx,
        activePageId: nextActiveId,
        selectedPageIds: [...this.originalSelectedPageIds],
        isModified: true,
      };

      useDocumentStore.setState({ currentDocument: restoredDoc });
      syncTabIfPresent(restoredDoc);
    }
  }
}

export class RotatePageCommand implements ICommand {
  public description: string;
  public docId?: string;
  private pageIds: string[];
  private angle: number;

  constructor(pageIds: string[], angle: number, docId?: string) {
    this.pageIds = [...pageIds];
    this.angle = angle;
    this.docId = docId ?? useDocumentStore.getState().currentDocument?.id;
    this.description = `${pageIds.length} sayfa ${angle}° döndürüldü`;
  }

  public execute(): void {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;
    const idSet = new Set(this.pageIds);
    const pages = doc.pages.map((p) => {
      if (idSet.has(p.id)) {
        return { ...p, rotation: ((p.rotation + this.angle) % 360 + 360) % 360 };
      }
      return { ...p };
    });
    const nextDoc: PdfDocumentModel = { ...doc, pages, isModified: true };
    useDocumentStore.setState({ currentDocument: nextDoc });
    syncTabIfPresent(nextDoc);
  }

  public undo(): void {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;
    const idSet = new Set(this.pageIds);
    const pages = doc.pages.map((p) => {
      if (idSet.has(p.id)) {
        return { ...p, rotation: ((p.rotation - this.angle) % 360 + 360) % 360 };
      }
      return { ...p };
    });
    const nextDoc: PdfDocumentModel = { ...doc, pages, isModified: true };
    useDocumentStore.setState({ currentDocument: nextDoc });
    syncTabIfPresent(nextDoc);
  }
}

export class DeletePageCommand implements ICommand {
  public description: string;
  public docId?: string;
  private deletedPages: { page: PdfPageModel; index: number }[];
  private prevActivePageId: string = '';
  private prevActivePageIndex: number = 0;
  private prevSelectedPageIds: string[] = [];

  constructor(deletedPages: { page: PdfPageModel; index: number }[], docId?: string) {
    this.deletedPages = deletedPages.map((d) => ({
      page: clonePageModel(d.page),
      index: d.index,
    }));
    const doc = useDocumentStore.getState().currentDocument;
    this.docId = docId ?? doc?.id;
    if (doc) {
      this.prevActivePageId = doc.activePageId;
      this.prevActivePageIndex = doc.activePageIndex;
      this.prevSelectedPageIds = [...doc.selectedPageIds];
    }
    this.description = `${deletedPages.length} sayfa silindi`;
  }

  public execute(): void {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;

    const idsToDelete = new Set(this.deletedPages.map((d) => d.page.id));
    const remaining = doc.pages.filter((p) => !idsToDelete.has(p.id));
    const updatedPages = remaining.map((p, idx) => ({
      ...p,
      displayPageNumber: idx + 1,
    }));

    let nextActiveIndex = 0;
    let nextActiveId = '';
    let nextSelected: string[] = [];

    if (updatedPages.length > 0) {
      const keptIdx = updatedPages.findIndex((p) => p.id === doc.activePageId);
      if (keptIdx !== -1) {
        nextActiveIndex = keptIdx;
      } else {
        const minDeletedIdx = this.deletedPages.reduce(
          (min, d) => Math.min(min, d.index),
          doc.activePageIndex
        );
        nextActiveIndex = Math.max(0, Math.min(minDeletedIdx, updatedPages.length - 1));
      }
      nextActiveId = updatedPages[nextActiveIndex].id;
      nextSelected = [nextActiveId];
    }

    const nextDoc: PdfDocumentModel = {
      ...doc,
      pages: updatedPages,
      totalPages: updatedPages.length,
      activePageIndex: nextActiveIndex,
      activePageId: nextActiveId,
      selectedPageIds: nextSelected,
      isModified: true,
    };

    useDocumentStore.setState({ currentDocument: nextDoc });
    syncTabIfPresent(nextDoc);
  }

  public undo(): void {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;

    const pages = doc.pages.map(clonePageModel);
    const sorted = [...this.deletedPages].sort((a, b) => a.index - b.index);
    sorted.forEach(({ page, index }) => {
      const safeIndex = Math.max(0, Math.min(index, pages.length));
      pages.splice(safeIndex, 0, clonePageModel(page));
    });

    const updatedPages = pages.map((p, idx) => ({
      ...p,
      displayPageNumber: idx + 1,
    }));

    let restoredActiveIndex = 0;
    let restoredActiveId = '';
    if (updatedPages.length > 0) {
      const foundIdx = updatedPages.findIndex((p) => p.id === this.prevActivePageId);
      restoredActiveIndex =
        foundIdx !== -1
          ? foundIdx
          : Math.max(0, Math.min(this.prevActivePageIndex, updatedPages.length - 1));
      restoredActiveId = updatedPages[restoredActiveIndex].id;
    }

    const validPageIds = new Set(updatedPages.map((p) => p.id));
    const restoredSelected = this.prevSelectedPageIds.filter((id) => validPageIds.has(id));

    const nextDoc: PdfDocumentModel = {
      ...doc,
      pages: updatedPages,
      totalPages: updatedPages.length,
      activePageIndex: restoredActiveIndex,
      activePageId: restoredActiveId,
      selectedPageIds:
        restoredSelected.length > 0
          ? restoredSelected
          : restoredActiveId
            ? [restoredActiveId]
            : [],
      isModified: true,
    };

    useDocumentStore.setState({ currentDocument: nextDoc });
    syncTabIfPresent(nextDoc);
  }
}

export class GenericCommand implements ICommand {
  public docId?: string;
  public mergeKey?: string;
  private onMerge?: (next: GenericCommand) => boolean;

  constructor(
    public description: string,
    private executeFn: () => void | Promise<void>,
    private undoFn: () => void | Promise<void>,
    options?: {
      docId?: string;
      mergeKey?: string;
      onMerge?: (next: GenericCommand) => boolean;
    }
  ) {
    this.docId = options?.docId ?? useDocumentStore.getState().currentDocument?.id;
    this.mergeKey = options?.mergeKey;
    this.onMerge = options?.onMerge;
  }

  public mergeWith(next: ICommand): boolean {
    if (next instanceof GenericCommand && this.onMerge) {
      return this.onMerge(next);
    }
    return false;
  }

  public execute(): void | Promise<void> {
    return this.executeFn();
  }

  public undo(): void | Promise<void> {
    return this.undoFn();
  }
}

export class AnnotationReorderCommand implements ICommand {
  public description: string;
  public docId?: string;
  private pageId: string;
  private beforeOrder: AnyAnnotation[];
  private afterOrder: AnyAnnotation[];

  constructor(
    description: string,
    pageId: string,
    beforeOrder: AnyAnnotation[],
    afterOrder: AnyAnnotation[],
    docId?: string
  ) {
    this.description = description;
    this.pageId = pageId;
    this.beforeOrder = beforeOrder.map(cloneAnnotation);
    this.afterOrder = afterOrder.map(cloneAnnotation);
    this.docId = docId ?? useDocumentStore.getState().currentDocument?.id;
  }

  private applyOrder(order: AnyAnnotation[]): void {
    useDocumentStore.setState((docState) => {
      if (!docState.currentDocument) return;
      const page = docState.currentDocument.pages.find((p) => p.id === this.pageId);
      if (page) {
        page.annotations = order.map(cloneAnnotation);
        docState.currentDocument.isModified = true;
      }
    });
  }

  public execute(): void {
    this.applyOrder(this.afterOrder);
  }

  public undo(): void {
    this.applyOrder(this.beforeOrder);
  }
}

export class PageNumberConfigCommand implements ICommand {
  public description = 'Sayfa numarası ayarları güncellendi';
  public docId?: string;

  constructor(
    private prevConfig: PageNumberConfig,
    private nextConfig: PageNumberConfig,
    private prevModified: boolean,
    docId?: string
  ) {
    this.docId = docId ?? useDocumentStore.getState().currentDocument?.id;
  }

  private applyConfig(config: PageNumberConfig, isModified: boolean): void {
    const key = this.docId || 'global';
    useAnnotationStore.setState((s) => {
      s.pageNumberConfigByDoc[key] = { ...config };
      s.pageNumberConfig = { ...config };
    });
    useDocumentStore.setState((s) => {
      if (s.currentDocument && (!this.docId || s.currentDocument.id === this.docId)) {
        s.currentDocument.isModified = isModified;
      }
    });
  }

  public execute(): void {
    this.applyConfig(this.nextConfig, true);
  }

  public undo(): void {
    this.applyConfig(this.prevConfig, this.prevModified);
  }
}

export class HeaderFooterConfigCommand implements ICommand {
  public description = 'Üst/Alt bilgi ayarları güncellendi';
  public docId?: string;

  constructor(
    private prevConfig: HeaderFooterConfig,
    private nextConfig: HeaderFooterConfig,
    private prevModified: boolean,
    docId?: string
  ) {
    this.docId = docId ?? useDocumentStore.getState().currentDocument?.id;
  }

  private applyConfig(config: HeaderFooterConfig, isModified: boolean): void {
    const key = this.docId || 'global';
    useAnnotationStore.setState((s) => {
      s.headerFooterConfigByDoc[key] = { ...config };
      s.headerFooterConfig = { ...config };
    });
    useDocumentStore.setState((s) => {
      if (s.currentDocument && (!this.docId || s.currentDocument.id === this.docId)) {
        s.currentDocument.isModified = isModified;
      }
    });
  }

  public execute(): void {
    this.applyConfig(this.nextConfig, true);
  }

  public undo(): void {
    this.applyConfig(this.prevConfig, this.prevModified);
  }
}

export class NativeObjectCommand implements ICommand {
  public docId?: string;
  public mergeKey?: string;
  private pageId: string;
  private prevObjects: PdfNativeObject[];
  private nextObjects: PdfNativeObject[];
  private prevModified: boolean;

  constructor(
    public description: string,
    pageId: string,
    prevObjects: PdfNativeObject[],
    nextObjects: PdfNativeObject[],
    prevModified: boolean,
    options?: { docId?: string; mergeKey?: string }
  ) {
    this.pageId = pageId;
    this.prevObjects = prevObjects.map((o) => ({ ...o }));
    this.nextObjects = nextObjects.map((o) => ({ ...o }));
    this.prevModified = prevModified;
    this.docId = options?.docId ?? useDocumentStore.getState().currentDocument?.id;
    this.mergeKey = options?.mergeKey;
  }

  public mergeWith(next: ICommand): boolean {
    if (next instanceof NativeObjectCommand && next.pageId === this.pageId) {
      this.nextObjects = next.nextObjects.map((o) => ({ ...o }));
      this.description = next.description;
      return true;
    }
    return false;
  }

  public execute(): void {
    useNativeObjectStore.setState((state) => ({
      objectsByPage: {
        ...state.objectsByPage,
        [this.pageId]: this.nextObjects.map((o) => ({ ...o })),
      },
    }));
    useDocumentStore.setState((s) => {
      if (s.currentDocument && (!this.docId || s.currentDocument.id === this.docId)) {
        s.currentDocument.isModified = true;
      }
    });
  }

  public undo(): void {
    useNativeObjectStore.setState((state) => ({
      objectsByPage: {
        ...state.objectsByPage,
        [this.pageId]: this.prevObjects.map((o) => ({ ...o })),
      },
    }));
    useDocumentStore.setState((s) => {
      if (s.currentDocument && (!this.docId || s.currentDocument.id === this.docId)) {
        s.currentDocument.isModified = this.prevModified;
      }
    });
  }
}

export class FormValuesCommand implements ICommand {
  public docId: string;
  public mergeKey?: string;
  private prevValues: Record<string, string | boolean>;
  private nextValues: Record<string, string | boolean>;
  private prevModified: boolean;

  constructor(
    public description: string,
    docId: string,
    prevValues: Record<string, string | boolean>,
    nextValues: Record<string, string | boolean>,
    prevModified: boolean,
    mergeKey?: string
  ) {
    this.docId = docId;
    this.prevValues = { ...prevValues };
    this.nextValues = { ...nextValues };
    this.prevModified = prevModified;
    this.mergeKey = mergeKey;
  }

  public mergeWith(next: ICommand): boolean {
    if (next instanceof FormValuesCommand && next.docId === this.docId) {
      this.nextValues = { ...next.nextValues };
      this.description = next.description;
      return true;
    }
    return false;
  }

  public execute(): void {
    useFormStore.setState((state) => ({
      valuesByDoc: {
        ...state.valuesByDoc,
        [this.docId]: { ...this.nextValues },
      },
    }));
    useDocumentStore.setState((s) => {
      if (s.currentDocument && s.currentDocument.id === this.docId) {
        s.currentDocument.isModified = true;
      }
    });
  }

  public undo(): void {
    useFormStore.setState((state) => {
      const updated = { ...state.valuesByDoc };
      if (Object.keys(this.prevValues).length === 0) {
        delete updated[this.docId];
      } else {
        updated[this.docId] = { ...this.prevValues };
      }
      return { valuesByDoc: updated };
    });
    useDocumentStore.setState((s) => {
      if (s.currentDocument && s.currentDocument.id === this.docId) {
        s.currentDocument.isModified = this.prevModified;
      }
    });
  }
}

export class DocumentStateSnapshotCommand implements ICommand {
  public docId?: string;
  private prevBuffer?: ArrayBuffer;
  private nextBuffer?: ArrayBuffer;
  private prevModel: PdfDocumentModel;
  private nextModel: PdfDocumentModel;

  constructor(
    public description: string,
    prevModel: PdfDocumentModel,
    private prevProxy: unknown,
    nextModel: PdfDocumentModel,
    private nextProxy: unknown
  ) {
    this.prevModel = cloneDocumentModel(prevModel);
    this.nextModel = cloneDocumentModel(nextModel);
    this.docId = nextModel.id;

    const pBuf =
      binaryStore.getForProxy(prevProxy as object) ||
      (prevModel.id !== nextModel.id ? binaryStore.get(prevModel.id) : undefined);
    if (pBuf) {
      this.prevBuffer = pBuf.slice(0);
    }

    const nBuf =
      binaryStore.getForProxy(nextProxy as object) || binaryStore.get(nextModel.id);
    if (nBuf) {
      this.nextBuffer = nBuf.slice(0);
    }
  }

  private applySnapshot(
    model: PdfDocumentModel,
    proxy: unknown,
    buffer: ArrayBuffer | undefined,
    otherModelId: string
  ): void {
    const cloned = cloneDocumentModel(model);
    if (buffer) {
      binaryStore.set(cloned.id, buffer.slice(0));
    }
    clearDocumentCaches(cloned.id);
    if (otherModelId !== cloned.id) {
      clearDocumentCaches(otherModelId);
    }
    useDocumentStore.getState().setDocument(cloned, proxy as Parameters<ReturnType<typeof useDocumentStore.getState>['setDocument']>[1]);

    const tabStore = useTabStore.getState();
    const hasMatchingTab = tabStore.tabs.some((t) => t.id === cloned.id);
    if (!hasMatchingTab && tabStore.activeTabId === otherModelId) {
      tabStore.replaceActiveTab(
        cloned,
        proxy as Parameters<typeof tabStore.replaceActiveTab>[1]
      );
    } else {
      syncTabIfPresent(cloned, proxy);
    }
  }

  public execute(): void {
    this.applySnapshot(this.nextModel, this.nextProxy, this.nextBuffer, this.prevModel.id);
  }

  public undo(): void {
    this.applySnapshot(this.prevModel, this.prevProxy, this.prevBuffer, this.nextModel.id);
  }
}

export class ReplaceTextCommand implements ICommand {
  public description: string;
  public docId?: string;
  private oldBuffer: ArrayBuffer;
  private newBuffer: ArrayBuffer;
  private docName: string;
  private filePath?: string;

  constructor(
    oldBuffer: ArrayBuffer,
    newBuffer: ArrayBuffer,
    docName: string,
    filePath: string | undefined,
    count: number,
    docId?: string
  ) {
    this.oldBuffer = oldBuffer.slice(0);
    this.newBuffer = newBuffer.slice(0);
    this.docName = docName;
    this.filePath = filePath;
    this.docId = docId ?? useDocumentStore.getState().currentDocument?.id;
    this.description = `${count} metin değiştirildi`;
  }

  private async loadBufferState(buffer: ArrayBuffer): Promise<void> {
    const current = useDocumentStore.getState().currentDocument;
    const preserveId = this.docId || current?.id;
    if (preserveId) {
      clearDocumentCaches(preserveId);
    }

    const { model, pdfDoc } = await PdfLoader.loadDocument(
      this.docName,
      buffer.slice(0),
      this.filePath,
      undefined,
      preserveId ? { preserveDocId: preserveId } : undefined
    );

    // Preserve in-memory annotations/rotations/crop/metadata if page count matches
    if (current && current.pages.length === model.pages.length) {
      model.pages = model.pages.map((p, idx) => {
        const prevPage = current.pages[idx];
        return {
          ...p,
          rotation: prevPage.rotation,
          crop: prevPage.crop ? { ...prevPage.crop } : undefined,
          annotations: prevPage.annotations.map((ann) => ({
            ...cloneAnnotation(ann),
            pageId: p.id,
          })),
        };
      });
      model.activePageIndex = Math.max(0, Math.min(current.activePageIndex, model.pages.length - 1));
      model.activePageId = model.pages[model.activePageIndex]?.id || '';
      model.selectedPageIds = model.activePageId ? [model.activePageId] : [];
      model.metadata = { ...model.metadata, ...current.metadata };
    }
    model.isModified = true;

    useDocumentStore.getState().setDocument(model, pdfDoc);
    const tabStore = useTabStore.getState();
    if (tabStore.tabs.some((t) => t.id === model.id)) {
      syncTabIfPresent(model, pdfDoc);
    } else if (tabStore.activeTabId) {
      tabStore.replaceActiveTab(model, pdfDoc);
    }
  }

  public async execute(): Promise<void> {
    await this.loadBufferState(this.newBuffer);
  }

  public async undo(): Promise<void> {
    await this.loadBufferState(this.oldBuffer);
  }
}

export class TransferOcrTextCommand implements ICommand {
  public description: string;
  public docId?: string;
  private pageTransfers: {
    pageId: string;
    newAnnotations: AnyAnnotation[];
    previousAnnotations: AnyAnnotation[];
  }[];

  constructor(
    pageTransfers: {
      pageId: string;
      newAnnotations: AnyAnnotation[];
      previousAnnotations: AnyAnnotation[];
    }[],
    description?: string,
    docId?: string
  ) {
    this.pageTransfers = pageTransfers.map((pt) => ({
      pageId: pt.pageId,
      newAnnotations: pt.newAnnotations.map(cloneAnnotation),
      previousAnnotations: pt.previousAnnotations.map(cloneAnnotation),
    }));
    this.docId = docId ?? useDocumentStore.getState().currentDocument?.id;
    const totalCount = pageTransfers.reduce((sum, pt) => sum + pt.newAnnotations.length, 0);
    this.description = description || `${totalCount} OCR metin bloğu sayfaya aktarıldı`;
  }

  public execute(): void {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;

    useDocumentStore.setState((state) => {
      if (!state.currentDocument) return;
      for (const pt of this.pageTransfers) {
        const page = state.currentDocument.pages.find((p) => p.id === pt.pageId);
        if (page) {
          page.annotations = [
            ...pt.previousAnnotations.map(cloneAnnotation),
            ...pt.newAnnotations.map(cloneAnnotation),
          ];
        }
      }
      state.currentDocument.isModified = true;
    });
  }

  public undo(): void {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;

    useDocumentStore.setState((state) => {
      if (!state.currentDocument) return;
      for (const pt of this.pageTransfers) {
        const page = state.currentDocument.pages.find((p) => p.id === pt.pageId);
        if (page) {
          page.annotations = pt.previousAnnotations.map(cloneAnnotation);
        }
      }
      state.currentDocument.isModified = true;
    });
  }
}

interface DocHistoryStacks {
  undoStack: ICommand[];
  redoStack: ICommand[];
}

class HistoryManager {
  private stacksByDoc: Map<string, DocHistoryStacks> = new Map();
  private maxHistory: number = 50;
  private listeners: Set<() => void> = new Set();
  private isApplyingFlag: boolean = false;
  private lastPushTime: number = 0;
  private pendingChain: Promise<void> = Promise.resolve();
  private activeAsyncOps: number = 0;

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public isApplying(): boolean {
    return this.isApplyingFlag;
  }

  public hasPendingOperations(): boolean {
    return this.activeAsyncOps > 0;
  }

  public whenIdle(): Promise<void> {
    return this.pendingChain;
  }

  private notify(): void {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (e) {
        console.error('History listener error:', e);
      }
    });
  }

  private resolveDocId(explicitDocId?: string): string {
    return explicitDocId || useDocumentStore.getState().currentDocument?.id || '__global__';
  }

  private getOrCreateStacks(docId: string): DocHistoryStacks {
    let stacks = this.stacksByDoc.get(docId);
    if (!stacks) {
      stacks = { undoStack: [], redoStack: [] };
      this.stacksByDoc.set(docId, stacks);
    }
    return stacks;
  }

  private runWithApplying(fn: () => void | Promise<void>): void {
    const executeNow = () => {
      this.isApplyingFlag = true;
      let result: void | Promise<void>;
      try {
        result = fn();
      } catch (err) {
        this.isApplyingFlag = false;
        throw err;
      }

      if (isPromiseLike(result)) {
        this.activeAsyncOps += 1;
        this.pendingChain = result
          .catch((err) => {
            console.error('[HistoryManager] async command error:', err);
          })
          .finally(() => {
            this.activeAsyncOps = Math.max(0, this.activeAsyncOps - 1);
            this.isApplyingFlag = false;
            this.notify();
          });
      } else {
        this.isApplyingFlag = false;
      }
    };

    if (this.activeAsyncOps > 0) {
      this.activeAsyncOps += 1;
      this.pendingChain = this.pendingChain
        .then(async () => {
          this.isApplyingFlag = true;
          try {
            await fn();
          } finally {
            this.isApplyingFlag = false;
          }
        })
        .catch((err) => {
          console.error('[HistoryManager] chained async command error:', err);
        })
        .finally(() => {
          this.activeAsyncOps = Math.max(0, this.activeAsyncOps - 1);
          this.notify();
        });
      return;
    }

    executeNow();
  }

  public execute(command: ICommand, docId?: string): void {
    const targetDocId = command.docId || this.resolveDocId(docId);
    command.docId = targetDocId;
    const stacks = this.getOrCreateStacks(targetDocId);

    this.runWithApplying(() => command.execute());
    stacks.undoStack.push(command);
    if (stacks.undoStack.length > this.maxHistory) {
      stacks.undoStack.shift();
    }
    stacks.redoStack = [];
    this.lastPushTime = Date.now();
    this.notify();
  }

  public async executeAsync(command: ICommand, docId?: string): Promise<void> {
    this.execute(command, docId);
    await this.pendingChain;
  }

  public push(command: ICommand, docId?: string): void {
    if (this.isApplyingFlag) return;

    const targetDocId = command.docId || this.resolveDocId(docId);
    command.docId = targetDocId;
    const stacks = this.getOrCreateStacks(targetDocId);
    const now = Date.now();

    if (
      command.mergeKey &&
      now - this.lastPushTime < 600 &&
      stacks.undoStack.length > 0
    ) {
      const top = stacks.undoStack[stacks.undoStack.length - 1];
      if (top.mergeKey === command.mergeKey && top.mergeWith?.(command)) {
        stacks.redoStack = [];
        this.lastPushTime = now;
        this.notify();
        return;
      }
    }

    stacks.undoStack.push(command);
    if (stacks.undoStack.length > this.maxHistory) {
      stacks.undoStack.shift();
    }
    stacks.redoStack = [];
    this.lastPushTime = now;
    this.notify();
  }

  public undo(docId?: string): boolean {
    const targetDocId = this.resolveDocId(docId);
    const stacks = this.stacksByDoc.get(targetDocId);
    if (!stacks || stacks.undoStack.length === 0) return false;

    const command = stacks.undoStack.pop()!;
    this.runWithApplying(() => command.undo());
    stacks.redoStack.push(command);
    this.notify();
    return true;
  }

  public async undoAsync(docId?: string): Promise<boolean> {
    const didStart = this.undo(docId);
    await this.pendingChain;
    return didStart;
  }

  public redo(docId?: string): boolean {
    const targetDocId = this.resolveDocId(docId);
    const stacks = this.stacksByDoc.get(targetDocId);
    if (!stacks || stacks.redoStack.length === 0) return false;

    const command = stacks.redoStack.pop()!;
    this.runWithApplying(() => command.execute());
    stacks.undoStack.push(command);
    this.notify();
    return true;
  }

  public async redoAsync(docId?: string): Promise<boolean> {
    const didStart = this.redo(docId);
    await this.pendingChain;
    return didStart;
  }

  public canUndo(docId?: string): boolean {
    const targetDocId = this.resolveDocId(docId);
    const stacks = this.stacksByDoc.get(targetDocId);
    return Boolean(stacks && stacks.undoStack.length > 0);
  }

  public canRedo(docId?: string): boolean {
    const targetDocId = this.resolveDocId(docId);
    const stacks = this.stacksByDoc.get(targetDocId);
    return Boolean(stacks && stacks.redoStack.length > 0);
  }

  public getUndoStackSize(docId?: string): number {
    const targetDocId = this.resolveDocId(docId);
    return this.stacksByDoc.get(targetDocId)?.undoStack.length ?? 0;
  }

  public getRedoStackSize(docId?: string): number {
    const targetDocId = this.resolveDocId(docId);
    return this.stacksByDoc.get(targetDocId)?.redoStack.length ?? 0;
  }

  public clear(docId?: string): void {
    if (docId) {
      this.stacksByDoc.delete(docId);
    } else {
      const currentId = useDocumentStore.getState().currentDocument?.id;
      if (currentId) {
        this.stacksByDoc.delete(currentId);
      } else {
        this.stacksByDoc.clear();
      }
    }
    this.notify();
  }

  public clearAll(): void {
    this.stacksByDoc.clear();
    this.notify();
  }
}

export const historyManager = new HistoryManager();
