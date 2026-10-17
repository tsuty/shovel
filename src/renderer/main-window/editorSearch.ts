/**
 * Cmd/Ctrl+F をページ内検索（FindBar）とエディタの検索パネルのどちらが受けるかの取り次ぎ。
 * ソースが見えているタブのエディタが自分の検索を登録し、FindBar はキーを受けたときに
 * 見えている登録先があればそちらへ渡す。
 */
interface EditorSearchTarget {
  /** エディタの外枠。見えているか（アクティブなタブか）の判定に使う。 */
  element: HTMLElement
  open: () => void
}

const targets = new Set<EditorSearchTarget>()
const findBarClosers = new Set<() => void>()

export function registerEditorSearch(target: EditorSearchTarget): () => void {
  targets.add(target)
  return () => targets.delete(target)
}

/** `root` の中で見えているエディタの検索パネルを開く。開いたら true。 */
export function openEditorSearchIn(root: HTMLElement): boolean {
  for (const target of targets) {
    if (root.contains(target.element) && target.element.checkVisibility()) {
      target.open()
      return true
    }
  }
  return false
}

export function onCloseFindBar(fn: () => void): () => void {
  findBarClosers.add(fn)
  return () => findBarClosers.delete(fn)
}

export function closeFindBar(): void {
  for (const fn of findBarClosers) fn()
}
