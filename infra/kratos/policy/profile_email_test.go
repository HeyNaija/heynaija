// Copyright HeyNaija contributors. SPDX-License-Identifier: Apache-2.0
package profile

import (
	"github.com/ory/kratos/identity"
	"testing"
)

func TestHeyNaijaEmailChange(t *testing.T) {
	i := identity.NewIdentity("member")
	i.Traits = identity.Traits(`{"email":"ada@gmail.com","handle":"ada"}`)
	next := []byte(`{"email":"different@gmail.com","handle":"ada"}`)
	if err := heynaijaEmailChange(i, next); err != nil {
		t.Fatal("email-only accounts may change email", err)
	}
	i.SetCredentials(identity.CredentialsTypeOIDC, identity.Credentials{Config: []byte(`{"providers":[{"provider":"google","subject":"subject"}]}`)})
	if err := heynaijaEmailChange(i, next); err == nil {
		t.Fatal("a profile update created a different-email Google connection")
	}
	if err := heynaijaEmailChange(i, []byte(`{"email":"ADA@gmail.com","handle":"new_handle"}`)); err != nil {
		t.Fatal("ordinary profile changes should work", err)
	}
}
