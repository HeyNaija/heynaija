// Copyright HeyNaija contributors. SPDX-License-Identifier: Apache-2.0
package oidc

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ory/kratos/identity"
	"github.com/ory/kratos/selfservice/flow"
	"github.com/ory/kratos/selfservice/flow/login"
	"github.com/ory/kratos/selfservice/flow/registration"
	"github.com/ory/kratos/x"
)

func TestHeyNaijaEmailRules(t *testing.T) {
	i := identity.NewIdentity("member")
	i.Traits = identity.Traits(`{"email":"Ada@Gmail.com"}`)
	for _, tc := range []struct {
		email    string
		verified bool
		allowed  bool
	}{
		{"ada@gmail.com", true, true}, {"ADA@gmail.com", true, true},
		{"different@gmail.com", true, false}, {"ada+other@gmail.com", true, false},
		{"a.da@gmail.com", true, false}, {"ada@gmail.com", false, false}, {"", true, false},
	} {
		claims := &Claims{Email: tc.email, EmailVerified: x.ConvertibleBoolean(tc.verified)}
		email, err := heynaijaEmail(claims, "Google")
		if err == nil {
			err = heynaijaMatchEmail(i, email, "Google")
		}
		if (err == nil) != tc.allowed {
			t.Errorf("email=%q verified=%v: %v", tc.email, tc.verified, err)
		}
	}
}

func TestHeyNaijaPendingLinkBinding(t *testing.T) {
	i := identity.NewIdentity("member")
	i.Traits = identity.Traits(`{"email":"ada@gmail.com"}`)
	credentials := &identity.Credentials{Config: []byte(`{"providers":[{"provider":"google","subject":"google-subject"}]}`)}
	lf := &login.Flow{}
	if err := heynaijaBindGoogle(lf, credentials, "ada@gmail.com"); err != nil {
		t.Fatal(err)
	}
	pending, err := flow.DuplicateCredentials(lf)
	if err != nil {
		t.Fatal(err)
	}
	if pending.DuplicateIdentifier != "ada@gmail.com" {
		t.Fatal("confirmation is not bound to the Google email")
	}
	if err := heynaijaCheckPendingGoogle(i, pending.CredentialsConfig); err != nil {
		t.Fatal(err)
	}
	i.Traits = identity.Traits(`{"email":"someone-else@gmail.com"}`)
	if err := heynaijaCheckPendingGoogle(i, pending.CredentialsConfig); err == nil {
		t.Fatal("different-email linking was accepted")
	}
	i.Traits = identity.Traits(`{"email":"ada@gmail.com"}`)
	if err := heynaijaCheckPendingGoogle(i, credentials.Config); err == nil {
		t.Fatal("an unbound legacy flow was accepted")
	}
	// Apple's credential waits for the same confirmation.
	apple := &identity.Credentials{Config: []byte(`{"providers":[{"provider":"apple","subject":"001234.abcd"}]}`)}
	if err := heynaijaCheckPendingGoogle(i, apple.Config); err == nil {
		t.Fatal("an unbound Apple flow was accepted")
	}
	if err := heynaijaBindGoogle(lf, apple, "ada@gmail.com"); err != nil {
		t.Fatal(err)
	}
	pending, _ = flow.DuplicateCredentials(lf)
	if err := heynaijaCheckPendingGoogle(i, pending.CredentialsConfig); err != nil {
		t.Fatal(err)
	}
}

func TestHeyNaijaPolicyCoversGoogleAndApple(t *testing.T) {
	i := identity.NewIdentity("member")
	i.Traits = identity.Traits(`{"email":"ada@privaterelay.appleid.com"}`)
	apple, other := heynaijaTestProvider("apple"), heynaijaTestProvider("github")
	if !heynaijaGoogle(heynaijaTestProvider("google")) || !heynaijaGoogle(apple) || heynaijaGoogle(other) {
		t.Fatal("the policy should cover Google and Apple, and nothing else")
	}
	// Apple writes email_verified as a string; Hide My Email's address is the account's.
	claims := &Claims{Email: "ADA@privaterelay.appleid.com", EmailVerified: x.ConvertibleBoolean(true)}
	if err := heynaijaCheckGoogle(i, claims, apple); err != nil {
		t.Fatal(err)
	}
	err := heynaijaCheckGoogle(i, &Claims{Email: "ada@icloud.com", EmailVerified: x.ConvertibleBoolean(true)}, apple)
	if err == nil || !strings.Contains(err.Error(), "Choose the Apple account") {
		t.Fatalf("a different Apple address was accepted, or the refusal did not name Apple: %v", err)
	}
	if err := heynaijaCheckGoogle(i, &Claims{Email: "ada@icloud.com"}, other); err != nil {
		t.Fatal("another provider was held to the policy")
	}
}

type heynaijaTestProvider string

func (p heynaijaTestProvider) Config() *Configuration { return &Configuration{ID: string(p)} }

func TestHeyNaijaGoogleSignupWaitsForItsHandle(t *testing.T) {
	google, other := heynaijaTestProvider("google"), heynaijaTestProvider("other")
	claims := &Claims{Subject: "google-subject", Email: "ada@gmail.com", EmailVerified: x.ConvertibleBoolean(true)}
	token := &identity.CredentialsOIDCEncryptedTokens{IDToken: "encrypted-id-token"}
	rf := &registration.Flow{InternalContext: []byte("{}")}

	if err := heynaijaKeepGoogle(rf, other, claims, token); err != nil {
		t.Fatal(err)
	}
	if _, _, _, ok := heynaijaPendingGoogle(rf, google, nil); ok {
		t.Fatal("another provider's result was kept")
	}
	if err := heynaijaKeepGoogle(rf, google, claims, token); err != nil {
		t.Fatal(err)
	}
	if _, _, _, ok := heynaijaPendingGoogle(rf, other, nil); ok {
		t.Fatal("a Google result was offered to another provider")
	}
	kept, keptToken, traits, ok := heynaijaPendingGoogle(rf, google, json.RawMessage(`{"email":"someone-else@gmail.com","handle":"ada"}`))
	if !ok || kept.Subject != "google-subject" || kept.Email != "ada@gmail.com" || keptToken.IDToken != "encrypted-id-token" {
		t.Fatalf("the Google result did not come back: %+v %+v", kept, keptToken)
	}
	// The address is Google's: a form cannot replace it, only add the handle.
	if string(traits) != `{"handle":"ada"}` {
		t.Fatalf("traits sent with the handle: %s", traits)
	}
	if _, _, _, ok := heynaijaPendingGoogle(&registration.Flow{InternalContext: []byte("{}")}, google, nil); ok {
		t.Fatal("a flow without a Google result offered one")
	}
}
