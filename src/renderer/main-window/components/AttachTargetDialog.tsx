import { useTranslation } from 'react-i18next'
import { History, MessageSquare } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../shared/components/ui/dialog'
import { Button } from '../../shared/components/ui/button'

/** 「チャットの横に表示」の添え先となるチャット／履歴タブを選ばせる。 */
export function AttachTargetDialog({
  relPath,
  chatTabs,
  onPick,
  onCancel
}: {
  /** null のときは閉じている。 */
  relPath: string | null
  chatTabs: { sessionId: string; title: string; kind: 'session' | 'history' }[]
  onPick: (sessionId: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Dialog open={relPath !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editor.attachTarget.title')}</DialogTitle>
          <DialogDescription>{t('editor.attachTarget.description', { path: relPath ?? '' })}</DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {chatTabs.map((tab) => (
            <li key={tab.sessionId}>
              <button
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => onPick(tab.sessionId)}
              >
                {tab.kind === 'session' ? (
                  <MessageSquare size={14} className="shrink-0 text-muted-foreground" />
                ) : (
                  <History size={14} className="shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{tab.title}</span>
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
