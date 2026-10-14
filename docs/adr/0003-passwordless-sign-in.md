# ADR 0003 — No passwords: emailed codes and Google

**Date:** 14 October 2026 · **Status:** Accepted · **Amends:** ADR 0002 (account
pages, password change and recovery)

## Decision

Members sign up and sign in with a one-time code that Kratos emails them, or with
Google. Kratos's password method is switched off, and with it password recovery:
signing in with a code already gets someone back into their account. Signup stays
invite-only for both methods, through the same registration webhooks.

## Why

- Nothing to forget, reuse or leak: most account takeovers start with a reused
  password, and most support requests start with a forgotten one.
- Most members will already be signed in to Google on their phone, so joining is a
  tap. The emailed code covers everyone else.
- One way back into an account (the email inbox) instead of two (password and
  recovery email) is less to secure.

## Consequences

- Access to the email account is access to the HeyNaija account. That was already
  true through password recovery.
- Every sign-in by code sends an email, so Resend's volume and deliverability
  matter more. Codes last 15 minutes.
- Google sign-in needs an OAuth client per environment and the consent screen
  published: [google-sign-in.md](../deployment/google-sign-in.md).
- Accounts created with a password need a one-off re-save so they can receive
  codes (same document, "Existing accounts").
- Removed: `/recovery`, "Forgot your password?", and the password section of
  Settings. Added: **Connected accounts** in Settings.
