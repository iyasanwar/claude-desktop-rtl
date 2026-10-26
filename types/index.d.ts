export type Mode = 'arabic' | 'all' | 'auto'

declare module 'claude-code' {
  interface PluginState {
    'rtl-fix': { mode: Mode }
  }
}
