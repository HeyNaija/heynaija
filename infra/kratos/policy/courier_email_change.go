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
	return "Your HeyNaija email change code: " + t.m.Code, nil
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
	return heynaijaHTML(t.paragraphs(), 1), nil
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
	return heynaijaHTML(t.paragraphs(), -1), nil
}

func heynaijaPlaintext(paragraphs []string) string { return strings.Join(paragraphs, "\n\n") + "\n" }

// Every value is escaped; the paragraph at index code is shown large.
func heynaijaHTML(paragraphs []string, code int) string {
	var b strings.Builder
	b.WriteString(`<!doctype html><html><body style="font-family:sans-serif;line-height:1.5">`)
	for n, p := range paragraphs {
		if n == code {
			fmt.Fprintf(&b, `<p style="font-size:28px;font-weight:bold;letter-spacing:4px">%s</p>`, html.EscapeString(p))
		} else {
			fmt.Fprintf(&b, "<p>%s</p>", html.EscapeString(p))
		}
	}
	b.WriteString("</body></html>")
	return b.String()
}
