import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { MermaidDiagram } from './MermaidDiagram'

/**
 * ```mermaid ブロックの図をポップアップで見せる。中身は開いている間だけマウントされるので、
 * 開くたびにその時点のコードとテーマで描き直す。
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-[90vw] flex-col sm:max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>{t('mermaid.title')}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          <MermaidDiagram code={code} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
