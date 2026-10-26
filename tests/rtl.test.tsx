import { expect, test } from 'claude-code/testing'

import { blockDir, splitBlocks } from '../hooks/blocks'

const REPLY = [
  'هذه فقرة عربية فيها `code` وكلمة English.',
  '',
  'This is an English paragraph.',
  '',
  '- البند الأول',
  '- البند الثاني',
  '',
  '| الاسم | Value |',
  '|---|---|',
  '| أحمد | 10 |',
  '',
  '```python',
  'print("مرحبا")',
  '```',
].join('\n')

const message = (text: string) => ({
  plugin: 'rtl-fix',
  component: 'AssistantMessage',
  requestId: 'm1',
  props: { text, isFirstOfReply: true },
}) as const

test('blocks read by their first strong letter; code stays LTR', () => {
  const dirs = splitBlocks(REPLY.split('\n')).map(b => `${b.kind}:${blockDir(b, 'auto')}`)
  expect(dirs).toEqual(['para:rtl', 'para:ltr', 'item:rtl', 'item:rtl', 'table:rtl', 'code:ltr'])
})

test('arabic mode: an Arabic line opening with an English word reads RTL', () => {
  const [b] = splitBlocks(['Claude Code يعرض النص العربي من اليمين الآن'])
  expect(b && blockDir(b, 'arabic')).toBe('rtl')
  expect(b && blockDir(b, 'auto')).toBe('ltr')
  const [en] = splitBlocks(['This English sentence has one word مرحبا in it'])
  expect(en && blockDir(en, 'arabic')).toBe('ltr')
  expect(en && blockDir(en, 'all', true)).toBe('rtl')
})

test('desktop draws Arabic blocks rtl and leaves English to Markdown', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...message(REPLY), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /فقرة عربية/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /English paragraph/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /print/ })).toBeDefined()
  await ui.unmount()

  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const other = await $.ui.mount({ ...message(REPLY), surface })
    expect((await other.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    await other.unmount()
  }
})

test('the prompt row stays the engine\'s, its Arabic line isolated', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`engine:${(e.props as { text: string }).text}`}</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'rtl-fix',
    component: 'UserMessage',
    requestId: 'u1',
    props: { text: 'Claude Code صار يعرض كلامي من اليمين', origin: { kind: 'prompt' }, isExpanded: true },
    surface: 'desktop',
  } as never)
  const row = await ui.find({ type: 'Text', text: /engine:/ })
  expect(row?.text).toBe('engine:\u2067Claude Code صار يعرض كلامي من اليمين\u2069')
  await ui.unmount()
})

test('an Arabic reply line opens with a strong RTL mark and colors its English', async $ => {
  const ui = await $.ui.mount({ ...message('Claude Code يعرض النص العربي من اليمين'), surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /يعرض/ })
  expect(row?.text).toBe('\u200F\u2067\u2066Claude Code\u2069 يعرض النص العربي من اليمين\u2069')
  await ui.unmount()
})

test('a long Arabic paragraph is cut into lines that each start RTL', async $ => {
  const words = Array.from({ length: 30 }, (_, i) => (i % 5 === 4 ? 'React' : 'كلمة')).join(' ')
  const ui = await $.ui.mount({ ...message(words), surface: 'desktop', viewport: { columns: 30, rows: 40 } } as never)
  const lines = await ui.findAll({ type: 'Text', text: /^\u200F\u2067/ })
  expect(lines.length).toBeGreaterThan(2)
  await ui.unmount()
})

test('English cut out of the punctuation that clings to it is shaded whole', async $ => {
  const ui = await $.ui.mount({ ...message('افتح موقع example.com، ثم شغّل (React) وملف config.py.'), surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /افتح/ })
  expect(row?.text).toBe('\u200F\u2067افتح موقع \u2066example.com\u2069، ثم شغّل (\u2066React\u2069) وملف \u2066config.py\u2069.\u2069')
  await ui.unmount()
})
