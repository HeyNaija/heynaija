// Copyright HeyNaija contributors. SPDX-License-Identifier: Apache-2.0
package code

import (
	"regexp"
	"testing"
)

var randomCode = regexp.MustCompile(`^[0-9]{6}$`)

func TestHeyNaijaReviewCodeIsOffUntilSet(t *testing.T) {
	t.Setenv("HEYNAIJA_REVIEW_EMAIL", "")
	t.Setenv("HEYNAIJA_REVIEW_CODE", "")
	code, review := heynaijaReviewCode("review-k7q2xm9f@heynaija.ng")
	if review || !randomCode.MatchString(code) {
		t.Fatalf("got %q, %v; want a random code", code, review)
	}
}

func TestHeyNaijaReviewCodeIsOnlyForTheReviewAddress(t *testing.T) {
	t.Setenv("HEYNAIJA_REVIEW_EMAIL", "review-k7q2xm9f@heynaija.ng")
	t.Setenv("HEYNAIJA_REVIEW_CODE", "482917")

	for _, address := range []string{"review-k7q2xm9f@heynaija.ng", " Review-K7Q2XM9F@HeyNaija.ng "} {
		if code, review := heynaijaReviewCode(address); code != "482917" || !review {
			t.Errorf("%q: got %q, %v; want the fixed code", address, code, review)
		}
	}
	for _, address := range []string{"ada@example.com", "review@heynaija.ng", "review-k7q2xm9f@heynaija.ng.evil.test", ""} {
		code, review := heynaijaReviewCode(address)
		if review || !randomCode.MatchString(code) {
			t.Errorf("%q: got %q, %v; want a random code", address, code, review)
		}
	}
}

func TestHeyNaijaReviewCodeRefusesAnUnusableCode(t *testing.T) {
	t.Setenv("HEYNAIJA_REVIEW_EMAIL", "review-k7q2xm9f@heynaija.ng")
	for _, bad := range []string{"", "48291", "4829170", "48a917", "111111", "000000", "123456", "654321", "890123", "321098"} {
		t.Setenv("HEYNAIJA_REVIEW_CODE", bad)
		if code, review := heynaijaReviewCode("review-k7q2xm9f@heynaija.ng"); review || code == bad {
			t.Errorf("%q: got %q, %v; want a random code", bad, code, review)
		}
	}
}
