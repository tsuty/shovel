import { conflictPath, decideEditorSync } from '@renderer/main-window/editorSync'
import type { FileReadResult } from '@shared/types/filer'

const disk = (content: string): FileReadResult => ({ kind: 'text', content, size: content.length, encoding: 'UTF-8', lineEnding: 'LF' })

describe('decideEditorSync', () => {
  it('ディスクが最後に保存した内容のままなら unchanged', () => {
    expect(decideEditorSync(disk('a'), 'a', 'a')).toEqual({ kind: 'unchanged' })
    expect(decideEditorSync(disk('a'), 'a', 'a+編集')).toEqual({ kind: 'unchanged' })
  })

  it('外部で変更され、未保存の編集が無ければ reload', () => {
    expect(decideEditorSync(disk('外部'), 'a', 'a')).toEqual({ kind: 'reload', content: '外部' })
  })

  it('外部で変更され、未保存の編集があれば conflict', () => {
    expect(decideEditorSync(disk('外部'), 'a', 'a+編集')).toEqual({ kind: 'conflict', content: '外部' })
  })

  it('編集内容が外部の変更と同じなら競合にしない', () => {
    expect(decideEditorSync(disk('同じ'), 'a', '同じ')).toEqual({ kind: 'reload', content: '同じ' })
  })

  it('ファイルが無ければ deleted、テキストでなければ unreadable', () => {
    expect(decideEditorSync({ kind: 'missing' }, 'a', 'b')).toEqual({ kind: 'deleted' })
    expect(decideEditorSync({ kind: 'binary' }, 'a', 'b')).toEqual({ kind: 'unreadable' })
  })

  it('入力中にエージェントが書き換えた場合、自動保存は上書きせず競合として扱う', () => {
    // 読み込み時: 'v1'。ユーザーが編集中に、エージェントがディスクを 'agent' に書き換えた。
    expect(decideEditorSync(disk('agent'), 'v1', 'v1 ユーザーの追記')).toEqual({ kind: 'conflict', content: 'agent' })
  })
})

describe('conflictPath', () => {
  const now = new Date('2026-09-14T15:30:12.345Z')

  it('拡張子の前に .conflict-{日時} を挟む', () => {
    expect(conflictPath('docs/spec.md', now)).toBe('docs/spec.conflict-20260914-153012.md')
  })

  it('拡張子が無ければ末尾に付ける', () => {
    expect(conflictPath('docs/README', now)).toBe('docs/README.conflict-20260914-153012')
  })

  it('ディレクトリ名のピリオドを拡張子と取り違えない', () => {
    expect(conflictPath('docs.v2/README', now)).toBe('docs.v2/README.conflict-20260914-153012')
  })

  it('先頭がピリオドのファイル名は拡張子なしとして扱う', () => {
    expect(conflictPath('.notes', now)).toBe('.notes.conflict-20260914-153012')
  })
})
