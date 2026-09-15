import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../shared/components/ui/dialog'
import { Button } from '../../shared/components/ui/button'
import { Input } from '../../shared/components/ui/input'

/**
 * flows.md §1-2 / decisions.md N-2-7b: shovel は OAuth を一切実装しない。
 * ブラウザの起動もコールバックの受け取りもターミナルとエージェントに任せ、
 * shovel は状態確認と誘導だけを行う。
 */
export function AuthDialog({
  open,
  onOpenChange,
  projectId,
  onConfirmed
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  onConfirmed: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [checking, setChecking] = useState(false)
  const [notLoggedInYet, setNotLoggedInYet] = useState(false)

  async function recheck(): Promise<void> {
    setChecking(true)
    setNotLoggedInYet(false)
    try {
      const status = await window.shovel.auth.status(projectId)
      if (status.loggedIn) {
        onOpenChange(false)
        onConfirmed()
      } else {
        setNotLoggedInYet(true)
      }
    } finally {
      setChecking(false)
    }
  }

  async function submitApiKey(): Promise<void> {
    if (!apiKey.trim()) return
    await window.shovel.auth.setApiKey(projectId, apiKey.trim())
    setApiKey('')
    await recheck()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('auth.title')}</DialogTitle>
          <DialogDescription>{t('auth.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Button onClick={() => void window.shovel.auth.openLoginTerminal(projectId)}>
            {t('auth.openTerminal')}
          </Button>

          {!showApiKey ? (
            <button
              className="text-left text-xs text-muted-foreground hover:underline"
              onClick={() => setShowApiKey(true)}
            >
              {t('auth.useApiKey')}
            </button>
          ) : (
            <div className="flex gap-2">
              <Input
                type="password"
                value={apiKey}
                placeholder={t('auth.apiKeyPlaceholder')}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Button variant="outline" disabled={!apiKey.trim()} onClick={() => void submitApiKey()}>
                {t('common.save')}
              </Button>
            </div>
          )}

          {notLoggedInYet && <p className="text-xs text-destructive">{t('auth.stillNotLoggedIn')}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={checking} onClick={() => void recheck()}>
            {checking ? t('common.loading') : t('auth.recheck')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
