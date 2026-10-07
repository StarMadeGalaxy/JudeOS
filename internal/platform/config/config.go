package config

import (
	"errors"
	"net"
	"os"
)

type Config struct {
	DatabaseURL string
	HTTPAddr    string
	WebDir      string
	APIDir      string
}

func Load() (Config, error) {
	c := Config{DatabaseURL: os.Getenv("DATABASE_URL"), HTTPAddr: value("HTTP_ADDR", "127.0.0.1:8080"), WebDir: value("WEB_DIR", "apps/web/dist"), APIDir: value("API_DIR", "api/dist")}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
	if _, _, err := net.SplitHostPort(c.HTTPAddr); err != nil {
		return c, errors.New("HTTP_ADDR must be host:port")
	}
	return c, nil
}

func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
