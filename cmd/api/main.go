package main

import (
	"context"
	"encoding/json"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/StarMadeGalaxy/JudeOS/internal/platform/config"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/database"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/httpapi"
)

func main() {
	routes := flag.Bool("routes", false, "print chi routes as JSON without connecting to a database")
	flag.Parse()
	if *routes {
		paths, err := httpapi.Routes(httpapi.New(httpapi.Options{}))
		if err != nil {
			os.Exit(1)
		}
		_ = json.NewEncoder(os.Stdout).Encode(paths)
		return
	}
	c, err := config.Load()
	if err != nil {
		slog.Error(err.Error())
		os.Exit(1)
	}
	db, err := database.Open(c.DatabaseURL)
	if err != nil {
		slog.Error("database configuration is invalid")
		os.Exit(1)
	}
	defer db.Close()
	r := httpapi.New(httpapi.Options{Ready: func(ctx context.Context) error { return database.ReadyRuntime(ctx, db) }, WebDir: c.WebDir, APIDir: c.APIDir})
	server := &http.Server{Addr: c.HTTPAddr, Handler: r, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	slog.Info("API listening", "address", c.HTTPAddr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("HTTP server failed")
		os.Exit(1)
	}
	// ListenAndServe returns as soon as shutdown begins. Keep the process and DB
	// alive until existing handlers finish or the shutdown deadline expires.
	<-shutdownDone
}
