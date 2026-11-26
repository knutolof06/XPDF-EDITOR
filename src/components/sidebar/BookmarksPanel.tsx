import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { PdfOutlineExtractor } from '@/core/pdf/pdf-outline';
import { BookmarkItem } from '@/types/advanced';
import {
  addBookmarkNode,
  clearSavedBookmarks,
  countBookmarks,
  createBookmarkItem,
  deleteBookmarkNode,
  filterBookmarks,
  findActiveBookmarkId,
  getBookmarkStorageKey,
  loadSavedBookmarks,
  moveBookmarkNode,
  saveBookmarks,
  updateBookmarkNode,
} from './bookmark-storage';
import {
  Bookmark,
  ChevronRight,
  ChevronDown,
  FileText,
  Plus,
  Search,
  Trash2,
  Edit2,
  ArrowUp,
  ArrowDown,
  IndentIncrease,
  IndentDecrease,
  RotateCcw,
  FolderPlus,
  X,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const BookmarksPanel: React.FC = () => {
  const { currentDocument, pdfDocProxy, setActivePageIndex } = useDocumentStore();
  const addToast = useUIStore((s) => s.addToast);

  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [originalBookmarks, setOriginalBookmarks] = useState<BookmarkItem[]>([]);
  const [hasCustomEdits, setHasCustomEdits] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const storageKey = getBookmarkStorageKey(currentDocument);

  useEffect(() => {
    let cancelled = false;

    async function loadBookmarks() {
      if (!pdfDocProxy) {
        setBookmarks([]);
        setOriginalBookmarks([]);
        setHasCustomEdits(false);
        return;
      }

      setIsLoading(true);
      try {
        const extracted = await PdfOutlineExtractor.extractOutline(pdfDocProxy);
        if (cancelled) return;
        setOriginalBookmarks(extracted);

        const saved = loadSavedBookmarks(storageKey);
        if (saved) {
          setBookmarks(saved);
          setHasCustomEdits(true);
        } else {
          setBookmarks(extracted);
          setHasCustomEdits(false);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadBookmarks();
    return () => {
      cancelled = true;
    };
  }, [pdfDocProxy, storageKey]);

  const persistUpdate = (updater: (prev: BookmarkItem[]) => BookmarkItem[]) => {
    setBookmarks((prev) => {
      const next = updater(prev);
      saveBookmarks(storageKey, next);
      setHasCustomEdits(true);
      return next;
    });
  };

  const handleAddBookmark = (parentId: string | null = null) => {
    const activeIdx = currentDocument?.activePageIndex ?? 0;
    const item = createBookmarkItem(`Sayfa ${activeIdx + 1}`, activeIdx);
    persistUpdate((prev) => addBookmarkNode(prev, parentId, item));
    setEditingId(item.id);
    addToast(`Sayfa ${activeIdx + 1} için yer imi eklendi.`, 'success', 1500);
  };

  const handleResetToOriginal = () => {
    clearSavedBookmarks(storageKey);
    setBookmarks(originalBookmarks);
    setHasCustomEdits(false);
    setEditingId(null);
    addToast('Yer imleri belge varsayılanına sıfırlandı.', 'info', 1500);
  };

  const activePageIndex = currentDocument?.activePageIndex ?? 0;
  const activeBookmarkId = useMemo(
    () => findActiveBookmarkId(bookmarks, activePageIndex),
    [bookmarks, activePageIndex]
  );

  const displayedBookmarks = useMemo(
    () => filterBookmarks(bookmarks, searchQuery),
    [bookmarks, searchQuery]
  );

  const totalCount = useMemo(() => countBookmarks(bookmarks), [bookmarks]);

  if (isLoading) {
    return (
      <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
        <div className="w-5 h-5 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin mx-auto mb-2" />
        İçindekiler ağacı yükleniyor...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-3 select-none">
      {/* Header & Add Action */}
      <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
          <Bookmark className="w-3.5 h-3.5 text-sky-500 shrink-0" />
          <span className="truncate">İçindekiler ({totalCount})</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {hasCustomEdits && (
            <button
              type="button"
              aria-label="Yer imlerini orijinale sıfırla"
              onClick={handleResetToOriginal}
              className="p-1 rounded-md text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
              title="Belge Orijinaline Sıfırla"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            aria-label="Mevcut sayfa için yer imi ekle"
            onClick={() => handleAddBookmark(null)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-500/30 text-[11px] font-semibold transition-colors"
            title={`Sayfa ${activePageIndex + 1} için yer imi ekle`}
          >
            <Plus className="w-3 h-3" />
            <span>Ekle</span>
          </button>
        </div>
      </div>

      {/* Filter Input */}
      <div className="relative mb-2">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
        <input
          type="text"
          aria-label="Yer imlerinde ara"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Yer imlerinde ara..."
          className="w-full text-xs pl-8 pr-7 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-sky-500"
        />
        {searchQuery && (
          <button
            type="button"
            aria-label="Yer imi aramasını temizle"
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Tree or Empty State */}
      {bookmarks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center text-xs text-slate-500 dark:text-slate-400">
          <Bookmark className="w-8 h-8 text-slate-400 dark:text-slate-600 mx-auto mb-2" />
          <p className="font-semibold text-slate-700 dark:text-slate-300">İçindekiler Bulunamadı</p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">
            Bu PDF belgesinde tanımlı bir yer imi / içindekiler yapısı mevcut değil.
          </p>
          <button
            type="button"
            onClick={() => handleAddBookmark(null)}
            className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Sayfa {activePageIndex + 1} İçin Yer İmi Ekle</span>
          </button>
        </div>
      ) : displayedBookmarks.length === 0 ? (
        <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">
          Eşleşen yer imi bulunamadı.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-0.5 pr-0.5">
          {displayedBookmarks.map((bm) => (
            <BookmarkNode
              key={bm.id}
              item={bm}
              activeBookmarkId={activeBookmarkId}
              editingId={editingId}
              onStartEdit={setEditingId}
              onSelect={(pageIdx) => setActivePageIndex(pageIdx)}
              onRename={(id, newTitle) => {
                setEditingId(null);
                const trimmed = newTitle.trim();
                if (trimmed) {
                  persistUpdate((prev) => updateBookmarkNode(prev, id, { title: trimmed }));
                }
              }}
              onAddChild={(parentId) => handleAddBookmark(parentId)}
              onDelete={(id) => persistUpdate((prev) => deleteBookmarkNode(prev, id))}
              onMove={(id, dir) => persistUpdate((prev) => moveBookmarkNode(prev, id, dir))}
              onToggleExpand={(id, expanded) =>
                setBookmarks((prev) => updateBookmarkNode(prev, id, { expanded }))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface BookmarkNodeProps {
  item: BookmarkItem;
  activeBookmarkId: string | null;
  editingId: string | null;
  onStartEdit: (id: string | null) => void;
  onSelect: (pageIndex: number) => void;
  onRename: (id: string, newTitle: string) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down' | 'indent' | 'outdent') => void;
  onToggleExpand: (id: string, expanded: boolean) => void;
  level?: number;
}

const BookmarkNode: React.FC<BookmarkNodeProps> = ({
  item,
  activeBookmarkId,
  editingId,
  onStartEdit,
  onSelect,
  onRename,
  onAddChild,
  onDelete,
  onMove,
  onToggleExpand,
  level = 0,
}) => {
  const [draftTitle, setDraftTitle] = useState(item.title);
  const isExpanded = item.expanded !== false;
  const hasChildren = Boolean(item.children && item.children.length > 0);
  const isActive = activeBookmarkId === item.id;
  const isEditing = editingId === item.id;

  useEffect(() => {
    setDraftTitle(item.title);
  }, [item.title]);

  return (
    <div>
      <div
        onClick={() => {
          if (!isEditing) onSelect(item.pageIndex);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraftTitle(item.title);
          onStartEdit(item.id);
        }}
        style={{ paddingLeft: `${level * 12 + 6}px` }}
        className={cn(
          'group flex items-center justify-between gap-1 py-1.5 pr-1.5 rounded-lg cursor-pointer text-xs transition-colors',
          isActive
            ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 font-semibold'
            : 'hover:bg-slate-200/70 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-transparent'
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {hasChildren ? (
            <button
              type="button"
              aria-label={isExpanded ? 'Alt başlıkları daralt' : 'Alt başlıkları aç'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(item.id, !isExpanded);
              }}
              className="p-0.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 shrink-0"
            >
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          ) : (
            <FileText className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
          )}

          {isEditing ? (
            <input
              type="text"
              aria-label="Yer imi başlığını düzenle"
              value={draftTitle}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={() => onRename(item.id, draftTitle)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  onRename(item.id, draftTitle);
                } else if (e.key === 'Escape') {
                  setDraftTitle(item.title);
                  onStartEdit(null);
                }
              }}
              className="w-full px-1.5 py-0.5 text-xs bg-white dark:bg-slate-900 border border-sky-500 rounded text-slate-900 dark:text-white focus:outline-none"
            />
          ) : (
            <span
              className={cn(
                'truncate',
                item.bold && 'font-bold',
                item.italic && 'italic'
              )}
              title={`${item.title} (Sayfa ${item.pageIndex + 1})`}
            >
              {item.title}
            </span>
          )}
        </div>

        {/* Hover Actions + Page Badge */}
        <div className="flex items-center gap-0.5 shrink-0">
          {!isEditing && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="hidden group-hover:flex items-center gap-0.5 bg-white/90 dark:bg-slate-900/90 rounded px-0.5 border border-slate-200 dark:border-slate-700"
            >
              <button
                type="button"
                aria-label="Yeniden adlandır"
                onClick={() => {
                  setDraftTitle(item.title);
                  onStartEdit(item.id);
                }}
                className="p-0.5 text-slate-500 hover:text-sky-600 dark:hover:text-sky-400"
                title="Yeniden Adlandır"
              >
                <Edit2 className="w-2.5 h-2.5" />
              </button>
              <button
                type="button"
                aria-label="Alt yer imi ekle"
                onClick={() => onAddChild(item.id)}
                className="p-0.5 text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400"
                title="Alt Başlık Ekle"
              >
                <FolderPlus className="w-2.5 h-2.5" />
              </button>
              <button
                type="button"
                aria-label="Yukarı taşı"
                onClick={() => onMove(item.id, 'up')}
                className="p-0.5 text-slate-500 hover:text-slate-800 dark:hover:text-white"
                title="Yukarı Taşı"
              >
                <ArrowUp className="w-2.5 h-2.5" />
              </button>
              <button
                type="button"
                aria-label="Aşağı taşı"
                onClick={() => onMove(item.id, 'down')}
                className="p-0.5 text-slate-500 hover:text-slate-800 dark:hover:text-white"
                title="Aşağı Taşı"
              >
                <ArrowDown className="w-2.5 h-2.5" />
              </button>
              <button
                type="button"
                aria-label="Alt düzeye taşı"
                onClick={() => onMove(item.id, 'indent')}
                className="p-0.5 text-slate-500 hover:text-slate-800 dark:hover:text-white"
                title="Girintile (Alt Başlık Yap)"
              >
                <IndentIncrease className="w-2.5 h-2.5" />
              </button>
              {level > 0 && (
                <button
                  type="button"
                  aria-label="Üst düzeye taşı"
                  onClick={() => onMove(item.id, 'outdent')}
                  className="p-0.5 text-slate-500 hover:text-slate-800 dark:hover:text-white"
                  title="Üst Düzeye Çıkar"
                >
                  <IndentDecrease className="w-2.5 h-2.5" />
                </button>
              )}
              <button
                type="button"
                aria-label="Yer imini sil"
                onClick={() => onDelete(item.id)}
                className="p-0.5 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400"
                title="Sil"
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            </div>
          )}
          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 shrink-0 pl-1">
            s. {item.pageIndex + 1}
          </span>
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div className="space-y-0.5">
          {item.children!.map((child) => (
            <BookmarkNode
              key={child.id}
              item={child}
              activeBookmarkId={activeBookmarkId}
              editingId={editingId}
              onStartEdit={onStartEdit}
              onSelect={onSelect}
              onRename={onRename}
              onAddChild={onAddChild}
              onDelete={onDelete}
              onMove={onMove}
              onToggleExpand={onToggleExpand}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};
