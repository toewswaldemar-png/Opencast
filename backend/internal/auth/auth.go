package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
)

// User represents an authenticated principal.
// Role is "admin" for now — extended when session auth is added later.
type User struct {
	Role string
}

// Authenticator validates an incoming request and returns the authenticated user.
// Swap the implementation (TokenAuth → SessionAuth) without touching any route handler.
type Authenticator interface {
	Validate(r *http.Request) (*User, error)
}

var ErrUnauthorized = errors.New("unauthorized")

// GenerateToken creates a cryptographically random URL-safe token (32 bytes, base64url).
func GenerateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// TokenAuth implements Authenticator using a single static bearer token.
// Replace with SessionAuth for multi-user support.
type TokenAuth struct {
	token string
}

func NewTokenAuth(token string) Authenticator {
	return &TokenAuth{token: token}
}

func (a *TokenAuth) Validate(r *http.Request) (*User, error) {
	if tok := extractToken(r); tok != "" && tok == a.token {
		return &User{Role: "admin"}, nil
	}
	return nil, ErrUnauthorized
}

// extractToken reads the token from Authorization: Bearer <token>
// or the ?token= query parameter (used for WebSocket connections).
func extractToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return r.URL.Query().Get("token")
}
