// Copyright HeyNaija contributors. SPDX-License-Identifier: Apache-2.0
// Added to the pinned Kratos code package by infra/kratos/Dockerfile.

package code

import (
	"fmt"
	"os"
	"regexp"
	"strings"
)

// The app stores' reviewers sign in to one account (docs/deployment/store-review.md),
// and cannot read an inbox. For that account's address, HEYNAIJA_REVIEW_EMAIL, the
// sign-in and signup code is HEYNAIJA_REVIEW_CODE instead of a random one, and no
// email is sent. Both are secrets: the address is unlisted, so guessing the pair is
// guessing a password. Unset, or either one unusable, every address gets a random
// code, as upstream.
var heynaijaReviewCodePattern = regexp.MustCompile(fmt.Sprintf("^[0-9]{%d}$", CodeLength))

// heynaijaReviewCode is the code to send to address, and whether it is the review
// account's fixed one.
func heynaijaReviewCode(address string) (string, bool) {
	email := strings.TrimSpace(os.Getenv("HEYNAIJA_REVIEW_EMAIL"))
	code := strings.TrimSpace(os.Getenv("HEYNAIJA_REVIEW_CODE"))
	if email == "" || !heynaijaUsableReviewCode(code) || !strings.EqualFold(strings.TrimSpace(address), email) {
		return GenerateCode(), false
	}
	return code, true
}

// Six digits, and not one anyone would try first: one digit repeated, or a run up or down.
func heynaijaUsableReviewCode(code string) bool {
	if !heynaijaReviewCodePattern.MatchString(code) {
		return false
	}
	same, up, down := true, true, true
	for i := 1; i < len(code); i++ {
		step := int(code[i]) - int(code[i-1])
		same = same && step == 0
		up = up && (step == 1 || step == -9)
		down = down && (step == -1 || step == 9)
	}
	return !same && !up && !down
}
