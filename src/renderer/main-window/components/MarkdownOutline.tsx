import { useTranslation } from 'react-i18next'
import { TableOfContents } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../shared/components/ui/dropdown-menu'
import { cn } from '../../shared/lib/utils'
import type { OutlineItem } from '../markdownOutline'

/** 見出しのレベル 1 段あたりの字下げ（px）。 */
const INDENT_PX = 12

/** いちばん浅い見出しのレベル。そこを字下げ 0 にする。 */
function shallowestLevel(items: OutlineItem[]): number {
  return Math.min(...items.map((item) => item.level))
}

/** エディタの左に置くアウトラインの一覧。 */
export function OutlinePane({
  items,
  onSelect
}: {
  items: OutlineItem[]
  onSelect: (item: OutlineItem) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const minLevel = shallowestLevel(items)
  return (
    <nav
      data-find-ignore
      aria-label={t('editor.outline')}
      className="h-full w-full overflow-y-auto py-1 text-xs"
    >
      {items.length === 0 ? (
        <p className="px-3 py-1.5 text-muted-foreground">{t('editor.outlineEmpty')}</p>
      ) : (
        items.map((item, i) => (
          <button
            key={`${item.line}:${i}`}
            className={cn(
              'block w-full truncate py-1 pr-2 text-left hover:bg-accent hover:text-foreground',
              item.level <= 2 ? 'text-foreground' : 'text-muted-foreground'
            )}
            style={{ paddingLeft: 12 + (item.level - minLevel) * INDENT_PX }}
            title={item.text}
            onClick={() => onSelect(item)}
          >
            {item.text || ' '}
          </button>
        ))
      )}
    </nav>
  )
}

/** 幅が狭いときの、ボタンから開くアウトラインの一覧。 */
export function OutlineMenu({
  items,
  onSelect
}: {
  items: OutlineItem[]
  onSelect: (item: OutlineItem) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const minLevel = shallowestLevel(items)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t('editor.outline')}
        >
          <TableOfContents size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[60vh] max-w-80 overflow-y-auto"
        // 選んだ見出しへ移したフォーカスを、ボタンへ戻さない。
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {items.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('editor.outlineEmpty')}</p>
        ) : (
          items.map((item, i) => (
            <DropdownMenuItem
              key={`${item.line}:${i}`}
              className="block truncate py-1 text-xs"
              style={{ paddingLeft: 8 + (item.level - minLevel) * INDENT_PX }}
              title={item.text}
              onSelect={() => onSelect(item)}
            >
              {item.text || ' '}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
