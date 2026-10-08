/** ACP レジストリ（registry.json）の読み取りと、バージョン文字列の比較。 */

/** ACP レジストリの URL。 */
export const ACP_REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** `x.y.z`（プレリリース・ビルドメタデータ付き可）の形か。 */
export function isValidVersion(version: unknown): version is string {
  return typeof version === 'string' && VERSION_PATTERN.test(version)
}

/**
 * semver の大小比較（a < b なら負、a > b なら正、同じなら 0）。
 * プレリリースは同じ `x.y.z` の正式版より小さい。ビルドメタデータは無視する。
 */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = splitVersion(a)
  const [coreB, preB] = splitVersion(b)
  for (let i = 0; i < 3; i++) {
    const diff = (coreA[i] ?? 0) - (coreB[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (preA === preB) return 0
  if (preA === null) return 1
  if (preB === null) return -1
  const partsA = preA.split('.')
  const partsB = preB.split('.')
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const pa = partsA[i]
    const pb = partsB[i]
    if (pa === undefined) return -1
    if (pb === undefined) return 1
    const na = /^\d+$/.test(pa) ? Number(pa) : null
    const nb = /^\d+$/.test(pb) ? Number(pb) : null
    if (na !== null && nb !== null) {
      if (na !== nb) return na - nb
    } else if (na !== null) {
      return -1
    } else if (nb !== null) {
      return 1
    } else if (pa !== pb) {
      return pa < pb ? -1 : 1
    }
  }
  return 0
}

function splitVersion(version: string): [number[], string | null] {
  const plus = version.indexOf('+')
  const withoutBuild = plus >= 0 ? version.slice(0, plus) : version
  const dash = withoutBuild.indexOf('-')
  const core = dash >= 0 ? withoutBuild.slice(0, dash) : withoutBuild
  const pre = dash >= 0 ? withoutBuild.slice(dash + 1) : null
  return [core.split('.').map((n) => Number(n)), pre]
}

/** registry.json の1エージェントのうち、shovel が使う部分。 */
export interface AcpRegistryEntry {
  /** 表示名（例: `Claude Agent`）。 */
  name: string
  /** 最新バージョン。 */
  version: string
}

/**
 * registry.json から、指定した npm パッケージのエージェントの表示名と最新バージョンを読む。
 * エージェントの `distribution.npx.package`（`<name>@<version>`）の名前で照合する。
 * 見つからない・形が合わないときは null。
 */
export function findRegistryEntry(registry: unknown, packageName: string): AcpRegistryEntry | null {
  const agents = (registry as { agents?: unknown } | null)?.agents
  if (!Array.isArray(agents)) return null
  for (const agent of agents) {
    const entry = agent as { name?: unknown; distribution?: { npx?: { package?: unknown } } } | null
    const spec = entry?.distribution?.npx?.package
    if (typeof spec !== 'string') continue
    // スコープ付き（`@scope/name@1.2.3`）を考え、最後の `@` で分ける。
    const at = spec.lastIndexOf('@')
    if (at <= 0) continue
    const name = spec.slice(0, at)
    const version = spec.slice(at + 1)
    if (name === packageName && isValidVersion(version)) {
      return { name: typeof entry?.name === 'string' && entry.name ? entry.name : packageName, version }
    }
  }
  return null
}
