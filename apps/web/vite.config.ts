import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    strictPort: true,
    proxy: Object.fromEntries(['/api', '/healthz', '/readyz', '/docs', '/openapi.json'].map(path => [path, 'http://127.0.0.1:8080']))
  }
});
