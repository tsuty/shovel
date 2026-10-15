import type { Html, Paragraph, Parent, Root, RootContent } from 'mdast'

/** `<details>` / `<summary>…</summary>` / `</details>` を1つずつ拾う。それ以外のタグは拾わない。 */
const TAG_PATTERN = /<details\b([^>]*)>|<\/details\s*>|<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/gi
/** ブロックを子に持つノード。ここに置かれた HTML だけを `details` として扱う（段落の中の HTML は対象外）。 */
const FLOW_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition'])

type Token =
  | { kind: 'open'; open: boolean }
  | { kind: 'close' }
  | { kind: 'summary'; text: string }
  | { kind: 'text'; text: string }

interface DetailsNode extends Parent {
  type: 'details'
  hasSummary: boolean
}

/**
 * remark プラグイン: Markdown 中の `<details>` / `<summary>` だけを要素に変える。
 * 属性は `open` だけを読み、`summary` の中身は文字列として扱う。それ以外の生 HTML はこれまでどおり描かれない。
 */
export function remarkDetails() {
  return (tree: Root): void => {
    transform(tree)
  }
}

function transform(parent: Parent): void {
  const out: RootContent[] = []
  const stack: DetailsNode[] = []
  const target = (): RootContent[] => stack.at(-1)?.children ?? out

  for (const child of parent.children) {
    const tokens = child.type === 'html' ? tokenize(child) : null
    if (!tokens) {
      if (FLOW_PARENTS.has(child.type) && 'children' in child) transform(child)
      target().push(child)
      continue
    }
    for (const token of tokens) {
      if (token.kind === 'open') {
        const details: DetailsNode = {
          type: 'details',
          hasSummary: false,
          children: [],
          data: { hName: 'details', hProperties: token.open ? { open: true } : {} }
        }
        target().push(details as unknown as RootContent)
        stack.push(details)
      } else if (token.kind === 'close') {
        stack.pop()
      } else if (token.kind === 'summary') {
        const details = stack.at(-1)
        if (!details || details.hasSummary) continue
        details.hasSummary = true
        details.children.unshift({
          type: 'summary',
          children: [{ type: 'text', value: token.text }],
          data: { hName: 'summary' }
        } as unknown as RootContent)
      } else {
        target().push({ type: 'paragraph', children: [{ type: 'text', value: token.text }] } satisfies Paragraph)
      }
    }
  }
  parent.children = out
}

/** `details` に関わるタグを含む HTML ノードを分解する。含まなければ null（そのノードは描かれないまま）。 */
function tokenize(node: Html): Token[] | null {
  const tokens: Token[] = []
  let last = 0
  const pushText = (raw: string): void => {
    const text = raw.trim()
    if (text) tokens.push({ kind: 'text', text })
  }
  for (const match of node.value.matchAll(TAG_PATTERN)) {
    pushText(node.value.slice(last, match.index))
    last = match.index + match[0].length
    if (match[0].startsWith('</')) tokens.push({ kind: 'close' })
    else if (match[2] !== undefined) tokens.push({ kind: 'summary', text: plainText(match[2]) })
    else tokens.push({ kind: 'open', open: /\bopen\b/i.test(match[1] ?? '') })
  }
  if (last === 0) return null
  pushText(node.value.slice(last))
  return tokens
}

/** `summary` の中身からタグを除き、よく使う文字参照を戻す。 */
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(lt|gt|quot|#39|amp);/g, (_, name: string) =>
      name === 'lt' ? '<' : name === 'gt' ? '>' : name === 'quot' ? '"' : name === '#39' ? "'" : '&'
    )
    .trim()
}
