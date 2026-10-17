// Copyright HeyNaija contributors. SPDX-License-Identifier: Apache-2.0
package profile

import (
	"encoding/json"
	"strings"

	"github.com/ory/kratos/identity"
	"github.com/ory/kratos/schema"
	"github.com/ory/kratos/text"
	"github.com/tidwall/gjson"
)

// Do not let a later profile edit turn a matching Google connection into a
// different-email connection. Unlinking Google remains available in Settings.
func heynaijaEmailChange(i *identity.Identity, traits []byte) error {
	previous := strings.ToLower(strings.TrimSpace(gjson.GetBytes(i.Traits, "email").String()))
	next := strings.ToLower(strings.TrimSpace(gjson.GetBytes(traits, "email").String()))
	if previous == next {
		return nil
	}
	credentials, ok := i.GetCredentials(identity.CredentialsTypeOIDC)
	if !ok {
		return nil
	}
	var providers identity.CredentialsOIDC
	if err := json.Unmarshal(credentials.Config, &providers); err != nil {
		return err
	}
	for _, provider := range providers.Providers {
		if provider.Provider == "google" {
			message := "Disconnect Google before changing your HeyNaija email address. Connected accounts must use the same email."
			return schema.NewHookValidationError("#/traits/email", message, text.Messages{{ID: 4900103, Text: message, Type: "error"}})
		}
	}
	return nil
}
