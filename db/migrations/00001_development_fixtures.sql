-- +goose Up
-- Development fixtures are deliberately separate from the future tenant schema (#20).
CREATE SCHEMA development;
CREATE TABLE development.sample_clubs (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120)
);

-- +goose Down
DROP SCHEMA development CASCADE;
