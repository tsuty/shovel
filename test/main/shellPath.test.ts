import { extractMarkedPath, mergePath } from '@main/shellPath'

describe('extractMarkedPath', () => {
  it('rc ファイルの余計な出力を無視してマーカー間を取り出す', () => {
    const out = 'Welcome!\n__SHOVEL_PATH_START__/opt/homebrew/bin:/usr/bin__SHOVEL_PATH_END__'
    expect(extractMarkedPath(out)).toBe('/opt/homebrew/bin:/usr/bin')
  })

  it('マーカーが無い・空なら null', () => {
    expect(extractMarkedPath('no markers')).toBeNull()
    expect(extractMarkedPath('__SHOVEL_PATH_START____SHOVEL_PATH_END__')).toBeNull()
    expect(extractMarkedPath('__SHOVEL_PATH_START__/usr/bin')).toBeNull()
  })
})

describe('mergePath', () => {
  it('シェルの PATH を優先し、現在の PATH にしか無いものを後ろに残す', () => {
    expect(mergePath('/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin:/custom', ':')).toBe(
      '/opt/homebrew/bin:/usr/bin:/bin:/custom'
    )
  })

  it('空要素と未定義の現在 PATH を扱う', () => {
    expect(mergePath('/a::/b:', undefined, ':')).toBe('/a:/b')
  })
})
