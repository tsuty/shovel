import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, ExternalLink, Globe, GlobeLock, RefreshCw, RotateCw, ShieldAlert, Star, X } from 'lucide-react'
import { addressToUrl, BLANK_PAGE, isBrowsableUrl, isWebUrl, parseLocalPageUrl } from '@shared/browserUrl'
import { cn } from '../../shared/lib/utils'
import { registerEditorSearch } from '../editorSearch'
import { TAB_TOOLBAR_CLASS } from '../tabToolbar'

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
  onFocus,
  onAutoRefreshChange
}: {
  initialUrl: string
  /** 今のページがブックマークにあるか。 */
  bookmarked: boolean
  onNavigate: (url: string) => void
  onTitleChange: (title: string) => void
  onToggleBookmark: (url: string, title: string) => void
  /** ページにフォーカスが移った（分割ビューで前面のペインにする）。 */
  onFocus: () => void
  /** 自動再読み込みの間隔（秒、0 は止めている）が変わった。 */
  onAutoRefreshChange: (seconds: number) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<WebviewElement | null>(null)
  const readyRef = useRef(false)
  const addressRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(isBrowsableUrl(initialUrl) ? initialUrl : '')
  const [address, setAddress] = useState(url)
  const [editingAddress, setEditingAddress] = useState(false)
  const [loading, setLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<{ active: number; total: number } | null>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  /** 今のページで断った権限（Electron の名前）と、それを求めたページの origin。ページを移ったら空にする。 */
  /** 自動再読み込みの間隔（秒）。0 は止めている。 */
  const [autoRefresh, setAutoRefresh] = useState(0)
  /** 表示中のプロジェクト内のファイルのページから、外部への接続を許しているか。 */
  const [networkAllowed, setNetworkAllowed] = useState(false)
  const localPage = parseLocalPageUrl(url)
  const localProjectId = localPage?.projectId ?? null
  /** 外部のブラウザで開けるか。プロジェクト内のファイルは HTML（とフォルダの `index.html`）だけ。 */
  const canOpenExternal = localPage ? localPage.relPath === '' || /(\.html?|\/)$/i.test(localPage.relPath) : isWebUrl(url)
  const [deniedPermissions, setDeniedPermissions] = useState<{ permission: string; origins: string[] }[]>([])

  const callbacksRef = useRef({ onNavigate, onTitleChange, onFocus, onAutoRefreshChange })
  callbacksRef.current = { onNavigate, onTitleChange, onFocus, onAutoRefreshChange }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const webview = document.createElement('webview') as WebviewElement
    webview.setAttribute('partition', BROWSER_PARTITION)
    webview.setAttribute('allowpopups', '')
    webview.className = 'h-full w-full'
    webview.src = isBrowsableUrl(initialUrl) ? initialUrl : BLANK_PAGE
    webviewRef.current = webview

    const syncHistory = (): void => {
      if (!readyRef.current) return
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
    }
    const onNavigated = (event: Event): void => {
      const { url: next, isMainFrame } = event as Event & { url: string; isMainFrame?: boolean }
      if (isMainFrame === false) return
      if (event.type === 'did-navigate') setDeniedPermissions([])
      const shown = isBrowsableUrl(next) ? next : ''
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
    if (!isBrowsableUrl(initialUrl)) addressRef.current?.focus()
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

  useEffect(
    () =>
      window.shovel.browser.onPermissionDenied((webContentsId, permission, origin) => {
        const webview = webviewRef.current
        if (!webview || !readyRef.current || webview.getWebContentsId() !== webContentsId) return
        setDeniedPermissions((prev) => {
          const found = prev.find((p) => p.permission === permission)
          if (!found) return [...prev, { permission, origins: origin ? [origin] : [] }]
          if (!origin || found.origins.includes(origin)) return prev
          return prev.map((p) => (p === found ? { ...p, origins: [...p.origins, origin] } : p))
        })
      }),
    []
  )

  /** 自動再読み込みの間隔を変える。右クリックで選ばれたときは main がもう知っているので伝えない。 */
  function changeAutoRefresh(seconds: number, tellMain: boolean): void {
    setAutoRefresh(seconds)
    callbacksRef.current.onAutoRefreshChange(seconds)
    const webview = webviewRef.current
    if (tellMain && webview && readyRef.current) void window.shovel.browser.setAutoRefresh(webview.getWebContentsId(), seconds)
  }

  useEffect(
    () =>
      window.shovel.browser.onAutoRefresh((webContentsId, seconds) => {
        const webview = webviewRef.current
        if (webview && readyRef.current && webview.getWebContentsId() === webContentsId) changeAutoRefresh(seconds, false)
      }),
    []
  )

  // 読み込み中でなければ、間隔ごとに読み直す。
  useEffect(() => {
    if (autoRefresh <= 0) return
    const timer = window.setInterval(() => {
      const webview = webviewRef.current
      if (webview && readyRef.current && !webview.isLoading()) webview.reload()
    }, autoRefresh * 1000)
    return () => window.clearInterval(timer)
  }, [autoRefresh])

  useEffect(() => {
    if (!localProjectId) return
    let cancelled = false
    void window.shovel.browser.getLocalPageNetwork(localProjectId).then((allowed) => {
      if (!cancelled) setNetworkAllowed(allowed)
    })
    const off = window.shovel.browser.onLocalPageNetworkChanged((projectId, allowed) => {
      if (projectId !== localProjectId) return
      setNetworkAllowed(allowed)
      // 新しい設定（CSP）はページを読み直したときに効く。
      if (readyRef.current) webviewRef.current?.reload()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [localProjectId])

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
      <div className={TAB_TOOLBAR_CLASS}>
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
        {autoRefresh > 0 && (
          <button
            className="flex h-7 shrink-0 items-center gap-1 rounded px-1.5 text-xs text-primary hover:bg-accent"
            title={t('browser.autoRefreshStop', { seconds: autoRefresh })}
            onClick={() => changeAutoRefresh(0, true)}
          >
            <RefreshCw size={13} />
            {t('browser.autoRefreshSeconds', { seconds: autoRefresh })}
          </button>
        )}
        {localProjectId && (
          <button
            className={cn(iconButton, networkAllowed && 'text-amber-600 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-400')}
            title={networkAllowed ? t('browser.localNetworkAllowed') : t('browser.localNetworkBlocked')}
            onClick={() => void window.shovel.browser.setLocalPageNetwork(localProjectId, !networkAllowed)}
          >
            {networkAllowed ? <Globe size={14} /> : <GlobeLock size={14} />}
          </button>
        )}
        <button
          className={iconButton}
          title={bookmarked ? t('browser.removeBookmark') : t('browser.addBookmark')}
          disabled={!isWebUrl(url)}
          onClick={() => onToggleBookmark(url, webview()?.getTitle() || url)}
        >
          <Star size={14} className={cn(bookmarked && 'fill-current text-amber-500')} />
        </button>
        <button
          className={iconButton}
          title={t('browser.openExternal')}
          disabled={!canOpenExternal}
          onClick={() => void window.shovel.browser.openExternal(url)}
        >
          <ExternalLink size={14} />
        </button>
      </div>
      {deniedPermissions.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-2 py-1 text-xs">
          <ShieldAlert size={14} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <span
            className="min-w-0 flex-1 truncate"
            title={deniedPermissions
              .map((p) => `${t(`browser.permissions.${p.permission}`, { defaultValue: p.permission })} (${p.permission})${p.origins.length ? `: ${p.origins.join(', ')}` : ''}`)
              .join('\n')}
          >
            {t('browser.permissionDenied', {
              names: new Intl.ListFormat(i18n.language, { style: 'narrow', type: 'conjunction' }).format([
                ...new Set(deniedPermissions.map((p) => t(`browser.permissions.${p.permission}`, { defaultValue: p.permission })))
              ])
            })}
            <span className="ml-2 text-muted-foreground">{t('browser.permissionDeniedHint')}</span>
          </span>
          <button
            type="button"
            disabled={!canOpenExternal}
            onClick={() => void window.shovel.browser.openExternal(url)}
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40"
          >
            <ExternalLink size={12} />
            {t('browser.openExternal')}
          </button>
          <button
            type="button"
            title={t('browser.dismiss')}
            onClick={() => setDeniedPermissions([])}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
          >
            <X size={14} />
          </button>
        </div>
      )}
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
