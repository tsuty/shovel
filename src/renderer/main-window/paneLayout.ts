/**
 * 分割ビューのペインの操作。ウィンドウのタブ領域を左右に並ぶペインに分け、各ペインが自分のタブ（表示順）と
 * 前面のタブを持つ。どの関数も新しいレイアウトを返し、変化が無ければ同じオブジェクトを返す。
 */

import type { SavedPane } from '@shared/types/session'

/** 並べられるペインの数。 */
export const MAX_PANES = 4

export interface Pane {
  id: string
  /** タブバーの表示順に並べたタブ id。 */
  tabIds: string[]
  activeTabId: string | null
  /** ペインの幅の比率（grid の fr）。 */
  weight: number
}

export interface PaneLayout {
  panes: Pane[]
  /** 前面のペイン（最後に操作したペイン）。 */
  focusedPaneId: string
}

export function newPaneId(): string {
  return `pane:${crypto.randomUUID()}`
}

export function initialLayout(): PaneLayout {
  const id = newPaneId()
  return { panes: [{ id, tabIds: [], activeTabId: null, weight: 1 }], focusedPaneId: id }
}

export function paneOf(layout: PaneLayout, tabId: string): Pane | undefined {
  return layout.panes.find((pane) => pane.tabIds.includes(tabId))
}

export function focusedPane(layout: PaneLayout): Pane {
  return layout.panes.find((pane) => pane.id === layout.focusedPaneId) ?? layout.panes[0]!
}

/** 前面のペインの前面のタブ。 */
export function focusedTabId(layout: PaneLayout): string | null {
  return focusedPane(layout).activeTabId
}

function replacePane(layout: PaneLayout, pane: Pane): PaneLayout {
  return { ...layout, panes: layout.panes.map((p) => (p.id === pane.id ? pane : p)) }
}

/** 閉じた・移したタブの代わりに前面にするタブ（右隣、無ければ左隣）。 */
function neighborOf(tabIds: string[], tabId: string): string | null {
  const index = tabIds.indexOf(tabId)
  return tabIds[index + 1] ?? tabIds[index - 1] ?? null
}

/**
 * タブの一覧（`tabIds`）に合わせて整える。無くなったタブを外し、どのペインにも入っていないタブを前面の
 * ペインの右端に足す。空になったペインは（1つは残して）畳み、前面のタブ・ペインが無ければ選び直す。
 */
export function normalizeLayout(layout: PaneLayout, tabIds: readonly string[]): PaneLayout {
  const existing = new Set(tabIds)
  const placed = new Set(layout.panes.flatMap((pane) => pane.tabIds))
  const orphans = tabIds.filter((id) => !placed.has(id))
  let changed = orphans.length > 0
  const focusedId = layout.panes.some((pane) => pane.id === layout.focusedPaneId) ? layout.focusedPaneId : layout.panes[0]?.id

  let panes = layout.panes.map((pane) => {
    const kept = pane.tabIds.filter((id) => existing.has(id))
    const ids = pane.id === focusedId ? [...kept, ...orphans] : kept
    const activeTabId = pane.activeTabId !== null && ids.includes(pane.activeTabId) ? pane.activeTabId : (ids[ids.length - 1] ?? null)
    if (ids.length === pane.tabIds.length && ids.every((id, i) => id === pane.tabIds[i]) && activeTabId === pane.activeTabId) {
      return pane
    }
    changed = true
    return { ...pane, tabIds: ids, activeTabId }
  })
  if (panes.length > 1 && panes.some((pane) => pane.tabIds.length === 0)) {
    changed = true
    const nonEmpty = panes.filter((pane) => pane.tabIds.length > 0)
    panes = nonEmpty.length > 0 ? nonEmpty : [panes[0]!]
  }
  if (panes.length === 0) return initialLayout()
  const focusedPaneId = panes.some((pane) => pane.id === layout.focusedPaneId) ? layout.focusedPaneId : panes[0]!.id
  if (!changed && focusedPaneId === layout.focusedPaneId) return layout
  return { panes, focusedPaneId }
}

export function focusPane(layout: PaneLayout, paneId: string): PaneLayout {
  if (layout.focusedPaneId === paneId || !layout.panes.some((pane) => pane.id === paneId)) return layout
  return { ...layout, focusedPaneId: paneId }
}

/**
 * タブを前面に出し、そのペインを前面のペインにする。どのペインにも無ければ `paneId`（省略時は前面の
 * ペイン）の右端に足す。
 */
export function activateTab(layout: PaneLayout, tabId: string, paneId?: string): PaneLayout {
  const holder = paneOf(layout, tabId)
  if (holder) {
    if (holder.activeTabId === tabId && layout.focusedPaneId === holder.id) return layout
    return { ...replacePane(layout, { ...holder, activeTabId: tabId }), focusedPaneId: holder.id }
  }
  const target = layout.panes.find((pane) => pane.id === paneId) ?? focusedPane(layout)
  return {
    ...replacePane(layout, { ...target, tabIds: [...target.tabIds, tabId], activeTabId: tabId }),
    focusedPaneId: target.id
  }
}

/** タブを外す。前面のタブだったら隣のタブを前面にし、ペインが空になったら畳んで幅を隣のペインに渡す。 */
export function removeTab(layout: PaneLayout, tabId: string): PaneLayout {
  const pane = paneOf(layout, tabId)
  if (!pane) return layout
  const tabIds = pane.tabIds.filter((id) => id !== tabId)
  const activeTabId = pane.activeTabId === tabId ? neighborOf(pane.tabIds, tabId) : pane.activeTabId
  if (tabIds.length > 0 || layout.panes.length === 1) return replacePane(layout, { ...pane, tabIds, activeTabId })
  return collapsePane(layout, pane.id)
}

/** ペインを畳み、その幅を隣（左、無ければ右）のペインに足す。前面のペインだったら幅を受け取ったペインを前面にする。 */
function collapsePane(layout: PaneLayout, paneId: string): PaneLayout {
  const index = layout.panes.findIndex((pane) => pane.id === paneId)
  const removed = layout.panes[index]!
  const heir = layout.panes[index - 1] ?? layout.panes[index + 1]!
  const panes = layout.panes
    .filter((pane) => pane.id !== paneId)
    .map((pane) => (pane.id === heir.id ? { ...pane, weight: pane.weight + removed.weight } : pane))
  return { panes, focusedPaneId: layout.focusedPaneId === paneId ? heir.id : layout.focusedPaneId }
}

/** 「右に分割して移動」できるか。そのペインにタブが2つ以上あり、ペインが上限に達していないとき。 */
export function canSplitRight(layout: PaneLayout, tabId: string): boolean {
  const pane = paneOf(layout, tabId)
  return !!pane && pane.tabIds.length >= 2 && layout.panes.length < MAX_PANES
}

/** タブのあるペインを半分に分け、そのタブを右の新しいペインへ移す。新しいペインが前面になる。 */
export function splitRight(layout: PaneLayout, tabId: string, newId = newPaneId()): PaneLayout {
  if (!canSplitRight(layout, tabId)) return layout
  const source = paneOf(layout, tabId)!
  const half = source.weight / 2
  const rest: Pane = {
    ...source,
    tabIds: source.tabIds.filter((id) => id !== tabId),
    activeTabId: source.activeTabId === tabId ? neighborOf(source.tabIds, tabId) : source.activeTabId,
    weight: half
  }
  const created: Pane = { id: newId, tabIds: [tabId], activeTabId: tabId, weight: half }
  const index = layout.panes.indexOf(source)
  const panes = [...layout.panes.slice(0, index), rest, created, ...layout.panes.slice(index + 1)]
  return { panes, focusedPaneId: newId }
}

/**
 * タブバーのドラッグで、タブを `toPaneId` のペインの `beforeId` のタブの左（`null` なら右端）へ動かす。
 * 動かしたタブはそのペインの前面になり、そのペインが前面になる。元のペインが空になったら畳む。
 */
export function moveTab(layout: PaneLayout, tabId: string, toPaneId: string, beforeId: string | null): PaneLayout {
  const source = paneOf(layout, tabId)
  const target = layout.panes.find((pane) => pane.id === toPaneId)
  if (!source || !target || tabId === beforeId) return layout

  const insert = (ids: string[]): string[] => {
    const rest = ids.filter((id) => id !== tabId)
    const at = beforeId === null ? rest.length : rest.indexOf(beforeId)
    if (at < 0) return ids
    return [...rest.slice(0, at), tabId, ...rest.slice(at)]
  }

  if (source.id === target.id) {
    const tabIds = insert(source.tabIds)
    const unchanged = tabIds.every((id, i) => id === source.tabIds[i])
    if (unchanged && source.activeTabId === tabId && layout.focusedPaneId === source.id) return layout
    return { ...replacePane(layout, { ...source, tabIds, activeTabId: tabId }), focusedPaneId: source.id }
  }

  const remaining = source.tabIds.filter((id) => id !== tabId)
  const next: PaneLayout = {
    panes: layout.panes.map((pane) => {
      if (pane.id === target.id) return { ...target, tabIds: insert(target.tabIds), activeTabId: tabId }
      if (pane.id === source.id) {
        const activeTabId = source.activeTabId === tabId ? neighborOf(source.tabIds, tabId) : source.activeTabId
        return { ...source, tabIds: remaining, activeTabId }
      }
      return pane
    }),
    focusedPaneId: target.id
  }
  return remaining.length === 0 ? collapsePane(next, source.id) : next
}

/** タブ id が変わったとき（接続できた・履歴を再開した）に、ペインの中の id も差し替える。 */
export function replaceTabId(layout: PaneLayout, fromId: string, toId: string): PaneLayout {
  const pane = paneOf(layout, fromId)
  if (!pane || fromId === toId) return layout
  return replacePane(layout, {
    ...pane,
    tabIds: pane.tabIds.map((id) => (id === fromId ? toId : id)),
    activeTabId: pane.activeTabId === fromId ? toId : pane.activeTabId
  })
}

/** ペインの幅（px など）をそのまま比率として持たせる。 */
export function setPaneWeights(layout: PaneLayout, weights: Record<string, number>): PaneLayout {
  return { ...layout, panes: layout.panes.map((pane) => ({ ...pane, weight: weights[pane.id] ?? pane.weight })) }
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

/** 保存用に、タブ id ごとのペインの情報を作る。 */
export function savedPanesOf(layout: PaneLayout): Map<string, SavedPane> {
  const map = new Map<string, SavedPane>()
  layout.panes.forEach((pane, index) => {
    const weight = Math.round(pane.weight * 100) / 100
    for (const tabId of pane.tabIds) {
      const active = pane.activeTabId === tabId
      map.set(tabId, {
        index,
        weight,
        ...(active ? { active } : {}),
        ...(active && layout.focusedPaneId === pane.id ? { focused: true } : {})
      })
    }
  })
  return map
}

/**
 * 保存しておいたペインの情報からレイアウトを作る。`order` は開き直したタブの並び。情報の無いタブは
 * 最初のペインに入れる。ペインは上限まで。
 */
export function layoutFromSaved(order: readonly string[], saved: Map<string, SavedPane>): PaneLayout {
  const byIndex = new Map<number, Pane>()
  let focusedIndex: number | null = null
  for (const tabId of order) {
    const info = saved.get(tabId)
    const index = info?.index ?? 0
    let pane = byIndex.get(index)
    if (!pane) {
      pane = { id: newPaneId(), tabIds: [], activeTabId: null, weight: info && info.weight > 0 ? info.weight : 1 }
      byIndex.set(index, pane)
    }
    pane.tabIds.push(tabId)
    if (info?.active) pane.activeTabId = tabId
    if (info?.focused) focusedIndex = index
  }
  const indexes = [...byIndex.keys()].sort((a, b) => a - b)
  const kept = indexes.slice(0, MAX_PANES).map((i) => byIndex.get(i)!)
  // 上限を超えた分のペインのタブは、最後のペインにまとめる。
  for (const i of indexes.slice(MAX_PANES)) kept[kept.length - 1]!.tabIds.push(...byIndex.get(i)!.tabIds)
  if (kept.length === 0) return initialLayout()
  for (const pane of kept) pane.activeTabId ??= pane.tabIds[pane.tabIds.length - 1] ?? null
  const focusedPos = focusedIndex === null ? -1 : indexes.slice(0, MAX_PANES).indexOf(focusedIndex)
  return { panes: kept, focusedPaneId: kept[focusedPos >= 0 ? focusedPos : 0]!.id }
}
