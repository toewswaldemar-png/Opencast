//go:build windows

package api

import (
	"context"
	"net/http"

	"opencast/internal/auth"
)

type ctxKey string

const ctxUser ctxKey = "user"

// WithAuth returns a middleware that enforces authentication via the given Authenticator.
// Unauthenticated requests receive 401 JSON. Swap the Authenticator implementation
// to switch from token-based to session-based auth without changing any route handler.
func WithAuth(a auth.Authenticator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, err := a.Validate(r)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			ctx := context.WithValue(r.Context(), ctxUser, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// CurrentUser returns the authenticated user stored in the request context.
func CurrentUser(r *http.Request) *auth.User {
	u, _ := r.Context().Value(ctxUser).(*auth.User)
	return u
}
