/**
 * 分割ビューのグループ（左右に並べて表示するタブのまとまり）の操作。
 * タブの並びはタブ id の配列（タブバーの表示順）で受け取り、並び替えた配列と新しいグループを返す。
 */

/** 1つのグループに並べられるタブの数。 */
export const MAX_SPLIT_PANES = 4

export interface SplitPane {
  tabId: string
  /** ペインの幅の比率（flex-grow）。 */
  weight: number
}

export interface SplitGroup {
  id: string
  /** タブバーの表示順に並べたペイン。 */
  panes: SplitPane[]
}

export interface SplitLayout {
  order: string[]
  groups: SplitGroup[]
}

export function groupOf(groups: SplitGroup[], tabId: string | null): SplitGroup | undefined {
  if (tabId === null) return undefined
  return groups.find((group) => group.panes.some((pane) => pane.tabId === tabId))
}

/** 無くなったタブを外し、ペインをタブの並び順に揃え、1つ以下になったグループを解く。 */
export function normalizeGroups(groups: SplitGroup[], order: string[]): SplitGroup[] {
  const index = new Map(order.map((id, i) => [id, i]))
  const next = groups.flatMap((group) => {
    const panes = group.panes
      .filter((pane) => index.has(pane.tabId))
      .sort((a, b) => index.get(a.tabId)! - index.get(b.tabId)!)
    if (panes.length < 2) return []
    const unchanged = panes.length === group.panes.length && panes.every((pane, i) => pane === group.panes[i])
    return [unchanged ? group : { ...group, panes }]
  })
  return next.length === groups.length && next.every((group, i) => group === groups[i]) ? groups : next
}

function withoutTab(groups: SplitGroup[], tabId: string): SplitGroup[] {
  return groups.map((group) => ({ ...group, panes: group.panes.filter((pane) => pane.tabId !== tabId) }))
}

/** `tabId` を `order` から抜き、`afterId` のすぐ右に入れる。 */
function placeAfter(order: string[], tabId: string, afterId: string): string[] {
  const rest = order.filter((id) => id !== tabId)
  const at = rest.indexOf(afterId)
  if (at < 0) return order
  rest.splice(at + 1, 0, tabId)
  return rest
}

/** いま表示しているタブ `shownId`（グループならそのグループ）の右に `tabId` を加えられるか。 */
export function canSplitRight(groups: SplitGroup[], shownId: string | null, tabId: string): boolean {
  if (shownId === null || shownId === tabId) return false
  const shown = groupOf(groups, shownId)
  if (!shown) return true
  return !shown.panes.some((pane) => pane.tabId === tabId) && shown.panes.length < MAX_SPLIT_PANES
}

/**
 * いま表示しているタブ `shownId`（グループならその右端）の右に `tabId` を加える。`tabId` が別のグループに
 * いれば、そこから抜けて移る。加えたペインの幅は既存のペインの平均にする。
 */
export function splitRight(layout: SplitLayout, shownId: string, tabId: string): SplitLayout {
  if (!canSplitRight(layout.groups, shownId, tabId)) return layout
  const groups = normalizeGroups(withoutTab(layout.groups, tabId), layout.order.filter((id) => id !== tabId))
  const shown = groupOf(groups, shownId)
  const panes = shown?.panes ?? [{ tabId: shownId, weight: 1 }]
  const weight = panes.reduce((sum, pane) => sum + pane.weight, 0) / panes.length
  const lastId = panes[panes.length - 1]!.tabId
  const order = placeAfter(layout.order, tabId, lastId)
  const group: SplitGroup = { id: shown?.id ?? `split:${shownId}`, panes: [...panes, { tabId, weight }] }
  const nextGroups = shown ? groups.map((g) => (g === shown ? group : g)) : [...groups, group]
  return { order, groups: normalizeGroups(nextGroups, order) }
}

/** `tabId` をグループから外し、グループのすぐ右の単独のタブにする。 */
export function unsplit(layout: SplitLayout, tabId: string): SplitLayout {
  const group = groupOf(layout.groups, tabId)
  if (!group) return layout
  const lastId = group.panes[group.panes.length - 1]!.tabId
  const order = lastId === tabId ? layout.order : placeAfter(layout.order, tabId, lastId)
  return { order, groups: normalizeGroups(withoutTab(layout.groups, tabId), order) }
}

/**
 * タブバーのドラッグで `tabId` を `beforeId` のタブの左（`null` なら一番右）へ動かす。
 *   - グループのタブは、グループの中（両端の隣を含む）に落とせばペインの並びが変わり、外ならグループから外れる。
 *   - 別のグループのペインの間に落ちたタブは、そのグループのすぐ右へ送る（ドラッグではグループに加えない）。
 */
export function moveTab(layout: SplitLayout, tabId: string, beforeId: string | null): SplitLayout {
  if (tabId === beforeId) return layout
  const rest = layout.order.filter((id) => id !== tabId)
  const at = beforeId === null ? rest.length : rest.indexOf(beforeId)
  if (at < 0 || !layout.order.includes(tabId)) return layout
  let order = [...rest]
  order.splice(at, 0, tabId)
  let groups = layout.groups

  const own = groupOf(groups, tabId)
  if (own) {
    const others = own.panes.filter((pane) => pane.tabId !== tabId).map((pane) => order.indexOf(pane.tabId))
    const position = order.indexOf(tabId)
    if (position < Math.min(...others) - 1 || position > Math.max(...others) + 1) {
      groups = withoutTab(groups, tabId)
    }
  }
  const position = order.indexOf(tabId)
  const host = groups.find((group) => {
    if (group.panes.some((pane) => pane.tabId === tabId)) return false
    const indexes = group.panes.map((pane) => order.indexOf(pane.tabId))
    return position > Math.min(...indexes) && position < Math.max(...indexes)
  })
  if (host) order = placeAfter(order, tabId, host.panes[host.panes.length - 1]!.tabId)

  if (order.every((id, i) => id === layout.order[i])) return layout
  return { order, groups: normalizeGroups(groups, order) }
}

/** ペインの幅（px）をそのまま比率として持たせる。 */
export function setPaneWeights(groups: SplitGroup[], groupId: string, widths: Record<string, number>): SplitGroup[] {
  return groups.map((group) =>
    group.id === groupId
      ? { ...group, panes: group.panes.map((pane) => ({ ...pane, weight: widths[pane.tabId] ?? pane.weight })) }
      : group
  )
}

/**
 * ペインの境目のドラッグ。左のペインを `delta` px 広げ（負なら狭め）、右のペインをその分だけ縮める。
 * どちらも最小幅を割らないところで止める。
 */
export function resizeAdjacent(
  left: { width: number; minWidth: number },
  right: { width: number; minWidth: number },
  delta: number
): { left: number; right: number } {
  const total = left.width + right.width
  const nextLeft = Math.min(Math.max(left.width + delta, left.minWidth), total - right.minWidth)
  // 両方の最小幅を足すと足りないときは、元の幅のまま動かさない。
  if (nextLeft < left.minWidth) return { left: left.width, right: right.width }
  return { left: nextLeft, right: total - nextLeft }
}

/**
 * 保存しておいたタブの分割の情報（同じ `group` 番号のタブが1つのグループ）からグループを作る。
 * `order` は開き直したタブの並び。
 */
export function groupsFromSaved(
  order: string[],
  saved: Map<string, { group: number; weight: number }>
): SplitGroup[] {
  const byNumber = new Map<number, SplitPane[]>()
  for (const tabId of order) {
    const split = saved.get(tabId)
    if (!split) continue
    const panes = byNumber.get(split.group) ?? []
    if (panes.length < MAX_SPLIT_PANES) panes.push({ tabId, weight: split.weight > 0 ? split.weight : 1 })
    byNumber.set(split.group, panes)
  }
  const groups = [...byNumber.values()].map((panes) => ({ id: `split:${panes[0]!.tabId}`, panes }))
  return normalizeGroups(groups, order)
}

/** 保存用に、タブ id ごとの分割の情報（グループ番号と比率）を作る。 */
export function savedSplitOf(groups: SplitGroup[]): Map<string, { group: number; weight: number }> {
  const map = new Map<string, { group: number; weight: number }>()
  groups.forEach((group, i) => {
    for (const pane of group.panes) map.set(pane.tabId, { group: i, weight: Math.round(pane.weight * 100) / 100 })
  })
  return map
}

/** タブ id が変わったとき（接続できた・履歴を再開した）に、グループの中の id も差し替える。 */
export function replaceTabId(groups: SplitGroup[], fromId: string, toId: string): SplitGroup[] {
  if (fromId === toId || !groupOf(groups, fromId)) return groups
  return groups.map((group) => ({
    ...group,
    panes: group.panes.map((pane) => (pane.tabId === fromId ? { ...pane, tabId: toId } : pane))
  }))
}

/** グループの中で `tabId` を閉じたときに前面にするタブ（左隣、無ければ右隣）。 */
export function neighborInGroup(groups: SplitGroup[], tabId: string): string | undefined {
  const group = groupOf(groups, tabId)
  if (!group) return undefined
  const index = group.panes.findIndex((pane) => pane.tabId === tabId)
  return (group.panes[index - 1] ?? group.panes[index + 1])?.tabId
}
