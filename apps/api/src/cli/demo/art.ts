// Pictures for the demo seed, drawn as SVG so the repository ships no stock
// photos and every run produces the same images. Each one is simple, but they
// differ in shape (wide, square, tall) so post galleries show every layout.

export type Art = { svg: string; width: number; height: number }

/** A small deterministic generator (mulberry32), so a seed always draws the same picture. */
function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const between = (r: () => number, min: number, max: number) => min + r() * (max - min)
const pick = <T>(r: () => number, items: readonly T[]) => items[Math.floor(r() * items.length)]!
const svg = (width: number, height: number, body: string): Art => ({
  width,
  height,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
})
const gradient = (id: string, stops: string[], vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops
    .map((c, i) => `<stop offset="${(i / (stops.length - 1)).toFixed(2)}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`

type Horizon = 'city' | 'trees' | 'bridge'

/** A sky over a horizon of buildings, trees or a long bridge, usually above water. */
export function skyline(seed: number, o: { sky: string[]; sun: string; land: string; water?: string; horizon?: Horizon; width?: number; height?: number }): Art {
  const r = random(seed)
  const W = o.width ?? 1600
  const H = o.height ?? 1000
  const line = Math.round(H * (o.water ? 0.62 : 0.78))
  const sunX = between(r, W * 0.25, W * 0.75)
  const sunY = line - between(r, H * 0.08, H * 0.22)
  const parts = [
    `<defs>${gradient('sky', o.sky)}<radialGradient id="glow"><stop offset="0" stop-color="${o.sun}" stop-opacity="0.55"/><stop offset="1" stop-color="${o.sun}" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>`,
    `<circle cx="${sunX}" cy="${sunY}" r="${H * 0.32}" fill="url(#glow)"/>`,
    `<circle cx="${sunX}" cy="${sunY}" r="${H * 0.06}" fill="${o.sun}"/>`,
  ]
  const horizon = o.horizon ?? 'city'
  if (horizon === 'city') {
    for (let x = -20; x < W; ) {
      const w = between(r, 40, 130)
      const h = between(r, 60, H * 0.36)
      parts.push(`<rect x="${x.toFixed(1)}" y="${(line - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${o.land}"/>`)
      // A few lit windows.
      for (let wy = line - h + 14; wy < line - 16; wy += 22) {
        for (let wx = x + 8; wx < x + w - 12; wx += 18) {
          if (r() < 0.18) parts.push(`<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="7" height="10" fill="${o.sun}" opacity="0.7"/>`)
        }
      }
      x += w + between(r, 0, 12)
    }
  } else if (horizon === 'trees') {
    for (let x = -40; x < W + 40; x += between(r, 30, 70)) {
      const radius = between(r, 30, 80)
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${(line - radius * 0.55).toFixed(1)}" r="${radius.toFixed(1)}" fill="${o.land}"/>`)
    }
    parts.push(`<rect x="0" y="${line - 12}" width="${W}" height="14" fill="${o.land}"/>`)
  } else {
    const deck = line - H * 0.05
    parts.push(`<rect x="0" y="${deck}" width="${W}" height="${H * 0.025}" fill="${o.land}"/>`)
    for (let x = 40; x < W; x += 150) parts.push(`<rect x="${x}" y="${deck}" width="18" height="${line - deck + 4}" fill="${o.land}"/>`)
    for (let x = 20; x < W; x += 60) parts.push(`<circle cx="${x}" cy="${deck - 10}" r="3" fill="${o.sun}" opacity="0.8"/>`)
    // Distant skyline behind the bridge.
    for (let x = W * 0.55; x < W; ) {
      const w = between(r, 26, 70)
      const h = between(r, 30, H * 0.16)
      parts.push(`<rect x="${x.toFixed(1)}" y="${(deck - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${o.land}" opacity="0.55"/>`)
      x += w + between(r, 4, 20)
    }
  }
  if (o.water) {
    parts.push(`<rect x="0" y="${line}" width="${W}" height="${H - line}" fill="${o.water}"/>`)
    // The sun's reflection, as broken strokes that widen towards the viewer.
    for (let y = line + 10; y < H; y += between(r, 10, 22)) {
      const spread = ((y - line) / (H - line)) * W * 0.18 + 30
      const w = between(r, spread * 0.4, spread)
      parts.push(`<rect x="${(sunX - w / 2 + between(r, -20, 20)).toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="4" rx="2" fill="${o.sun}" opacity="${between(r, 0.25, 0.6).toFixed(2)}"/>`)
    }
    // A fishing canoe or two.
    for (let i = 0; i < 2; i++) {
      const bx = between(r, W * 0.1, W * 0.85)
      const by = between(r, line + 40, H - 60)
      parts.push(`<path d="M${bx} ${by} q60 18 120 0 l-14 14 h-92 z" fill="${o.land}"/>`)
    }
  } else {
    parts.push(`<rect x="0" y="${line}" width="${W}" height="${H - line}" fill="${o.land}"/>`)
  }
  return svg(W, H, parts.join(''))
}

const MOTIFS = ['circles', 'diamonds', 'leaves', 'waves'] as const

/** A wax-print style repeat: tiles of bold shapes in a five-colour palette. */
export function ankara(seed: number, palette: [string, string, string, string, string], motif: (typeof MOTIFS)[number]): Art {
  const r = random(seed)
  const W = 1200
  const H = 1200
  const T = 150
  const [ground, a, b, c, d] = palette
  const parts = [`<rect width="${W}" height="${H}" fill="${ground}"/>`]
  for (let row = 0; row < H / T; row++) {
    for (let col = 0; col < W / T; col++) {
      const x = col * T
      const y = row * T
      const cx = x + T / 2
      const cy = y + T / 2
      const alt = (row + col) % 2 === 0
      if (motif === 'circles') {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="66" fill="${alt ? a : b}"/>`)
        parts.push(`<circle cx="${cx}" cy="${cy}" r="44" fill="${c}"/>`)
        parts.push(`<circle cx="${cx}" cy="${cy}" r="20" fill="${alt ? d : a}"/>`)
        parts.push(`<circle cx="${x}" cy="${y}" r="12" fill="${d}"/>`)
      } else if (motif === 'diamonds') {
        parts.push(`<path d="M${cx} ${y + 6} L${x + T - 6} ${cy} L${cx} ${y + T - 6} L${x + 6} ${cy} Z" fill="${alt ? a : c}"/>`)
        parts.push(`<path d="M${cx} ${y + 36} L${x + T - 36} ${cy} L${cx} ${y + T - 36} L${x + 36} ${cy} Z" fill="${b}"/>`)
        parts.push(`<circle cx="${cx}" cy="${cy}" r="12" fill="${d}"/>`)
      } else if (motif === 'leaves') {
        const turn = alt ? 45 : -45
        parts.push(`<g transform="rotate(${turn} ${cx} ${cy})"><ellipse cx="${cx}" cy="${cy}" rx="68" ry="30" fill="${alt ? a : b}"/><path d="M${cx - 60} ${cy} H${cx + 60}" stroke="${d}" stroke-width="6"/></g>`)
        if (r() < 0.5) parts.push(`<circle cx="${x + 18}" cy="${y + 18}" r="10" fill="${c}"/>`)
      } else {
        const colour = [a, b, c, d][row % 4]
        parts.push(`<path d="M${x} ${cy} q${T / 4} -46 ${T / 2} 0 t${T / 2} 0" fill="none" stroke="${colour}" stroke-width="22" stroke-linecap="round"/>`)
        if (alt) parts.push(`<circle cx="${cx}" cy="${y + 20}" r="9" fill="${d}"/>`)
      }
    }
  }
  return svg(W, H, parts.join(''))
}

type Dish = 'jollof' | 'amala' | 'poundo'

/** A plate seen from above on a wooden table. */
export function plate(seed: number, dish: Dish): Art {
  const r = random(seed)
  const W = 1400
  const H = 1050
  const cx = W / 2 + between(r, -60, 60)
  const cy = H / 2 + between(r, -30, 30)
  const R = 400
  const parts = [`<rect width="${W}" height="${H}" fill="#6b4226"/>`]
  for (let y = 0; y < H; y += between(r, 18, 40)) {
    parts.push(`<rect x="0" y="${y.toFixed(1)}" width="${W}" height="${between(r, 2, 6).toFixed(1)}" fill="#583520" opacity="0.6"/>`)
  }
  parts.push(`<circle cx="${cx + 14}" cy="${cy + 18}" r="${R}" fill="#000" opacity="0.25"/>`)
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="#f7f4ee"/>`)
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${R * 0.8}" fill="#efe9df"/>`)
  const scatter = (count: number, colours: string[], x: number, y: number, spread: number, size: [number, number]) => {
    for (let i = 0; i < count; i++) {
      const angle = r() * Math.PI * 2
      const dist = Math.sqrt(r()) * spread
      parts.push(
        `<ellipse cx="${(x + Math.cos(angle) * dist).toFixed(1)}" cy="${(y + Math.sin(angle) * dist).toFixed(1)}" rx="${between(r, size[0], size[1]).toFixed(1)}" ry="${(size[0] * 0.6).toFixed(1)}" transform="rotate(${Math.round(r() * 180)} ${(x + Math.cos(angle) * dist).toFixed(1)} ${(y + Math.sin(angle) * dist).toFixed(1)})" fill="${pick(r, colours)}"/>`,
      )
    }
  }
  if (dish === 'jollof') {
    scatter(520, ['#d9531e', '#e8692c', '#c8461a', '#f07a35'], cx - 70, cy, R * 0.5, [7, 11])
    for (let i = 0; i < 7; i++) {
      const x = cx + 150 + between(r, -40, 60)
      const y = cy - 160 + i * 52
      parts.push(`<ellipse cx="${x}" cy="${y}" rx="44" ry="26" fill="#e9a23b"/><ellipse cx="${x}" cy="${y}" rx="30" ry="16" fill="#f4c35d"/>`)
    }
    parts.push(`<path d="M${cx - 40} ${cy + 140} q90 -80 170 10 q-20 90 -110 80 q-70 -10 -60 -90 z" fill="#8a3b12"/>`)
    scatter(26, ['#3f8f3a', '#5aa64a'], cx - 90, cy - 40, R * 0.4, [6, 10])
  } else if (dish === 'amala') {
    parts.push(`<ellipse cx="${cx - 110}" cy="${cy}" rx="170" ry="150" fill="#4a3426"/><ellipse cx="${cx - 140}" cy="${cy - 40}" rx="70" ry="40" fill="#5d4433" opacity="0.7"/>`)
    parts.push(`<ellipse cx="${cx + 150}" cy="${cy - 40}" rx="150" ry="130" fill="#3e6b2b"/>`)
    scatter(140, ['#5f8f3c', '#2e5221', '#79a650'], cx + 150, cy - 40, 120, [4, 8])
    parts.push(`<ellipse cx="${cx + 120}" cy="${cy + 170}" rx="140" ry="70" fill="#b8361d"/>`)
    scatter(40, ['#7a2412', '#d8572f'], cx + 120, cy + 170, 90, [6, 12])
  } else {
    // A pale mound on a pale plate needs a shadow and an edge to read at all.
    parts.push(`<ellipse cx="${cx - 96}" cy="${cy + 30}" rx="178" ry="156" fill="#000" opacity="0.12"/>`)
    parts.push(`<ellipse cx="${cx - 110}" cy="${cy + 10}" rx="175" ry="155" fill="#f6eed6" stroke="#d6c7a1" stroke-width="5"/><ellipse cx="${cx - 150}" cy="${cy - 40}" rx="80" ry="40" fill="#fffbf0"/>`)
    parts.push(`<ellipse cx="${cx + 160}" cy="${cy}" rx="160" ry="210" fill="#c9a227"/>`)
    scatter(220, ['#e4c04a', '#a7841d', '#3f7d2f', '#b23a1d'], cx + 160, cy, 150, [5, 9])
  }
  return svg(W, H, parts.join(''))
}

/** A tall bookcase, mostly full. */
export function bookshelf(seed: number): Art {
  const r = random(seed)
  const W = 1200
  const H = 1500
  const spines = ['#1f4e79', '#a23b2a', '#2f6b3c', '#d9a440', '#5b3a6e', '#e3d5b8', '#14213d', '#c4572e', '#3b7c8c', '#8c6b4a']
  const parts = [`<rect width="${W}" height="${H}" fill="#e9e2d4"/>`, `<rect x="70" y="60" width="${W - 140}" height="${H - 120}" fill="#5a3b25"/>`]
  const rows = 5
  const rowH = (H - 160) / rows
  for (let i = 0; i < rows; i++) {
    const base = 80 + rowH * (i + 1) - 10
    parts.push(`<rect x="90" y="${base - rowH + 20}" width="${W - 180}" height="${rowH - 20}" fill="#3e2716"/>`)
    for (let x = 100; x < W - 110; ) {
      const w = between(r, 22, 54)
      const h = between(r, rowH * 0.6, rowH * 0.88)
      if (x + w > W - 110) break
      if (r() < 0.06) {
        x += between(r, 30, 80) // a gap where a book is out
        continue
      }
      parts.push(`<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${pick(r, spines)}"/>`)
      parts.push(`<rect x="${(x + 4).toFixed(1)}" y="${(base - h * 0.75).toFixed(1)}" width="${(w - 8).toFixed(1)}" height="5" fill="#f5efe0" opacity="0.7"/>`)
      x += w + between(r, 1, 4)
    }
    parts.push(`<rect x="80" y="${base}" width="${W - 160}" height="18" fill="#7a5233"/>`)
  }
  parts.push(`<circle cx="${W - 220}" cy="${H - 250}" r="70" fill="#2f6b3c"/><rect x="${W - 260}" y="${H - 220}" width="80" height="90" rx="10" fill="#c4572e"/>`)
  return svg(W, H, parts.join(''))
}

/** A dark home studio: a screen with a waveform above a desk of faders. */
export function studio(seed: number): Art {
  const r = random(seed)
  const W = 1600
  const H = 1000
  const parts = [
    `<defs>${gradient('wall', ['#1a1d2b', '#0e1018'])}</defs>`,
    `<rect width="${W}" height="${H}" fill="url(#wall)"/>`,
    `<rect x="320" y="120" width="960" height="460" rx="18" fill="#05060a" stroke="#2a2f45" stroke-width="10"/>`,
  ]
  let points = ''
  for (let x = 360; x <= 1240; x += 8) {
    const amp = Math.abs(Math.sin(x / 37)) * between(r, 40, 170)
    points += `${x},${350 - amp} ${x},${350 + amp} `
  }
  parts.push(`<polyline points="${points}" fill="none" stroke="#3ddc97" stroke-width="3" opacity="0.9"/>`)
  for (let i = 0; i < 6; i++) parts.push(`<rect x="${370 + i * 140}" y="520" width="110" height="30" rx="6" fill="${pick(r, ['#ff7a45', '#3ddc97', '#5b8cff', '#f2c94c'])}" opacity="0.8"/>`)
  parts.push(`<rect x="160" y="640" width="1280" height="300" rx="20" fill="#232838"/>`)
  for (let i = 0; i < 16; i++) {
    const x = 220 + i * 76
    const knob = between(r, 680, 860)
    parts.push(`<rect x="${x}" y="680" width="6" height="200" rx="3" fill="#0b0d14"/>`)
    parts.push(`<rect x="${x - 14}" y="${knob}" width="34" height="18" rx="4" fill="#cfd5e6"/>`)
    parts.push(`<circle cx="${x + 3}" cy="905" r="7" fill="${r() < 0.4 ? '#3ddc97' : '#3a4158'}"/>`)
  }
  parts.push(`<rect x="80" y="380" width="160" height="300" rx="16" fill="#151821"/><circle cx="160" cy="470" r="50" fill="#0b0d14" stroke="#2a2f45" stroke-width="8"/><circle cx="160" cy="600" r="34" fill="#0b0d14" stroke="#2a2f45" stroke-width="6"/>`)
  parts.push(`<rect x="1360" y="380" width="160" height="300" rx="16" fill="#151821"/><circle cx="1440" cy="470" r="50" fill="#0b0d14" stroke="#2a2f45" stroke-width="8"/><circle cx="1440" cy="600" r="34" fill="#0b0d14" stroke="#2a2f45" stroke-width="6"/>`)
  return svg(W, H, parts.join(''))
}

/** A football pitch from above, two teams lined up. */
export function pitch(seed: number): Art {
  const r = random(seed)
  const W = 1600
  const H = 1000
  const parts = [`<rect width="${W}" height="${H}" fill="#1f7a3a"/>`]
  for (let i = 0; i < 10; i++) if (i % 2) parts.push(`<rect x="${i * 160}" y="0" width="160" height="${H}" fill="#238a42"/>`)
  const stroke = 'fill="none" stroke="#f4f7f2" stroke-width="6"'
  parts.push(`<rect x="60" y="60" width="${W - 120}" height="${H - 120}" ${stroke}/>`)
  parts.push(`<line x1="${W / 2}" y1="60" x2="${W / 2}" y2="${H - 60}" ${stroke.replace('fill="none" ', '')}/>`)
  parts.push(`<circle cx="${W / 2}" cy="${H / 2}" r="120" ${stroke}/><circle cx="${W / 2}" cy="${H / 2}" r="8" fill="#f4f7f2"/>`)
  parts.push(`<rect x="60" y="${H / 2 - 200}" width="220" height="400" ${stroke}/><rect x="${W - 280}" y="${H / 2 - 200}" width="220" height="400" ${stroke}/>`)
  parts.push(`<rect x="60" y="${H / 2 - 90}" width="80" height="180" ${stroke}/><rect x="${W - 140}" y="${H / 2 - 90}" width="80" height="180" ${stroke}/>`)
  for (const [team, side] of [['#ffffff', 0], ['#f2c230', 1]] as const) {
    for (let i = 0; i < 11; i++) {
      const x = side ? between(r, W / 2 + 60, W - 120) : between(r, 120, W / 2 - 60)
      const y = between(r, 120, H - 120)
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="16" fill="${team}" stroke="#0c3b1c" stroke-width="4"/>`)
    }
  }
  parts.push(`<circle cx="${W / 2 + between(r, -200, 200)}" cy="${H / 2 + between(r, -150, 150)}" r="10" fill="#fff" stroke="#111" stroke-width="3"/>`)
  return svg(W, H, parts.join(''))
}

/** A code editor in a dark theme. */
export function code(seed: number): Art {
  const r = random(seed)
  const W = 1600
  const H = 1000
  const colours = ['#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#f7768e', '#c0caf5', '#7dcfff']
  const parts = [`<rect width="${W}" height="${H}" fill="#1a1b26"/>`, `<rect width="${W}" height="56" fill="#16161e"/>`]
  for (const [i, c] of ['#f7768e', '#e0af68', '#9ece6a'].entries()) parts.push(`<circle cx="${34 + i * 30}" cy="28" r="9" fill="${c}"/>`)
  parts.push(`<rect x="0" y="56" width="300" height="${H - 56}" fill="#16161e"/>`)
  for (let i = 0; i < 14; i++) parts.push(`<rect x="36" y="${96 + i * 44}" width="${between(r, 90, 200).toFixed(0)}" height="12" rx="6" fill="#565f89"/>`)
  let indent = 0
  for (let line = 0; line < 22; line++) {
    const y = 96 + line * 38
    parts.push(`<rect x="330" y="${y}" width="24" height="12" rx="4" fill="#3b4261"/>`)
    if (r() < 0.12) continue
    indent = Math.max(0, Math.min(4, indent + pick(r, [-1, 0, 0, 1])))
    let x = 390 + indent * 36
    const tokens = 1 + Math.floor(r() * 4)
    for (let t = 0; t < tokens; t++) {
      const w = between(r, 40, 180)
      parts.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="14" rx="7" fill="${pick(r, colours)}"/>`)
      x += w + 16
    }
  }
  parts.push(`<rect x="${390 + between(r, 0, 400)}" y="${96 + 22 * 38}" width="4" height="22" fill="#c0caf5"/>`)
  return svg(W, H, parts.join(''))
}

/** An abstract square portrait for a profile photo. */
export function avatar(seed: number, palette: [string, string, string]): Art {
  const r = random(seed)
  const [bg, a, b] = palette
  const S = 512
  const parts = [`<rect width="${S}" height="${S}" fill="${bg}"/>`]
  parts.push(`<circle cx="${between(r, 140, 370)}" cy="${between(r, 140, 370)}" r="${between(r, 140, 230)}" fill="${a}"/>`)
  for (let i = 0; i < 3; i++) {
    const y = between(r, 0, S)
    parts.push(`<rect x="-40" y="${y.toFixed(1)}" width="${S + 80}" height="${between(r, 18, 46).toFixed(1)}" fill="${b}" opacity="0.85" transform="rotate(${between(r, -30, 30).toFixed(1)} ${S / 2} ${S / 2})"/>`)
  }
  parts.push(`<circle cx="${between(r, 100, 410)}" cy="${between(r, 100, 410)}" r="${between(r, 30, 70)}" fill="${bg}"/>`)
  return svg(S, S, parts.join(''))
}
