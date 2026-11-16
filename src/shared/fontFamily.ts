/** 書体の設定（`editorFontFamily` / `previewFontFamily`）に保存できるフォント名の最大の長さ。 */
export const FONT_FAMILY_MAX_LENGTH = 200

/**
 * 設定に保存するフォント名を整える。空・長すぎる・制御文字を含むものは `null`（既定の書体）にする。
 */
export function sanitizeFontFamily(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (name === '' || name.length > FONT_FAMILY_MAX_LENGTH) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

/** フォント名を CSS の文字列として引用する（`"` と `\` をエスケープする）。 */
export function quoteFontFamily(name: string): string {
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * 既定の書体の並びの前に置く CSS 変数の値（`"名前", `）。`null` なら変数を外す（既定の並びだけになる）。
 */
export function fontFamilyPrefix(name: string | null): string | null {
  const sanitized = sanitizeFontFamily(name)
  return sanitized === null ? null : `${quoteFontFamily(sanitized)},`
}

/** `queryLocalFonts()` の結果などから、重複の無いファミリー名を名前順で返す。 */
export function uniqueFamilies(fonts: readonly { family: string }[]): string[] {
  const names = new Set<string>()
  for (const font of fonts) {
    const name = sanitizeFontFamily(font.family)
    if (name !== null) names.add(name)
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
