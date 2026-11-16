package gui

import (
	"encoding/json"
	"net/http"

	"github.com/kestrel-app/kestrel/internal/license"
)

// licenseRoutes serves the activation gate: what the page draws, and the
// code it takes. Kept apart from api.go so the brand layer can add it with
// two lines in the mux rather than a patch to a large file.
func licenseRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/license", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Cache-Control", "no-store")
		writeJSON(rw, license.Check())
	})
	mux.HandleFunc("POST /api/license/activate", func(rw http.ResponseWriter, r *http.Request) {
		var in struct {
			Key string `json:"key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			fail(rw, err)
			return
		}
		st, err := license.Activate(in.Key)
		if err != nil {
			fail(rw, err)
			return
		}
		rw.Header().Set("Cache-Control", "no-store")
		writeJSON(rw, st)
	})
}
