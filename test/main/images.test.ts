import { MAX_IMAGE_BYTES, toTranscriptImage } from '@main/acp/images'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const GIF = Buffer.from('GIF89a\0\0', 'latin1')
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ', 'latin1')])

describe('toTranscriptImage', () => {
  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/gif', GIF],
    ['image/webp', WEBP]
  ])('%s はバイト列で見分けて data を持たせる', (mimeType, bytes) => {
    expect(toTranscriptImage(bytes.toString('base64'), 'application/octet-stream')).toEqual({
      mimeType,
      data: bytes.toString('base64')
    })
  })

  it('mimeType ではなくバイト列を信じる', () => {
    expect(toTranscriptImage(PNG.toString('base64'), 'image/jpeg').mimeType).toBe('image/png')
  })

  it('知らない形式・空・壊れた base64 はプレースホルダ（data なし）にする', () => {
    expect(toTranscriptImage(Buffer.from('<svg/>').toString('base64'), 'image/svg+xml')).toEqual({ mimeType: 'image/svg+xml' })
    expect(toTranscriptImage('', 'image/png')).toEqual({ mimeType: 'image/png' })
    expect(toTranscriptImage('!!!!', 'image/png')).toEqual({ mimeType: 'image/png' })
  })

  it('上限を超える画像はプレースホルダにする', () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)])
    expect(toTranscriptImage(big.toString('base64'), 'image/png')).toEqual({ mimeType: 'image/png' })
  })
})
