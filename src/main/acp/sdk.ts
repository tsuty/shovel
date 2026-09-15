/**
 * `@agentclientprotocol/sdk` は ESM 専用パッケージ（package.json: "type": "module"）。
 * main プロセスのビルド出力は CommonJS なので、静的 `import` / `require` では
 * ロードできない。CJS から ESM を読み込む唯一の標準的な経路である動的
 * `import()` に一本化し、一度だけ読み込んでキャッシュする。
 *
 * このファイル以外では `@agentclientprotocol/sdk` から値をインポートしない。
 * 型だけが必要な場所では `import type` を使う（型情報はコンパイル時に消え、
 * 実行時の ESM/CJS 相互運用の問題を起こさない）。
 */

type AcpSdkModule = typeof import('@agentclientprotocol/sdk')

let modulePromise: Promise<AcpSdkModule> | null = null

export function loadAcpSdk(): Promise<AcpSdkModule> {
  if (!modulePromise) {
    modulePromise = import('@agentclientprotocol/sdk')
  }
  return modulePromise
}
