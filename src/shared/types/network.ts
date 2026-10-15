/** プロジェクトのサンドボックスで拒否された通信の宛先（`sbx policy log` の `blocked` を宛先ごとにまとめたもの）。 */
export interface BlockedHost {
  /** `host:port` の形。`sbx policy log` の `host` そのまま。 */
  host: string
  /** 拒否された回数の合計。 */
  count: number
  /** 最後に拒否された時刻（ISO 8601）。不明なら null。 */
  lastSeen: string | null
  /** 既定の拒否（どの許可ルールにも当たらない）によるもので、許可ルールを足せば通るなら true。 */
  allowable: boolean
  /** `sbx policy log` の `reason`。 */
  reason: string | null
  /** `sbx policy log` の `rule`。 */
  rule: string | null
  /** プロジェクトの無視リストに入っているなら true。 */
  ignored: boolean
}

/** プロジェクトの詳細の「ネットワーク」欄に出す内容。 */
export interface NetworkBlocks {
  /** いまのルールでもまだ通らない宛先。最後に拒否された時刻の新しい順。 */
  entries: BlockedHost[]
}
