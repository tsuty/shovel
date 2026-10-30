import { describe, expect, it } from 'vitest'
import { addressToUrl, isWebUrl } from '@shared/browserUrl'

describe('isWebUrl', () => {
  it('http / https だけを通す', () => {
    expect(isWebUrl('https://example.com')).toBe(true)
    expect(isWebUrl('http://localhost:3000/a')).toBe(true)
    expect(isWebUrl('file:///etc/passwd')).toBe(false)
    expect(isWebUrl('javascript:alert(1)')).toBe(false)
    expect(isWebUrl('about:blank')).toBe(false)
    expect(isWebUrl('not a url')).toBe(false)
  })
})

describe('addressToUrl', () => {
  it('スキーム付きはそのまま', () => {
    expect(addressToUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(addressToUrl('  HTTP://Example.com ')).toBe('HTTP://Example.com')
  })

  it('ドメインらしい形には https を補う', () => {
    expect(addressToUrl('example.com')).toBe('https://example.com')
    expect(addressToUrl('docs.example.co.jp/guide#top')).toBe('https://docs.example.co.jp/guide#top')
  })

  it('localhost と IP アドレスには http を補う', () => {
    expect(addressToUrl('localhost:5173')).toBe('http://localhost:5173')
    expect(addressToUrl('localhost')).toBe('http://localhost')
    expect(addressToUrl('192.168.0.10:8080/x')).toBe('http://192.168.0.10:8080/x')
  })

  it('それ以外は検索する', () => {
    expect(addressToUrl('electron webview')).toBe('https://www.google.com/search?q=electron%20webview')
    expect(addressToUrl('仕様書')).toBe('https://www.google.com/search?q=%E4%BB%95%E6%A7%98%E6%9B%B8')
    expect(addressToUrl('file:///etc/passwd')).toBe('https://www.google.com/search?q=file%3A%2F%2F%2Fetc%2Fpasswd')
  })

  it('空なら null', () => {
    expect(addressToUrl('   ')).toBeNull()
  })
})
