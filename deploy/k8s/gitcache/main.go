package main

import (
	"log"
	"net/http"
	"net/http/cgi"
	"os"
	"path/filepath"
)

func main() {
	root := os.Getenv("GIT_PROJECT_ROOT")
	if root == "" {
		log.Fatal("GIT_PROJECT_ROOT is required")
	}
	backend := os.Getenv("GIT_HTTP_BACKEND")
	if backend == "" {
		backend = "/usr/libexec/git-core/git-http-backend"
	}
	if _, err := os.Stat(backend); err != nil {
		log.Fatalf("git HTTP backend %q: %v", backend, err)
	}
	handler := &cgi.Handler{
		Path: backend,
		Args: []string{filepath.Base(backend)},
		Env:  []string{"GIT_PROJECT_ROOT=" + root, "GIT_HTTP_EXPORT_ALL=1"},
	}
	addr := ":" + env("PORT", "9418")
	log.Printf("station Git cache serving %s on %s", root, addr)
	log.Fatal(http.ListenAndServe(addr, handler))
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
