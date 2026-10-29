/**
 * The frame every HeyNaija email shares: a white card with a hairline border on
 * the sage ground, the wordmark above it and a quiet footer below, in the colours
 * of apps/web/DESIGN.md. Mail programs ignore web fonts and most CSS, so this is
 * tables and inline styles in the system font stack. The dark-mode block is only
 * a hint for programs that honour it; the inline light colours are what the rest show.
 * The frame is drawn in four places that must stay in step: here, `heynaijaHTML` in
 * infra/kratos/policy/courier_email_change.go, and infra/kratos/courier-templates/login_code/valid/email.body.gotmpl
 * and registration_code/valid/email.body.gotmpl (the emails Kratos sends).
 */

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans',Helvetica,Arial,sans-serif"

/** Colours from DESIGN.md. Light values are inline; the dark ones are in the style block below. */
export const COLOR = {
  ground: '#f1f4f2',
  card: '#ffffff',
  hairline: '#e3e9e5',
  ink: '#10212b',
  muted: '#5c6b76',
  green: '#258153',
  greenDeep: '#176541',
} as const

const DARK_MODE = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .hn-ground { background:#0b1210 !important }
    .hn-card { background:#111a17 !important; border-color:#212d28 !important }
    .hn-ink { color:#e6efe9 !important }
    .hn-muted { color:#9dafa5 !important }
    .hn-link { color:#7dd9aa !important }
    .hn-rule { border-color:#212d28 !important }
    .hn-inset { background:#18231f !important }
  }`

/** A green link-button. `href` is escaped here. */
export const button = (label: string, href: string) =>
  `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px 0 0"><tr><td style="background:${COLOR.green};border-radius:8px;padding:12px 20px">` +
  `<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none">${escapeHtml(label)}</a>` +
  `</td></tr></table>`

/** A paragraph of body text; `html` must already be escaped. */
export const paragraph = (html: string, style = '') =>
  `<p class="hn-ink" style="margin:0 0 14px;color:${COLOR.ink};${style}">${html}</p>`

/**
 * @param preheader the grey preview line a mail list shows beside the subject; plain text.
 * @param body the card's contents, already escaped.
 * @param footer the small print under the card, already escaped; leave out for none.
 */
export function emailFrame(input: { title: string; preheader: string; body: string; footer?: string }): string {
  const { title, preheader, body, footer } = input
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<style>${DARK_MODE}
</style>
</head>
<body class="hn-ground" style="margin:0;padding:0;background:${COLOR.ground}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(preheader)}${'&nbsp;&zwnj;'.repeat(40)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="hn-ground" style="background:${COLOR.ground}"><tr><td align="center" style="padding:24px 12px">
  <!--[if mso]><table role="presentation" width="560" align="center"><tr><td><![endif]-->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px">
    <tr><td style="padding:0 4px 14px;font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:-0.03em;color:${COLOR.green}" class="hn-link">HeyNaija</td></tr>
    <tr><td class="hn-card" style="background:${COLOR.card};border:1px solid ${COLOR.hairline};border-radius:12px;padding:24px;font-family:${FONT};font-size:15px;line-height:1.6;color:${COLOR.ink}">
${body}
    </td></tr>${
      footer
        ? `
    <tr><td class="hn-muted" style="padding:16px 4px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${COLOR.muted}">${footer}</td></tr>`
        : ''
    }
  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>
`
}

/** A text link in the footer or body; `label` and `href` are escaped here. */
export const link = (label: string, href: string) =>
  `<a class="hn-link" href="${escapeHtml(href)}" style="color:${COLOR.greenDeep};font-weight:600">${escapeHtml(label)}</a>`
