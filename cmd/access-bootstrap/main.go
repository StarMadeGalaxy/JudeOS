// Explicit synthetic operator bootstrap: outputs one invite secret once.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/StarMadeGalaxy/JudeOS/internal/access"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/database"
	"os"
	"time"
)

func main() {
	tenant := flag.String("tenant", "", "synthetic club UUID")
	login := flag.String("login", "", "synthetic staff login")
	flag.Parse()
	db, e := database.Open(os.Getenv("MIGRATION_DATABASE_URL"))
	if e != nil {
		fail()
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	v, e := access.BootstrapOwner(ctx, db, *tenant, *login)
	if e != nil {
		fail()
	}
	json.NewEncoder(os.Stdout).Encode(v)
}
func fail() { fmt.Fprintln(os.Stderr, "owner bootstrap rejected"); os.Exit(1) }
