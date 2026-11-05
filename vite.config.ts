import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Strict Content-Security-Policy for the packaged app. Applied at build time only, because the
// dev server needs inline scripts and a websocket for hot reload.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const cspPlugin = (): Plugin => ({
  name: 'ledgerly-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${csp}" />`)
  }
})

export default defineConfig({
  base: './',
  plugins: [react(), cspPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: false,
    chunkSizeWarningLimit: 2000
  },
  server: { port: 5173, strictPort: true, host: '127.0.0.1' }
})
