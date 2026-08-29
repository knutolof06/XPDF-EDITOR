import { PdfPageModel } from '@/types/document';
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
      this.originalOrder = [...doc.pages];
    }
  }

  public execute(): void {
    useDocumentStore.getState().moveMultiplePages(this.pageIds, this.targetIndex, this.position);
  }

  public undo(): void {
    useDocumentStore.setState((state) => {
      if (state.currentDocument && this.originalOrder.length > 0) {
        state.currentDocument.pages = [...this.originalOrder];
        state.currentDocument.pages.forEach((p, idx) => {
          p.displayPageNumber = idx + 1;
        });
        state.currentDocument.isModified = true;
      }
    });
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
    const store = useDocumentStore.getState();
    this.pageIds.forEach((id) => store.rotatePage(id, this.angle));
  }

  public undo(): void {
    const store = useDocumentStore.getState();
    this.pageIds.forEach((id) => store.rotatePage(id, -this.angle));
  }
}

export class DeletePageCommand implements ICommand {
  public description: string;
  private deletedPages: { page: PdfPageModel; index: number }[];

  constructor(deletedPages: { page: PdfPageModel; index: number }[]) {
    this.deletedPages = deletedPages;
    this.description = `${deletedPages.length} sayfa silindi`;
  }

  public execute(): void {
    const store = useDocumentStore.getState();
    this.deletedPages.forEach(({ page }) => store.deletePage(page.id));
  }

  public undo(): void {
    const store = useDocumentStore.getState();
    const doc = store.currentDocument;
    if (!doc) return;

    // Restore pages at their original indices
    useDocumentStore.setState((state) => {
      if (!state.currentDocument) return;
      const pages = [...state.currentDocument.pages];
      
      this.deletedPages.forEach(({ page, index }) => {
        pages.splice(index, 0, page);
      });

      pages.forEach((p, idx) => {
        p.displayPageNumber = idx + 1;
      });

      state.currentDocument.pages = pages;
      state.currentDocument.totalPages = pages.length;
      state.currentDocument.isModified = true;
    });
  }
}

class HistoryManager {
  private undoStack: ICommand[] = [];
  private redoStack: ICommand[] = [];
  private maxHistory: number = 50;

  public execute(command: ICommand): void {
    command.execute();
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Clear redo on new action
  }

  public undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo();
    this.redoStack.push(command);
    return true;
  }

  public redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.execute();
    this.undoStack.push(command);
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
  }
}

export const historyManager = new HistoryManager();
