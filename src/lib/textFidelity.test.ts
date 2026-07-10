import { describe, it, expect } from 'vitest'
import { unwrapText, wrapText } from './textFidelity'

/** 未编辑文件应逐字节 round-trip：unwrap 再 wrap 得回原文。 */
function roundTrip(raw: string): string {
  const u = unwrapText(raw)
  return wrapText({ bom: u.bom, eol: u.eol }, u.text)
}

describe('textFidelity', () => {
  it('保真 LF / CRLF / CR-only / BOM', () => {
    expect(roundTrip('a\nb\nc')).toBe('a\nb\nc')
    expect(roundTrip('a\r\nb\r\nc')).toBe('a\r\nb\r\nc')
    expect(roundTrip('a\rb\rc')).toBe('a\rb\rc') // 老 Mac CR
    expect(roundTrip('﻿a\r\nb')).toBe('﻿a\r\nb')
  })

  it('主导换行符按多数决，并列优先 LF', () => {
    expect(unwrapText('a\r\nb\r\nc\nd').eol).toBe('\r\n') // CRLF 2 > LF 1
    expect(unwrapText('a\nb\nc\r\n').eol).toBe('\n') // LF 2 > CRLF 1
    expect(unwrapText('a\nb\r\nc').eol).toBe('\n') // 并列 1:1 → LF
    expect(unwrapText('a\rb\rc\n').eol).toBe('\r') // CR 2 > LF 1
  })

  it('编辑器内正文一律归一为 \\n', () => {
    expect(unwrapText('a\r\nb\rc\n').text).toBe('a\nb\nc\n')
  })
})
