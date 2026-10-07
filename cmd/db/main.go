package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"time"

	"github.com/StarMadeGalaxy/JudeOS/db/migrations"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/database"
)

func main() {
	target := flag.Int64("to", migrations.Version, "migration target version (up only)")
	flag.Parse()
	if flag.NArg() != 1 || (flag.Arg(0) != "bootstrap-local" && flag.Arg(0) != "migrate" && flag.Arg(0) != "seed-synthetic") || *target < 1 || *target > migrations.Version {
		slog.Error("usage: db [-to VERSION] bootstrap-local | migrate | seed-synthetic")
		os.Exit(1)
	}
	url := os.Getenv("MIGRATION_DATABASE_URL")
	if flag.Arg(0) == "bootstrap-local" {
		url = os.Getenv("BOOTSTRAP_DATABASE_URL")
	}
	if url == "" {
		slog.Error("database command configuration is required")
		os.Exit(1)
	}
	db, err := database.Open(url)
	if err != nil {
		slog.Error("database configuration is invalid")
		os.Exit(1)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if flag.Arg(0) == "bootstrap-local" {
		err = database.Bootstrap(ctx, db, os.Getenv("MIGRATION_PASSWORD"), os.Getenv("RUNTIME_PASSWORD"))
	} else if flag.Arg(0) == "migrate" {
		err = database.Migrate(ctx, db, *target)
	} else if err = database.Ready(ctx, db); err == nil {
		err = database.Seed(ctx, db)
	}
	// Driver errors can contain connection strings. Do not log raw errors or credentials.
	if err != nil {
		slog.Error("database operation failed", "command", flag.Arg(0))
		os.Exit(1)
	}
	slog.Info("database operation completed", "command", flag.Arg(0))
}
