import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addressToUrl } from '@shared/browserUrl'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../shared/components/ui/dialog'
import { Button } from '../../shared/components/ui/button'
import { Input } from '../../shared/components/ui/input'

/** ブックマークの追加・編集。URL はアドレスバーと同じ規則で補う。 */
export function BookmarkDialog({
  initial,
  editing,
  onSave,
  onCancel
}: {
  /** null のときは閉じている。 */
  initial: { title: string; url: string } | null
  editing: boolean
  onSave: (title: string, url: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!initial) return
    setTitle(initial.title)
    setUrl(initial.url)
  }, [initial])

  const resolved = addressToUrl(url)

  function save(): void {
    if (!resolved) return
    onSave(title.trim() || resolved, resolved)
  }

  return (
    <Dialog open={initial !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? t('browser.editBookmark') : t('browser.addBookmark')}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <label className="grid gap-1 text-sm">
            {t('browser.bookmarkTitle')}
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </label>
          <label className="grid gap-1 text-sm">
            URL
            <Input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!resolved}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
