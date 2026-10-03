import type { CommandHistory } from '@shared/types/command'

const data: Record<string, unknown> = {}

vi.mock('electron-store', () => ({
  default: class {
    constructor({ defaults }: { defaults: Record<string, unknown> }) {
      Object.assign(data, structuredClone(defaults))
    }
    get(key: string): unknown {
      return structuredClone(data[key])
    }
    set(key: string, value: unknown): void {
      data[key] = structuredClone(value)
    }
  }
}))

const { commandHistoryStore, COMMAND_HISTORY_LIMIT, PINNED_COMMAND_LIMIT } = await import('@main/persistence/store')

const P = 'proj-1'

beforeEach(() => {
  data.commandHistory = {}
  data.pinnedCommands = {}
})

describe('commandHistoryStore', () => {
  it('未使用のプロジェクトは空', () => {
    const empty: CommandHistory = { pinned: [], recent: [] }
    expect(commandHistoryStore.get(P)).toEqual(empty)
  })

  it('pin は履歴から外してピン留めの末尾に移す', () => {
    commandHistoryStore.push(P, 'a')
    commandHistoryStore.push(P, 'b')
    expect(commandHistoryStore.pin(P, 'a')).toEqual({ pinned: ['a'], recent: ['b'] })
    expect(commandHistoryStore.pin(P, 'b')).toEqual({ pinned: ['a', 'b'], recent: [] })
  })

  it('ピン留め済みのコマンドを再実行しても位置は動かず、履歴にも出ない', () => {
    commandHistoryStore.push(P, 'a')
    commandHistoryStore.push(P, 'b')
    commandHistoryStore.pin(P, 'a')
    commandHistoryStore.pin(P, 'b')
    commandHistoryStore.push(P, 'a')
    expect(commandHistoryStore.get(P)).toEqual({ pinned: ['a', 'b'], recent: [] })
  })

  it('unpin は削除せず履歴の先頭に戻す', () => {
    commandHistoryStore.push(P, 'a')
    commandHistoryStore.pin(P, 'a')
    commandHistoryStore.push(P, 'b')
    expect(commandHistoryStore.unpin(P, 'a')).toEqual({ pinned: [], recent: ['a', 'b'] })
  })

  it('ピン留めは上限を超えて増えない', () => {
    for (let i = 0; i <= PINNED_COMMAND_LIMIT; i++) {
      commandHistoryStore.push(P, `c${i}`)
      commandHistoryStore.pin(P, `c${i}`)
    }
    const { pinned, recent } = commandHistoryStore.get(P)
    expect(pinned).toHaveLength(PINNED_COMMAND_LIMIT)
    expect(recent).toEqual([`c${PINNED_COMMAND_LIMIT}`])
  })

  it('ピン留めは履歴の件数上限で押し出されない', () => {
    commandHistoryStore.push(P, 'keep')
    commandHistoryStore.pin(P, 'keep')
    for (let i = 0; i < COMMAND_HISTORY_LIMIT + 5; i++) commandHistoryStore.push(P, `c${i}`)
    const { pinned, recent } = commandHistoryStore.get(P)
    expect(pinned).toEqual(['keep'])
    expect(recent).toHaveLength(COMMAND_HISTORY_LIMIT)
  })
})
