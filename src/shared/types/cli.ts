/**
 * コマンドラインツール `shovel` の入れ方。
 * - `symlink`: 既存の PATH にシンボリックリンクを置く（macOS は `/usr/local/bin`、Linux は `~/.local/bin`）
 * - `script`: 実行ファイルの場所を書き込んだスクリプトを `~/.local/bin` に置く（AppImage）
 * - `windowsPath`: `<インストール先>\bin` をユーザーの PATH に足す（Windows）
 * - `package`: パッケージが入れる（Linux の deb）。ボタンでは入れ外ししない
 */
export type CliInstallMethod = 'symlink' | 'script' | 'windowsPath' | 'package'

/**
 * - `installed`: 入っている
 * - `notInstalled`: 入っていない
 * - `stale`: 以前に入れたものが、移動前の場所や別のコピーを指している（入れ直せば直る）
 * - `foreign`: 置き場所に別のファイルがある（上書きしない）
 */
export type CliInstallState = 'installed' | 'notInstalled' | 'stale' | 'foreign'

export type CliInstallStatus =
  | {
      available: false
      /** `dev`: 開発中の起動（配布物でない）。`unsupported`: 対応していない OS。 */
      reason: 'dev' | 'unsupported'
    }
  | {
      available: true
      method: CliInstallMethod
      state: CliInstallState
      /** コマンドの置き場所（Windows は PATH に足すディレクトリ）。 */
      location: string
      /** 置き場所のディレクトリが PATH に入っていない（Linux の `~/.local/bin`）。 */
      dirNotOnPath: boolean
      /** PATH 上で先に見つかる別の `shovel`。 */
      shadowedBy: string | null
      /** Windows: インストーラーがシステムの PATH に足している（ボタンでは外せない）。 */
      managedByInstaller: boolean
    }

/** 入れる・外す操作の結果。利用者が管理者権限の確認を取り消したら `cancelled`。 */
export type CliInstallResult = { status: CliInstallStatus; cancelled: boolean }
