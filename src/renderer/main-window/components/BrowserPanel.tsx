import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Plus, SquarePen, Star, Trash2 } from 'lucide-react'
import type { Bookmark } from '@shared/types/browser'
import { MenuItem } from './MenuItem'

/** サイドバーのブラウザパネル。新しいブラウザタブを開くボタンと、プロジェクトのブックマークの一覧。 */
export function BrowserPanel({
  bookmarks,
  onNewTab,
  onOpenBookmark,
  onAddBookmark,
  onEditBookmark,
  onDeleteBookmark
}: {
  bookmarks: Bookmark[]
  onNewTab: () => void
  onOpenBookmark: (bookmark: Bookmark) => void
  onAddBookmark: () => void
  onEditBookmark: (bookmark: Bookmark) => void
  onDeleteBookmark: (bookmark: Bookmark) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<{ x: number; y: number; bookmark: Bookmark } | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const headerButton = 'flex h-5 w-5 items-center justify-center rounded hover:bg-accent hover:text-foreground'

  return (
    <div className="flex h-full flex-col p-2">
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{t('sidebar.browser')}</span>
        <span className="flex gap-0.5">
          <button className={headerButton} title={t('browser.addBookmark')} onClick={onAddBookmark}>
            <Star size={13} />
          </button>
          <button className={headerButton} title={t('browser.newTab')} onClick={onNewTab}>
            <Plus size={13} />
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {bookmarks.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">{t('browser.noBookmarks')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {bookmarks.map((bookmark) => (
              <li key={bookmark.id}>
                <button
                  className="flex w-full items-center gap-1.5 truncate rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
                  onClick={() => onOpenBookmark(bookmark)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, bookmark })
                  }}
                >
                  <Globe size={14} className="shrink-0 text-muted-foreground" />
                  <span className="truncate" title={bookmark.url}>
                    {bookmark.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div
            className="fixed z-50 min-w-36 rounded-md border bg-popover p-1 text-sm shadow-md"
            style={{ left: menu.x, top: menu.y }}
          >
            <MenuItem
              icon={<SquarePen size={14} />}
              onClick={() => {
                onEditBookmark(menu.bookmark)
                setMenu(null)
              }}
            >
              {t('browser.editBookmark')}
            </MenuItem>
            <MenuItem
              icon={<Trash2 size={14} />}
              onClick={() => {
                onDeleteBookmark(menu.bookmark)
                setMenu(null)
              }}
            >
              {t('common.delete')}
            </MenuItem>
          </div>
        </>
      )}
    </div>
  )
}
