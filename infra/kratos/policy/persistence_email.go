// Copyright HeyNaija contributors. SPDX-License-Identifier: Apache-2.0
package sql

import (
	"context"
	"crypto/subtle"
	"time"

	"github.com/gofrs/uuid"
	"github.com/ory/kratos/identity"
	"github.com/ory/kratos/selfservice/flow/settings"
	"github.com/ory/pop/v6"
	"github.com/ory/x/sqlxx"
	"github.com/tidwall/gjson"
)

// Serialize attempts, resends and consumption in the private settings-flow
// context. The identity lock also serializes sends across different flows.
// HeyNaija runs PostgreSQL; no new table or identity trait is needed.
func (p *Persister) WithHeyNaijaEmailFlow(ctx context.Context, flowID, identityID uuid.UUID, update func(context.Context, *settings.Flow, time.Time) error) error {
	return p.Transaction(ctx, func(ctx context.Context, tx *pop.Connection) error {
		var owner identity.Identity
		if err := tx.RawQuery("SELECT * FROM identities WHERE id = ? AND nid = ? FOR UPDATE", identityID, p.NetworkID(ctx)).First(&owner); err != nil {
			return err
		}
		// Expanding several associations runs parallel queries in upstream Kratos,
		// which cannot share a transaction connection. Only credentials are needed.
		if err := p.HydrateIdentityAssociations(ctx, &owner, identity.ExpandCredentials); err != nil {
			return err
		}
		var locked settings.Flow
		if err := tx.RawQuery("SELECT * FROM selfservice_settings_flows WHERE id = ? AND identity_id = ? AND nid = ? FOR UPDATE", flowID, identityID, p.NetworkID(ctx)).First(&locked); err != nil {
			return err
		}
		locked.Identity = &owner
		var recent []struct {
			InternalContext sqlxx.JSONRawMessage `db:"internal_context"`
		}
		if err := tx.RawQuery("SELECT internal_context FROM selfservice_settings_flows WHERE identity_id = ? AND nid = ? AND updated_at >= ?", identityID, p.NetworkID(ctx), time.Now().UTC().Add(-time.Minute)).All(&recent); err != nil {
			return err
		}
		var lastSent time.Time
		for _, previous := range recent {
			at, _ := time.Parse(time.RFC3339Nano, gjson.GetBytes(previous.InternalContext, "heynaija_email_sent_at").String())
			if at.After(lastSent) {
				lastSent = at
			}
		}
		if err := update(ctx, &locked, lastSent); err != nil {
			return err
		}
		return p.UpdateSettingsFlow(ctx, &locked)
	})
}

// Use the same server-secret HMAC primitive and rotation handling as native OTPs.
func (p *Persister) HeyNaijaEmailCodeHash(ctx context.Context, value string) string {
	return p.hmacValue(ctx, value)
}
func (p *Persister) HeyNaijaEmailCodeMatches(ctx context.Context, value, expected string) bool {
	for _, secret := range p.r.Config().SecretsSession(ctx) {
		if subtle.ConstantTimeCompare([]byte(hmacValueWithSecret(value, secret)), []byte(expected)) == 1 {
			return true
		}
	}
	return false
}
