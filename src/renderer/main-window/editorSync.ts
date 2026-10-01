import type { FileReadResult } from '@shared/types/filer'

export type EditorSyncAction =
  | { kind: 'unchanged' }
  | { kind: 'reload'; content: string }
  | { kind: 'conflict'; content: string }
  | { kind: 'deleted' }
  | { kind: 'unreadable' }

/**
 * ディスクの内容と、最後に保存（または読み込み）した内容・エディタの内容を比べて、
 * エディタがとるべき動作を決める。
 *   - ディスクが最後に保存した内容のまま → unchanged
 *   - 外部で変更され、未保存の編集が無い → reload
 *   - 外部で変更され、未保存の編集がある → conflict（編集内容は競合コピーへ）
 *   - ファイルが無い → deleted
 *   - テキストとして読めない → unreadable
 */
export function decideEditorSync(disk: FileReadResult, savedText: string, editorText: string): EditorSyncAction {
  if (disk.kind === 'missing') return { kind: 'deleted' }
  if (disk.kind !== 'text') return { kind: 'unreadable' }
  if (disk.content === savedText) return { kind: 'unchanged' }
  if (editorText === savedText || editorText === disk.content) return { kind: 'reload', content: disk.content }
  return { kind: 'conflict', content: disk.content }
}

/** `{name}.conflict-{yyyyMMdd-HHmmss}{.ext}` 形式の競合コピーのパスを返す。 */
export function conflictPath(relPath: string, now: Date = new Date()): string {
  const slash = relPath.lastIndexOf('/')
  const dot = relPath.lastIndexOf('.')
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15)
  return dot > slash + 1
    ? `${relPath.slice(0, dot)}.conflict-${stamp}${relPath.slice(dot)}`
    : `${relPath}.conflict-${stamp}`
}
