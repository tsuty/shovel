import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { MermaidViewer } from './MermaidViewer'

/**
 * ```mermaid ブロックの図をポップアップで見せる。中身は開いている間だけマウントされるので、
 * 開くたびにその時点のコードとテーマで描き直す。見出しの右のボタンでウィンドウいっぱいに広げられる。
 */
export function MermaidDialog({
  code,
  open,
  onOpenChange
}: {
  code: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)
  const toggleLabel = maximized ? t('mermaid.restore') : t('mermaid.maximize')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex flex-col',
          // 「全体を表示」が表示領域の高さを基準にするので、高さは中身に依らず決めておく。
          maximized
            ? 'h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none p-4 sm:max-w-none'
            : 'h-[85vh] max-w-[90vw] sm:max-w-[90vw]'
        )}
      >
        <DialogHeader>
          <DialogTitle>{t('mermaid.title')}</DialogTitle>
        </DialogHeader>
        <button
          className="absolute right-10 top-4 rounded-sm text-muted-foreground hover:text-foreground"
          title={toggleLabel}
          aria-label={toggleLabel}
          onClick={() => setMaximized((v) => !v)}
        >
          {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <MermaidViewer code={code} className="flex-1" />
      </DialogContent>
    </Dialog>
  )
}
