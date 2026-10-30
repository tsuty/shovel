import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, ExternalLink, RotateCw, Star, X } from 'lucide-react'
import { addressToUrl, BLANK_PAGE, isWebUrl } from '@shared/browserUrl'
import { cn } from '../../shared/lib/utils'
import { registerEditorSearch } from '../editorSearch'

/** ブラウザのタブの保存領域。main の `browserGuest.ts` でも同じ値を強制する。 */
const BROWSER_PARTITION = 'persist:shovel-browser'

/** `<webview>` の、ここで使うメソッドだけ。 */
interface WebviewElement extends HTMLElement {
  src: string
  getURL(): string
  getTitle(): string
  isLoading(): boolean
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  loadURL(url: string): Promise<void>
  getWebContentsId(): number
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): number
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
}

/**
 * ブラウザのタブ。`<webview>` は React に描かせず自前で作る（`allowpopups` などの属性を付けてから DOM に入れる
 * 必要があり、`src` を React が書き換えると読み直しになるため）。`initialUrl` は最初に開くページだけに使う。
 */
export function BrowserView({
  initialUrl,
  bookmarked,
  onNavigate,
  onTitleChange,
  onToggleBookmark,
  onFocus
}: {
  initialUrl: string
  /** 今のページがブックマークにあるか。 */
  bookmarked: boolean
  onNavigate: (url: string) => void
  onTitleChange: (title: string) => void
  onToggleBookmark: (url: string, title: string) => void
  /** ページにフォーカスが移った（分割ビューで前面のペインにする）。 */
  onFocus: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<WebviewElement | null>(null)
  const readyRef = useRef(false)
  const addressRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(isWebUrl(initialUrl) ? initialUrl : '')
  const [address, setAddress] = useState(url)
  const [editingAddress, setEditingAddress] = useState(false)
  const [loading, setLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<{ active: number; total: number } | null>(null)
  const findInputRef = useRef<HTMLInputElement>(null)

  const callbacksRef = useRef({ onNavigate, onTitleChange, onFocus })
  callbacksRef.current = { onNavigate, onTitleChange, onFocus }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const webview = document.createElement('webview') as WebviewElement
    webview.setAttribute('partition', BROWSER_PARTITION)
    webview.setAttribute('allowpopups', '')
    webview.className = 'h-full w-full'
    webview.src = isWebUrl(initialUrl) ? initialUrl : BLANK_PAGE
    webviewRef.current = webview

    const syncHistory = (): void => {
      if (!readyRef.current) return
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
    }
    const onNavigated = (event: Event): void => {
      const { url: next, isMainFrame } = event as Event & { url: string; isMainFrame?: boolean }
      if (isMainFrame === false) return
      const shown = isWebUrl(next) ? next : ''
      setUrl(shown)
      if (!editingRef.current) setAddress(shown)
      if (shown) callbacksRef.current.onNavigate(shown)
      syncHistory()
    }
    const listeners: [string, (event: Event) => void][] = [
      [
        'dom-ready',
        () => {
          readyRef.current = true
          syncHistory()
        }
      ],
      ['did-navigate', onNavigated],
      ['did-navigate-in-page', onNavigated],
      ['did-start-loading', () => setLoading(true)],
      [
        'did-stop-loading',
        () => {
          setLoading(false)
          syncHistory()
        }
      ],
      ['page-title-updated', (event) => callbacksRef.current.onTitleChange((event as Event & { title: string }).title)],
      [
        'found-in-page',
        (event) => {
          const { result } = event as Event & { result: { activeMatchOrdinal: number; matches: number; finalUpdate: boolean } }
          if (result.finalUpdate) setMatches({ active: result.activeMatchOrdinal, total: result.matches })
        }
      ]
    ]
    for (const [name, listener] of listeners) webview.addEventListener(name, listener)
    host.appendChild(webview)
    return () => {
      for (const [name, listener] of listeners) webview.removeEventListener(name, listener)
      webview.remove()
      webviewRef.current = null
      readyRef.current = false
    }
    // `initialUrl` は最初の1回だけ使う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 空のページで開いたときは、すぐ入力できるようにアドレスバーへフォーカスする。
  useEffect(() => {
    if (!isWebUrl(initialUrl)) addressRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** アドレスバーを編集中は、ページの移動でアドレスバーの文字を書き換えない。 */
  const editingRef = useRef(false)
  editingRef.current = editingAddress

  function openFind(): void {
    setFindOpen(true)
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }

  // ページ以外にフォーカスがあるときの Cmd/Ctrl+F（このペインが前面なら FindBar から渡される）。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    return registerEditorSearch({ element: host, open: openFind })
  }, [])

  // ページにフォーカスがあるときの Cmd/Ctrl+F（main が拾って渡す）。
  useEffect(
    () =>
      window.shovel.browser.onFindRequested((webContentsId) => {
        const webview = webviewRef.current
        if (webview && readyRef.current && webview.getWebContentsId() === webContentsId) openFind()
      }),
    []
  )

  useEffect(
    () =>
      window.shovel.browser.onFocused((webContentsId) => {
        const webview = webviewRef.current
        if (webview && readyRef.current && webview.getWebContentsId() === webContentsId) callbacksRef.current.onFocus()
      }),
    []
  )

  function find(forward: boolean, findNext: boolean): void {
    const webview = webviewRef.current
    if (!webview || !readyRef.current) return
    if (!query) {
      webview.stopFindInPage('clearSelection')
      setMatches(null)
      return
    }
    webview.findInPage(query, { forward, findNext })
  }

  // 語が変わったら最初から探し直す。
  useEffect(() => {
    if (findOpen) find(true, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, findOpen])

  function closeFind(): void {
    setFindOpen(false)
    setMatches(null)
    if (readyRef.current) webviewRef.current?.stopFindInPage('clearSelection')
  }

  function navigate(): void {
    const next = addressToUrl(address)
    if (!next) return
    setEditingAddress(false)
    addressRef.current?.blur()
    void webviewRef.current?.loadURL(next).catch(() => {})
  }

  const webview = (): WebviewElement | null => (readyRef.current ? webviewRef.current : null)
  const iconButton = 'flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <button className={iconButton} title={t('browser.back')} disabled={!canGoBack} onClick={() => webview()?.goBack()}>
          <ArrowLeft size={14} />
        </button>
        <button className={iconButton} title={t('browser.forward')} disabled={!canGoForward} onClick={() => webview()?.goForward()}>
          <ArrowRight size={14} />
        </button>
        {loading ? (
          <button className={iconButton} title={t('browser.stop')} onClick={() => webview()?.stop()}>
            <X size={14} />
          </button>
        ) : (
          <button className={iconButton} title={t('browser.reload')} onClick={() => webview()?.reload()}>
            <RotateCw size={14} />
          </button>
        )}
        <input
          ref={addressRef}
          value={address}
          placeholder={t('browser.addressPlaceholder')}
          spellCheck={false}
          onChange={(e) => {
            setEditingAddress(true)
            setAddress(e.target.value)
          }}
          onFocus={(e) => e.target.select()}
          onBlur={() => {
            setEditingAddress(false)
            setAddress(url)
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              navigate()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditingAddress(false)
              setAddress(url)
              e.currentTarget.select()
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <button
          className={iconButton}
          title={bookmarked ? t('browser.removeBookmark') : t('browser.addBookmark')}
          disabled={!url}
          onClick={() => onToggleBookmark(url, webview()?.getTitle() || url)}
        >
          <Star size={14} className={cn(bookmarked && 'fill-current text-amber-500')} />
        </button>
        <button
          className={iconButton}
          title={t('browser.openExternal')}
          disabled={!url}
          onClick={() => void window.shovel.browser.openExternal(url)}
        >
          <ExternalLink size={14} />
        </button>
      </div>
      {findOpen && (
        <div className="flex items-center gap-1 border-b border-border px-2 py-1">
          <input
            ref={findInputRef}
            value={query}
            placeholder={t('findBar.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') {
                e.preventDefault()
                find(!e.shiftKey, false)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                closeFind()
              }
            }}
            className="w-56 bg-transparent px-1 text-sm outline-none"
          />
          <span className="min-w-12 text-right text-xs tabular-nums text-muted-foreground">
            {!query || !matches ? '' : matches.total === 0 ? t('findBar.noMatches') : `${matches.active} / ${matches.total}`}
          </span>
          <button
            type="button"
            title={t('findBar.previous')}
            disabled={!matches?.total}
            onClick={() => find(false, false)}
            className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            title={t('findBar.next')}
            disabled={!matches?.total}
            onClick={() => find(true, false)}
            className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <ChevronDown size={14} />
          </button>
          <button type="button" title={t('findBar.close')} onClick={closeFind} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <X size={14} />
          </button>
        </div>
      )}
      <div ref={hostRef} className="relative min-h-0 flex-1" />
    </div>
  )
}
