import { findJsonProblem } from '@renderer/main-window/textEditing'

describe('findJsonProblem', () => {
  it('returns null for valid JSON', () => {
    expect(findJsonProblem('{\n  "mcpServers": {}\n}\n')).toBeNull()
  })

  it('reports line and column of a trailing comma', () => {
    expect(findJsonProblem('{\n  "a": 1,\n}')).toMatchObject({ line: 3, column: 1 })
  })

  it('reports the end of the text when the input is cut off', () => {
    expect(findJsonProblem('{\n  "a": 1')).toMatchObject({ line: 2 })
  })

  it('treats an empty file as a problem', () => {
    expect(findJsonProblem('')).not.toBeNull()
  })
})
