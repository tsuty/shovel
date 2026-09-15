/**
 * ドメインモデル。docs/design/data-model.md §1-2 を参照。
 * main/renderer の双方から参照される、値のみの型定義。
 */

export type SandboxStatus = 'running' | 'stopped' | 'missing' | 'workspace_missing'

export interface Project {
  /** shovel が生成する UUID。displayName を変えても不変。 */
  id: string
  /** 自由入力。日本語・スペース可。UI に出る。 */
  displayName: string
  /** ホストのディレクトリ（/Users/... または C:\...）。 */
  hostPath: string
  /** サンドボックス内のワークスペース。作成直後に `sbx exec <name> pwd` で実測。 */
  sandboxPath: string
  /** sbx の命名規則（英数字・ハイフン・ピリオド・プラス・マイナスのみ）に従って導出。 */
  sandboxName: string
  /** sbx が採番した UUID。sbx ls --json との照合に使う。 */
  sandboxId: string
  /** エージェント対応表 (agentTable.ts) のキー。 */
  agentId: string
  /** 作成時刻 (epoch ms)。プロジェクトマネージャでの並び順に使う。 */
  createdAt: number
}

/** `sbx ls --json` と shovel の設定を突き合わせた結果。data-model.md §5。 */
export interface ProjectWithStatus extends Project {
  status: SandboxStatus
}

export type AuthMethod =
  | { type: 'sbx-secret'; service: string }
  | { type: 'sbx-secret-oauth'; service: string }
  | { type: 'acp-authenticate'; methodId: string }
  | { type: 'agent-command'; argv: string[] }

/** エージェント対応表のエントリ。data-model.md §2 / decisions.md N-2-5, N-2-7b。 */
export interface AgentEntry {
  id: string
  label: string
  /** `sbx create <AGENT>` に渡す値。 */
  sbxAgent: string
  /** `npx -y <package>` に渡す ACP アダプタのパッケージ名。 */
  acpPackage: string
  status: 'verified' | 'experimental'
  auth: {
    /** サンドボックス内で実行し、認証状態を機械可読な JSON で返すコマンド。 */
    statusCommand: string[]
    /** statusCommand の JSON 出力から loggedIn を取り出すためのキーパス。 */
    loggedInPath: string
    /** OS のターミナルで実行してもらうログインコマンド。 */
    loginCommand: string[]
    /** API キーを `sbx secret set <service>` の stdin へ渡す代替経路。 */
    secretService: string
  }
}
