package config

import (
	"errors"
	"net"
	"net/url"
	"os"
)

type Config struct {
	Origin      string
	DatabaseURL string
	HTTPAddr    string
	WebDir      string
	APIDir      string
}

func Load() (Config, error) {
	c := Config{Origin: os.Getenv("PUBLIC_ORIGIN"), DatabaseURL: os.Getenv("DATABASE_URL"), HTTPAddr: value("HTTP_ADDR", "127.0.0.1:8080"), WebDir: value("WEB_DIR", "apps/web/dist"), APIDir: value("API_DIR", "api/dist")}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
	if _, _, err := net.SplitHostPort(c.HTTPAddr); err != nil {
		return c, errors.New("HTTP_ADDR must be host:port")
	}
	if c.Origin != "" {
		u, e := url.Parse(c.Origin)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return c, errors.New("PUBLIC_ORIGIN must be an HTTPS origin without path")
		}
	}
	return c, nil
}

func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
