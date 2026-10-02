import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, RotateCw, SquareCode } from 'lucide-react'
import type { FileReadResult } from '@shared/types/filer'
import { highlightToHtml, langFromFilename } from '../../shared/lib/shiki'
import { Button } from '../../shared/components/ui/button'
import { MermaidDiagram } from '../../shared/components/MermaidDiagram'
import { MermaidIcon } from '../../shared/components/icons/MermaidIcon'
import { FileStatusBar, ImageStatusBar } from './FileStatusBar'

/** 図として表示できる Mermaid のファイルか（拡張子で判定）。 */
export function isMermaidFile(relPath: string): boolean {
  return /\.(mmd|mermaid)$/i.test(relPath)
}

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

type ViewState =
  | { kind: 'loading' }
  | { kind: 'text'; html: string; file: Extract<FileReadResult, { kind: 'text' }> }
  | Extract<FileReadResult, { kind: 'image' }>
  | { kind: 'binary' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

/**
 * Markdown 以外のファイルのビューア。テキストは shiki でハイライトし行番号を付けて表示する。
 * 画像はアプリ内でプレビューし、それ以外のバイナリは OS の関連付けアプリで開くボタンを出す。
 * Mermaid のファイル（.mmd / .mermaid）は図とコードを切り替えて見られ、再読み込みもできる
 * （エージェントが書き換えた図を見直すため。他のテキストと同じく閲覧のみ）。
 */
export function FileViewer({ projectId, relPath }: { projectId: string; relPath: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [view, setView] = useState<ViewState>({ kind: 'loading' })
  const [openError, setOpenError] = useState<string | null>(null)
  const mermaid = isMermaidFile(relPath)
  const [mermaidMode, setMermaidMode] = useState<'diagram' | 'code'>('diagram')
  const [reloadKey, setReloadKey] = useState(0)
  /** 画像の幅×高さ。読み込み前は `undefined`、取れなかった（寸法のない SVG など）ときは `null`。 */
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null | undefined>(undefined)

  useEffect(() => {
    const run = { cancelled: false }
    setView({ kind: 'loading' })
    setOpenError(null)
    setImageDims(undefined)
    void (async () => {
      try {
        const result = await window.shovel.fs.readFile(projectId, relPath)
        if (result.kind !== 'text') {
          if (!run.cancelled) setView(result)
          return
        }
        const html = await highlightToHtml(result.content, langFromFilename(relPath))
        if (!run.cancelled) setView({ kind: 'text', html, file: result })
      } catch (err) {
        if (!run.cancelled) setView({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      run.cancelled = true
    }
  }, [projectId, relPath, reloadKey])

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
          {mermaid && (
            <div className="flex items-center gap-1 border-b border-border px-2 py-1">
              <Button
                size="sm"
                variant={mermaidMode === 'diagram' ? 'secondary' : 'ghost'}
                className="gap-1.5"
                onClick={() => setMermaidMode('diagram')}
              >
                <MermaidIcon size={14} />
                {t('mermaid.modeDiagram')}
              </Button>
              <Button
                size="sm"
                variant={mermaidMode === 'code' ? 'secondary' : 'ghost'}
                className="gap-1.5"
                onClick={() => setMermaidMode('code')}
              >
                <SquareCode size={14} />
                {t('mermaid.modeCode')}
              </Button>
              <div className="flex-1" />
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setReloadKey((k) => k + 1)}>
                <RotateCw size={14} />
                {t('mermaid.reload')}
              </Button>
            </div>
          )}
          {mermaid && mermaidMode === 'diagram' ? (
            <div className="flex-1 overflow-auto p-4">
              <MermaidDiagram code={view.file.content} />
            </div>
          ) : (
            <div className="flex-1 overflow-auto p-2">
              <div className="shiki-lines text-editor" dangerouslySetInnerHTML={{ __html: view.html }} />
            </div>
          )}
          <FileStatusBar size={view.file.size} encoding={view.file.encoding} lineEnding={view.file.lineEnding} />
        </div>
      )
  }
}
