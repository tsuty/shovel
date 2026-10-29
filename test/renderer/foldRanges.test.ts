import { describe, expect, it } from 'vitest'
import {
  htmlFoldRanges,
  jsonFoldRanges,
  markdownFoldRanges,
  yamlFoldRanges,
  type FoldRange
} from '../../src/renderer/main-window/foldRanges'

/** 範囲を「始まる行: 畳まれる文字列」にして読みやすくする。 */
function folded(text: string, ranges: FoldRange[]): string[] {
  return ranges.map((r) => `${r.line}: ${JSON.stringify(text.slice(r.from, r.to))}`)
}

describe('jsonFoldRanges', () => {
  it('folds the inside of multi-line objects and arrays', () => {
    const text = '{\n  "a": [\n    1,\n    2\n  ],\n  "b": { "c": 1 }\n}'
    expect(folded(text, jsonFoldRanges(text))).toEqual([
      '1: "\\n  \\"a\\": [\\n    1,\\n    2\\n  ],\\n  \\"b\\": { \\"c\\": 1 }\\n"',
      '2: "\\n    1,\\n    2\\n  "'
    ])
  })

  it('uses the outermost bracket when a line opens several', () => {
    const text = '[{\n  "a": 1\n},\n{\n  "b": 2\n}]'
    expect(jsonFoldRanges(text).map((r) => [r.line, text[r.from - 1], text[r.to]])).toEqual([
      [1, '[', ']'],
      [4, '{', '}']
    ])
  })

  it('ignores brackets inside strings, including escaped quotes', () => {
    const text = '{\n  "a": "{ \\" [",\n  "b": 1\n}'
    expect(jsonFoldRanges(text).map((r) => r.line)).toEqual([1])
    expect(text[jsonFoldRanges(text)[0]!.to]).toBe('}')
  })

  it('returns nothing for single-line or unbalanced input', () => {
    expect(jsonFoldRanges('{"a": [1, 2]}')).toEqual([])
    expect(jsonFoldRanges('{\n  "a": 1\n')).toEqual([])
  })
})

describe('yamlFoldRanges', () => {
  it('folds blocks indented deeper than their line', () => {
    const text = 'a:\n  b: 1\n  c:\n    d: 2\ne: 3'
    expect(folded(text, yamlFoldRanges(text))).toEqual(['1: "\\n  b: 1\\n  c:\\n    d: 2"', '3: "\\n    d: 2"'])
  })

  it('includes a sequence at the same indent under a key', () => {
    const text = 'list:\n- a\n- b:\n    c: 1\nnext: 2'
    expect(folded(text, yamlFoldRanges(text))).toEqual(['1: "\\n- a\\n- b:\\n    c: 1"', '3: "\\n    c: 1"'])
  })

  it('does not end a block at blank or shallow comment lines, and drops them at the end', () => {
    const text = 'a:\n  b: 1\n\n# note\n  c: 2\n\n# trailing\nd: 3'
    expect(folded(text, yamlFoldRanges(text))).toEqual(['1: "\\n  b: 1\\n\\n# note\\n  c: 2"'])
  })

  it('folds block scalars', () => {
    const text = 'script: |\n  echo 1\n  echo 2\n'
    expect(yamlFoldRanges(text).map((r) => r.line)).toEqual([1])
  })
})

describe('markdownFoldRanges', () => {
  it('folds a heading up to the next heading of the same or higher level, without trailing blank lines', () => {
    const text = '# A\n\ntext\n\n## B\n\nmore\n\n# C\nend\n'
    expect(folded(text, markdownFoldRanges(text))).toEqual([
      '1: "\\n\\ntext\\n\\n## B\\n\\nmore"',
      '5: "\\n\\nmore"',
      '9: "\\nend"'
    ])
  })

  it('folds setext headings after their underline', () => {
    const text = 'Title\n=====\n\nbody\n'
    expect(folded(text, markdownFoldRanges(text))).toEqual(['1: "\\n\\nbody"'])
  })

  it('folds fenced code blocks and ignores # lines inside them', () => {
    const text = '```sh\n# not a heading\necho\n```\n'
    expect(folded(text, markdownFoldRanges(text))).toEqual(['1: "\\n# not a heading\\necho\\n```"'])
  })

  it('does not fold indented code blocks, empty sections or single-line fences', () => {
    expect(markdownFoldRanges('# A\n# B\n\n    code\n    more\n').map((r) => r.line)).toEqual([2])
    expect(markdownFoldRanges('```\n```\n')).toEqual([])
  })
})

describe('htmlFoldRanges', () => {
  it('folds multi-line elements between the start and end tags, outermost first on a line', () => {
    const text = '<html><body>\n  <div class="a">\n    <p>x</p>\n  </div>\n</body></html>'
    expect(folded(text, htmlFoldRanges(text))).toEqual([
      '1: "<body>\\n  <div class=\\"a\\">\\n    <p>x</p>\\n  </div>\\n</body>"',
      '2: "\\n    <p>x</p>\\n  "'
    ])
  })

  it('folds multi-line comments', () => {
    const text = '<!--\nnote\n-->\n<p>x</p>'
    expect(folded(text, htmlFoldRanges(text))).toEqual(['1: "\\nnote\\n"'])
  })

  it('skips void, self-closing and unclosed elements, and ignores > inside attribute values', () => {
    const text = '<ul>\n  <li>a\n  <li>b\n  <br>\n  <x-y/>\n  <a title="a > b">\n  </a>\n</ul>'
    expect(htmlFoldRanges(text).map((r) => r.line)).toEqual([1, 6])
  })

  it('does not read tags inside script and style', () => {
    const text = '<script>\n  if (a < b) document.write("<div>")\n</script>\n<div>\n</div>'
    expect(htmlFoldRanges(text).map((r) => r.line)).toEqual([1, 4])
  })

  it('handles uppercase tag names and a doctype', () => {
    const text = '<!DOCTYPE html>\n<DIV>\n</div>'
    expect(htmlFoldRanges(text).map((r) => r.line)).toEqual([2])
  })
})
