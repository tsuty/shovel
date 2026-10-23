import type { Parent, Root } from 'mdast'
import { toString } from 'mdast-util-to-string'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { DETAILS_PLUGINS } from '../shared/markdownPlugins'

export interface OutlineItem {
  /** 見出しのレベル（1〜6）。 */
  level: number
  /** 装飾を外した見出しの文字列。 */
  text: string
  /** 見出しが始まる行（1 始まり）。 */
  line: number
}

const processor = unified().use(remarkParse).use(DETAILS_PLUGINS)

/** Markdown の見出しを文書順に返す。プレビューと同じプラグインで解析するので、プレビューに出る見出しと一致する。 */
export function extractOutline(markdown: string): OutlineItem[] {
  const tree = processor.runSync(processor.parse(markdown)) as Root
  const items: OutlineItem[] = []
  const walk = (node: Parent): void => {
    for (const child of node.children) {
      if (child.type === 'heading') {
        const line = child.position?.start.line
        if (line !== undefined) items.push({ level: child.depth, text: toString(child).trim(), line })
      } else if ('children' in child) {
        walk(child)
      }
    }
  }
  walk(tree)
  return items
}
