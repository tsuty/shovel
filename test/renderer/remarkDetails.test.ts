import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGemoji from 'remark-gemoji'
import remarkGfm from 'remark-gfm'
import { describe, expect, it } from 'vitest'
import { remarkDetails } from '../../src/renderer/shared/remarkDetails'

function render(markdown: string, withDetails = true): string {
  const plugins = withDetails ? [remarkGfm, remarkDetails, remarkGemoji] : [remarkGfm, remarkGemoji]
  return renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: plugins }, markdown))
}

describe('remarkDetails', () => {
  it('wraps the blocks between the tags in a details element', () => {
    expect(render('<details>\n<summary>Title</summary>\n\nbody **bold**\n\n</details>')).toBe(
      '<details><summary>Title</summary><p>body <strong>bold</strong></p></details>'
    )
  })

  it('reads only the open attribute', () => {
    expect(render('<details open class="x" onclick="alert(1)">\n<summary>T</summary>\n\nx\n\n</details>')).toBe(
      '<details open=""><summary>T</summary><p>x</p></details>'
    )
  })

  it('handles nesting, lists and a summary written on the same line', () => {
    expect(
      render('<details><summary>A</summary>\n\n- item\n\n<details><summary>B</summary>\n\ninner\n\n</details>\n</details>\n\nafter')
    ).toBe(
      '<details><summary>A</summary><ul>\n<li>item</li>\n</ul><details><summary>B</summary><p>inner</p></details></details>\n<p>after</p>'
    )
  })

  it('treats the summary as plain text', () => {
    expect(render('<details>\n<summary><b>a</b> &amp; <img src=x onerror=alert(1)></summary>\n\nx\n\n</details>')).toBe(
      '<details><summary>a &amp;</summary><p>x</p></details>'
    )
  })

  it('keeps text written without a blank line as plain text', () => {
    expect(render('<details>\n<summary>T</summary>\nbody <script>x</script>\n</details>')).toBe(
      '<details><summary>T</summary><p>body &lt;script&gt;x&lt;/script&gt;</p></details>'
    )
  })

  it('leaves an unclosed details open to the end and ignores stray tags', () => {
    expect(render('</details>\n\n<details>\n<summary>T</summary>\n\nrest')).toBe(
      '<details><summary>T</summary><p>rest</p></details>'
    )
  })

  it('still shows other raw HTML and inline tags as text', () => {
    expect(render('<div>x</div>\n\ntext <details> inline')).toBe(
      '&lt;div&gt;x&lt;/div&gt;\n<p>text &lt;details&gt; inline</p>'
    )
  })

  it('leaves details untouched when the plugin is not used', () => {
    expect(render('<details>\n<summary>T</summary>\n\nbody\n\n</details>', false)).toBe(
      '&lt;details&gt;\n&lt;summary&gt;T&lt;/summary&gt;\n<p>body</p>\n&lt;/details&gt;'
    )
  })
})

describe('remark-gemoji', () => {
  it('also applies to the summary when it runs after remarkDetails', () => {
    expect(render('<details>\n<summary>:tada: T</summary>\n\nx\n\n</details>')).toBe(
      '<details><summary>🎉 T</summary><p>x</p></details>'
    )
  })

  it('replaces shortcodes outside code', () => {
    expect(render(':smile: `:smile:` 10:30:00', false)).toBe('<p>😄 <code>:smile:</code> 10:30:00</p>')
  })
})
