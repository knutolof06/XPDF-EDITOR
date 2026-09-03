import { PdfPageModel, PdfDocumentModel } from '@/types/document';
import { useDocumentStore } from '@/store/document-store';

export interface ICommand {
  description: string;
  execute(): void;
  undo(): void;
}

export class MovePageCommand implements ICommand {
  public description: string;
  private fromIndex: number;
  private toIndex: number;

  constructor(fromIndex: number, toIndex: number) {
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
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
  private pageIds: string[];
  private targetIndex: number;
  private position: 'before' | 'after';
  private originalOrder: PdfPageModel[] = [];

  constructor(pageIds: string[], targetIndex: number, position: 'before' | 'after') {
    this.pageIds = pageIds;
    this.targetIndex = targetIndex;
    this.position = position;
    this.description = `${pageIds.length} sayfa taşındı`;
    const doc = useDocumentStore.getState().currentDocument;
    if (doc) {
      this.originalOrder = doc.pages.map((p) => ({ ...p }));
    }
  }

  public execute(): void {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc || this.pageIds.length === 0) return;

    const pages = [...doc.pages];
    const targetPage = pages[this.targetIndex];
    if (!targetPage) return;

    const movingPages = pages.filter((p) => this.pageIds.includes(p.id));
    const remainingPages = pages.filter((p) => !this.pageIds.includes(p.id));

    let insertIndex = remainingPages.findIndex((p) => p.id === targetPage.id);
    if (insertIndex === -1) {
      insertIndex = this.targetIndex;
    } else if (this.position === 'after') {
      insertIndex += 1;
    }

    remainingPages.splice(insertIndex, 0, ...movingPages);
    const updatedPages = remainingPages.map((p, idx) => ({
      ...p,
      displayPageNumber: idx + 1,
    }));

    useDocumentStore.setState({
      currentDocument: {
        ...doc,
        pages: updatedPages,
        selectedPageIds: this.pageIds,
        isModified: true,
      },
    });
  }

  public undo(): void {
    const doc = useDocumentStore.getState().currentDocument;
    if (doc && this.originalOrder.length > 0) {
      const restoredPages = this.originalOrder.map((p, idx) => ({
        ...p,
        displayPageNumber: idx + 1,
      }));
      useDocumentStore.setState({
        currentDocument: {
          ...doc,
          pages: restoredPages,
          isModified: true,
        },
      });
    }
  }
}

export class RotatePageCommand implements ICommand {
  public description: string;
  private pageIds: string[];
  private angle: number;

  constructor(pageIds: string[], angle: number) {
    this.pageIds = pageIds;
    this.angle = angle;
    this.description = `${pageIds.length} sayfa ${angle}° döndürüldü`;
  }

  public execute(): void {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;
    const pages = doc.pages.map((p) => {
      if (this.pageIds.includes(p.id)) {
        return { ...p, rotation: (p.rotation + this.angle + 360) % 360 };
      }
      return { ...p };
    });
    useDocumentStore.setState({
      currentDocument: {
        ...doc,
        pages,
        isModified: true,
      },
    });
  }

  public undo(): void {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;
    const pages = doc.pages.map((p) => {
      if (this.pageIds.includes(p.id)) {
        return { ...p, rotation: (p.rotation - this.angle + 360) % 360 };
      }
      return { ...p };
    });
    useDocumentStore.setState({
      currentDocument: {
        ...doc,
        pages,
        isModified: true,
      },
    });
  }
}

export class DeletePageCommand implements ICommand {
  public description: string;
  private deletedPages: { page: PdfPageModel; index: number }[];

  constructor(deletedPages: { page: PdfPageModel; index: number }[]) {
    this.deletedPages = deletedPages.map((d) => ({
      page: { ...d.page },
      index: d.index,
    }));
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
    useDocumentStore.setState({
      currentDocument: {
        ...doc,
        pages: updatedPages,
        totalPages: updatedPages.length,
        selectedPageIds: [],
        isModified: true,
      },
    });
  }

  public undo(): void {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;

    const pages = [...doc.pages];
    // Sort ascending by index before inserting
    const sorted = [...this.deletedPages].sort((a, b) => a.index - b.index);
    sorted.forEach(({ page, index }) => {
      const safeIndex = Math.min(index, pages.length);
      pages.splice(safeIndex, 0, { ...page });
    });

    const updatedPages = pages.map((p, idx) => ({
      ...p,
      displayPageNumber: idx + 1,
    }));

    useDocumentStore.setState({
      currentDocument: {
        ...doc,
        pages: updatedPages,
        totalPages: updatedPages.length,
        isModified: true,
      },
    });
  }
}

export class GenericCommand implements ICommand {
  constructor(
    public description: string,
    private executeFn: () => void,
    private undoFn: () => void
  ) {}

  public execute(): void {
    this.executeFn();
  }

  public undo(): void {
    this.undoFn();
  }
}

export class DocumentStateSnapshotCommand implements ICommand {
  constructor(
    public description: string,
    private prevModel: PdfDocumentModel,
    private prevProxy: any,
    private nextModel: PdfDocumentModel,
    private nextProxy: any
  ) {}

  public execute(): void {
    useDocumentStore.getState().setDocument(this.nextModel, this.nextProxy);
  }

  public undo(): void {
    useDocumentStore.getState().setDocument(this.prevModel, this.prevProxy);
  }
}

class HistoryManager {
  private undoStack: ICommand[] = [];
  private redoStack: ICommand[] = [];
  private maxHistory: number = 50;
  private listeners: Set<() => void> = new Set();

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

  public execute(command: ICommand): void {
    command.execute();
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Clear redo on new action
    this.notify();
  }

  public push(command: ICommand): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.notify();
  }

  public undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo();
    this.redoStack.push(command);
    this.notify();
    return true;
  }

  public redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.execute();
    this.undoStack.push(command);
    this.notify();
    return true;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }
}

export const historyManager = new HistoryManager();
