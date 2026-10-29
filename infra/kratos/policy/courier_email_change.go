// Copyright HeyNaija contributors. SPDX-License-Identifier: Apache-2.0
// Added to the pinned Kratos courier/template/email package by infra/kratos/Dockerfile.
package email

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/ory/kratos/courier/template"
)

// HeyNaija's email-change messages. Kratos's verification email would tell the
// new address to "verify your account" and offer a link that cannot finish the
// change, and nothing would tell the old address that the change happened.
const (
	TypeHeyNaijaEmailChangeCode template.TemplateType = "heynaija_email_change_code"
	TypeHeyNaijaEmailChanged    template.TemplateType = "heynaija_email_changed"
)

type (
	HeyNaijaEmailChangeCode struct{ m *HeyNaijaEmailChangeCodeModel }
	// Sent to the new address. It does not name the current one: a mistyped
	// address may belong to a stranger.
	HeyNaijaEmailChangeCodeModel struct {
		To               string `json:"to"`
		Code             string `json:"code"`
		ExpiresInMinutes int    `json:"expires_in_minutes"`
	}

	HeyNaijaEmailChanged struct{ m *HeyNaijaEmailChangedModel }
	// Sent to the old address once the new one is saved.
	HeyNaijaEmailChangedModel struct {
		To        string    `json:"to"`
		Handle    string    `json:"handle"`
		NewEmail  string    `json:"new_email"`
		ChangedAt time.Time `json:"changed_at"`
	}
)

func NewHeyNaijaEmailChangeCode(m *HeyNaijaEmailChangeCodeModel) *HeyNaijaEmailChangeCode {
	return &HeyNaijaEmailChangeCode{m: m}
}

func (t *HeyNaijaEmailChangeCode) EmailRecipient() (string, error) { return t.m.To, nil }
func (t *HeyNaijaEmailChangeCode) TemplateType() template.TemplateType {
	return TypeHeyNaijaEmailChangeCode
}
func (t *HeyNaijaEmailChangeCode) MarshalJSON() ([]byte, error) { return json.Marshal(t.m) }

func (t *HeyNaijaEmailChangeCode) EmailSubject(context.Context) (string, error) {
	return "Confirm your new HeyNaija email address", nil
}

func (t *HeyNaijaEmailChangeCode) paragraphs() []string {
	return []string{
		"You asked to make this the email address for your HeyNaija account. To confirm, enter this code in Settings, where you made the change:",
		t.m.Code,
		fmt.Sprintf("The code expires in %d minutes. Until the change is confirmed, you keep signing in with your current address.", t.m.ExpiresInMinutes),
		"If you did not ask for this, ignore this email. Nothing changes without the code.",
	}
}

func (t *HeyNaijaEmailChangeCode) EmailBodyPlaintext(context.Context) (string, error) {
	return heynaijaPlaintext(t.paragraphs()), nil
}

func (t *HeyNaijaEmailChangeCode) EmailBody(context.Context) (string, error) {
	return heynaijaHTML("HeyNaija email change code", t.paragraphs(), 1), nil
}

func NewHeyNaijaEmailChanged(m *HeyNaijaEmailChangedModel) *HeyNaijaEmailChanged {
	return &HeyNaijaEmailChanged{m: m}
}

func (t *HeyNaijaEmailChanged) EmailRecipient() (string, error) { return t.m.To, nil }
func (t *HeyNaijaEmailChanged) TemplateType() template.TemplateType {
	return TypeHeyNaijaEmailChanged
}
func (t *HeyNaijaEmailChanged) MarshalJSON() ([]byte, error) { return json.Marshal(t.m) }

func (t *HeyNaijaEmailChanged) EmailSubject(context.Context) (string, error) {
	return "Your HeyNaija email address was changed", nil
}

func (t *HeyNaijaEmailChanged) paragraphs() []string {
	return []string{
		fmt.Sprintf("The email address for your HeyNaija account @%s was changed from %s to %s on %s. You now sign in with the new address.",
			t.m.Handle, t.m.To, t.m.NewEmail, t.m.ChangedAt.UTC().Format("2 January 2006 at 15:04 UTC")),
		"If you made this change, there is nothing more to do.",
		"If you did not, someone else may be using your account. Keep this email: it records the change and the address the account was moved to.",
	}
}

func (t *HeyNaijaEmailChanged) EmailBodyPlaintext(context.Context) (string, error) {
	return heynaijaPlaintext(t.paragraphs()), nil
}

func (t *HeyNaijaEmailChanged) EmailBody(context.Context) (string, error) {
	return heynaijaHTML("Your HeyNaija email address was changed", t.paragraphs(), -1), nil
}

func heynaijaPlaintext(paragraphs []string) string { return strings.Join(paragraphs, "\n\n") + "\n" }

// The same frame as apps/api/src/email/layout.ts, in the colours of apps/web/DESIGN.md. It is
// also drawn by courier-templates/login_code and registration_code; keep all four in step.
// A white card on the sage ground under the wordmark. Every value is escaped; the
// paragraph at index code is shown large, in an inset panel.
func heynaijaHTML(title string, paragraphs []string, code int) string {
	const font = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans',Helvetica,Arial,sans-serif`
	var b strings.Builder
	b.WriteString(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
		`<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">`)
	fmt.Fprintf(&b, "<title>%s</title>", html.EscapeString(title))
	b.WriteString(`<style>:root{color-scheme:light dark;supported-color-schemes:light dark}` +
		`@media (prefers-color-scheme:dark){.hn-ground{background:#0b1210!important}.hn-card{background:#111a17!important;border-color:#212d28!important}` +
		`.hn-ink{color:#e6efe9!important}.hn-link{color:#7dd9aa!important}.hn-inset{background:#18231f!important}}</style></head>`)
	b.WriteString(`<body class="hn-ground" style="margin:0;padding:0;background:#f1f4f2">`)
	// The grey preview line a mail list shows: the first paragraph, hidden in the body.
	fmt.Fprintf(&b, `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">%s%s</div>`, html.EscapeString(paragraphs[0]), strings.Repeat("&nbsp;&zwnj;", 40))
	b.WriteString(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="hn-ground" style="background:#f1f4f2"><tr><td align="center" style="padding:24px 12px">`)
	b.WriteString(`<!--[if mso]><table role="presentation" width="560" align="center"><tr><td><![endif]-->`)
	b.WriteString(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px">`)
	fmt.Fprintf(&b, `<tr><td class="hn-link" style="padding:0 4px 14px;font-family:%s;font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#258153">HeyNaija</td></tr>`, font)
	fmt.Fprintf(&b, `<tr><td class="hn-card" style="background:#ffffff;border:1px solid #e3e9e5;border-radius:12px;padding:24px;font-family:%s;font-size:15px;line-height:1.6;color:#10212b">`, font)
	for n, p := range paragraphs {
		if n == code {
			fmt.Fprintf(&b, `<p class="hn-ink hn-inset" style="margin:0 0 14px;padding:14px 16px;background:#f3f6f4;border-radius:8px;text-align:center;font-size:30px;font-weight:700;letter-spacing:6px;color:#10212b">%s</p>`, html.EscapeString(p))
		} else {
			fmt.Fprintf(&b, `<p class="hn-ink" style="margin:0 0 14px;color:#10212b">%s</p>`, html.EscapeString(p))
		}
	}
	b.WriteString("</td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>")
	return b.String()
}
