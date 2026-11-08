# The app stores' review account

Google Play and Apple review every release of the apps, and both need to sign
in. HeyNaija has no passwords: it emails a code, and a reviewer cannot read our
inbox. So production has one **review account** whose sign-in code is fixed and
never emailed. Our Kratos build does this ([policy README](../../infra/kratos/policy/README.md));
everyone else's codes are random, as always.

The address and the code are both secrets. HeyNaija never shows members'
addresses, so an attacker would have to guess both, which makes the pair as hard
as a good password. Each sign-in attempt still allows only five tries, and the
code works once per sign-in and runs out after 15 minutes.

## Set it up (once per server)

1. Make an address and a code. The code must be six digits, and not one digit
   repeated or a straight run (`123456`); Kratos ignores those.

   ```bash
   echo "review-$(openssl rand -hex 4)@heynaija.ng"
   ```

   ```bash
   printf '%06d\n' "$(( $(od -An -N4 -tu4 /dev/urandom) % 1000000 ))"
   ```

2. As `heynaija`, add both to `/srv/heynaija/infra/deploy/.env`, and keep them in
   the password manager:

   ```text
   HEYNAIJA_REVIEW_EMAIL=review-1a2b3c4d@heynaija.ng
   HEYNAIJA_REVIEW_CODE=482917
   ```

   Deploy again (or `./deploy.sh <current commit>`) so Kratos starts with them.

3. Make the account, in the app or on the web: **Join with an invite**, tick
   **I am 18 or older** (or, while signup asks for one, a date of birth that makes
   it an adult), the handle `heynaija_review` (or similar), and the review address.
   No email comes: type the fixed code. Finish the welcome steps and follow a few
   communities, so the reviewers see a feed rather than an empty screen.

It is an ordinary member account, with no moderator rights. What reviewers post
is public, like anyone's; it shows under that handle.

## What to give the stores

**Google Play**: Play Console → App content → **App access** → All or some
functionality is restricted → Add instructions:

- Username: the review address
- Password: leave empty, or "none"
- Any other information: "HeyNaija has no passwords. Tap Sign in, enter the
  address above, tap Email me a code, then enter `<code>`. The code is fixed for
  this account, so no email is needed."

**Apple**: App Store Connect → the version → **App Review Information** → Sign-in
required: the address as the user name, the code as the password, and the same
words in the notes.

## Afterwards

Change the code (and, if it may have been seen elsewhere, the address) after a
review, in `.env` and in both stores' forms, then deploy. To turn it off, delete
both lines and deploy: the account then signs in like any other, by emailed code
to an inbox nobody reads, so it is effectively closed.
