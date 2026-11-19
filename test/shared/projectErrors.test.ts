import { alreadyRegisteredMessage, parseAlreadyRegisteredMessage } from '@shared/projectErrors'

describe('parseAlreadyRegisteredMessage', () => {
  it('IPC の前置きが付いていてもプロジェクト名を取り出す', () => {
    const raw = `Error invoking remote method 'projects:createNewDir': Error: ${alreadyRegisteredMessage('メモ: 仕様')}`
    expect(parseAlreadyRegisteredMessage(raw)).toBe('メモ: 仕様')
  })

  it('目印が無ければ null', () => {
    expect(parseAlreadyRegisteredMessage('something else')).toBeNull()
  })
})
