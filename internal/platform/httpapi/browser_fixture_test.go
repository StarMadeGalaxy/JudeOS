package httpapi_test

import (
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/StarMadeGalaxy/JudeOS/internal/access"
	"github.com/StarMadeGalaxy/JudeOS/internal/people"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/database"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/httpapi"
)

// Opt-in fixture for an actual browser -> HTTPS API -> PostgreSQL flow. It uses
// only JUDEOS_TEST_* credentials and an explicit private test certificate dir.
// No API startup provisioning, production URL or working volume is involved.
func TestRegistryBrowserFixture(t *testing.T) {
	dir := os.Getenv("JUDEOS_BROWSER_FIXTURE_DIR")
	if dir == "" {
		t.Skip("opt-in disposable HTTPS browser fixture")
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	migrator, e := database.Open(os.Getenv("JUDEOS_TEST_MIGRATION_URL"))
	if e != nil {
		t.Fatal("test database")
	}
	defer migrator.Close()
	runtime, e := database.Open(os.Getenv("JUDEOS_TEST_RUNTIME_URL"))
	if e != nil {
		t.Fatal("test runtime")
	}
	defer runtime.Close()
	tenant := people.UUID()
	e = database.WithinTenant(ctx, migrator, database.TenantContext{TenantID: tenant, ActorID: "00000000-0000-4000-8000-000000000301", RequestID: "00000000000000000000000000000027"}, func(tx *sql.Tx) error {
		_, e := tx.ExecContext(ctx, `INSERT INTO core.clubs(tenant_id,name) VALUES($1,'Синтетический браузерный клуб')`, tenant)
		return e
	})
	if e != nil {
		t.Fatal("club fixture", e)
	}
	login := "synthetic.browser." + people.UUID()
	link, e := access.BootstrapOwner(ctx, migrator, tenant, login)
	if e != nil {
		t.Fatal("owner fixture", e)
	}
	cert, e := tls.LoadX509KeyPair(filepath.Join(dir, "server.crt"), filepath.Join(dir, "server.key"))
	if e != nil {
		t.Fatal("test certificate")
	}
	root, e := filepath.Abs("../../..")
	if e != nil {
		t.Fatal(e)
	}
	opts := httpapi.Options{Access: access.New(runtime), WebDir: filepath.Join(root, "apps/web/dist"), APIDir: filepath.Join(root, "api/dist"), Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Ready: func(ctx context.Context) error { return database.ReadyRuntime(ctx, runtime) }}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { httpapi.New(opts).ServeHTTP(w, r) }))
	server.TLS = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	defer server.Close()
	opts.Origin = server.URL
	var platformLogin string
	if e = migrator.QueryRowContext(ctx, `SELECT a.login FROM organization.platform_administrators p JOIN access.accounts a ON a.id=p.account_id WHERE p.active AND a.password_hash IS NOT NULL ORDER BY a.id LIMIT 1`).Scan(&platformLogin); e != nil {
		t.Fatal("synthetic platform fixture", e)
	}
	data, _ := json.Marshal(map[string]any{"origin": server.URL, "tenant": tenant, "login": login, "link": link, "platform_login": platformLogin})
	if e = os.WriteFile(filepath.Join(dir, "fixture.json"), data, 0600); e != nil {
		t.Fatal("private fixture file")
	}
	t.Log("synthetic browser fixture ready")
	<-ctx.Done()
}
