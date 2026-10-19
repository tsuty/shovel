import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { findFirstMatch, findNameMatch, searchDirectory } from '@main/domain/fileSearch'

let root: string

async function put(relPath: string, content: string | Buffer): Promise<void> {
  const abs = path.join(root, relPath)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, content)
}

const always = (): boolean => true

async function contentPaths(scope: string, query: string): Promise<string[] | undefined> {
  return (await searchDirectory(root, scope, query, always))?.contents.map((r) => r.relPath)
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'shovel-filesearch-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('findFirstMatch', () => {
  it('最初の一致の行・列（1 始まり）と、その行の抜粋を返す', () => {
    const match = findFirstMatch('first\nsecond Apple line\napple again', 'apple')
    expect(match).toMatchObject({ line: 2, column: 8, length: 5 })
    expect(match?.snippet).toEqual({ before: 'second ', match: 'Apple', after: ' line' })
  })

  it('一致しなければ null', () => {
    expect(findFirstMatch('nothing here', 'apple')).toBeNull()
  })
})

describe('findNameMatch', () => {
  it('大文字小文字を無視した一致箇所を返す', () => {
    expect(findNameMatch('FileSearchDialog.tsx', 'search')).toEqual({ start: 4, length: 6 })
  })

  it('一致しなければ null', () => {
    expect(findNameMatch('readme.md', 'search')).toBeNull()
  })
})

describe('searchDirectory', () => {
  it('ファイル名の一致を、コンテンツの一致とは別に返す（フォルダ名は対象外）', async () => {
    await put('notes/plan.md', 'nothing')
    await put('plan/readme.md', 'see the plan')
    await put('Plan.txt', 'x')
    const results = await searchDirectory(root, '', 'plan', always)
    expect(results?.names).toEqual([
      { relPath: 'Plan.txt', start: 0, length: 4 },
      { relPath: 'notes/plan.md', start: 0, length: 4 }
    ])
    expect(results?.contents.map((r) => r.relPath)).toEqual(['plan/readme.md'])
  })

  it('ファイル名の検索も「.」で始まるフォルダと node_modules には入らない', async () => {
    await put('.git/needle.txt', '')
    await put('node_modules/needle/index.js', '')
    await put('src/needle.ts', '')
    expect((await searchDirectory(root, '', 'needle', always))?.names.map((r) => r.relPath)).toEqual([
      'src/needle.ts'
    ])
  })

  it('ファイルごとに最初の一致を、浅い階層から順に返す', async () => {
    await put('deep/nested/b.md', 'needle in deep')
    await put('a.txt', 'one\nneedle\nneedle')
    await put('c.txt', 'no match')
    const results = await searchDirectory(root, '', 'Needle', always)
    expect(results?.contents.map((r) => [r.relPath, r.line])).toEqual([
      ['a.txt', 2],
      ['deep/nested/b.md', 1]
    ])
  })

  it('「.」で始まるフォルダと node_modules には入らない（範囲に直接選べば探す）', async () => {
    await put('.hidden/a.txt', 'needle')
    await put('node_modules/pkg/index.js', 'needle')
    await put('src/node_modules/x.js', 'needle')
    await put('.env', 'needle')
    expect(await contentPaths('', 'needle')).toEqual(['.env'])
    expect(await contentPaths('.hidden', 'needle')).toEqual(['.hidden/a.txt'])
  })

  it('バイナリと UTF-8 以外のファイルは読まない', async () => {
    await put('bin.dat', Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00, 0x01]))
    // 「needle」を Shift_JIS の全角文字と並べる（UTF-8 としては読めない）。
    await put('sjis.txt', Buffer.concat([Buffer.from('needle '), Buffer.from([0x82, 0xa0])]))
    await put('bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('needle')]))
    expect(await contentPaths('', 'needle')).toEqual(['bom.txt'])
  })

  it('範囲を絞ると、そのフォルダの中だけを探す', async () => {
    await put('docs/a.md', 'needle')
    await put('src/b.ts', 'needle')
    expect(await contentPaths('docs', 'needle')).toEqual(['docs/a.md'])
  })

  it('空の検索語は空、追い越されたら null', async () => {
    await put('a.txt', 'needle')
    expect(await searchDirectory(root, '', '  ', always)).toEqual({ names: [], contents: [] })
    expect(await searchDirectory(root, '', 'needle', () => false)).toBeNull()
  })
})
