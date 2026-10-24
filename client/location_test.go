package main

import "testing"

func TestExtractCountryKeepsWholeNames(t *testing.T) {
	cases := map[string]string{
		"":                               "",
		"US":                             "US",
		"de":                             "DE",
		"Hong Kong":                      "Hong Kong",
		"United States":                  "United States",
		"Los Angeles, CA, United States": "United States",
		"Frankfurt, DE (Hetzner)":        "DE",
		"Tokyo, Japan 100-0001":          "Japan",
		"Germany,":                       "Germany",
	}
	for in, want := range cases {
		if got := extractCountry(in); got != want {
			t.Errorf("extractCountry(%q) = %q, want %q", in, got, want)
		}
	}
}
