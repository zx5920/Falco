//go:build windows

package license

import (
	"os"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// machineSource is the Windows MachineGuid: the same value on every launch,
// and different on a cloned folder, so a copied code is no longer this
// machine's. The host name stands in where the key cannot be read.
func machineSource() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Cryptography`, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err == nil {
		defer k.Close()
		if v, _, err := k.GetStringValue("MachineGuid"); err == nil && strings.TrimSpace(v) != "" {
			return v
		}
	}
	h, _ := os.Hostname()
	return h
}
