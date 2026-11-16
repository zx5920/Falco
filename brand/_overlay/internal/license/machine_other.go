//go:build !windows

package license

import "os"

// machineSource stands in elsewhere: this build is Windows-only, but the
// package still compiles for the tests of other machines.
func machineSource() string {
	h, _ := os.Hostname()
	return h
}
