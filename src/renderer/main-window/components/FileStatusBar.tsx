import { useTranslation } from 'react-i18next'
import type { LineEnding, TextEncoding } from '@shared/types/filer'

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * テキストファイル（閲覧・Markdown エディタ）の下端に出すステータスバー。
 * ファイルサイズ・文字コード・改行コードを示す。
 */
export function FileStatusBar({
  size,
  encoding,
  lineEnding,
  readOnly = false
}: {
  size: number
  encoding: TextEncoding
  lineEnding: LineEnding
  /** 書き戻せない文字コードのため編集できないとき。 */
  readOnly?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const items = [
    formatFileSize(size),
    encoding === 'unknown' ? t('fileStatus.encodingUnknown') : encoding,
    lineEnding === 'mixed' ? t('fileStatus.eolMixed') : lineEnding === 'none' ? t('fileStatus.eolNone') : lineEnding
  ]
  return (
    <div className="flex shrink-0 items-center justify-end gap-4 border-t border-border px-3 py-0.5 text-xs text-muted-foreground">
      {readOnly && <span className="mr-auto">{t('fileStatus.readOnly')}</span>}
      {items.map((item, i) => (
        <span key={i}>{item}</span>
      ))}
    </div>
  )
}
