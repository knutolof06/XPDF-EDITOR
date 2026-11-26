import { BookmarkItem } from '@/types/advanced';
import { PdfDocumentModel } from '@/types/document';

const STORAGE_PREFIX = 'xpdf_bookmarks_';

export function getBookmarkStorageKey(doc: Pick<PdfDocumentModel, 'filePath' | 'name'> | null): string | null {
  if (!doc) return null;
  const rawKey = (doc.filePath || doc.name || '').trim();
  if (!rawKey) return null;
  return `${STORAGE_PREFIX}${encodeURIComponent(rawKey)}`;
}

export function loadSavedBookmarks(docKey: string | null): BookmarkItem[] | null {
  if (!docKey || typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(docKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveBookmarks(docKey: string | null, items: BookmarkItem[]): void {
  if (!docKey || typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(docKey, JSON.stringify(items));
  } catch {
    // ignore storage quota errors
  }
}

export function clearSavedBookmarks(docKey: string | null): void {
  if (!docKey || typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.removeItem(docKey);
  } catch {
    // ignore
  }
}

export function createBookmarkItem(title: string, pageIndex: number): BookmarkItem {
  return {
    id: `bm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    title,
    pageIndex,
    expanded: true,
  };
}

export function addBookmarkNode(
  tree: BookmarkItem[],
  parentId: string | null,
  newItem: BookmarkItem
): BookmarkItem[] {
  if (!parentId) {
    return [...tree, newItem];
  }
  return tree.map((node) => {
    if (node.id === parentId) {
      return {
        ...node,
        expanded: true,
        children: [...(node.children || []), newItem],
      };
    }
    if (node.children && node.children.length > 0) {
      return {
        ...node,
        children: addBookmarkNode(node.children, parentId, newItem),
      };
    }
    return node;
  });
}

export function updateBookmarkNode(
  tree: BookmarkItem[],
  id: string,
  patch: Partial<BookmarkItem>
): BookmarkItem[] {
  return tree.map((node) => {
    if (node.id === id) {
      return { ...node, ...patch };
    }
    if (node.children && node.children.length > 0) {
      return {
        ...node,
        children: updateBookmarkNode(node.children, id, patch),
      };
    }
    return node;
  });
}

export function deleteBookmarkNode(tree: BookmarkItem[], id: string): BookmarkItem[] {
  const result: BookmarkItem[] = [];
  for (const node of tree) {
    if (node.id === id) continue;
    if (node.children && node.children.length > 0) {
      result.push({
        ...node,
        children: deleteBookmarkNode(node.children, id),
      });
    } else {
      result.push(node);
    }
  }
  return result;
}

export function moveBookmarkNode(
  tree: BookmarkItem[],
  id: string,
  direction: 'up' | 'down' | 'indent' | 'outdent'
): BookmarkItem[] {
  const idx = tree.findIndex((item) => item.id === id);

  if (idx !== -1) {
    const next = [...tree];
    if (direction === 'up' && idx > 0) {
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    }
    if (direction === 'down' && idx < next.length - 1) {
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    }
    if (direction === 'indent' && idx > 0) {
      const target = next[idx];
      const prevSibling = next[idx - 1];
      next.splice(idx, 1);
      next[idx - 1] = {
        ...prevSibling,
        expanded: true,
        children: [...(prevSibling.children || []), target],
      };
      return next;
    }
    return tree;
  }

  // Handle outdent or nested up/down/indent inside children
  const result: BookmarkItem[] = [];
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i];
    if (!node.children || node.children.length === 0) {
      result.push(node);
      continue;
    }

    if (direction === 'outdent') {
      const childIdx = node.children.findIndex((c) => c.id === id);
      if (childIdx !== -1) {
        const promoted = node.children[childIdx];
        const remainingChildren = node.children.filter((c) => c.id !== id);
        result.push({
          ...node,
          children: remainingChildren.length > 0 ? remainingChildren : undefined,
        });
        result.push(promoted);
        continue;
      }
    }

    result.push({
      ...node,
      children: moveBookmarkNode(node.children, id, direction),
    });
  }
  return result;
}

export function filterBookmarks(tree: BookmarkItem[], query: string): BookmarkItem[] {
  const q = query.trim().toLocaleLowerCase('tr-TR');
  if (!q) return tree;

  const filtered: BookmarkItem[] = [];
  for (const node of tree) {
    const childMatches = node.children ? filterBookmarks(node.children, query) : [];
    const selfMatch = node.title.toLocaleLowerCase('tr-TR').includes(q);
    if (selfMatch || childMatches.length > 0) {
      filtered.push({
        ...node,
        expanded: true,
        children: childMatches.length > 0 ? childMatches : node.children,
      });
    }
  }
  return filtered;
}

export function findActiveBookmarkId(tree: BookmarkItem[], activePageIndex: number): string | null {
  let bestId: string | null = null;
  let bestPage = -1;

  const walk = (nodes: BookmarkItem[]) => {
    for (const node of nodes) {
      if (node.pageIndex <= activePageIndex && node.pageIndex >= bestPage) {
        bestPage = node.pageIndex;
        bestId = node.id;
      }
      if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  };

  walk(tree);
  return bestId;
}

export function countBookmarks(tree: BookmarkItem[]): number {
  let total = 0;
  for (const node of tree) {
    total += 1;
    if (node.children && node.children.length > 0) {
      total += countBookmarks(node.children);
    }
  }
  return total;
}
