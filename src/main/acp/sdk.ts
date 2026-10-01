/** `@agentclientprotocol/sdk`（ESM 専用）を動的 `import()` で一度だけ読み込んでキャッシュする。 */

type AcpSdkModule = typeof import('@agentclientprotocol/sdk')

let modulePromise: Promise<AcpSdkModule> | null = null

export function loadAcpSdk(): Promise<AcpSdkModule> {
  if (!modulePromise) {
    modulePromise = import('@agentclientprotocol/sdk')
  }
  return modulePromise
}
