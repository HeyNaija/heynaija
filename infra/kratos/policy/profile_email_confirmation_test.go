// Copyright HeyNaija contributors. SPDX-License-Identifier: Apache-2.0
package profile

import (
	"testing"
	"time"

	"github.com/ory/kratos/identity"
	"github.com/ory/kratos/x"
)

func TestHeyNaijaEmailConfirmationBinding(t *testing.T) {
	i := identity.NewIdentity("member")
	i.ID = x.NewUUID()
	i.Traits = identity.Traits(`{"email":"old@example.com"}`)
	now := time.Now().UTC()
	c := heynaijaEmailChallenge{IdentityID: i.ID, Original: "old@example.com", Target: "new@example.com", Expires: now.Add(time.Minute)}
	if !c.validFor(i, "new@example.com", now) {
		t.Fatal("a matching, live challenge should work")
	}
	if c.validFor(i, "different@example.com", now) {
		t.Fatal("code allowed a different email")
	}
	if c.validFor(i, c.Target, now.Add(2*time.Minute)) {
		t.Fatal("expired code was accepted")
	}
	c.Used = true
	if c.validFor(i, c.Target, now) {
		t.Fatal("consumed code was accepted")
	}
	c.Used = false
	i.Traits = identity.Traits(`{"email":"changed-elsewhere@example.com"}`)
	if c.validFor(i, c.Target, now) {
		t.Fatal("stale flow could overwrite a newer email change")
	}
	i.Traits = identity.Traits(`{"email":"old@example.com"}`)
	i.ID = x.NewUUID()
	if c.validFor(i, c.Target, now) {
		t.Fatal("code allowed another account")
	}
}
