// Copyright HeyNaija contributors. SPDX-License-Identifier: Apache-2.0
package profile

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/ory/kratos/courier"
	"github.com/ory/kratos/courier/template"
	"github.com/ory/kratos/courier/template/email"
	"github.com/ory/kratos/identity"
	"github.com/ory/kratos/selfservice/flow"
	"github.com/ory/kratos/selfservice/flow/settings"
	"github.com/ory/kratos/selfservice/strategy/code"
	"github.com/ory/kratos/text"
	"github.com/ory/kratos/ui/node"
	"github.com/ory/kratos/x"
	"github.com/ory/x/sqlxx"
	"github.com/pkg/errors"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

const heynaijaPendingEmailKey = "heynaija_email_change"
const heynaijaEmailCodeField = "email_change_code"

type heynaijaEmailChallenge struct {
	IdentityID uuid.UUID `json:"identity_id"`
	Original   string    `json:"original"`
	Target     string    `json:"target"`
	Nonce      string    `json:"nonce"`
	MAC        string    `json:"mac"`
	Expires    time.Time `json:"expires"`
	Attempts   int       `json:"attempts"`
	Used       bool      `json:"used"`
}

type heynaijaEmailStore interface {
	WithHeyNaijaEmailFlow(context.Context, uuid.UUID, uuid.UUID, func(context.Context, *settings.Flow, time.Time) error) error
	HeyNaijaEmailCodeHash(context.Context, string) string
	HeyNaijaEmailCodeMatches(context.Context, string, string) bool
}

func heynaijaNormalizeEmail(value string) string { return strings.ToLower(strings.TrimSpace(value)) }
func (c *heynaijaEmailChallenge) payload(flowID uuid.UUID, supplied string) string {
	return fmt.Sprintf("heynaija-email-change:%s:%s:%s:%s:%s:%s", flowID, c.IdentityID, c.Original, c.Target, c.Nonce, supplied)
}
func (c *heynaijaEmailChallenge) validFor(i *identity.Identity, target string, now time.Time) bool {
	return !c.Used && c.IdentityID == i.ID && c.Original == heynaijaNormalizeEmail(gjson.GetBytes(i.Traits, "email").String()) && c.Target == target && now.Before(c.Expires)
}

func heynaijaEmailMessage(f *settings.Flow, message string, failure bool) {
	f.UI.Messages.Clear()
	typeOf := "info"
	if failure {
		typeOf = "error"
	}
	f.UI.Messages.Add(&text.Message{ID: 4900201, Text: message, Type: text.UITextType(typeOf)})
}

func heynaijaEmailUI(f *settings.Flow, target string) {
	f.UI.Nodes.Remove(heynaijaEmailCodeField, "email_change_action")
	if n := f.UI.Nodes.Find("method"); n != nil {
		n.Attributes.SetValue("profile")
		n.Attributes.(*node.InputAttributes).Type = node.InputAttributeTypeHidden
	}
	input := node.NewInputField(heynaijaEmailCodeField, "", node.ProfileGroup, node.InputAttributeTypeText, node.WithRequiredInputAttribute).
		WithMetaLabel(&text.Message{ID: 4900202, Text: "Code sent to your new email", Type: "info"})
	input.Attributes.(*node.InputAttributes).Pattern = "[0-9]{6}"
	input.Attributes.(*node.InputAttributes).Autocomplete = node.InputAttributeAutocompleteOneTimeCode
	f.UI.Nodes.Append(input)
	for _, action := range []struct{ value, label string }{{"confirm", "Confirm email change"}, {"resend", "Send a new code"}, {"cancel", "Cancel email change"}} {
		f.UI.Nodes.Append(node.NewInputField("email_change_action", action.value, node.ProfileGroup, node.InputAttributeTypeSubmit).
			WithMetaLabel(&text.Message{ID: 4900203, Text: action.label, Type: "info"}))
	}
}

// Called after native CSRF/trait validation, before the identity is handed to
// the settings persistence hooks. The only successful path consumes a code
// bound to this flow, identity, old email and exact new email.
func (s *Strategy) heynaijaConfirmEmail(ctx context.Context, w http.ResponseWriter, r *http.Request, uc *settings.UpdateContext, current, updated *identity.Identity, p updateSettingsFlowWithProfileMethod) (bool, error) {
	oldEmail := heynaijaNormalizeEmail(gjson.GetBytes(current.Traits, "email").String())
	target := heynaijaNormalizeEmail(gjson.GetBytes(updated.Traits, "email").String())
	pending := gjson.GetBytes(uc.Flow.InternalContext, heynaijaPendingEmailKey).Exists()
	if oldEmail == target && !pending && p.EmailChangeAction == "" && p.EmailChangeCode == "" {
		return false, nil
	}
	if !uc.Session.AuthenticatedAt.Add(s.d.Config().SelfServiceFlowSettingsPrivilegedSessionMaxAge(ctx)).After(time.Now()) {
		return false, settings.NewFlowNeedsReAuth()
	}
	// Native reauthentication resumes the original, CSRF-checked POST through
	// an identity-bound encrypted continuity cookie on a GET callback.
	if r.Method != http.MethodPost && !p.heynaijaResumed {
		return false, errors.New("email changes require POST")
	}
	store, ok := s.d.SettingsFlowPersister().(heynaijaEmailStore)
	if !ok {
		return false, errors.New("email confirmation storage is unavailable")
	}
	accepted := false
	err := store.WithHeyNaijaEmailFlow(ctx, uc.Flow.ID, current.ID, func(ctx context.Context, f *settings.Flow, lastSent time.Time) error {
		fresh := f.Identity
		var err error
		if err := heynaijaEmailChange(fresh, updated.Traits); err != nil {
			return err
		}
		f.Identity = fresh
		if err := f.Valid(uc.Session); err != nil {
			return err
		}
		f.UI = uc.Flow.UI
		f.UI.SetCSRF(s.d.GenerateCSRFToken(r))
		var challenge heynaijaEmailChallenge
		if raw := gjson.GetBytes(f.InternalContext, heynaijaPendingEmailKey); raw.Exists() {
			if err := json.Unmarshal([]byte(raw.Raw), &challenge); err != nil {
				return err
			}
		}
		if p.EmailChangeAction == "cancel" {
			f.InternalContext, err = sjson.DeleteBytes(f.InternalContext, heynaijaPendingEmailKey)
			if err != nil {
				return err
			}
			f.UI.Nodes.Remove(heynaijaEmailCodeField, "email_change_action", "method")
			if err := s.PopulateSettingsMethod(ctx, r, fresh, f); err != nil {
				return err
			}
			heynaijaEmailMessage(f, "Email change cancelled. Your current email address is unchanged.", false)
		} else if p.EmailChangeCode != "" && p.EmailChangeAction != "resend" {
			heynaijaEmailUI(f, target)
			challenge.Attempts++
			limit := s.d.Config().SelfServiceCodeMethodMaxSubmissions(ctx)
			switch {
			case challenge.Attempts > limit:
				heynaijaEmailMessage(f, "Too many code attempts. Cancel this change and start again. Your current email is still active.", true)
			case !challenge.validFor(fresh, target, time.Now().UTC()):
				heynaijaEmailMessage(f, "This code has expired or does not match this email change. Request a new code. Your current email is still active.", true)
			case !store.HeyNaijaEmailCodeMatches(ctx, challenge.payload(f.ID, strings.TrimSpace(p.EmailChangeCode)), challenge.MAC):
				heynaijaEmailMessage(f, "That code is not correct. Your current email address is unchanged.", true)
			default:
				challenge.Used = true
				accepted = true
			}
			f.InternalContext, err = sjson.SetBytes(f.InternalContext, heynaijaPendingEmailKey, challenge)
			if err != nil {
				return err
			}
		} else {
			if oldEmail == target {
				heynaijaEmailMessage(f, "Enter the new email address you want to confirm, or cancel this change.", true)
			} else if lastSent.Add(time.Minute).After(time.Now()) {
				heynaijaEmailMessage(f, "Please wait a minute before requesting another email code. Your current email is still active.", true)
			} else {
				if oldEmail != heynaijaNormalizeEmail(gjson.GetBytes(fresh.Traits, "email").String()) {
					return errors.New("your email changed in another flow; reload Settings")
				}
				now := time.Now().UTC()
				previous := challenge
				raw := code.GenerateCode()
				for previous.MAC != "" && store.HeyNaijaEmailCodeMatches(ctx, previous.payload(f.ID, raw), previous.MAC) {
					raw = code.GenerateCode()
				}
				challenge = heynaijaEmailChallenge{IdentityID: fresh.ID, Original: oldEmail, Target: target, Nonce: x.NewUUID().String(), Attempts: challenge.Attempts, Expires: now.Add(s.d.Config().SelfServiceCodeMethodLifespan(ctx))}
				challenge.MAC = store.HeyNaijaEmailCodeHash(ctx, challenge.payload(f.ID, raw))
				f.InternalContext, err = sjson.SetBytes(f.InternalContext, heynaijaPendingEmailKey, challenge)
				if err != nil {
					return err
				}
				f.InternalContext, err = sjson.SetBytes(f.InternalContext, "heynaija_email_sent_at", now.Format(time.RFC3339Nano))
				if err != nil {
					return err
				}
				delivery, ok := s.d.(interface {
					courier.Provider
					template.Dependencies
				})
				if !ok {
					return errors.New("email delivery is unavailable")
				}
				outbox, err := delivery.Courier(ctx)
				if err != nil {
					return err
				}
				_, err = outbox.QueueEmail(ctx, email.NewVerificationCodeValid(delivery, &email.VerificationCodeValidModel{To: target, VerificationCode: raw, VerificationURL: f.AppendTo(s.d.Config().SelfServiceFlowSettingsUI(ctx)).String(), ExpiresInMinutes: int(s.d.Config().SelfServiceCodeMethodLifespan(ctx).Minutes()), Identity: map[string]interface{}{"id": fresh.ID.String()}}))
				if err != nil {
					return err
				}
				heynaijaEmailMessage(f, fmt.Sprintf("We sent a code to %s. Your current email, %s, stays active until you confirm the change.", target, oldEmail), false)
			}
			heynaijaEmailUI(f, target)
		}
		uc.Flow = f
		return nil
	})
	if err != nil {
		return false, err
	}
	if accepted {
		// The address is only marked verified after its bound challenge succeeds.
		for n := range updated.VerifiableAddresses {
			address := &updated.VerifiableAddresses[n]
			if heynaijaNormalizeEmail(address.Value) == target {
				address.Verified = true
				at := sqlxx.NullTime(time.Now().UTC())
				address.VerifiedAt = &at
				address.Status = identity.VerifiableAddressStatusCompleted
			}
		}
		return true, nil
	}
	x.SendFlowCompletedAsRedirectOrJSON(w, r, s.d.Writer(), uc.Flow, uc.Flow.AppendTo(s.d.Config().SelfServiceFlowSettingsUI(ctx)).String())
	return false, errors.WithStack(flow.ErrCompletedByStrategy)
}
