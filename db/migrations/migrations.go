// Package migrations contains the versioned, transactional scaffold schema.
package migrations

import "embed"

//go:embed *.sql
var Files embed.FS

const Version int64 = 8
