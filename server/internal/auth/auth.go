package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
)

type User struct {
	Role string
}

type Authenticator interface {
	Validate(r *http.Request) (*User, error)
}

var ErrUnauthorized = errors.New("unauthorized")

func GenerateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

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

func extractToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return r.URL.Query().Get("token")
}
