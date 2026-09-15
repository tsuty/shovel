import { useTranslation } from 'react-i18next'
import type { AppSettings } from '@shared/types/settings'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Checkbox } from './ui/input'

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onUpdate
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-sm">
          <Field label={t('settings.language')}>
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={settings.locale ?? 'system'}
              onChange={(e) => onUpdate({ locale: e.target.value === 'system' ? null : (e.target.value as 'en' | 'ja') })}
            >
              <option value="system">{t('settings.systemDefault')}</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </Field>
          <Field label={t('settings.theme')}>
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={settings.theme}
              onChange={(e) => onUpdate({ theme: e.target.value as AppSettings['theme'] })}
            >
              <option value="system">{t('settings.systemDefault')}</option>
              <option value="light">{t('settings.light')}</option>
              <option value="dark">{t('settings.dark')}</option>
            </select>
          </Field>
          <Field label={t('settings.transcriptFontSize')}>
            <input
              type="range"
              min={11}
              max={20}
              value={settings.transcriptFontSize}
              onChange={(e) => onUpdate({ transcriptFontSize: Number(e.target.value) })}
            />
            <span className="ml-2 text-xs text-muted-foreground">{settings.transcriptFontSize}px</span>
          </Field>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={settings.autoAttachActiveFile}
              onChange={(e) => onUpdate({ autoAttachActiveFile: e.target.checked })}
            />
            {t('settings.autoAttachActiveFile')}
          </label>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
