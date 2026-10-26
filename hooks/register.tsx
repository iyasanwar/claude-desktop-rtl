import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement } from 'claude-code'

import { blockDir, hasRtl, inline, MODES, splitBlocks, textDir } from './blocks'
import type { Block, Dir, Mode, Span } from './blocks'

const mode = atom({ plugin: 'rtl-fix', key: 'mode' } as const, 'arabic' as Mode)

const MODE_NAMES: Record<Mode, string> = {
  arabic: 'arabic: a block with Arabic in it reads right to left, whatever letter opens it',
  all: 'all: every block of a reply that holds any Arabic reads right to left',
  auto: 'auto: each block by its first strong letter (dir="auto")',
}

type T = Elements['desktop']

// Desktop draws a Text's `dir` as alignment only, the paragraph still laid out
// left to right; Unicode isolates set the direction inside the text itself.
const RLI = '\u2067'
const LRI = '\u2066'
const PDI = '\u2069'
const isolate = (dir: Dir) => (dir === 'rtl' ? RLI : LRI)
// A strong RTL letter ahead of the isolate: Desktop aligns a line by the first
// strong letter it finds, and an isolate's contents are skipped by that search.
const RLM = '\u200F'
// A strong LTR letter: keeps a list number "1." from reading ".1" beside RTL text.
const LRM = '\u200E'

// English inside Arabic, styled like Desktop's inline code: its colors, read
// off a screenshot of the dark theme (text #c96f6a in a #2c2c2c box on #222222).
const LATIN = { color: '#c96f6a', backgroundColor: '#2c2c2c' } as const

// One flat label for a link: Link draws a string.
function plain(spans: readonly Span[]): string {
  return spans.map(s => (s.t === 'text' || s.t === 'code' ? s.text : plain(s.children))).join('')
}

function drawSpans(t: T, spans: readonly Span[]): (string | RenderElement)[] {
  const { Text, Link } = t
  return spans.map(s => {
    switch (s.t) {
      case 'text':
        return s.text
      case 'code':
        return <Text mono dir="ltr">{LRI + s.text + PDI}</Text>
      case 'strong':
        return <Text weight="bold">{drawSpans(t, s.children)}</Text>
      case 'em':
        return <Text italic>{drawSpans(t, s.children)}</Text>
      case 'del':
        return <Text strikethrough>{drawSpans(t, s.children)}</Text>
      case 'link':
        return <Link href={s.href} label={plain(s.children)} />
    }
  })
}

// An RTL run broken into lines here, one Text per line: Desktop lays a Text out
// left to right whatever its `dir`, so a wrapped line it broke itself sits on the
// left. `width` is the room in cells (Desktop reports it per window width); a
// line is filled to FILL of it, a word at a time, each letter measured in cells:
// the page's proportional Arabic runs narrower than a cell, Latin a little less so.
// Calibrated on a Desktop screenshot: two full lines, one English-heavy; a line
// cut too long is wrapped again by the page and its tail sits on the left, so err short.
const FILL = 0.92
const CELLS = { arabic: 0.9, mark: 0, latin: 1.1, space: 0.5, code: 1.15, shade: 0.8 }
const MARK = /[\u064B-\u065F\u0670\u06D6-\u06ED]/u
const ARABIC_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u

function cells(a: Atom): number {
  if (a.kind === 'code') return a.text.length * CELLS.code + CELLS.shade
  let n = isLatin(a) ? CELLS.shade : 0
  for (const ch of a.text) n += MARK.test(ch) ? CELLS.mark : ARABIC_CHAR.test(ch) ? CELLS.arabic : /\s/.test(ch) ? CELLS.space : CELLS.latin
  return n
}

type Wrap = 'strong' | 'em' | 'del'
// `glue`: no space before it (the rest of a word an English run was cut out of).
type Atom = { text: string; kind: 'word' | 'code' | 'link'; href?: string; wraps: readonly Wrap[]; glue?: true }

// The English part of a word, its trailing sentence punctuation left out.
const LATIN_PART = /[A-Za-z][\w.\-/+#'’:@]*[\w/+#]|[A-Za-z]/g

// One word as atoms: its English parts apart from what clings to them
// ("example.com،", "(React)", "config.py.").
function wordAtoms(word: string, wraps: readonly Wrap[]): Atom[] {
  const out: Atom[] = []
  let last = 0
  const push = (text: string) => out.push(out.length === 0 ? { text, kind: 'word', wraps } : { text, kind: 'word', wraps, glue: true })
  for (const m of word.matchAll(LATIN_PART)) {
    const at = m.index ?? 0
    if (at > last) push(word.slice(last, at))
    push(m[0])
    last = at + m[0].length
  }
  if (last < word.length) push(word.slice(last))
  return out
}

function atoms(spans: readonly Span[], wraps: readonly Wrap[] = []): Atom[] {
  return spans.flatMap((s): Atom[] => {
    switch (s.t) {
      case 'text':
        return s.text.split(/\s+/).filter(w => w !== '').flatMap(w => wordAtoms(w, wraps))
      case 'code':
        return [{ text: s.text, kind: 'code', wraps }]
      case 'link':
        return [{ text: plain(s.children), kind: 'link', href: s.href, wraps }]
      default:
        return atoms(s.children, [...wraps, s.t])
    }
  })
}

function breakLines(list: readonly Atom[], width: number | undefined): Atom[][] {
  if (width === undefined) return [list.slice()]
  const room = Math.max(12, width * FILL)
  const lines: Atom[][] = [[]]
  let used = 0
  for (const a of list) {
    const cur = lines[lines.length - 1] ?? []
    const size = cells(a)
    const gap = a.glue ? 0 : CELLS.space
    if (cur.length > 0 && !a.glue && used + gap + size > room) {
      lines.push([a])
      used = size
    } else {
      cur.push(a)
      used += (cur.length > 1 ? gap : 0) + size
    }
  }
  return lines
}

const isLatin = (a: Atom) => a.kind === 'word' && /^[A-Za-z]/.test(a.text)

// One line of atoms: neighbours of one style merge, so a run of English words
// is one LTR isolate (two isolates side by side would swap in an RTL line).
function drawAtoms(t: T, line: readonly Atom[]): (string | RenderElement)[] {
  const { Text, Link } = t
  const groups: Atom[][] = []
  for (const a of line) {
    const prev = groups[groups.length - 1]
    const last = prev?.[prev.length - 1]
    // English words merge only across a space: glued punctuation ends the run.
    const same = last && last.kind === 'word' && a.kind === 'word' && isLatin(last) === isLatin(a) && last.wraps.join() === a.wraps.join() && !(isLatin(a) && a.glue)
    if (prev && same) prev.push(a)
    else groups.push([a])
  }
  const out: (string | RenderElement)[] = []
  groups.forEach((g, i) => {
    const first = g[0]
    if (!first) return
    if (i > 0 && !first.glue) out.push(' ')
    const text = g.map((a, j) => (j > 0 && !a.glue ? ' ' : '') + a.text).join('')
    let el: string | RenderElement =
      first.kind === 'code' ? <Text mono {...LATIN}>{LRI + text + PDI}</Text>
      : first.kind === 'link' ? <Link href={first.href ?? ''} label={text} />
      : isLatin(first) ? <Text {...LATIN}>{LRI + text + PDI}</Text>
      : text
    for (const w of [...first.wraps].reverse()) {
      el = w === 'strong' ? <Text weight="bold">{el}</Text> : w === 'em' ? <Text italic>{el}</Text> : <Text strikethrough>{el}</Text>
    }
    out.push(el)
  })
  return out
}

type LineStyle = { weight?: 'bold'; size?: 'title' | 'heading'; dimColor?: boolean }

// A run of text in its own direction, pushed to its own edge.
function line(t: T, text: string, dir: Dir, style: LineStyle = {}, width?: number) {
  const { Box, Text } = t
  if (dir === 'ltr') {
    return (
      <Box flexDirection="column" flexGrow={1} flexShrink={1} alignItems="flex-start">
        <Text dir={dir} {...style}>{[LRI, ...drawSpans(t, inline(text)), PDI]}</Text>
      </Box>
    )
  }
  const scale = style.size === 'title' ? 0.6 : style.size === 'heading' ? 0.75 : 1
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} alignItems="flex-end">
      {breakLines(atoms(inline(text)), width === undefined ? undefined : width * scale).map(l => (
        <Text dir="rtl" {...style}>{[RLM + RLI, ...drawAtoms(t, l), PDI]}</Text>
      ))}
    </Box>
  )
}

function drawTable(t: T, rows: readonly string[][], dir: Dir, m: Mode, width?: number) {
  const { Box } = t
  const columns = Math.max(1, ...rows.map(r => r.length))
  return (
    <Box flexDirection="column" borderStyle="single" borderDimColor paddingX={1}>
      {rows.map((row, r) => (
        <Box flexDirection={dir === 'rtl' ? 'row-reverse' : 'row'} gap="sm">
          {Array.from({ length: columns }, (_, c) => {
            const cell = row[c] ?? ''
            return (
              <Box width={`${100 / columns}%`} flexShrink={1}>
                {line(t, cell, textDir(cell, m, dir), r === 0 ? { weight: 'bold' } : {}, width === undefined ? undefined : width / columns - 3)}
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

// A block that reads right to left (or a table with Arabic in it), drawn by hand.
function drawBlock(t: T, block: Block, dir: Dir, m: Mode, width?: number) {
  const { Box, Text } = t
  const row = dir === 'rtl' ? 'row-reverse' : 'row'
  switch (block.kind) {
    case 'heading':
      return line(t, block.text, dir, { weight: 'bold', size: block.level === 1 ? 'title' : block.level === 2 ? 'heading' : undefined }, width)
    case 'item':
      return (
        <Box flexDirection={row} gap="xs" {...(dir === 'rtl' ? { paddingRight: block.depth * 2 } : { paddingLeft: block.depth * 2 })}>
          <Text dir="ltr">{/^\d/.test(block.marker) ? LRM + block.marker + LRM : '•'}</Text>
          {line(t, block.text, dir, {}, width === undefined ? undefined : width - block.depth * 2 - 3)}
        </Box>
      )
    case 'quote':
      return (
        <Box flexDirection={row} gap="xs">
          <Text dimColor>┃</Text>
          {line(t, block.text, dir, { dimColor: true }, width === undefined ? undefined : width - 3)}
        </Box>
      )
    case 'table':
      return drawTable(t, block.rows, dir, m, width === undefined ? undefined : width - 4)
    default:
      return line(t, block.kind === 'para' ? block.text : '', dir, {}, width)
  }
}

/** The reply as blocks: LTR runs go to the surface's own Markdown untouched, RTL blocks are drawn here. */
function drawReply(t: T, text: string, m: Mode, width?: number) {
  const { Box, Markdown } = t
  const lines = text.split('\n')
  const out: RenderElement[] = []
  let run: Block[] = []
  const flush = () => {
    const first = run[0]
    const last = run[run.length - 1]
    if (first && last) out.push(<Markdown text={lines.slice(first.from, last.to).join('\n')} />)
    run = []
  }
  for (const block of splitBlocks(lines)) {
    const dir = blockDir(block, m, true)
    const isMine = dir === 'rtl' || (block.kind === 'table' && block.rows.some(r => r.some(hasRtl)))
    if (!isMine) {
      run.push(block)
      continue
    }
    flush()
    out.push(drawBlock(t, block, dir, m, width))
  }
  flush()
  return (
    <Box flexDirection="column" gap="sm">
      {out}
    </Box>
  )
}

const nextMode = (m: Mode): Mode => MODES[(MODES.indexOf(m) + 1) % MODES.length] ?? 'arabic'

async function choose($: EngineInterface, chosen: Mode) {
  await update($, mode, () => chosen)
  await $.store.set('mode', chosen)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rtl',
      description: 'How Arabic blocks choose their direction: /rtl arabic | all | auto (no argument: the next one)',
    })
    const saved = await $.store.get('mode')
    if (typeof saved === 'string' && (MODES as readonly string[]).includes(saved)) await update($, mode, () => saved as Mode)
    return next(e)
  })

  // Redraws every row that read the mode; kept across sessions in the store.
  on('command.run', { command: 'rtl' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()
    const current = await read($, mode)
    if (asked !== '' && !(MODES as readonly string[]).includes(asked)) {
      return { text: `Unknown mode "${asked}". Use one of: ${MODES.join(', ')}. Now: ${MODE_NAMES[current]}` }
    }
    const chosen = asked === '' ? nextMode(current) : (asked as Mode)
    await choose($, chosen)
    return { text: `RTL mode: ${MODE_NAMES[chosen]}` }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || !hasRtl(e.props.text)) return next(e)
    return drawReply($.ui.resolve(e), e.props.text, await read($, mode), e.viewport?.columns)
  })

  // The person's own prompt: the engine keeps drawing its row (its bubble and
  // style); only the text changes, each Arabic line wrapped in an RTL isolate.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.task || e.props.from || !hasRtl(e.props.text)) return next(e)
    const m = await read($, mode)
    const text = e.props.text
      .split('\n')
      .map(p => (textDir(p, m) === 'rtl' ? RLI + p + PDI : p))
      .join('\n')
    return next({ ...e, props: { ...e.props, text } })
  })
}
