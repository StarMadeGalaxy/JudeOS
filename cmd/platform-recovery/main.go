// Operator-only recovery prints one bearer secret once; never log its output.
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
	login := flag.String("login", "", "existing platform administrator login")
	ref := flag.String("operator-ref", "", "symbolic verification procedure reference; no personal data")
	verified := flag.Bool("identity-verified", false, "confirm the recipient was verified outside the program")
	flag.Parse()
	db, e := database.Open(os.Getenv("MIGRATION_DATABASE_URL"))
	if e != nil {
		fail()
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	v, e := access.OperatorRecovery(ctx, db, *login, *ref, *verified)
	if e != nil {
		fail()
	}
	if e = json.NewEncoder(os.Stdout).Encode(v); e != nil {
		fail()
	}
}
func fail() { fmt.Fprintln(os.Stderr, "platform recovery rejected"); os.Exit(1) }
