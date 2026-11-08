/** チャットのタブの状態から、タブのアイコンの動きと未確認のターン終了を求める。 */

export interface TabStatus {
  /** エージェントが作業している（ターン中か、ターンの後の作業中）。 */
  sending: boolean
  /** 承認カードか質問への回答を待っている。 */
  awaitingUser: boolean
  /** 前面にない間にターンが終わり、まだ見ていない。 */
  turnUnseen: boolean
}

export interface TabIndicator {
  spin: boolean
  blink: boolean
  /** 確認待ちのバッジ。 */
  badge: boolean
}

/** SessionView から届いた状態を当てる。変化がなければ同じオブジェクトを返す。 */
export function applyTabStatus(
  prev: TabStatus | undefined,
  next: { sending: boolean; awaitingUser: boolean },
  visible: boolean
): TabStatus {
  const turnEnded = !!prev?.sending && !next.sending
  const turnUnseen = !next.sending && !visible && (turnEnded || !!prev?.turnUnseen)
  if (
    prev &&
    prev.sending === next.sending &&
    prev.awaitingUser === next.awaitingUser &&
    prev.turnUnseen === turnUnseen
  ) {
    return prev
  }
  return { ...next, turnUnseen }
}

/** 前面にあるタブの未確認を消す。変化がなければ同じオブジェクトを返す。 */
export function markTabsSeen(
  statuses: Record<string, TabStatus>,
  visibleTabIds: readonly string[]
): Record<string, TabStatus> {
  let next = statuses
  for (const id of visibleTabIds) {
    const status = statuses[id]
    if (!status?.turnUnseen) continue
    if (next === statuses) next = { ...statuses }
    next[id] = { ...status, turnUnseen: false }
  }
  return next
}

export function tabIndicator(status: TabStatus | undefined, isActive: boolean): TabIndicator {
  if (!status) return { spin: false, blink: false, badge: false }
  const awaitingInBackground = status.awaitingUser && !isActive
  return {
    spin: status.sending && !status.awaitingUser,
    blink: awaitingInBackground || (status.turnUnseen && !isActive),
    badge: awaitingInBackground
  }
}
