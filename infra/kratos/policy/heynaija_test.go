// Copyright HeyNaija contributors. SPDX-License-Identifier: Apache-2.0
package oidc

import (
	"testing"

	"github.com/ory/kratos/identity"
	"github.com/ory/kratos/selfservice/flow"
	"github.com/ory/kratos/selfservice/flow/login"
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
		email, err := heynaijaEmail(claims)
		if err == nil {
			err = heynaijaMatchEmail(i, email)
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
}
