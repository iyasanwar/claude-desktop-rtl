# rtl-fix

A Claude Code mod that makes Arabic read right to left in the Claude Desktop app's Code tab.

- A paragraph, heading, list item, quote or table cell where Arabic is a real share of the letters (about 30% or more) reads right to left and sits on the right. The letter it starts with doesn't matter.
- Long Arabic paragraphs are cut into lines by the mod, so every line, the last one included, stays on the right.
- English words and inline code inside an Arabic line keep their own left-to-right order, on a shaded background.
- Code blocks and English paragraphs are left to the app, unchanged.
- Your own messages keep the app's style. Their Arabic lines read right to left.
- It only acts on the Desktop surface. The terminal, VS Code and mobile are untouched.

## Install

At the prompt of a terminal session:

```
/plugin install rtl-fix --marketplace iyasanwar/claude-desktop-rtl
```

Answer `y` to add the marketplace, then pick a scope. The user scope makes it load in every session.

From a shell:

```
claude plugin install rtl-fix --marketplace iyasanwar/claude-desktop-rtl
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `iyasanwar/claude-desktop-rtl`, then Add plugin.

Needs Claude Code 2.1.287 or newer (mods). If it doesn't load, set `"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"` under `env` in `~/.claude/settings.json`.

## Modes

`/rtl arabic | all | auto` chooses the rule. `/rtl` on its own steps to the next mode. The Desktop slash menu may not list it.

- `arabic` (default): the share rule above.
- `all`: every block of a reply that holds any Arabic reads right to left.
- `auto`: each block by its first strong letter, like HTML `dir="auto"`.

## Limits

- The mods API has no `dir` or CSS for the page. Direction comes from Unicode marks (RLM, RLI/PDI), and alignment from the mod's own line breaking.
- Line length is estimated from the chat width Desktop reports, so a line can end a little short of the edge.
- Arabic blocks drawn by the mod use plain text elements, so their styling is close to the app's Markdown but not identical.
- The font can't be changed.
