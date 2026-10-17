// Copyright HeyNaija contributors. SPDX-License-Identifier: Apache-2.0
// Added to the pinned Kratos oidc package by infra/kratos/Dockerfile.
package oidc

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/ory/kratos/identity"
	"github.com/ory/kratos/schema"
	"github.com/ory/kratos/selfservice/flow"
	"github.com/ory/kratos/selfservice/flow/login"
	"github.com/ory/kratos/text"
	"github.com/ory/kratos/x"
	"github.com/ory/x/sqlcon"
	"github.com/ory/x/sqlxx"
	"github.com/pkg/errors"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

func heynaijaGoogle(provider Provider) bool { return provider.Config().ID == "google" }

func heynaijaError(message string) error {
	return schema.NewHookValidationError("#/", message, text.Messages{{ID: 4900101, Text: message, Type: "error"}})
}

func heynaijaEmail(claims *Claims) (string, error) {
	if claims == nil || !bool(claims.EmailVerified) || strings.TrimSpace(claims.Email) == "" {
		return "", heynaijaError("Google must verify your email address before you can use it to sign in.")
	}
	// Case is ignored; Gmail dots, plus-addresses and other aliases stay distinct.
	return strings.ToLower(strings.TrimSpace(claims.Email)), nil
}

func heynaijaMatchEmail(i *identity.Identity, email string) error {
	accountEmail := strings.ToLower(strings.TrimSpace(gjson.GetBytes(i.Traits, "email").String()))
	if email == "" || accountEmail == "" || accountEmail != email {
		return heynaijaError("Choose the Google account with the same email address as your HeyNaija account. Different email addresses cannot be connected.")
	}
	return nil
}

func heynaijaCheckGoogle(i *identity.Identity, claims *Claims, provider Provider) error {
	if !heynaijaGoogle(provider) {
		return nil
	}
	email, err := heynaijaEmail(claims)
	if err != nil {
		return err
	}
	return heynaijaMatchEmail(i, email)
}

func (s *Strategy) heynaijaExistingGoogle(ctx context.Context, claims *Claims, provider Provider) (*identity.Identity, error) {
	if !heynaijaGoogle(provider) {
		return nil, nil
	}
	email, err := heynaijaEmail(claims)
	if err != nil {
		return nil, err
	}
	i, _, err := s.d.PrivilegedIdentityPool().FindByCredentialsIdentifier(ctx, identity.CredentialsTypeCodeAuth, email)
	if errors.Is(err, sqlcon.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := heynaijaMatchEmail(i, email); err != nil {
		return nil, err
	}
	return i, nil
}

// Bind the pending Google credential to its verified email in the server-side
// flow context. The existing Kratos code challenge checks this same identifier
// before Link is called; no provider authorization or Settings visit is repeated.
func heynaijaBindGoogle(lf *login.Flow, credentials *identity.Credentials, email string) error {
	bound, err := sjson.SetBytes(credentials.Config, "heynaija_verified_email", email)
	if err != nil {
		return err
	}
	return flow.SetDuplicateCredentials(lf, flow.DuplicateCredentialsData{
		CredentialsType:     identity.CredentialsTypeOIDC,
		CredentialsConfig:   sqlxx.JSONRawMessage(bound),
		DuplicateIdentifier: email,
	})
}

func (s *Strategy) heynaijaConfirmGoogle(ctx context.Context, w http.ResponseWriter, r *http.Request, lf *login.Flow, i *identity.Identity, token *identity.CredentialsOIDCEncryptedTokens, claims *Claims, provider Provider) error {
	email, err := heynaijaEmail(claims)
	if err != nil {
		return err
	}
	if err := heynaijaMatchEmail(i, email); err != nil {
		return err
	}
	credentials, err := identity.NewOIDCLikeCredentials(token, s.ID(), provider.Config().ID, claims.Subject, provider.Config().OrganizationID)
	if err != nil {
		return err
	}
	if err := heynaijaBindGoogle(lf, credentials, email); err != nil {
		return err
	}
	s.populateAccountLinkingUI(ctx, lf, provider.Config().ID, email, []string{"code"}, nil)
	// Do not offer another social provider or permit the confirmation email to be
	// changed. The native code flow and duplicate-identifier check enforce it too.
	nodes := lf.UI.Nodes[:0]
	for _, n := range lf.UI.Nodes {
		if string(n.Group) != "oidc" {
			nodes = append(nodes, n)
		}
	}
	lf.UI.Nodes = nodes
	lf.UI.Messages.Clear()
	lf.UI.Messages.Add(&text.Message{ID: 4900102, Text: "Google confirmed your email. Confirm your existing HeyNaija account with an email code to finish signing in. Google will be connected automatically.", Type: "info"})
	if err := s.d.LoginFlowPersister().UpdateLoginFlow(ctx, lf); err != nil {
		return err
	}
	x.SendFlowCompletedAsRedirectOrJSON(w, r, s.d.Writer(), lf, lf.AppendTo(s.d.Config().SelfServiceFlowLoginUI(ctx)).String())
	return errors.WithStack(flow.ErrCompletedByStrategy)
}

// Link is also used when an email challenge completes. Reject stale/unbound
// flows and any attempt to confirm a different account, before saving credentials.
func heynaijaCheckPendingGoogle(i *identity.Identity, config []byte) error {
	var credentials identity.CredentialsOIDC
	if err := json.Unmarshal(config, &credentials); err != nil {
		return err
	}
	for _, provider := range credentials.Providers {
		if provider.Provider == "google" {
			email := gjson.GetBytes(config, "heynaija_verified_email").String()
			return heynaijaMatchEmail(i, email)
		}
	}
	return nil
}
