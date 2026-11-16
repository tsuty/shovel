import { fontFamilyPrefix, quoteFontFamily, sanitizeFontFamily, uniqueFamilies } from '@shared/fontFamily'

describe('sanitizeFontFamily', () => {
  it('keeps ordinary names, trimmed', () => {
    expect(sanitizeFontFamily('  HackGen Console ')).toBe('HackGen Console')
    expect(sanitizeFontFamily('ヒラギノ角ゴシック')).toBe('ヒラギノ角ゴシック')
  })

  it('treats empty, too long, non-string and control characters as the default', () => {
    expect(sanitizeFontFamily('')).toBeNull()
    expect(sanitizeFontFamily('   ')).toBeNull()
    expect(sanitizeFontFamily('a'.repeat(201))).toBeNull()
    expect(sanitizeFontFamily('a\nb')).toBeNull()
    expect(sanitizeFontFamily(null)).toBeNull()
    expect(sanitizeFontFamily(42)).toBeNull()
  })
})

describe('quoteFontFamily / fontFamilyPrefix', () => {
  it('escapes quotes and backslashes', () => {
    expect(quoteFontFamily('Menlo')).toBe('"Menlo"')
    expect(quoteFontFamily('a"b\\c')).toBe('"a\\"b\\\\c"')
  })

  it('cannot break out of the string to inject other declarations', () => {
    expect(fontFamilyPrefix('x"; color: red; "')).toBe('"x\\"; color: red; \\"",')
  })

  it('returns null for the default', () => {
    expect(fontFamilyPrefix(null)).toBeNull()
    expect(fontFamilyPrefix('')).toBeNull()
    expect(fontFamilyPrefix('Menlo')).toBe('"Menlo",')
  })
})

describe('uniqueFamilies', () => {
  it('dedupes styles of the same family and sorts case-insensitively', () => {
    expect(
      uniqueFamilies([
        { family: 'menlo' },
        { family: 'DejaVu Sans Mono' },
        { family: 'DejaVu Sans Mono' },
        { family: 'Arial' },
        { family: '' }
      ])
    ).toEqual(['Arial', 'DejaVu Sans Mono', 'menlo'])
  })
})
