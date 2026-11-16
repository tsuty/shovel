import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { quoteFontFamily } from '@shared/fontFamily'
import { loadFontChoices, type FontChoices } from '../localFonts'

/**
 * 書体の選択欄と見本。`kind` が `editor` なら等幅のフォントだけを出し、和文も等幅になるものを先に別のグループで出す。
 * 自由入力はできない。
 * 選択中のフォントが一覧に無ければ「見つかりません」を付けて残す。
 */
export function FontFamilySelect({
  kind,
  value,
  onChange
}: {
  kind: 'editor' | 'preview'
  value: string | null
  onChange: (value: string | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [choices, setChoices] = useState<FontChoices | null>(null)

  useEffect(() => {
    let alive = true
    void loadFontChoices().then((loaded) => {
      if (alive) setChoices(loaded)
    })
    return () => {
      alive = false
    }
  }, [])

  const families = choices ? (kind === 'editor' ? choices.monospace : choices.all) : []
  const aligned = new Set(kind === 'editor' && choices ? choices.cjkAligned : [])
  const missing = value !== null && choices !== null && !families.includes(value)
  const fallback = kind === 'editor' ? 'var(--font-mono)' : 'var(--app-font-family)'
  const option = (family: string): React.JSX.Element => (
    <option key={family} value={family}>
      {family}
    </option>
  )

  return (
    <div className="flex flex-col gap-1">
      <select
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        value={value ?? ''}
        disabled={choices === null}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">{choices === null ? t('settings.fontLoading') : t('settings.fontDefault')}</option>
        {missing && <option value={value}>{t('settings.fontMissing', { name: value })}</option>}
        {kind === 'editor' && choices ? (
          <>
            {aligned.size > 0 && (
              <optgroup label={t('settings.fontGroupCjkAligned')}>
                {families.filter((family) => aligned.has(family)).map(option)}
              </optgroup>
            )}
            <optgroup label={t('settings.fontGroupMonospace')}>
              {families.filter((family) => !aligned.has(family)).map(option)}
            </optgroup>
          </>
        ) : (
          families.map(option)
        )}
      </select>
      <div
        className="truncate rounded-md border border-border px-2 py-1"
        style={{ fontFamily: value === null ? fallback : `${quoteFontFamily(value)}, ${fallback}` }}
      >
        {kind === 'editor' ? t('settings.fontSampleEditor') : t('settings.fontSamplePreview')}
      </div>
      {kind === 'editor' && value !== null && choices !== null && !missing && !aligned.has(value) && (
        <span className="text-xs text-muted-foreground">{t('settings.fontNotCjkAligned')}</span>
      )}
      {choices?.source === 'preset' && (
        <span className="text-xs text-muted-foreground">{t('settings.fontPresetOnly')}</span>
      )}
    </div>
  )
}
