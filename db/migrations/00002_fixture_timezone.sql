-- +goose Up
ALTER TABLE development.sample_clubs
    ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/Minsk'
    CHECK (timezone = 'Europe/Minsk');

-- +goose Down
ALTER TABLE development.sample_clubs DROP COLUMN timezone;
