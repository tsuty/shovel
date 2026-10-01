import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionSnapshot } from '@shared/types/session'

let userData = ''

vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const store = await import('@main/persistence/snapshot')

const PROJECT = 'proj-1'

function snapshot(sessionId: string, fields: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    schemaVersion: 1,
    sessionId,
    projectId: PROJECT,
    title: `title ${sessionId}`,
    savedAt: 1000,
    entries: [{ id: 'u', role: 'USER', markdown: `hello ${sessionId}` }],
    ...fields
  }
}

const files = async (): Promise<string[]> => (await readdir(store.snapshotDir(PROJECT))).sort()

beforeEach(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), 'shovel-test-'))
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(userData, { recursive: true, force: true })
})

describe('snapshot store', () => {
  it('保存して読み戻せる（一時ファイルは残らない）', async () => {
    await store.saveSnapshot(snapshot('s1'))
    expect(await store.loadSnapshot(PROJECT, 's1')).toEqual(snapshot('s1'))
    expect(await files()).toEqual(['s1.json'])
  })

  it('無いファイル・壊れたファイル・別バージョンは null', async () => {
    expect(await store.loadSnapshot(PROJECT, 'missing')).toBeNull()
    await mkdir(store.snapshotDir(PROJECT), { recursive: true })
    await writeFile(path.join(store.snapshotDir(PROJECT), 'broken.json'), '{')
    await writeFile(path.join(store.snapshotDir(PROJECT), 'v2.json'), JSON.stringify({ ...snapshot('v2'), schemaVersion: 2 }))
    expect(await store.loadSnapshot(PROJECT, 'broken')).toBeNull()
    expect(await store.loadSnapshot(PROJECT, 'v2')).toBeNull()
  })

  it('バックアップは元の記録を残したまま .backup に複製し、同じミリ秒なら +1ms する', async () => {
    vi.useFakeTimers({ now: 5000, toFake: ['Date'] })
    await store.saveSnapshot(snapshot('s1'))
    expect(await store.backupSnapshot(PROJECT, 's1')).toBe('s1.json.5000.backup')
    expect(await store.backupSnapshot(PROJECT, 's1')).toBe('s1.json.5001.backup')
    expect(await files()).toEqual(['s1.json', 's1.json.5000.backup', 's1.json.5001.backup'])
  })

  it('記録が無ければバックアップしない', async () => {
    expect(await store.backupSnapshot(PROJECT, 'none')).toBeNull()
  })

  it('ソフトデリートは本体とそのセッションのバックアップだけを .deleted にする', async () => {
    vi.useFakeTimers({ now: 5000, toFake: ['Date'] })
    await store.saveSnapshot(snapshot('s1'))
    await store.saveSnapshot(snapshot('s2'))
    await store.backupSnapshot(PROJECT, 's1')
    await store.backupSnapshot(PROJECT, 's2')
    vi.setSystemTime(9000)
    await store.softDeleteSnapshot(PROJECT, 's1')
    expect(await files()).toEqual(['s1.json.5000.deleted', 's1.json.9000.deleted', 's2.json', 's2.json.5000.backup'])
  })

  it('本体が無ければソフトデリートは失敗し、バックアップには触らない', async () => {
    vi.useFakeTimers({ now: 5000, toFake: ['Date'] })
    await store.saveSnapshot(snapshot('s1'))
    await store.backupSnapshot(PROJECT, 's1')
    await rm(path.join(store.snapshotDir(PROJECT), 's1.json'))
    await expect(store.softDeleteSnapshot(PROJECT, 's1')).rejects.toThrow()
    expect(await files()).toEqual(['s1.json.5000.backup'])
  })

  it('listLocalRecords は種類・タイムスタンプ付きで新しい順に返す', async () => {
    vi.useFakeTimers({ now: 3000, toFake: ['Date'] })
    await store.saveSnapshot(snapshot('s1', { savedAt: 1000 }))
    await store.saveSnapshot(snapshot('s2', { savedAt: 2000 }))
    await store.backupSnapshot(PROJECT, 's1')
    const records = await store.listLocalRecords(PROJECT)
    expect(records.map((r) => [r.fileName, r.kind, r.sessionId, r.timestamp])).toEqual([
      ['s1.json.3000.backup', 'backup', 's1', 3000],
      ['s2.json', 'current', 's2', 2000],
      ['s1.json', 'current', 's1', 1000]
    ])
  })

  it('listSnapshotsForProject は現行の記録だけを返し、他プロジェクトの記録は除く', async () => {
    await store.saveSnapshot(snapshot('s1'))
    await store.backupSnapshot(PROJECT, 's1')
    await writeFile(path.join(store.snapshotDir(PROJECT), 'other.json'), JSON.stringify({ ...snapshot('other'), projectId: 'x' }))
    expect((await store.listSnapshotsForProject(PROJECT)).map((s) => s.sessionId)).toEqual(['s1'])
  })

  it('readLocalRecord は既知の形式のファイル名だけを読む', async () => {
    await store.saveSnapshot(snapshot('s1'))
    expect(await store.readLocalRecord(PROJECT, 's1.json')).toMatchObject({ sessionId: 's1' })
    expect(await store.readLocalRecord(PROJECT, '../s1.json')).toBeNull()
    expect(await store.readLocalRecord(PROJECT, 's1.txt')).toBeNull()
  })

  it('タイトルの書き換えは保存済みの記録にだけ反映する', async () => {
    await store.saveSnapshot(snapshot('s1'))
    await store.renameSnapshotTitle(PROJECT, 's1', '新しい名前')
    await store.renameSnapshotTitle(PROJECT, 'none', 'x')
    expect((await store.loadSnapshot(PROJECT, 's1'))?.title).toBe('新しい名前')
    expect(await files()).toEqual(['s1.json'])
  })

  it('readRecordsForProject は shouldContinue が false になったら打ち切る', async () => {
    await store.saveSnapshot(snapshot('s1'))
    await store.saveSnapshot(snapshot('s2'))
    let calls = 0
    const records = await store.readRecordsForProject(PROJECT, () => calls++ < 1)
    expect(records).toHaveLength(1)
  })

  it('プロジェクト id にパス区切りや .. を使えない', () => {
    expect(() => store.snapshotDir('../x')).toThrow()
    expect(() => store.snapshotDir('a/b')).toThrow()
    expect(() => store.snapshotDir('..')).toThrow()
    expect(() => store.snapshotDir('')).toThrow()
  })

  it('旧形式のファイルをプロジェクトごとのディレクトリへ移す', async () => {
    const root = path.join(userData, 'snapshots')
    await mkdir(root, { recursive: true })
    await writeFile(path.join(root, 's1.json'), JSON.stringify(snapshot('s1')))
    await writeFile(path.join(root, 'junk.json'), 'not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await store.migrateFlatSnapshots()
    warn.mockRestore()
    expect(await files()).toEqual(['s1.json'])
    expect((await readdir(root)).sort()).toEqual(['junk.json', PROJECT])
  })
})
