import type { TFunction } from 'i18next'
import { friendlyErrorMessage } from '@renderer/shared/friendlyError'

const t = ((key: string) => key) as unknown as TFunction

describe('friendlyErrorMessage', () => {
  it('IPC の前置きを外す', () => {
    expect(
      friendlyErrorMessage(`Error invoking remote method 'session:openTab': Error: サンドボックス "demo" に到達できません。`, t)
    ).toBe('サンドボックス "demo" に到達できません。')
  })

  it('前置きの無いメッセージはそのまま', () => {
    expect(friendlyErrorMessage('something failed', t)).toBe('something failed')
  })
})
