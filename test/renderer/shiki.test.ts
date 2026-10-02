import { langFromFence, langFromFilename } from '@renderer/shared/lib/shiki'

describe('langFromFilename', () => {
  it('拡張子から言語を決める', () => {
    expect(langFromFilename('a.ts')).toBe('typescript')
    expect(langFromFilename('src/b.PY')).toBe('python')
    expect(langFromFilename('flow.mmd')).toBe('mermaid')
    expect(langFromFilename('docs/flow.Mermaid')).toBe('mermaid')
  })

  it('ディレクトリ配下でも、拡張子の無いファイル名そのもので引く', () => {
    expect(langFromFilename('Dockerfile')).toBe('docker')
    expect(langFromFilename('src/Dockerfile')).toBe('docker')
    expect(langFromFilename('src\\Dockerfile')).toBe('docker')
  })

  it('ディレクトリ名のドットに引きずられない', () => {
    expect(langFromFilename('v1.go/README')).toBe('plaintext')
    expect(langFromFilename('pkg.rs/main.go')).toBe('go')
  })

  it('未知の拡張子は plaintext', () => {
    expect(langFromFilename('notes.unknown')).toBe('plaintext')
  })
})

describe('langFromFence', () => {
  it('言語名・別名・拡張子を受け付ける', () => {
    expect(langFromFence('TypeScript')).toBe('typescript')
    expect(langFromFence('shell')).toBe('bash')
    expect(langFromFence('dockerfile')).toBe('docker')
    expect(langFromFence('ts')).toBe('typescript')
    expect(langFromFence('nope')).toBe('plaintext')
  })
})
