// TEMPORARY, and not for merging: a local panel for trying colours and borders on
// the real pages, in both themes. It is kept on its own branch while the colour
// review is paused. Delete this file once the values are chosen. It does nothing
// outside `next dev`, and nothing it changes leaves this browser.

type Theme = 'light' | 'dark'
type Border = 'none' | 'thin' | 'thick'
type ThemeState = {
  tokens: Record<string, string>
  border: Border
  borderColor: string
  shadow: boolean
  outline: boolean
  cardRadius: number | null
  controlRadius: number | null
}
type Preset = [id: string, label: string, preset: Partial<ThemeState>, from?: 'refero']
type State = {
  light: ThemeState
  dark: ThemeState
  open: boolean
  pos: { x: number; y: number } | null
}

const KEY = 'hn-tweaker'
const OLD_KEY = 'hn-preview-version'
const THEME_KEY = 'hn-theme'
const THEMES = ['light', 'dark'] as const

const GROUPS: [title: string, open: boolean, tokens: [id: string, label: string][]][] = [
  ['Backgrounds', true, [['bg', 'Page background'], ['surface', 'Card'], ['panel', 'Box inside a card, inputs'], ['accent-soft', 'Green tint']]],
  ['Lines', true, [['line', 'Lines and card borders'], ['line-strong', 'Stronger lines, input borders']]],
  ['Text', false, [['ink', 'Main text'], ['muted', 'Quiet text'], ['faint', 'Faintest text, icons']]],
  ['Brand green', false, [['accent', 'Buttons'], ['accent-strong', 'Links, highlights'], ['accent-ink', 'Text on a green button'], ['brand-deep', 'Headings on green tint']]],
  ['Other colours', false, [['danger', 'Warnings'], ['danger-soft', 'Warning tint'], ['warm', 'Orange'], ['selection', 'Selected text']]],
]

// Today's values, used only if they cannot be read from the page's stylesheet.
const FALLBACK: Record<Theme, Record<string, string>> = {
  light: { bg: '#f1f4f2', surface: '#ffffff', panel: '#f3f6f4', 'accent-soft': '#eaf4ee', line: '#e3e9e5', 'line-strong': '#d3dcd7', ink: '#10212b', muted: '#5c6b76', faint: '#8a96a0', accent: '#258153', 'accent-strong': '#176541', 'accent-ink': '#ffffff', 'brand-deep': '#123b30', danger: '#b3261e', 'danger-soft': '#fbedec', warm: '#e8590c', selection: '#cfe8da' },
  dark: { bg: '#0b1210', surface: '#111a17', panel: '#18231f', 'accent-soft': '#15281f', line: '#212d28', 'line-strong': '#2f4038', ink: '#e6efe9', muted: '#9dafa5', faint: '#6c7f75', accent: '#3fae79', 'accent-strong': '#7dd9aa', 'accent-ink': '#06150d', 'brand-deep': '#d6ecdf', danger: '#ff8f85', 'danger-soft': '#3a1c1a', warm: '#ff9b5c', selection: '#1f4d38' },
}

const BLACK = { surface: '#1e1e1e', panel: '#272727', line: '#303030', 'line-strong': '#424242', 'accent-soft': '#1c2f25' }

// A hex colour part of the way from one to another.
const mix = (from: string, to: string, amount: number) =>
  '#' +
  [1, 3, 5]
    .map((i) => Math.round(parseInt(from.slice(i, i + 2), 16) * (1 - amount) + parseInt(to.slice(i, i + 2), 16) * amount))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')

// Another product's dark style (read from styles.refero.design), as its ground,
// card, inset, lines and text. The brand greens, orange and warning red are left
// alone; the green tint is today's brand green laid thinly over that style's card.
const style = (
  [bg, surface, panel]: [string, string, string],
  [line, lineStrong]: [string, string],
  [ink, muted, faint]: [string, string, string],
  rest: Partial<ThemeState> = {},
): Partial<ThemeState> => ({
  tokens: { bg, surface, panel, 'accent-soft': mix(surface, '#3fae79', 0.12), line, 'line-strong': lineStrong, ink, muted, faint },
  ...rest,
})

const PRESETS: Record<Theme, Preset[]> = {
  light: [['now', 'Today', {}]],
  dark: [
    ['now', 'Today', {}],
    ['c', 'C: borders only', { tokens: { surface: '#0b1210', panel: '#0b1210', line: '#2a3832', 'line-strong': '#3a4c43', 'accent-soft': '#0b1210' }, outline: true }],
    ['k', 'Black cards', { tokens: BLACK, border: 'none' }],
    ['k2', 'Black + black ground', { tokens: { bg: '#101010', ...BLACK }, border: 'none' }],
    // Card is the ground and is drawn by its border; insets are one grey up.
    ['supabase', 'Supabase', style(['#121212', '#121212', '#242424'], ['#2e2e2e', '#393939'], ['#fafafa', '#b4b4b4', '#898989'], { cardRadius: 16 }), 'refero'],
    // Black ground, filled cards, no borders.
    ['spotify', 'Spotify', style(['#000000', '#121212', '#1f1f1f'], ['#333333', '#333333'], ['#ffffff', '#b3b3b3', '#767676'], { border: 'none', cardRadius: 8 }), 'refero'],
    // Cool blue-black, outlined cards.
    ['github', 'GitHub', style(['#0d1117', '#151a22', '#21262d'], ['#21262d', '#484f58'], ['#ffffff', '#a4aea6', '#7c8980'], { cardRadius: 24 }), 'refero'],
    // Near-black with hairlines.
    ['linear', 'Linear', style(['#08090a', '#0f1011', '#161718'], ['#23252a', '#383b3f'], ['#ffffff', '#8a8f98', '#62666d']), 'refero'],
    // Soft greys; its card edge is a 5% white glow, written here as a line colour.
    ['obsidian', 'Obsidian', style(['#171717', '#1e1e1e', '#171717'], ['#292929', '#3f3f3f'], ['#eeeeee', '#bcbcbc', '#a3a3a3']), 'refero'],
    // Purple-tinted dark with outlined cards and darker wells.
    ['railway', 'Railway', style(['#13111c', '#1a191f', '#0d0c14'], ['#33323e', '#33323e'], ['#f7f7f8', '#a1a0ab', '#868593']), 'refero'],
    // Warm charcoal: the ground is lighter than the cards, and the lines are darker than both.
    ['herding', 'Herding', style(['#2e2e2b', '#232320', '#35352f'], ['#161615', '#45453e'], ['#fffffe', '#a3a29c', '#7f7e77'], { cardRadius: 16 }), 'refero'],
  ],
}

const CARDS =
  '.square-card, .rail-section, .post-card, .page-header, .governance-section, .governance-summary, .ownership-card, .membership-status, .story-start, .story-fold > a, .notification-row, .content-panel, .community-card, .progress-priorities a, .idea-row, .policy-contents, .policy-section'

// What a fill alone marks, drawn with a line instead: for when a card or an inset
// is given the same colour as what it sits on.
const OUTLINE = String.raw`
@S@ :where(.notice:not(.notice-danger), .bg-panel, .governance-empty, .governance-callout, .gov-flow-node, .participation-card, .milestone-number, .verification-glance > div, .idea-similar, .about-intro, .media-held, .install-steps-key, .gist-badge, .progress-status, .status-chip.idea-kind) { box-shadow: inset 0 0 0 1px var(--line); }
@S@ :is(.chip, .status-chip.is-in-progress, .status-chip.is-completed, .status-chip.idea-status:is(.is-planned, .is-in-progress, .is-shipped), .progress-status.is-implemented, .gist-badge-role, .gov-flow-node.is-root, .idea-vote[aria-pressed="true"], .board-choice:has(input:checked), .board-filter[aria-current="page"], .thread-order a[aria-current="true"]),
@S@ .proposal-steps li::before,
@S@ .install-steps > li::before { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent); }
@S@ .notification-row.is-unread { border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); }
@S@ .poll-result-bar { background: color-mix(in srgb, var(--accent) 28%, transparent); opacity: 1; }
@S@ .community-mark { border-color: var(--line-strong); }
@S@ .treasury-symbol { box-shadow: inset 0 0 0 1px var(--line-strong); }
@S@ .community-rules { margin-top: 18px; border-top: 1px solid var(--line); border-radius: 0; box-shadow: none; padding: 14px 0 0; }
@S@ :is(.menu-item:hover:not(:disabled), .btn-ghost:hover:not(:disabled), .icon-btn:hover:not(:disabled), .sidebar-nav-item:hover, .mention-option[aria-selected="true"], a.notification-row:hover, .gist-live-item:hover, .hover\:bg-panel:hover) { background: color-mix(in srgb, var(--ink) 7%, transparent); }
`

const UI = `
:host { all: initial; }
* { box-sizing: border-box; }
.pill, .panel { position: fixed; z-index: 2147483647; font: 500 12.5px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; color: #16181d; }
button, input, summary, output { font: inherit; color: inherit; }
button, summary, input[type="color"], input[type="range"], input[type="checkbox"] { cursor: pointer; }
.pill { right: 14px; border: 0; border-radius: 999px; background: #fff; padding: 10px 15px; font-weight: 650; box-shadow: 0 8px 28px rgb(0 0 0 / 40%), 0 0 0 1px rgb(0 0 0 / 10%); }
.panel { display: flex; flex-direction: column; width: 296px; max-height: calc(100vh - 24px); overflow: hidden; border-radius: 12px; background: #fff; box-shadow: 0 16px 48px rgb(0 0 0 / 45%), 0 0 0 1px rgb(0 0 0 / 12%); }
header { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #e6e8eb; padding: 9px 8px 9px 14px; font-size: 13px; font-weight: 700; cursor: grab; user-select: none; touch-action: none; }
header span { flex: 1; }
header button { width: 28px; height: 28px; border: 0; border-radius: 7px; background: transparent; font-size: 16px; line-height: 1; color: #555b64; }
header button:hover, .undo:hover { background: #eef0f2; color: #16181d; }
.body { overflow-y: auto; overscroll-behavior: contain; padding: 12px 14px 6px; }
footer { display: flex; align-items: center; gap: 8px; border-top: 1px solid #e6e8eb; padding: 10px 14px; }
footer .note { flex: 1; color: #1a7f4b; font-weight: 600; text-align: right; }
.seg { display: flex; gap: 2px; border-radius: 8px; background: #eef0f2; padding: 2px; }
.seg button { flex: 1; border: 0; border-radius: 6px; background: transparent; padding: 6px 8px; font-weight: 600; color: #555b64; white-space: nowrap; }
.seg button[aria-pressed="true"] { background: #fff; color: #16181d; box-shadow: 0 1px 2px rgb(0 0 0 / 18%); }
.label { margin: 12px 0 6px; color: #5d636d; font-size: 11.5px; font-weight: 650; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips button, .btn { border: 1px solid #d5d9de; border-radius: 999px; background: #fff; padding: 5px 11px; font-weight: 600; }
.chips button:hover, .btn:hover { background: #f3f4f6; }
.chips button[aria-pressed="true"] { border-color: #16181d; background: #16181d; color: #fff; }
details { margin-top: 12px; border-top: 1px solid #e6e8eb; padding-bottom: 2px; }
summary { padding: 9px 0 6px; font-weight: 700; }
.row { display: grid; grid-template-columns: minmax(0, 1fr) 30px 72px 22px; align-items: center; gap: 6px; padding: 3px 0; }
.row > span, .field > span, .check, .range > span { color: #33373e; }
input[type="color"] { width: 30px; height: 24px; border: 1px solid #c3c8cf; border-radius: 6px; background: none; padding: 0; }
input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
input[type="color"]::-webkit-color-swatch { border: 0; border-radius: 5px; }
input[type="text"] { width: 72px; height: 24px; border: 1px solid #d5d9de; border-radius: 6px; background: #fff; padding: 0 6px; font: 500 11.5px ui-monospace, Menlo, monospace; }
.undo { width: 22px; height: 22px; border: 0; border-radius: 6px; background: transparent; padding: 0; font-size: 14px; line-height: 1; color: #6a707a; }
.field { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; }
.field .seg { flex: 0 1 190px; }
.field .right { display: flex; align-items: center; gap: 6px; }
.check { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; }
.check input { margin: 1px 0 0; }
.range { display: grid; grid-template-columns: minmax(0, 1fr) 104px 34px; align-items: center; gap: 8px; padding: 4px 0; }
.range input { width: 100%; }
.range output { color: #5d636d; text-align: right; font-variant-numeric: tabular-nums; }
:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
`

const blank = (): ThemeState => ({ tokens: {}, border: 'thin', borderColor: '', shadow: false, outline: false, cardRadius: null, controlRadius: null })
const fromPreset = (preset: Partial<ThemeState>): ThemeState => ({ ...blank(), ...preset, tokens: { ...preset.tokens } })

function load(): State {
  const state: State = { light: blank(), dark: blank(), open: true, pos: null }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<State> | null
    if (saved) {
      state.open = saved.open !== false
      state.pos = saved.pos ?? null
      state.light = { ...blank(), ...saved.light }
      state.dark = { ...blank(), ...saved.dark }
    } else {
      // Carry over the version last picked in the switcher this panel replaces.
      const old = PRESETS.dark.find(([id]) => id === localStorage.getItem(OLD_KEY))
      if (old) state.dark = fromPreset(old[2])
    }
    localStorage.removeItem(OLD_KEY)
  } catch {}
  return state
}

// Today's value of every colour in both themes, read from the app's own stylesheet.
function readDefaults(skip: Node): Record<Theme, Record<string, string>> {
  const found: Record<Theme, Record<string, string>> = { light: {}, dark: {} }
  const ids = GROUPS.flatMap(([, , tokens]) => tokens.map(([id]) => id))
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        const theme = rule.selectorText === ':root' ? 'light' : rule.selectorText === ':root[data-theme="dark"]' ? 'dark' : null
        if (!theme) continue
        for (const id of ids) {
          const value = rule.style.getPropertyValue('--' + id).trim().toLowerCase()
          if (/^#[0-9a-f]{6}$/.test(value)) found[theme][id] = value
        }
      } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of document.styleSheets) {
    if (sheet.ownerNode === skip) continue
    try {
      visit(sheet.cssRules)
    } catch {}
  }
  return { light: { ...FALLBACK.light, ...found.light }, dark: { ...FALLBACK.dark, ...found.light, ...FALLBACK.dark, ...found.dark } }
}

function themeCss(theme: Theme, s: ThemeState): string {
  // The tokens outrank `:root[data-theme="dark"]`; the rules keep the weight they
  // would have in globals.css.
  const root = theme === 'dark' ? 'html:root[data-theme="dark"]' : 'html:root:not([data-theme="dark"])'
  const scope = theme === 'dark' ? ':where(html)[data-theme="dark"]' : ':where(html):not([data-theme="dark"])'
  const set = Object.entries(s.tokens).map(([id, value]) => `--${id}:${value};`)
  if (s.tokens.bg) set.push(`--topbar:color-mix(in srgb, ${s.tokens.bg} 90%, transparent);`)
  const ring = theme === 'dark' ? s.tokens['accent-strong'] : s.tokens.accent
  if (ring) set.push(`--field-ring:color-mix(in srgb, ${ring} ${theme === 'dark' ? 20 : 16}%, transparent);`)
  if (s.cardRadius !== null) set.push(`--r-panel:${s.cardRadius}px;--r-frame:${s.cardRadius + 2}px;`)
  if (s.controlRadius !== null) set.push(`--r-control:${s.controlRadius}px;--r-chip:${Math.max(s.controlRadius - 2, 0)}px;`)
  if (s.shadow) {
    set.push(
      theme === 'dark'
        ? '--shadow-card:0 1px 2px rgb(0 0 0 / 35%), 0 8px 20px rgb(0 0 0 / 28%);'
        : '--shadow-card:0 1px 2px rgb(16 33 43 / 6%), 0 8px 20px rgb(16 33 43 / 7%);',
    )
  }
  let css = set.length ? `${root}{${set.join('')}}\n` : ''
  if (s.border === 'none') css += `${scope} :is(${CARDS}){border-color:transparent}\n`
  if (s.border === 'thick') css += `${scope} :is(${CARDS}){border-width:2px}\n`
  if (s.border !== 'none' && s.borderColor) css += `${scope} :is(${CARDS}){border-color:${s.borderColor}}\n`
  if (s.outline) css += OUTLINE.replaceAll('@S@', scope)
  return css
}

function start() {
  const root = document.documentElement
  const style = document.createElement('style')
  style.id = 'hn-tweaker-css'
  const defaults = readDefaults(style)
  const state = load()
  const openGroups = new Set(['Cards', ...GROUPS.filter(([, open]) => open).map(([title]) => title)])
  const theme = (): Theme => (root.dataset.theme === 'dark' ? 'dark' : 'light')

  const apply = () => {
    style.textContent = themeCss('light', state.light) + themeCss('dark', state.dark)
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {}
  }

  const host = document.createElement('div')
  host.id = 'hn-tweaker'
  const ui = host.attachShadow({ mode: 'open' })
  ui.innerHTML = `<style>${UI}</style>
    <button class="pill" type="button">Colours and borders</button>
    <section class="panel" aria-label="Colours and borders (local preview)">
      <header><span>Colours and borders</span><button type="button" data-min aria-label="Minimise" title="Minimise">&minus;</button></header>
      <div class="body"></div>
      <footer><button type="button" class="btn" data-copy>Copy my values</button><button type="button" class="btn" data-clear></button><span class="note" role="status"></span></footer>
    </section>`
  const pill = ui.querySelector<HTMLElement>('.pill')!
  const panel = ui.querySelector<HTMLElement>('.panel')!
  const body = ui.querySelector<HTMLElement>('.body')!
  const note = ui.querySelector<HTMLElement>('.note')!
  // Typing a hex value must not reach the app's keyboard shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (event) => event.stopPropagation())

  const place = () => {
    pill.style.bottom = (window.innerWidth < 768 ? 76 : 14) + 'px'
    pill.hidden = state.open
    panel.hidden = !state.open
    panel.style.display = state.open ? '' : 'none'
    const x = state.pos ? Math.min(Math.max(state.pos.x, 4), Math.max(window.innerWidth - 300, 4)) : Math.max(window.innerWidth - 308, 4)
    const y = state.pos ? Math.min(Math.max(state.pos.y, 4), Math.max(window.innerHeight - 60, 4)) : 12
    panel.style.left = x + 'px'
    panel.style.top = y + 'px'
    panel.style.maxHeight = `calc(100vh - ${y + 12}px)`
  }

  const render = () => {
    const t = theme()
    const s = state[t]
    const same = (preset: Partial<ThemeState>) => JSON.stringify(fromPreset(preset)) === JSON.stringify({ ...blank(), ...s })
    const row = ([id, label]: [string, string]) => {
      const value = s.tokens[id] ?? defaults[t][id]
      return `<div class="row"><span>${label}</span>
        <input type="color" value="${value}" data-token="${id}" aria-label="${label}">
        <input type="text" value="${value}" data-hex="${id}" spellcheck="false" aria-label="${label}, hex value">
        <button type="button" class="undo" data-undo="${id}" aria-label="Put ${label} back" title="Back to today's value" style="visibility:${id in s.tokens ? 'visible' : 'hidden'}">&#8634;</button></div>`
    }
    const seg = (name: string, current: string, options: [string, string][]) =>
      `<div class="seg" role="group">${options.map(([value, label]) => `<button type="button" data-${name}="${value}" aria-pressed="${value === current}">${label}</button>`).join('')}</div>`
    const group = (title: string, inner: string) => `<details data-group="${title}" ${openGroups.has(title) ? 'open' : ''}><summary>${title}</summary>${inner}</details>`

    const chips = (list: Preset[]) =>
      `<div class="chips">${list.map(([id, label, preset]) => `<button type="button" data-preset="${id}" aria-pressed="${same(preset)}">${label}</button>`).join('')}</div>`
    const borrowed = PRESETS[t].filter((preset) => preset[3])

    body.innerHTML =
      seg('theme', t, [['light', 'Light theme'], ['dark', 'Dark theme']]) +
      `<p class="label">Start from</p>${chips(PRESETS[t].filter((preset) => !preset[3]))}` +
      (borrowed.length ? `<p class="label">Other products' dark styles, with your greens</p>${chips(borrowed)}` : '') +
      GROUPS.map(([title, , tokens]) => group(title, tokens.map(row).join(''))).join('') +
      group(
        'Cards',
        `<div class="field"><span>Border</span>${seg('border', s.border, [['none', 'None'], ['thin', 'Thin'], ['thick', 'Thick']])}</div>
         <div class="field"><span>Border colour</span><span class="right">
           <input type="color" value="${s.borderColor || s.tokens.line || defaults[t].line}" data-border-color aria-label="Card border colour">
           <button type="button" class="btn" data-border-auto style="visibility:${s.borderColor ? 'visible' : 'hidden'}">Same as lines</button></span></div>
         <label class="check"><input type="checkbox" data-shadow ${s.shadow ? 'checked' : ''}>Soft shadow under cards</label>
         <label class="check"><input type="checkbox" data-outline ${s.outline ? 'checked' : ''}>Outline boxes and tags that have no fill of their own</label>`,
      ) +
      group(
        'Corners',
        `<label class="range"><span>Cards</span><input type="range" min="0" max="28" value="${s.cardRadius ?? 12}" data-radius="cardRadius"><output>${s.cardRadius ?? 12}px</output></label>
         <label class="range"><span>Buttons, inputs</span><input type="range" min="0" max="22" value="${s.controlRadius ?? 8}" data-radius="controlRadius"><output>${s.controlRadius ?? 8}px</output></label>
         <div class="field"><span></span><button type="button" class="btn" data-corners>Back to today's corners</button></div>`,
      )
    ui.querySelector<HTMLElement>('[data-clear]')!.textContent = `Reset ${t}`
  }

  const summary = () => {
    const lines = ['HeyNaija colours and borders (local preview)']
    for (const t of THEMES) {
      const s = state[t]
      const out = Object.entries(s.tokens).map(([id, value]) => `  --${id}: ${value}  (today ${defaults[t][id]})`)
      if (s.border !== 'thin') out.push(`  Card border: ${s.border}`)
      if (s.border !== 'none' && s.borderColor) out.push(`  Card border colour: ${s.borderColor}`)
      if (s.shadow) out.push('  Card shadow: soft')
      if (s.outline) out.push('  Boxes and tags with no fill: outlined')
      if (s.cardRadius !== null) out.push(`  Card corners: ${s.cardRadius}px  (today 12px)`)
      if (s.controlRadius !== null) out.push(`  Button and input corners: ${s.controlRadius}px  (today 8px)`)
      lines.push('', t.toUpperCase(), ...(out.length ? out : ['  no changes']))
    }
    return lines.join('\n')
  }

  const say = (text: string) => {
    note.textContent = text
    window.setTimeout(() => {
      if (note.textContent === text) note.textContent = ''
    }, 2500)
  }

  const setToken = (id: string, value: string | null) => {
    const t = theme()
    if (value === null || value === defaults[t][id]) delete state[t].tokens[id]
    else state[t].tokens[id] = value
    apply()
  }

  ui.addEventListener('input', (event) => {
    const el = event.target as HTMLInputElement
    const s = state[theme()]
    if (el.dataset.token) {
      setToken(el.dataset.token, el.value.toLowerCase())
      const rowEl = el.closest('.row')!
      rowEl.querySelector<HTMLInputElement>('[data-hex]')!.value = el.value.toLowerCase()
      rowEl.querySelector<HTMLElement>('.undo')!.style.visibility = el.dataset.token in s.tokens ? 'visible' : 'hidden'
    } else if (el.dataset.borderColor !== undefined) {
      s.borderColor = el.value.toLowerCase()
      ui.querySelector<HTMLElement>('[data-border-auto]')!.style.visibility = 'visible'
      apply()
    } else if (el.dataset.radius) {
      s[el.dataset.radius as 'cardRadius' | 'controlRadius'] = Number(el.value)
      el.nextElementSibling!.textContent = el.value + 'px'
      apply()
    }
  })

  ui.addEventListener('change', (event) => {
    const el = event.target as HTMLInputElement
    const s = state[theme()]
    if (el.dataset.hex) {
      const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(el.value.trim())
      if (match) {
        const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1]
        setToken(el.dataset.hex, '#' + hex.toLowerCase())
      }
      render()
    } else if (el.dataset.shadow !== undefined) {
      s.shadow = el.checked
      apply()
      render()
    } else if (el.dataset.outline !== undefined) {
      s.outline = el.checked
      apply()
      render()
    }
  })

  ui.addEventListener('click', (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>('button')
    if (!el) return
    const t = theme()
    const data = el.dataset
    if (el === pill || data.min !== undefined) {
      state.open = el === pill
      apply()
      place()
    } else if (data.theme) {
      try {
        localStorage.setItem(THEME_KEY, data.theme)
      } catch {}
      root.dataset.theme = data.theme
      ;(window as unknown as { __hnTheme?: () => void }).__hnTheme?.()
      window.dispatchEvent(new Event('hn-theme'))
      render()
    } else if (data.preset) {
      state[t] = fromPreset(PRESETS[t].find(([id]) => id === data.preset)![2])
    } else if (data.undo) {
      setToken(data.undo, null)
    } else if (data.border) {
      state[t].border = data.border as Border
    } else if (data.borderAuto !== undefined) {
      state[t].borderColor = ''
    } else if (data.corners !== undefined) {
      state[t].cardRadius = null
      state[t].controlRadius = null
    } else if (data.clear !== undefined) {
      state[t] = blank()
      say(`${t === 'dark' ? 'Dark' : 'Light'} theme is back to today's`)
    } else if (data.copy !== undefined) {
      const copied: Promise<void> = navigator.clipboard?.writeText(summary()) ?? Promise.reject()
      copied.then(
        () => say('Copied'),
        () => say('Could not copy'),
      )
      return
    } else return
    apply()
    render()
  })

  // <details> does not bubble its toggle, so it is caught on the way down.
  ui.addEventListener(
    'toggle',
    (event) => {
      const el = event.target as HTMLDetailsElement
      if (!el.dataset.group) return
      if (el.open) openGroups.add(el.dataset.group)
      else openGroups.delete(el.dataset.group)
    },
    true,
  )

  // The panel is moved by its title.
  const header = ui.querySelector<HTMLElement>('header')!
  header.addEventListener('pointerdown', (down) => {
    if ((down.target as HTMLElement).closest('button')) return
    const box = panel.getBoundingClientRect()
    const dx = down.clientX - box.left
    const dy = down.clientY - box.top
    header.setPointerCapture(down.pointerId)
    const move = (event: PointerEvent) => {
      state.pos = { x: event.clientX - dx, y: event.clientY - dy }
      place()
    }
    const up = () => {
      header.removeEventListener('pointermove', move)
      header.removeEventListener('pointerup', up)
      apply()
    }
    header.addEventListener('pointermove', move)
    header.addEventListener('pointerup', up)
  })

  apply()
  render()
  place()
  new MutationObserver(render).observe(root, { attributes: true, attributeFilter: ['data-theme'] })

  // The colours apply before the page is interactive; the panel waits for the page.
  const mount = () => {
    if (document.head && document.head.lastElementChild !== style) document.head.appendChild(style)
    if (document.body && !host.isConnected) document.body.appendChild(host)
  }
  if (document.head) document.head.appendChild(style)
  window.addEventListener('load', () => window.setTimeout(mount, 200))
  window.addEventListener('resize', place)
  window.setInterval(mount, 1500)
}

if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  try {
    start()
  } catch (error) {
    console.warn('Colour panel did not start', error)
  }
}
