import type { ConfigOption } from '@shared/types/session'

/** `updates` の項目で `current` の同じ configId を置き換え、`current` に無い項目は末尾に足す。 */
export function mergeConfigOptions(current: ConfigOption[], updates: ConfigOption[]): ConfigOption[] {
  const byId = new Map(updates.map((opt) => [opt.configId, opt]))
  const merged = current.map((opt) => byId.get(opt.configId) ?? opt)
  const known = new Set(current.map((opt) => opt.configId))
  return [...merged, ...updates.filter((opt) => !known.has(opt.configId))]
}
