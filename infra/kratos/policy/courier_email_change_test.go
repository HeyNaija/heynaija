// Copyright HeyNaija contributors. SPDX-License-Identifier: Apache-2.0
package email

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestHeyNaijaEmailChangeMessages(t *testing.T) {
	ctx := context.Background()
	code := NewHeyNaijaEmailChangeCode(&HeyNaijaEmailChangeCodeModel{To: "new@example.com", Code: "123456", ExpiresInMinutes: 15})
	subject, _ := code.EmailSubject(ctx)
	text, _ := code.EmailBodyPlaintext(ctx)
	if strings.Contains(subject, "123456") {
		t.Fatal("the code must stay out of the subject, which shows on lock screens:", subject)
	}
	if !strings.Contains(text, "\n\n123456\n\n") || !strings.Contains(text, "15 minutes") {
		t.Fatalf("the code email must carry the code and its lifetime: %q / %q", subject, text)
	}
	if strings.Contains(strings.ToLower(text), "verify your account") {
		t.Fatal("the code email must describe an email change, not account verification")
	}

	changed := NewHeyNaijaEmailChanged(&HeyNaijaEmailChangedModel{
		To: "old@example.com", Handle: "ada", NewEmail: "new<b>@example.com",
		ChangedAt: time.Date(2026, 10, 17, 18, 5, 0, 0, time.FixedZone("WAT", 3600)),
	})
	if to, _ := changed.EmailRecipient(); to != "old@example.com" {
		t.Fatal("the notice goes to the old address, got", to)
	}
	text, _ = changed.EmailBodyPlaintext(ctx)
	if !strings.Contains(text, "@ada") || !strings.Contains(text, "from old@example.com to new<b>@example.com") || !strings.Contains(text, "17 October 2026 at 17:05 UTC") {
		t.Fatalf("the notice must say which account, both addresses and when (in UTC): %q", text)
	}
	// Sign-in codes are six digits; a notice must never look like one.
	if regexp.MustCompile(`\b\d{6}\b`).MatchString(text) {
		t.Fatal("the notice contains something that reads as a code:", text)
	}
	body, _ := changed.EmailBody(ctx)
	if strings.Contains(body, "new<b>") || !strings.Contains(body, "new&lt;b&gt;") {
		t.Fatal("HTML bodies must escape their values:", body)
	}
}

func TestHeyNaijaEmailFrame(t *testing.T) {
	ctx := context.Background()
	changed := NewHeyNaijaEmailChanged(&HeyNaijaEmailChangedModel{
		To: "old@example.com", Handle: "ada", NewEmail: "new@example.com",
		ChangedAt: time.Date(2026, 10, 17, 18, 5, 0, 0, time.UTC),
	})
	code := NewHeyNaijaEmailChangeCode(&HeyNaijaEmailChangeCodeModel{To: "new@example.com", Code: "123456", ExpiresInMinutes: 15})
	for name, body := range map[string]func(context.Context) (string, error){"changed": changed.EmailBody, "code": code.EmailBody} {
		html, _ := body(ctx)
		pre := regexp.MustCompile(`<div style="display:none[^"]*mso-hide:all">(.*?)</div>`).FindStringSubmatch(html)
		if pre == nil || !strings.HasSuffix(pre[1], strings.Repeat("&nbsp;&zwnj;", 40)) {
			t.Fatalf("%s: want a hidden preheader with mso-hide and padding, got %v", name, pre)
		}
		if !strings.HasPrefix(pre[1], "You asked to make this") && !strings.HasPrefix(pre[1], "The email address for your HeyNaija account @ada was changed") {
			t.Fatalf("%s: the preheader leads with the first paragraph, got %q", name, pre[1])
		}
		if strings.Contains(pre[1], "123456") {
			t.Fatalf("%s: the preheader must not carry the code", name)
		}
		if !strings.Contains(html, `<!--[if mso]><table role="presentation" width="560" align="center"><tr><td><![endif]-->`) ||
			!strings.Contains(html, `<!--[if mso]></td></tr></table><![endif]-->`) {
			t.Fatalf("%s: want the Outlook-only fixed-width wrapper", name)
		}
	}
}
