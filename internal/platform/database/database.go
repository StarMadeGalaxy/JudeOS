package database

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/StarMadeGalaxy/JudeOS/db/migrations"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func Open(url string) (*sql.DB, error) {
	db, err := sql.Open("pgx", url)
	if err != nil {
		return nil, fmt.Errorf("invalid database configuration")
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	return db, nil
}

func Migrate(ctx context.Context, db *sql.DB, target int64) error {
	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations.Files)
	if err != nil {
		return err
	}
	_, err = provider.UpTo(ctx, target)
	return err
}

func Ready(ctx context.Context, db *sql.DB) error {
	var version int64
	// Reading the migration table also verifies connectivity; no schema is created by API startup.
	err := db.QueryRowContext(ctx, "SELECT version_id FROM goose_db_version WHERE is_applied ORDER BY id DESC LIMIT 1").Scan(&version)
	if err != nil {
		return err
	}
	if version != migrations.Version {
		return fmt.Errorf("schema version is not supported")
	}
	return nil
}

func Seed(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT INTO development.sample_clubs (id, name, timezone) VALUES
	('00000000-0000-4000-8000-000000000101', 'Синтетический клуб А', 'Europe/Minsk'),
	('00000000-0000-4000-8000-000000000102', 'Синтетический клуб Б', 'Europe/Minsk')
	ON CONFLICT (id) DO NOTHING`); err != nil {
		return err
	}
	return tx.Commit()
}
