// Package license gates this build: seven days from the first run, then an
// offline activation code signed by the publisher and bound to the machine.
//
// The code is "KESTREL1.<payload>.<signature>": base64url of a small JSON
// payload and of an ed25519 signature over "KESTREL1.<payload>". The
// signature is checked here, with the public key below; the private half is
// the publisher's and is not in this repository, so this build can make no
// codes of its own. The trial start and the code are one small file in the
// config folder. A copy of the repository can, of course, patch any of this
// out: the gate is a product decision, not a cryptographic lock on the
// source.
package license

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/kestrel-app/kestrel/internal/appdir"
)

// TrialDays is how long this build runs before it asks for a code.
const TrialDays = 7

// publicKey is the publisher's ed25519 public key, base64. The matching
// private key signs the activation codes and never ships.
const publicKey = "XZf4Pv8HO9UrCEJa/CWbmhgExM9MGpRo+wu40CY+1Zw="

// keyPrefix is in every code, and in what is signed.
const keyPrefix = "KESTREL1"

var (
	mu       sync.Mutex
	keyOnce  sync.Once
	keyBytes ed25519.PublicKey
	keyErr   error

	machineOnce sync.Once
	machineVal  string
)

// State is what the page draws and the API answers.
type State struct {
	// Status is "trial", "active" or "expired".
	Status string `json:"status"`
	// DaysLeft is the whole days of trial left, 0 outside a trial.
	DaysLeft int `json:"daysLeft,omitempty"`
	// Machine is the code an activation code must be issued for.
	Machine string `json:"machine"`
	// LicensedTo and Expires describe an active code; Expires is empty for
	// a perpetual one.
	LicensedTo string `json:"licensedTo,omitempty"`
	Expires    string `json:"expires,omitempty"`
	// Reason is why an expired copy is expired: "trial" or "license".
	Reason string `json:"reason,omitempty"`
}

// record is what the config folder keeps.
type record struct {
	Machine    string `json:"machine"`
	TrialStart int64  `json:"trialStart"`
	Key        string `json:"key,omitempty"`
}

// payload is what a code carries.
type payload struct {
	Machine string `json:"m"`
	Name    string `json:"n,omitempty"`
	Issued  int64  `json:"i"`
	Expires int64  `json:"e,omitempty"` // 0: perpetual
}

// Check reports the current state, starting the trial on first run.
func Check() State {
	mu.Lock()
	defer mu.Unlock()
	return checkLocked()
}

func checkLocked() State {
	m := machineCode()
	r := load()
	if r.Machine != m {
		// a record copied from another machine: the trial starts here
		r = record{Machine: m}
	}
	if r.TrialStart == 0 {
		r.TrialStart = time.Now().Unix()
		_ = save(r)
	}
	if p, ok := parseKey(r.Key, time.Now()); ok && p.Machine == m {
		return State{Status: "active", Machine: m, LicensedTo: p.Name, Expires: expiry(p)}
	}
	if left := trialDaysLeft(r.TrialStart, time.Now()); left > 0 {
		return State{Status: "trial", DaysLeft: left, Machine: m}
	}
	reason := "trial"
	if strings.TrimSpace(r.Key) != "" {
		reason = "license"
	}
	return State{Status: "expired", Machine: m, Reason: reason}
}

// Activate takes an activation code, checks it for this machine, and keeps
// it. The returned state is active unless the code was already expired,
// which is an error.
func Activate(code string) (State, error) {
	mu.Lock()
	defer mu.Unlock()
	code = strings.TrimSpace(code)
	if code == "" {
		return State{}, errors.New("enter an activation code")
	}
	p, signed := parseSigned(code)
	if !signed {
		return State{}, errors.New("invalid activation code")
	}
	if p.Expires != 0 && !time.Unix(p.Expires, 0).After(time.Now()) {
		return State{}, errors.New("this activation code has expired")
	}
	m := machineCode()
	if p.Machine != m {
		return State{}, errors.New("this activation code was issued for a different machine")
	}
	r := load()
	r.Machine = m
	if r.TrialStart == 0 {
		r.TrialStart = time.Now().Unix()
	}
	r.Key = code
	if err := save(r); err != nil {
		return State{}, fmt.Errorf("could not save the activation code: %w", err)
	}
	return State{Status: "active", Machine: m, LicensedTo: p.Name, Expires: expiry(p)}, nil
}

// parseKey verifies a code's signature and expiry. ok is false for anything
// malformed, forged or expired.
func parseKey(code string, now time.Time) (payload, bool) {
	p, ok := parseSigned(code)
	if !ok || (p.Expires != 0 && !time.Unix(p.Expires, 0).After(now)) {
		return payload{}, false
	}
	return p, true
}

// parseSigned verifies a code's signature and shape, expiry apart.
func parseSigned(code string) (payload, bool) {
	parts := strings.Split(strings.TrimSpace(code), ".")
	if len(parts) != 3 || parts[0] != keyPrefix {
		return payload{}, false
	}
	pub, err := public()
	if err != nil {
		return payload{}, false
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(sig) != ed25519.SignatureSize {
		return payload{}, false
	}
	if !ed25519.Verify(pub, []byte(keyPrefix+"."+parts[1]), sig) {
		return payload{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return payload{}, false
	}
	var p payload
	if json.Unmarshal(raw, &p) != nil {
		return payload{}, false
	}
	m, ok := normalizeMachine(p.Machine)
	if !ok {
		return payload{}, false
	}
	p.Machine = m
	return p, true
}

func public() (ed25519.PublicKey, error) {
	keyOnce.Do(func() {
		keyBytes, keyErr = base64.StdEncoding.DecodeString(publicKey)
		if keyErr == nil && len(keyBytes) != ed25519.PublicKeySize {
			keyErr = errors.New("activation public key is not ed25519")
		}
	})
	return keyBytes, keyErr
}

// machineCode is this machine's code: the first 16 hex digits of a hash of
// the Windows MachineGuid (or the host name elsewhere), in four groups.
func machineCode() string {
	machineOnce.Do(func() {
		sum := sha256.Sum256([]byte("kestrel-machine:" + machineSource()))
		h := strings.ToUpper(hex.EncodeToString(sum[:8]))
		machineVal = h[0:4] + "-" + h[4:8] + "-" + h[8:12] + "-" + h[12:16]
	})
	return machineVal
}

func normalizeMachine(s string) (string, bool) {
	h := strings.ToUpper(strings.NewReplacer("-", "", " ", "", "\t", "").Replace(strings.TrimSpace(s)))
	if len(h) != 16 {
		return "", false
	}
	if _, err := hex.DecodeString(h); err != nil {
		return "", false
	}
	return h[0:4] + "-" + h[4:8] + "-" + h[8:12] + "-" + h[12:16], true
}

func trialDaysLeft(start int64, now time.Time) int {
	end := time.Unix(start, 0).Add(TrialDays * 24 * time.Hour)
	left := end.Sub(now)
	if left <= 0 {
		return 0
	}
	return int((left + 24*time.Hour - 1) / (24 * time.Hour))
}

func expiry(p payload) string {
	if p.Expires == 0 {
		return ""
	}
	return time.Unix(p.Expires, 0).Format("2006-01-02")
}

func path() string { return filepath.Join(appdir.Config(), "license.json") }

func load() record {
	b, err := os.ReadFile(path())
	if err != nil {
		return record{}
	}
	var r record
	if json.Unmarshal(b, &r) != nil {
		return record{}
	}
	return r
}

func save(r record) error {
	if err := os.MkdirAll(appdir.Config(), 0o755); err != nil {
		return err
	}
	b, err := json.Marshal(r)
	if err != nil {
		return err
	}
	return os.WriteFile(path(), append(b, '\n'), 0o644)
}
