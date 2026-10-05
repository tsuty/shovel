import { editorLanguageFor, isNewFileKind } from '@shared/fileKinds'

describe('editorLanguageFor', () => {
  it('maps Markdown / JSON / YAML extensions case-insensitively', () => {
    expect(editorLanguageFor('notes/README.md')).toBe('markdown')
    expect(editorLanguageFor('.mcp.json')).toBe('json')
    expect(editorLanguageFor('config/Settings.JSON')).toBe('json')
    expect(editorLanguageFor('compose.yaml')).toBe('yaml')
    expect(editorLanguageFor('ci.yml')).toBe('yaml')
    expect(editorLanguageFor('flow.mmd')).toBe('mermaid')
    expect(editorLanguageFor('notes/Memo.TXT')).toBe('text')
    expect(editorLanguageFor('docs/Flow.Mermaid')).toBe('mermaid')
  })

  it('leaves other files to the read-only viewer', () => {
    expect(editorLanguageFor('src/index.ts')).toBeNull()
    expect(editorLanguageFor('config.toml')).toBeNull()
    expect(editorLanguageFor('json')).toBeNull()
  })
})

describe('isNewFileKind', () => {
  it('accepts only the known kinds', () => {
    expect(isNewFileKind('yaml')).toBe(true)
    expect(isNewFileKind('toml')).toBe(false)
    expect(isNewFileKind(undefined)).toBe(false)
  })
})
