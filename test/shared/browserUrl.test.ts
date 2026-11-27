import { describe, expect, it } from 'vitest'
import { addressToUrl, isWebUrl, isBrowsableUrl, localPageUrl, parseLocalPageUrl } from '@shared/browserUrl'

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

describe('localPageUrl / parseLocalPageUrl', () => {
  const id = '5002cd55-e1d9-427b-bd15-c561730e3710'

  it('プロジェクト内のパスを区切りごとにエンコードし、元に戻せる', () => {
    const url = localPageUrl(id, 'docs/資料 1/index.html')
    expect(url).toBe(`shovel-file://${id}/docs/${encodeURIComponent('資料 1')}/index.html`)
    expect(parseLocalPageUrl(url)).toEqual({ projectId: id, relPath: 'docs/資料 1/index.html' })
  })

  it('`#`・`?` を含むファイル名もクエリやフラグメントにならない', () => {
    expect(parseLocalPageUrl(localPageUrl(id, 'a#b?c.html'))).toEqual({ projectId: id, relPath: 'a#b?c.html' })
  })

  it('URL のクエリとフラグメントは無視する', () => {
    expect(parseLocalPageUrl(`shovel-file://${id}/index.html?x=1#top`)).toEqual({ projectId: id, relPath: 'index.html' })
  })

  it('他のスキームや壊れた URL は null', () => {
    expect(parseLocalPageUrl('https://example.com/index.html')).toBeNull()
    expect(parseLocalPageUrl('file:///etc/passwd')).toBeNull()
    expect(parseLocalPageUrl('not a url')).toBeNull()
    expect(parseLocalPageUrl(`shovel-file://${id}/%E0%A4%A`)).toBeNull()
  })

  it('`..` は URL の段階で正規化され、プロジェクトの外を指さない', () => {
    expect(parseLocalPageUrl(`shovel-file://${id}/../../etc/passwd`)).toEqual({ projectId: id, relPath: 'etc/passwd' })
  })

  it('isBrowsableUrl は Web とプロジェクト内のページだけを通す', () => {
    expect(isBrowsableUrl('https://example.com')).toBe(true)
    expect(isBrowsableUrl(localPageUrl(id, 'index.html'))).toBe(true)
    expect(isBrowsableUrl('file:///tmp/index.html')).toBe(false)
    expect(isBrowsableUrl('javascript:alert(1)')).toBe(false)
  })

  it('addressToUrl は入力された shovel-file の URL をそのまま開く', () => {
    const url = localPageUrl(id, 'index.html')
    expect(addressToUrl(url)).toBe(url)
  })
})
