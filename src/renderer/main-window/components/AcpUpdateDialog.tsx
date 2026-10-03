import { useTranslation } from 'react-i18next'
import type { AcpUpdateOffer } from '@shared/types/project'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../shared/components/ui/dialog'
import { Button } from '../../shared/components/ui/button'

/**
 * ACP アダプタの新しい版が出ているとき、更新するか今の版のままにするかを尋ねる
 * （decisions.md N-2-5b）。答えずに閉じたときは今回だけ今の版で開き、次回また尋ねる。
 */
export function AcpUpdateDialog({
  offer,
  onAnswer,
  onDismiss
}: {
  /** null のときは閉じている。 */
  offer: AcpUpdateOffer | null
  onAnswer: (update: boolean) => void
  onDismiss: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Dialog open={offer !== null} onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('acpUpdate.title')}</DialogTitle>
          <DialogDescription>{t('acpUpdate.description')}</DialogDescription>
        </DialogHeader>
        {offer && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('acpUpdate.agent')}</dt>
            <dd>{offer.agentName}</dd>
            <dt className="text-muted-foreground">{t('acpUpdate.current')}</dt>
            <dd className="font-mono">{offer.current}</dd>
            <dt className="text-muted-foreground">{t('acpUpdate.latest')}</dt>
            <dd className="font-mono">{offer.latest}</dd>
          </dl>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onAnswer(false)}>
            {t('acpUpdate.keep')}
          </Button>
          <Button onClick={() => onAnswer(true)}>{t('acpUpdate.update')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
