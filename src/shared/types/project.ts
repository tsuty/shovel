/** ドメインモデル。main/renderer の双方から参照される、値のみの型定義。 */

/** `unknown` は `sbx ls` の結果を当てにできない（未サインイン・sbx が動かない等）とき。 */
export type SandboxStatus = 'running' | 'stopped' | 'missing' | 'workspace_missing' | 'unknown'

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
  /**
   * このプロジェクトで使う ACP アダプタのバージョン（`npx -y <package>@<acpVersion>`）。
   * セッション開始時にエージェントが `initialize` で告げた版を記録する。未記録なら undefined。
   */
  acpVersion?: string
  /** 更新の確認で「更新する」を選ぶ前に記録していた版。プロジェクトの詳細から戻せる。 */
  previousAcpVersion?: string
  /** 更新の確認で「今のまま」を選んだ版。これより新しい版が出るまでは再び尋ねない。 */
  skippedAcpVersion?: string
  /** 拒否された通信のうち、ユーザーが「無視」にした宛先（`host:port`）。 */
  ignoredNetworkHosts?: string[]
}

/** プロジェクトのウィンドウを開いたときに尋ねる、ACP アダプタの更新。 */
export interface AcpUpdateOffer {
  /** エージェントの表示名（ACP レジストリの `name`。例: `Claude Agent`）。 */
  agentName: string
  current: string
  latest: string
}

/** `sbx ls --json` と shovel の設定を突き合わせた結果。 */
export interface ProjectWithStatus extends Project {
  status: SandboxStatus
}

/**
 * `sbx` 自体の問題で、サンドボックスの状態を確かめられないこと。
 * - `notInstalled`: `sbx` が PATH に無い
 * - `notSignedIn`: Docker にサインインしていない（`sbx diagnose` の Authentication が fail）
 * - `unavailable`: それ以外の理由で `sbx ls` が失敗した
 */
export type SbxProblem = 'notInstalled' | 'notSignedIn' | 'unavailable'

export interface ProjectListResult {
  projects: ProjectWithStatus[]
  /** null なら各プロジェクトの `status` は `sbx ls` に基づく。 */
  sbxProblem: SbxProblem | null
}

export type AuthMethod =
  | { type: 'sbx-secret'; service: string }
  | { type: 'sbx-secret-oauth'; service: string }
  | { type: 'acp-authenticate'; methodId: string }
  | { type: 'agent-command'; argv: string[] }

/** エージェント対応表のエントリ。 */
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
