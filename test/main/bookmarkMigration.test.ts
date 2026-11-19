import { mergeLegacyBookmarks } from '@main/domain/bookmarkMigration'
import type { Bookmark } from '@shared/types/browser'

const bm = (id: string, url: string): Bookmark => ({ id, title: id, url })

describe('mergeLegacyBookmarks', () => {
  const paths: Record<string, string> = { p1: '/a', p2: '/b', p3: '/a' }
  const hostPathOf = (id: string): string | undefined => paths[id]

  it('プロジェクト ID ごとの一覧をパスごとに移す', () => {
    const result = mergeLegacyBookmarks({}, { p1: [bm('x', 'https://x')], p2: [bm('y', 'https://y')] }, hostPathOf)
    expect(result).toEqual({ '/a': [bm('x', 'https://x')], '/b': [bm('y', 'https://y')] })
  })

  it('登録の無いプロジェクトの分は捨てる', () => {
    expect(mergeLegacyBookmarks({}, { gone: [bm('x', 'https://x')] }, hostPathOf)).toEqual({})
  })

  it('同じパスの分はつなげ、同じ URL は最初の 1 件だけ残す', () => {
    const result = mergeLegacyBookmarks(
      {},
      { p1: [bm('x', 'https://x')], p3: [bm('x2', 'https://x'), bm('z', 'https://z')] },
      hostPathOf
    )
    expect(result).toEqual({ '/a': [bm('x', 'https://x'), bm('z', 'https://z')] })
  })

  it('すでにパスごとに保存されている一覧を先に並べる', () => {
    const result = mergeLegacyBookmarks({ '/a': [bm('e', 'https://e')] }, { p1: [bm('x', 'https://x')] }, hostPathOf)
    expect(result).toEqual({ '/a': [bm('e', 'https://e'), bm('x', 'https://x')] })
  })

  it('空の一覧はキーを作らない', () => {
    expect(mergeLegacyBookmarks({}, { p1: [] }, hostPathOf)).toEqual({})
  })
})
