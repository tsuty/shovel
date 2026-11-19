import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeSystemPrompt } from '@shared/systemPrompt'
import { InfoTip } from './InfoTip'
import { Button } from './ui/button'
import { Textarea } from './ui/input'

/**
 * プロジェクトの詳細ダイアログの「システムプロンプト（追記）」欄。入力し、保存ボタンで
 * `projects.setSystemPrompt` に渡す。`saved` は最後に保存した（または読み込んだ）値。
 */
export function SystemPromptSection({
  projectId,
  initialValue
}: {
  projectId: string
  initialValue: string | undefined
}): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(initialValue ?? '')
  const [saved, setSaved] = useState(initialValue ?? '')
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(initialValue ?? '')
    setSaved(initialValue ?? '')
    setError(null)
  }, [projectId, initialValue])

  useEffect(() => {
    if (!justSaved) return
    const timer = setTimeout(() => setJustSaved(false), 1500)
    return () => clearTimeout(timer)
  }, [justSaved])

  const dirty = (normalizeSystemPrompt(draft) ?? '') !== saved

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await window.shovel.projects.setSystemPrompt(projectId, draft)
      const normalized = normalizeSystemPrompt(draft) ?? ''
      setSaved(normalized)
      setDraft(normalized)
      setJustSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <span>{t('systemPrompt.title')}</span>
        <InfoTip text={t('systemPrompt.info')} />
      </div>
      <Textarea
        className="min-h-24 resize-y text-xs"
        rows={4}
        value={draft}
        placeholder={t('systemPrompt.placeholder')}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="mt-1 flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t('systemPrompt.appliesToNewChats')}</p>
        {justSaved && <span className="shrink-0 text-xs text-muted-foreground">{t('systemPrompt.saved')}</span>}
        <Button size="sm" variant="outline" className="h-6 px-2" disabled={!dirty || saving} onClick={() => void save()}>
          {t('systemPrompt.save')}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
