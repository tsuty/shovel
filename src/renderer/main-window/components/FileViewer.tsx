import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import type { FileReadResult } from '@shared/types/filer'
import { highlightToHtml, langFromFilename } from '../../shared/lib/shiki'
import { Button } from '../../shared/components/ui/button'
import { FileStatusBar, ImageStatusBar } from './FileStatusBar'
import { onTurnEnd } from '../turnEnd'
import { revealInHighlightedCode, type FileReveal } from '../revealMatch'

/**
 * 画像が固有の幅×高さを持つか。SVG はルートに `width`/`height` が絶対値で両方あるときだけ持つ
 * （無い・% 指定のときも Chromium は `naturalWidth/Height` に既定の 300×150 を返すので、それを除く）。
 */
function hasIntrinsicSize(dataUrl: string): boolean {
  const prefix = 'data:image/svg+xml;base64,'
  if (!dataUrl.startsWith(prefix)) return true
  try {
    const bytes = Uint8Array.from(atob(dataUrl.slice(prefix.length)), (c) => c.charCodeAt(0))
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'image/svg+xml')
    const root = doc.documentElement
    const isAbsolute = (value: string | null): boolean => value !== null && /^\s*[\d.]+\s*(px|pt|pc|mm|cm|in|em|ex)?\s*$/i.test(value)
    return root.localName === 'svg' && isAbsolute(root.getAttribute('width')) && isAbsolute(root.getAttribute('height'))
  } catch {
    return false
  }
}

/** 表示中の内容とディスクの内容が同じか（同じなら読み直しで描き直さない）。 */
function sameContent(view: ViewState, disk: FileReadResult): boolean {
  switch (disk.kind) {
    case 'text':
      return (
        view.kind === 'text' &&
        view.file.content === disk.content &&
        view.file.size === disk.size &&
        view.file.encoding === disk.encoding &&
        view.file.lineEnding === disk.lineEnding
      )
    case 'image':
      return view.kind === 'image' && view.dataUrl === disk.dataUrl
    case 'binary':
    case 'missing':
      return view.kind === disk.kind
  }
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'text'; html: string; file: Extract<FileReadResult, { kind: 'text' }> }
  | Extract<FileReadResult, { kind: 'image' }>
  | { kind: 'binary' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

/**
 * アプリ内で編集できない（`TextFileEditor` で開かない）ファイルのビューア。テキストは shiki で
 * ハイライトし行番号を付けて表示する。画像はアプリ内でプレビューし、それ以外のバイナリは
 * OS の関連付けアプリで開くボタンを出す。`reveal` が来たら、その行へ移って一致箇所を塗る。
 */
export function FileViewer({
  projectId,
  relPath,
  reveal
}: {
  projectId: string
  relPath: string
  reveal?: FileReveal
}): React.JSX.Element {
  const { t } = useTranslation()
  const [view, setView] = useState<ViewState>({ kind: 'loading' })
  const [openError, setOpenError] = useState<string | null>(null)
  /** 画像の幅×高さ。読み込み前は `undefined`、取れなかった（寸法のない SVG など）ときは `null`。 */
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null | undefined>(undefined)

  /** ターン終了ごとに増やす。読み直しのきっかけ。 */
  const [revision, setRevision] = useState(0)
  useEffect(() => onTurnEnd(() => setRevision((r) => r + 1)), [])
  const viewRef = useRef(view)
  viewRef.current = view
  /** 最後に読み込んだファイル。同じファイルの読み直しは「読み込み中」を挟まず、変わったときだけ描き直す。 */
  const loadedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const run = { cancelled: false }
    const key = `${projectId}\0${relPath}`
    const reloading = loadedKeyRef.current === key
    loadedKeyRef.current = key
    if (!reloading) {
      setView({ kind: 'loading' })
      setOpenError(null)
      setImageDims(undefined)
    }
    // await をまたぐので、毎回読み直す（`run.cancelled` のままだと型の絞り込みが残る）。
    const isCancelled = (): boolean => run.cancelled
    void (async () => {
      try {
        const result = await window.shovel.fs.readFile(projectId, relPath)
        if (isCancelled() || (reloading && sameContent(viewRef.current, result))) return
        if (result.kind !== 'text') {
          if (result.kind === 'image') setImageDims(undefined)
          setView(result)
          return
        }
        const html = await highlightToHtml(result.content, langFromFilename(relPath))
        if (!isCancelled()) setView({ kind: 'text', html, file: result })
      } catch (err) {
        // 読み直しでの一時的な失敗では、表示中の内容を消さない。
        if (reloading) console.warn('[viewer] reload failed', err)
        else if (!isCancelled()) setView({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      run.cancelled = true
    }
  }, [projectId, relPath, revision])

  /** まだ反映していない `reveal`。テキストを描き終えてから反映する。 */
  const pendingRevealRef = useRef<FileReveal | null>(null)
  const codeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (reveal) pendingRevealRef.current = reveal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.nonce])
  useEffect(() => {
    const pending = pendingRevealRef.current
    if (!pending || view.kind !== 'text' || !codeRef.current) return
    if (revealInHighlightedCode(codeRef.current, pending)) pendingRevealRef.current = null
  })

  async function openInOS(): Promise<void> {
    setOpenError(null)
    try {
      await window.shovel.fs.openInOS(projectId, relPath)
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err))
    }
  }

  switch (view.kind) {
    case 'loading':
      return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>
    case 'missing':
      return <div className="p-4 text-sm text-muted-foreground">{t('filer.fileDeleted')}</div>
    case 'error':
      return (
        <div className="p-4 text-sm text-destructive">
          {t('filer.viewerError')}
          <div className="mt-1 text-xs text-muted-foreground">{view.message}</div>
        </div>
      )
    case 'binary':
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-sm text-muted-foreground">
          <p>{t('filer.noPreview')}</p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void openInOS()}>
            <ExternalLink size={14} />
            {t('filer.openWithDefaultApp')}
          </Button>
          {openError && <p className="text-xs text-destructive">{openError}</p>}
        </div>
      )
    case 'image':
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 items-center justify-center overflow-auto p-4">
            <img
              src={view.dataUrl}
              alt={relPath}
              className="max-h-full max-w-full object-contain"
              onLoad={(e) => {
                const { naturalWidth: width, naturalHeight: height } = e.currentTarget
                setImageDims(width > 0 && height > 0 && hasIntrinsicSize(view.dataUrl) ? { width, height } : null)
              }}
              onError={() => setImageDims(null)}
            />
          </div>
          <ImageStatusBar size={view.size} dimensions={imageDims} />
        </div>
      )
    case 'text':
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-2">
            <div ref={codeRef} className="shiki-lines text-editor" dangerouslySetInnerHTML={{ __html: view.html }} />
          </div>
          <FileStatusBar size={view.file.size} encoding={view.file.encoding} lineEnding={view.file.lineEnding} />
        </div>
      )
  }
}
