/** ファイラーの「新規ファイル」で作れるファイルの種類と、アプリ内エディタで編集できるファイルの判定。 */

export const NEW_FILE_KINDS = ['markdown', 'text', 'mermaid', 'html', 'json', 'yaml'] as const
export type NewFileKind = (typeof NEW_FILE_KINDS)[number]

export function isNewFileKind(value: unknown): value is NewFileKind {
  return typeof value === 'string' && (NEW_FILE_KINDS as readonly string[]).includes(value)
}

/**
 * アプリ内エディタで開くときの種類。Markdown / Mermaid / HTML は「分割・ソース・プレビュー」、
 * JSON / YAML / テキストは「表示（ハイライト。テキストは色なし）・編集」を切り替える。
 */
export type EditorLanguage = 'markdown' | 'mermaid' | 'html' | 'json' | 'yaml' | 'text'

/** 「表示・編集」を切り替える種類か（そうでなければ「分割・ソース・プレビュー」）。 */
export function usesViewEditModes(language: EditorLanguage): boolean {
  return language === 'json' || language === 'yaml' || language === 'text'
}

export function editorLanguageFor(relPath: string): EditorLanguage | null {
  const lower = relPath.toLowerCase()
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.mmd') || lower.endsWith('.mermaid')) return 'mermaid'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml'
  if (lower.endsWith('.txt')) return 'text'
  return null
}
