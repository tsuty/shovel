import type { BlockedHost } from '@shared/types/network'

/** `sbx policy log --json` の `blocked` の1エントリ（使うものだけ）。 */
interface PolicyLogEntry {
  sandbox_id?: string
  host?: string
  rule?: string
  reason?: string
  count?: number
  last_seen?: string
}

/** `sbx policy ls --json` の `rules` の1エントリ（使うものだけ）。 */
export interface PolicyRule {
  decision?: string
  resource_type?: string
  status?: string
  scope?: string
  applies_to?: string
  sandbox_id?: string
  resources?: string[]
  actions?: string[]
}

/** `sbx policy allow network` に渡す宛先として受け付ける形か。フラグに見えるもの・複数指定・空白を含むものは拒む。 */
export function isAllowableResource(host: string): boolean {
  return host.length > 0 && !host.startsWith('-') && !/[\s,]/.test(host)
}

/** `sbx policy log --json` から、指定したサンドボックスの `blocked` を読み出す。形が違えば空。 */
export function readBlockedEntries(json: unknown, sandboxName: string): PolicyLogEntry[] {
  if (!json || typeof json !== 'object') return []
  const blocked = (json as { blocked?: unknown }).blocked
  if (!Array.isArray(blocked)) return []
  return blocked.filter(
    (e): e is PolicyLogEntry =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as PolicyLogEntry).host === 'string' &&
      ((e as PolicyLogEntry).sandbox_id === undefined || (e as PolicyLogEntry).sandbox_id === sandboxName)
  )
}

/** `sbx policy ls --json` の `rules` を読み出す。形が違えば空。 */
export function readPolicyRules(json: unknown): PolicyRule[] {
  if (!json || typeof json !== 'object') return []
  const rules = (json as { rules?: unknown }).rules
  if (!Array.isArray(rules)) return []
  return rules.filter((r): r is PolicyRule => !!r && typeof r === 'object')
}

/** どの許可ルールにも当たらなかったための拒否（既定の拒否）か。 */
export function isDefaultDeny(entry: { reason?: string | null; rule?: string | null }): boolean {
  return /default deny/i.test(entry.reason ?? '') || /^no applicable policies/i.test(entry.rule ?? '')
}

/** `host:port` / `[v6]:port` / `host` を分ける。ポートが無ければ null。 */
function splitHostPort(value: string): { host: string; port: string | null } {
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end < 0) return { host: value, port: null }
    const rest = value.slice(end + 1)
    return { host: value.slice(1, end), port: rest.startsWith(':') ? rest.slice(1) : null }
  }
  const colons = value.split(':').length - 1
  if (colons !== 1) return { host: value, port: null }
  const idx = value.indexOf(':')
  return { host: value.slice(0, idx), port: value.slice(idx + 1) }
}

/** ドメインのグロブ（`*` は1ラベル内、`**` は複数ラベル、`?` は1文字、`[...]` / `[!...]` は文字クラス）を正規表現にする。 */
function globToRegExp(glob: string): RegExp {
  let src = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i)
    if (c === '*') {
      if (glob[i + 1] === '*') {
        src += '.+'
        i++
      } else {
        src += '[^.]*'
      }
    } else if (c === '?') {
      src += '[^.]'
    } else if (c === '[') {
      const end = glob.indexOf(']', i + 1)
      if (end < 0) {
        src += '\\['
        continue
      }
      let body = glob.slice(i + 1, end)
      const negate = body.startsWith('!')
      if (negate) body = body.slice(1)
      src += `[${negate ? '^' : ''}${body.replace(/[\\\]^]/g, '\\$&')}]`
      i = end
    } else {
      src += c.replace(/[.+^${}()|\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${src}$`, 'i')
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n
}

/** IPv4 の CIDR に含まれるか。IPv6 の CIDR は判定せず false を返す。 */
function inIpv4Cidr(cidr: string, ip: string): boolean {
  const [base = '', bitsText] = cidr.split('/')
  const baseInt = ipv4ToInt(base)
  const ipInt = ipv4ToInt(ip)
  const bits = Number(bitsText)
  if (baseInt === null || ipInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  if (bits === 0) return true
  const size = 2 ** (32 - bits)
  return Math.floor(baseInt / size) === Math.floor(ipInt / size)
}

/** ルールの宛先パターンが `host:port` に当たるか。パターンにポートが無ければ全ポートに当たる。 */
export function matchesResource(pattern: string, target: string): boolean {
  if (pattern === '**') return true
  const p = splitHostPort(pattern)
  const t = splitHostPort(target)
  if (p.port !== null && p.port !== t.port) return false
  if (p.host.includes('/')) return inIpv4Cidr(p.host, t.host)
  return globToRegExp(p.host).test(t.host)
}

/** ルールがこのサンドボックスの TCP 接続に効くか。 */
function ruleApplies(rule: PolicyRule, sandboxName: string): boolean {
  if (rule.resource_type !== undefined && rule.resource_type !== 'network') return false
  if (rule.status !== undefined && rule.status !== 'active') return false
  if (rule.actions !== undefined && !rule.actions.includes('net:connect:tcp')) return false
  return (
    rule.applies_to === 'all' ||
    rule.scope === 'global' ||
    rule.applies_to === `sandbox:${sandboxName}` ||
    rule.sandbox_id === sandboxName
  )
}

/** いまのルールでこの宛先が通るか（当たる許可ルールがあり、当たる拒否ルールが無い）。 */
export function isAllowedByRules(target: string, rules: PolicyRule[], sandboxName: string): boolean {
  const hits = (decision: string): boolean =>
    rules.some(
      (r) =>
        r.decision === decision &&
        ruleApplies(r, sandboxName) &&
        (r.resources ?? []).some((pattern) => matchesResource(pattern, target))
    )
  return hits('allow') && !hits('deny')
}

/**
 * 拒否ログを宛先ごとにまとめ、いまのルールで通るようになったものを除く。
 * 最後に拒否された時刻の新しい順に並べる。
 */
export function summarizeBlocked(
  entries: PolicyLogEntry[],
  rules: PolicyRule[],
  sandboxName: string,
  ignoredHosts: readonly string[]
): BlockedHost[] {
  const byHost = new Map<string, BlockedHost>()
  for (const e of entries) {
    const host = e.host as string
    const allowable = isDefaultDeny(e)
    const lastSeen = e.last_seen ?? null
    const prev = byHost.get(host)
    if (!prev) {
      byHost.set(host, {
        host,
        count: e.count ?? 0,
        lastSeen,
        allowable,
        reason: e.reason ?? null,
        rule: e.rule ?? null,
        ignored: ignoredHosts.includes(host)
      })
      continue
    }
    prev.count += e.count ?? 0
    prev.allowable &&= allowable
    if (lastSeen && (!prev.lastSeen || Date.parse(lastSeen) > Date.parse(prev.lastSeen))) {
      prev.lastSeen = lastSeen
      prev.reason = e.reason ?? prev.reason
      prev.rule = e.rule ?? prev.rule
    }
  }
  return [...byHost.values()]
    .filter((b) => !isAllowedByRules(b.host, rules, sandboxName))
    .sort((a, b) => (b.lastSeen ? Date.parse(b.lastSeen) : 0) - (a.lastSeen ? Date.parse(a.lastSeen) : 0))
}
