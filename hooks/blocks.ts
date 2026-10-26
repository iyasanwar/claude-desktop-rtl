// Splits a reply's markdown into blocks and gives each the direction of its
// first strong letter, as HTML's dir="auto" would. Tolerates a reply cut
// mid-stream: an unclosed fence runs to the end.

export type Dir = 'ltr' | 'rtl'

export type Block =
  | { kind: 'code'; from: number; to: number }
  | { kind: 'hr'; from: number; to: number }
  | { kind: 'heading'; from: number; to: number; level: number; text: string }
  | { kind: 'item'; from: number; to: number; marker: string; depth: number; text: string }
  | { kind: 'quote'; from: number; to: number; text: string }
  | { kind: 'table'; from: number; to: number; rows: string[][] }
  | { kind: 'para'; from: number; to: number; text: string }

const FENCE = /^\s*(`{3,}|~{3,})/
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const TABLE = /^\s*\|/

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/u
const LETTER = /\p{L}/u

/**
 * How a block's direction is chosen: `arabic` (default) reads a block right to
 * left once Arabic is a real share of its letters, whatever letter opens it;
 * `all` reads every block of a reply that holds any Arabic right to left;
 * `auto` is HTML's dir="auto", the first strong letter.
 */
export type Mode = 'arabic' | 'all' | 'auto'
export const MODES: readonly Mode[] = ['arabic', 'all', 'auto']

/** The share of Arabic letters at which a block reads right to left in `arabic` mode. */
const ARABIC_SHARE = 0.3

// The words a reader sees: no code, link targets or URLs.
function visible(markdown: string): string {
  return markdown
    .replace(/(`+)[\s\S]*?\1/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ')
}

/** The direction of the first strong letter, skipping code, link targets and URLs. */
export function firstStrong(markdown: string): Dir | undefined {
  for (const ch of visible(markdown)) {
    if (RTL.test(ch)) return 'rtl'
    if (LETTER.test(ch)) return 'ltr'
  }
  return undefined
}

/** A run of text's direction under `mode`; `fallback` when it has no letter at all. */
export function textDir(markdown: string, mode: Mode, fallback: Dir = 'ltr'): Dir {
  if (mode === 'auto') return firstStrong(markdown) ?? fallback
  let rtl = 0
  let letters = 0
  for (const ch of visible(markdown)) {
    if (RTL.test(ch)) rtl++
    if (LETTER.test(ch)) letters++
  }
  if (letters === 0) return fallback
  if (mode === 'all') return rtl > 0 ? 'rtl' : fallback
  return rtl / letters >= ARABIC_SHARE ? 'rtl' : 'ltr'
}

export function hasRtl(text: string): boolean {
  return RTL.test(text)
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HR.test(line) || HEADING.test(line) || ITEM.test(line) || QUOTE.test(line) || TABLE.test(line)
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
}

export function splitBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const close = fence[1] ?? '```'
      let j = i + 1
      while (j < lines.length && !(lines[j] ?? '').trim().startsWith(close)) j++
      const to = Math.min(j + 1, lines.length)
      blocks.push({ kind: 'code', from: i, to })
      i = to
      continue
    }
    if (HR.test(line)) {
      blocks.push({ kind: 'hr', from: i, to: i + 1 })
      i++
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', from: i, to: i + 1, level: heading[1]?.length ?? 1, text: heading[2] ?? '' })
      i++
      continue
    }
    if (TABLE.test(line)) {
      let j = i
      const rows: string[][] = []
      while (j < lines.length && TABLE.test(lines[j] ?? '')) {
        const row = cells(lines[j] ?? '')
        if (!row.every(c => /^:?-{1,}:?$/.test(c))) rows.push(row)
        j++
      }
      blocks.push({ kind: 'table', from: i, to: j, rows })
      i = j
      continue
    }
    const quote = QUOTE.exec(line)
    if (quote) {
      let j = i
      const parts: string[] = []
      let m: RegExpExecArray | null
      while (j < lines.length && (m = QUOTE.exec(lines[j] ?? ''))) {
        parts.push(m[1] ?? '')
        j++
      }
      blocks.push({ kind: 'quote', from: i, to: j, text: parts.join('\n') })
      i = j
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      const indent = item[1]?.length ?? 0
      let j = i + 1
      const parts = [item[3] ?? '']
      // Lazy continuation: indented, non-blank lines that start nothing new.
      while (j < lines.length) {
        const next = lines[j] ?? ''
        if (next.trim() === '' || startsBlock(next)) break
        parts.push(next.trim())
        j++
      }
      blocks.push({ kind: 'item', from: i, to: j, marker: item[2] ?? '-', depth: Math.floor(indent / 2), text: parts.join('\n') })
      i = j
      continue
    }
    let j = i + 1
    while (j < lines.length && (lines[j] ?? '').trim() !== '' && !startsBlock(lines[j] ?? '')) j++
    blocks.push({ kind: 'para', from: i, to: j, text: lines.slice(i, j).join('\n') })
    i = j
  }
  return blocks
}

/**
 * Code and rules are always LTR; every other block reads by `mode`. Under
 * `all`, a block in a reply that holds Arabic is RTL even with no Arabic of its own.
 */
export function blockDir(block: Block, mode: Mode, replyHasRtl = false): Dir {
  switch (block.kind) {
    case 'code':
    case 'hr':
      return 'ltr'
    default: {
      const text = block.kind === 'table' ? (block.rows[0] ?? []).join(' ') : block.text
      if (mode === 'all' && replyHasRtl) return 'rtl'
      return textDir(text, mode)
    }
  }
}

export type Span =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'strong' | 'em' | 'del'; children: Span[] }
  | { t: 'link'; href: string; children: Span[] }

const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*(?!\s)([^*]+?)\*|(?<![\p{L}\p{N}])_(?!\s)([^_]+?)_(?![\p{L}\p{N}])|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<?(https?:\/\/[^\s<>]*[^\s<>.,;:!?)\]'"])>?/gu

/** Inline markdown to spans: code, bold, italic, strikethrough, links, bare URLs. */
export function inline(text: string): Span[] {
  const out: Span[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ t: 'text', text: text.slice(last, at) })
    if (m[2] !== undefined) out.push({ t: 'code', text: m[2].replace(/^ (.*) $/, '$1') })
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ t: 'strong', children: inline(m[3] ?? m[4] ?? '') })
    else if (m[5] !== undefined) out.push({ t: 'del', children: inline(m[5]) })
    else if (m[6] !== undefined || m[7] !== undefined) out.push({ t: 'em', children: inline(m[6] ?? m[7] ?? '') })
    else if (m[8] !== undefined && m[9] !== undefined) out.push({ t: 'link', href: m[9], children: inline(m[8]) })
    else if (m[10] !== undefined) out.push({ t: 'link', href: m[10], children: [{ t: 'text', text: m[10] }] })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ t: 'text', text: text.slice(last) })
  return out
}
