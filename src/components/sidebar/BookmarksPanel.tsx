import React, { useEffect, useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { PdfOutlineExtractor } from '@/core/pdf/pdf-outline';
import { BookmarkItem } from '@/types/advanced';
import { Bookmark, ChevronRight, ChevronDown, FileText } from 'lucide-react';
import { cn } from '@/utils/cn';

export const BookmarksPanel: React.FC = () => {
  const { pdfDocProxy, setActivePageIndex } = useDocumentStore();
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function loadBookmarks() {
      if (!pdfDocProxy) {
        setBookmarks([]);
        return;
      }

      setIsLoading(true);
      try {
        const list = await PdfOutlineExtractor.extractOutline(pdfDocProxy);
        setBookmarks(list);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }

    loadBookmarks();
  }, [pdfDocProxy]);

  if (isLoading) {
    return (
      <div className="p-6 text-center text-xs text-slate-400">
        <div className="w-5 h-5 border-2 border-sky-500/30 border-t-sky-400 rounded-full animate-spin mx-auto mb-2" />
        İçindekiler ağacı yükleniyor...
      </div>
    );
  }

  if (bookmarks.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-slate-400">
        <Bookmark className="w-8 h-8 text-slate-600 mx-auto mb-2" />
        <p className="font-semibold text-slate-300">İçindekiler Bulunamadı</p>
        <p className="mt-1 text-[11px] text-slate-500">Bu PDF dökümanında tanımlı bir içindekiler / bookmark yapısı mevcut değil.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-1 select-none">
      <div className="text-xs font-semibold text-slate-400 px-2 pb-2 mb-1 border-b border-slate-800 flex items-center gap-1.5">
        <Bookmark className="w-3.5 h-3.5 text-sky-400" />
        İçindekiler ({bookmarks.length} Başlık)
      </div>

      {bookmarks.map((bm) => (
        <BookmarkNode
          key={bm.id}
          item={bm}
          onSelect={(pageIdx) => setActivePageIndex(pageIdx)}
        />
      ))}
    </div>
  );
};

const BookmarkNode: React.FC<{
  item: BookmarkItem;
  onSelect: (pageIndex: number) => void;
  level?: number;
}> = ({ item, onSelect, level = 0 }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = item.children && item.children.length > 0;

  return (
    <div>
      <div
        onClick={() => onSelect(item.pageIndex)}
        style={{ paddingLeft: `${level * 14 + 8}px` }}
        className="group flex items-center justify-between py-1.5 pr-2 rounded-lg hover:bg-slate-800/80 cursor-pointer text-xs transition-colors"
      >
        <div className="flex items-center gap-1.5 truncate">
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className="p-0.5 text-slate-400 hover:text-slate-200"
            >
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          ) : (
            <FileText className="w-3 h-3 text-slate-500 shrink-0" />
          )}

          <span
            className={cn(
              'truncate text-slate-300 group-hover:text-sky-300',
              item.bold ? 'font-bold' : '',
              item.italic ? 'italic' : ''
            )}
          >
            {item.title}
          </span>
        </div>

        <span className="text-[10px] font-semibold text-slate-500 group-hover:text-slate-300 shrink-0">
          s. {item.pageIndex + 1}
        </span>
      </div>

      {hasChildren && isExpanded && (
        <div className="space-y-0.5">
          {item.children!.map((child) => (
            <BookmarkNode
              key={child.id}
              item={child}
              onSelect={onSelect}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};
