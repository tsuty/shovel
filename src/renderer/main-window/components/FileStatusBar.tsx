import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LineEnding, TextEncoding } from '@shared/types/filer'

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** コピーした印を出しておく時間（ms）。 */
const COPIED_MS = 1200

/**
 * プロジェクト内のパス。押すとコピーする。幅が足りないときはフォルダ部分を先頭から省き
 * （`…sign/ui.md`）、ファイル名はできるだけ残す。
 */
function PathLabel({ relPath }: { relPath: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const slash = relPath.lastIndexOf('/')
  const dir = relPath.slice(0, slash + 1)
  const name = relPath.slice(slash + 1)
  return (
    <button
      className="flex min-w-0 shrink-[100] items-center hover:text-foreground"
      title={`${relPath}\n${t('fileStatus.copyPath')}`}
      onClick={() => {
        void navigator.clipboard.writeText(relPath)
        setCopied(true)
      }}
    >
      {dir && (
        // rtl にすると、はみ出したときに先頭側が「…」になる。中身は bdi で左から右のまま並べる。
        <span className="min-w-0 truncate [direction:rtl]">
          <bdi>{dir}</bdi>
        </span>
      )}
      <span className="max-w-full shrink-0 truncate">{name}</span>
      {copied && (
        <span className="ml-1 flex shrink-0 items-center gap-0.5 text-foreground">
          <Check size={12} />
          {t('fileStatus.copied')}
        </span>
      )}
    </button>
  )
}

/**
 * ファイルの表示の下端に出すステータスバー。左にパス（と `left`）、右に `items` を並べる。
 * 狭いときはパスだけが縮む。
 */
function StatusBarFrame({
  relPath,
  items,
  left
}: {
  relPath: string
  items: string[]
  left?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-4 overflow-hidden border-t border-border px-3 py-0.5 text-xs text-muted-foreground">
      <PathLabel relPath={relPath} />
      {left}
      <div className="ml-auto flex shrink-0 items-center gap-4">
        {items.map((item, i) => (
          <span key={i} className="whitespace-nowrap">
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

/** 中身を表示しないファイル（バイナリ・大きすぎる表）の下端に出すステータスバー。サイズが分かれば出す。 */
export function PathStatusBar({ relPath, size }: { relPath: string; size?: number }): React.JSX.Element {
  return <StatusBarFrame relPath={relPath} items={size === undefined ? [] : [formatFileSize(size)]} />
}

/**
 * 画像のビューアの下端に出すステータスバー。ファイルサイズと幅×高さ（px）を示す。
 * 幅×高さが取れない（寸法を持たない SVG など）ときは「—」。
 */
export function ImageStatusBar({
  relPath,
  size,
  dimensions
}: {
  relPath: string
  size: number
  /** 読み込み前は `undefined`（空欄）、取れなかったときは `null`。 */
  dimensions: { width: number; height: number } | null | undefined
}): React.JSX.Element {
  const items = [
    formatFileSize(size),
    dimensions === undefined ? '' : dimensions === null ? '—' : `${dimensions.width} × ${dimensions.height}`
  ]
  return <StatusBarFrame relPath={relPath} items={items} />
}

/**
 * テキストファイル（閲覧・Markdown エディタ）の下端に出すステータスバー。
 * 右にファイルサイズ・文字コード・改行コードと、エディタなら最後に自動保存した時刻を示す。
 */
export function FileStatusBar({
  relPath,
  size,
  encoding,
  lineEnding,
  readOnly = false,
  savedAt = null,
  problem = null
}: {
  relPath: string
  size: number
  encoding: TextEncoding
  lineEnding: LineEnding
  /** 書き戻せない文字コードのため編集できないとき。 */
  readOnly?: boolean
  /** Markdown エディタ: 最後に自動保存が完了した時刻（まだ保存していなければ null）。 */
  savedAt?: number | null
  /** エディタ: 内容の問題（JSON の書式の誤りなど）。押すとその位置へ移る。 */
  problem?: { label: string; detail: string; onClick?: () => void } | null
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const items = [
    formatFileSize(size),
    encoding === 'unknown' ? t('fileStatus.encodingUnknown') : encoding,
    lineEnding === 'mixed' ? t('fileStatus.eolMixed') : lineEnding === 'none' ? t('fileStatus.eolNone') : lineEnding
  ]
  if (!readOnly && savedAt !== null) {
    items.unshift(t('fileStatus.savedAt', { time: new Date(savedAt).toLocaleTimeString(i18n.language) }))
  }
  return (
    <StatusBarFrame
      relPath={relPath}
      items={items}
      left={
        <>
          {readOnly && <span className="min-w-0 truncate">{t('fileStatus.readOnly')}</span>}
          {problem && (
            <button
              className="min-w-0 truncate text-destructive hover:underline disabled:no-underline"
              title={problem.detail}
              disabled={!problem.onClick}
              onClick={problem.onClick}
            >
              {problem.label}
            </button>
          )}
        </>
      }
    />
  )
}
