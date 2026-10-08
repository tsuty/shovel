import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { findTextMatches } from '../findInPage'

const HIGHLIGHT = 'shovel-find'
const HIGHLIGHT_ACTIVE = 'shovel-find-active'
/** 検索中にトランスクリプトが流れてきたとき、照合し直すまでの待ち。 */
const RESCAN_DEBOUNCE_MS = 150

/**
 * ページ内検索バー（Cmd/Ctrl+F）。`root` の中の、いま見えているテキスト（textarea / input の中身は除く）を探す。
 * ヒット箇所は CSS Custom Highlight API で塗る（DOM を書き換えないので React の描画と衝突しない）。
 */
export function FindBar({ root }: { root: React.RefObject<HTMLElement | null> }): React.JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [ranges, setRanges] = useState<Range[]>([])
  const [active, setActive] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const isMac = window.shovel.platform === 'darwin'
    function handleKeyDown(event: KeyboardEvent): void {
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey
      if (!modifierPressed || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      setOpen(true)
      // 既に開いていれば入力欄へ戻して全選択する（ブラウザと同じ）。
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const scan = useCallback((): Range[] => {
    const container = root.current
    if (!container || !query) return []
    const nodes = collectVisibleTextNodes(container, barRef.current)
    return findTextMatches(
      nodes.map((node) => node.data),
      query
    ).flatMap((match) => {
      const startNode = nodes[match.start.segment]
      const endNode = nodes[match.end.segment]
      if (!startNode || !endNode) return []
      const range = document.createRange()
      range.setStart(startNode, match.start.offset)
      range.setEnd(endNode, match.end.offset)
      return [range]
    })
  }, [root, query])

  // 語が変わったら先頭のヒットから。
  useEffect(() => {
    if (!open) return
    const found = scan()
    setRanges(found)
    setActive(0)
    if (found[0]) scrollToRange(found[0])
  }, [open, scan])

  // 開いている間は、本文の変化（ストリーミング・タブ切り替え・折り畳み）に合わせて照合し直す。
  useEffect(() => {
    const container = root.current
    if (!open || !query || !container) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new MutationObserver((records) => {
      if (records.every((record) => barRef.current?.contains(record.target))) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        const found = scan()
        setRanges(found)
        setActive((current) => Math.min(current, Math.max(found.length - 1, 0)))
      }, RESCAN_DEBOUNCE_MS)
    })
    observer.observe(container, { subtree: true, childList: true, characterData: true, attributes: true })
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [open, query, root, scan])

  useEffect(() => {
    const current = ranges[active]
    if (!open || !current) {
      CSS.highlights.delete(HIGHLIGHT)
      CSS.highlights.delete(HIGHLIGHT_ACTIVE)
      return
    }
    CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges))
    CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(current))
  }, [open, ranges, active])

  useEffect(
    () => () => {
      CSS.highlights.delete(HIGHLIGHT)
      CSS.highlights.delete(HIGHLIGHT_ACTIVE)
    },
    []
  )

  function step(forward: boolean): void {
    if (ranges.length === 0) return
    const next = (active + (forward ? 1 : -1) + ranges.length) % ranges.length
    setActive(next)
    const range = ranges[next]
    if (range) scrollToRange(range)
  }

  function close(): void {
    setOpen(false)
    setRanges([])
  }

  if (!open) return null

  const count = !query ? '' : ranges.length === 0 ? t('findBar.noMatches') : `${active + 1} / ${ranges.length}`

  return (
    <div
      ref={barRef}
      className="absolute right-4 top-2 z-40 flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 shadow-md"
    >
      <input
        ref={inputRef}
        autoFocus
        value={query}
        placeholder={t('findBar.placeholder')}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            step(!e.shiftKey)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
        className="w-56 bg-transparent px-1 text-sm outline-none"
      />
      <span className="min-w-12 text-right text-xs tabular-nums text-muted-foreground">{count}</span>
      <button
        type="button"
        title={t('findBar.previous')}
        disabled={ranges.length === 0}
        onClick={() => step(false)}
        className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        title={t('findBar.next')}
        disabled={ranges.length === 0}
        onClick={() => step(true)}
        className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
      >
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        title={t('findBar.close')}
        onClick={close}
        className="rounded p-1 text-muted-foreground hover:bg-muted"
      >
        <X size={14} />
      </button>
    </div>
  )
}

/** `container` の中の、表示されているテキストノード（`exclude` の中は除く）。 */
function collectVisibleTextNodes(container: HTMLElement, exclude: HTMLElement | null): Text[] {
  const visibility = new Map<Element, boolean>()
  const isVisible = (element: Element): boolean => {
    let visible = visibility.get(element)
    if (visible === undefined) {
      visible = element.checkVisibility({ visibilityProperty: true })
      visibility.set(element, visible)
    }
    return visible
  }
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement
      if (!parent || !node.nodeValue) return NodeFilter.FILTER_REJECT
      if (exclude?.contains(parent) || parent.closest('script, style, textarea')) return NodeFilter.FILTER_REJECT
      return isVisible(parent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  return nodes
}

function scrollToRange(range: Range): void {
  range.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' })
}
