import { useTranslation } from 'react-i18next'
import type { LineEnding, TextEncoding } from '@shared/types/filer'

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 画像のビューアの下端に出すステータスバー。ファイルサイズと幅×高さ（px）を示す。
 * 幅×高さが取れない（寸法を持たない SVG など）ときは「—」。
 */
export function ImageStatusBar({
  size,
  dimensions
}: {
  size: number
  /** 読み込み前は `undefined`（空欄）、取れなかったときは `null`。 */
  dimensions: { width: number; height: number } | null | undefined
}): React.JSX.Element {
  const items = [
    formatFileSize(size),
    dimensions === undefined ? '' : dimensions === null ? '—' : `${dimensions.width} × ${dimensions.height}`
  ]
  return <StatusBarFrame items={items} />
}

function StatusBarFrame({ items, children }: { items: string[]; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center justify-end gap-4 border-t border-border px-3 py-0.5 text-xs text-muted-foreground">
      {children}
      {items.map((item, i) => (
        <span key={i}>{item}</span>
      ))}
    </div>
  )
}

/**
 * テキストファイル（閲覧・Markdown エディタ）の下端に出すステータスバー。
 * ファイルサイズ・文字コード・改行コードと、エディタなら最後に自動保存した時刻を示す。
 */
export function FileStatusBar({
  size,
  encoding,
  lineEnding,
  readOnly = false,
  savedAt = null,
  problem = null
}: {
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
  return (
    <StatusBarFrame items={items}>
      <div className="mr-auto flex min-w-0 items-center gap-4">
        {readOnly && <span>{t('fileStatus.readOnly')}</span>}
        {problem && (
          <button
            className="truncate text-destructive hover:underline disabled:no-underline"
            title={problem.detail}
            disabled={!problem.onClick}
            onClick={problem.onClick}
          >
            {problem.label}
          </button>
        )}
        {!readOnly && savedAt !== null && (
          <span>{t('fileStatus.savedAt', { time: new Date(savedAt).toLocaleTimeString(i18n.language) })}</span>
        )}
      </div>
    </StatusBarFrame>
  )
}
