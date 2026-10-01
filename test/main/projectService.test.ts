export {}

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, dialog: {}, shell: {} }))
vi.mock('electron-store', () => ({
  default: class {
    get(): unknown {
      return undefined
    }
    set(): void {}
  }
}))

const { deriveSandboxName } = await import('@main/domain/projectService')

describe('deriveSandboxName', () => {
  it('使えない文字をハイフンに置き換え、連続・前後のハイフンを詰める', () => {
    expect(deriveSandboxName('My Project (v2)', new Set())).toBe('My-Project-v2')
  })

  it('英数字とハイフン・ピリオド・プラスはそのまま使う', () => {
    expect(deriveSandboxName('a.b+c-d', new Set())).toBe('a.b+c-d')
  })

  it('使える文字が残らなければ project にする', () => {
    expect(deriveSandboxName('日本語の名前', new Set())).toBe('project')
  })

  it('既存の名前と衝突したら -2, -3 … を付ける', () => {
    expect(deriveSandboxName('app', new Set(['app']))).toBe('app-2')
    expect(deriveSandboxName('app', new Set(['app', 'app-2']))).toBe('app-3')
  })
})
