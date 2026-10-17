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
	if !strings.Contains(subject, "123456") || !strings.Contains(text, "\n\n123456\n\n") || !strings.Contains(text, "15 minutes") {
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
