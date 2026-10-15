import { describe, expect, it } from 'vitest'
import { withLinksInNewWindow } from '../../src/renderer/shared/lib/htmlPreview'

describe('withLinksInNewWindow', () => {
  it('inserts the base element right after the doctype', () => {
    expect(withLinksInNewWindow('<!DOCTYPE html>\n<html></html>')).toBe(
      '<!DOCTYPE html><base target="_blank">\n<html></html>'
    )
    expect(withLinksInNewWindow('  <!doctype html><p>x</p>')).toBe('  <!doctype html><base target="_blank"><p>x</p>')
  })

  it('prepends the base element when there is no doctype', () => {
    expect(withLinksInNewWindow('<p>x</p>')).toBe('<base target="_blank"><p>x</p>')
    expect(withLinksInNewWindow('')).toBe('<base target="_blank">')
  })
})
