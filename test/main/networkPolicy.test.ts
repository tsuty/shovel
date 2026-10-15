import {
  isAllowableResource,
  isAllowedByRules,
  isDefaultDeny,
  matchesResource,
  readBlockedEntries,
  readPolicyRules,
  summarizeBlocked,
  type PolicyRule
} from '@main/domain/networkPolicy'

describe('matchesResource', () => {
  it('完全一致とポート', () => {
    expect(matchesResource('api.example.com:443', 'api.example.com:443')).toBe(true)
    expect(matchesResource('api.example.com:443', 'api.example.com:80')).toBe(false)
    expect(matchesResource('API.example.com:443', 'api.example.com:443')).toBe(true)
  })

  it('ポートの無いパターンは全ポートに当たる', () => {
    expect(matchesResource('github.com', 'github.com:443')).toBe(true)
    expect(matchesResource('github.com', 'github.com:22')).toBe(true)
    expect(matchesResource('github.com', 'api.github.com:443')).toBe(false)
  })

  it('* は1ラベル、** は複数ラベルで、どちらも頂点ドメインには当たらない', () => {
    expect(matchesResource('*.one.digicert.com:80', 'x.one.digicert.com:80')).toBe(true)
    expect(matchesResource('*.one.digicert.com:80', 'a.b.one.digicert.com:80')).toBe(false)
    expect(matchesResource('**.github.com:443', 'a.b.github.com:443')).toBe(true)
    expect(matchesResource('**.github.com:443', 'github.com:443')).toBe(false)
    expect(matchesResource('**.github.com:443', 'evilgithub.com:443')).toBe(false)
  })

  it('ラベル内の * と ?、文字クラス', () => {
    expect(matchesResource('crl*.digicert.com:80', 'crl3.digicert.com:80')).toBe(true)
    expect(matchesResource('crl*.digicert.com:80', 'crl.digicert.com:80')).toBe(true)
    expect(matchesResource('api?.example.com', 'api1.example.com:443')).toBe(true)
    expect(matchesResource('api?.example.com', 'api12.example.com:443')).toBe(false)
    expect(matchesResource('api[12].example.com', 'api2.example.com:443')).toBe(true)
    expect(matchesResource('api[!1].example.com', 'api1.example.com:443')).toBe(false)
    expect(matchesResource('api[!1].example.com', 'api3.example.com:443')).toBe(true)
  })

  it('** だけなら何にでも当たる', () => {
    expect(matchesResource('**', 'anything.example:1234')).toBe(true)
  })

  it('IPv4 の CIDR と IPv6', () => {
    expect(matchesResource('10.0.0.0/8', '10.1.2.3:443')).toBe(true)
    expect(matchesResource('10.0.0.0/8', '11.1.2.3:443')).toBe(false)
    expect(matchesResource('[2001:db8::1]:443', '[2001:db8::1]:443')).toBe(true)
    expect(matchesResource('[2001:db8::1]:443', '[2001:db8::1]:80')).toBe(false)
  })
})

describe('isAllowedByRules', () => {
  const global = (resources: string[], decision = 'allow'): PolicyRule => ({
    decision,
    resource_type: 'network',
    status: 'active',
    scope: 'global',
    applies_to: 'all',
    resources,
    actions: ['net:connect:tcp']
  })
  const scoped = (sandbox: string, resources: string[]): PolicyRule => ({
    decision: 'allow',
    resource_type: 'network',
    status: 'active',
    scope: `sandbox:${sandbox}`,
    applies_to: `sandbox:${sandbox}`,
    sandbox_id: sandbox,
    resources
  })

  it('全体のルールとこのサンドボックスのルールは効き、他のサンドボックスのルールは効かない', () => {
    expect(isAllowedByRules('a.example.com:443', [global(['a.example.com:443'])], 'MyChat')).toBe(true)
    expect(isAllowedByRules('a.example.com:443', [scoped('MyChat', ['a.example.com:443'])], 'MyChat')).toBe(true)
    expect(isAllowedByRules('a.example.com:443', [scoped('other', ['a.example.com:443'])], 'MyChat')).toBe(false)
  })

  it('拒否ルールが当たれば通らない', () => {
    const rules = [global(['**']), global(['a.example.com'], 'deny')]
    expect(isAllowedByRules('a.example.com:443', rules, 'MyChat')).toBe(false)
    expect(isAllowedByRules('b.example.com:443', rules, 'MyChat')).toBe(true)
  })

  it('有効でないルール・ファイルシステムのルールは数えない', () => {
    expect(isAllowedByRules('a.example.com:443', [{ ...global(['**']), status: 'inactive' }], 'MyChat')).toBe(false)
    expect(isAllowedByRules('a.example.com:443', [{ ...global(['**']), resource_type: 'filesystem:read' }], 'MyChat')).toBe(false)
  })
})

describe('isDefaultDeny', () => {
  it('reason か rule で既定の拒否を見分ける', () => {
    expect(isDefaultDeny({ reason: 'No matching allow rule (default deny)' })).toBe(true)
    expect(isDefaultDeny({ rule: 'no applicable policies for op(action=net:connect:tcp, ...)' })).toBe(true)
    expect(isDefaultDeny({ reason: 'Blocked by org policy', rule: 'org-deny' })).toBe(false)
  })
})

describe('isAllowableResource', () => {
  it('フラグに見えるもの・複数指定・空白を拒む', () => {
    expect(isAllowableResource('api.example.com:443')).toBe(true)
    expect(isAllowableResource('--protocol')).toBe(false)
    expect(isAllowableResource('a.com,b.com')).toBe(false)
    expect(isAllowableResource('a.com b.com')).toBe(false)
    expect(isAllowableResource('')).toBe(false)
  })
})

describe('summarizeBlocked', () => {
  const log = {
    allowed: [],
    blocked: [
      {
        sandbox_id: 'MyChat',
        host: 'http-intake.logs.us5.datadoghq.com:443',
        rule: 'no applicable policies for op(action=net:connect:tcp, resource=net:domain:http-intake.logs.us5.datadoghq.com:443)',
        reason: 'No matching allow rule (default deny)',
        count: 8,
        last_seen: '2026-10-16T01:42:13.019093+09:00'
      },
      {
        sandbox_id: 'MyChat',
        host: 'http-intake.logs.us5.datadoghq.com:443',
        reason: 'No matching allow rule (default deny)',
        count: 2,
        last_seen: '2026-10-16T01:00:00+09:00'
      },
      {
        sandbox_id: 'MyChat',
        host: 'example.org:443',
        reason: 'Blocked by local rule',
        count: 1,
        last_seen: '2026-10-16T01:50:00+09:00'
      },
      { sandbox_id: 'MyChat', host: 'now-allowed.example.com:443', reason: 'default deny', count: 3 },
      { sandbox_id: 'other', host: 'other.example.com:443', reason: 'default deny', count: 1 }
    ]
  }
  const rules = readPolicyRules({
    rules: [
      {
        decision: 'allow',
        resource_type: 'network',
        status: 'active',
        applies_to: 'sandbox:MyChat',
        resources: ['now-allowed.example.com:443']
      }
    ]
  })

  it('宛先ごとにまとめ、いま通るものと他のサンドボックスを除き、新しい順に並べる', () => {
    const result = summarizeBlocked(readBlockedEntries(log, 'MyChat'), rules, 'MyChat', ['example.org:443'])
    expect(result).toEqual([
      {
        host: 'example.org:443',
        count: 1,
        lastSeen: '2026-10-16T01:50:00+09:00',
        allowable: false,
        reason: 'Blocked by local rule',
        rule: null,
        ignored: true
      },
      {
        host: 'http-intake.logs.us5.datadoghq.com:443',
        count: 10,
        lastSeen: '2026-10-16T01:42:13.019093+09:00',
        allowable: true,
        reason: 'No matching allow rule (default deny)',
        rule: 'no applicable policies for op(action=net:connect:tcp, resource=net:domain:http-intake.logs.us5.datadoghq.com:443)',
        ignored: false
      }
    ])
  })

  it('形の違う JSON は空として扱う', () => {
    expect(readBlockedEntries(null, 'MyChat')).toEqual([])
    expect(readBlockedEntries({ blocked: 'x' }, 'MyChat')).toEqual([])
    expect(readPolicyRules({})).toEqual([])
  })
})
