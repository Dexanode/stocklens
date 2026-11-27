import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only so local browser checks can read the same /api/market handler
// Vercel serves in production. It does not run during `vite build`.
function devMarketApi() {
  return {
    name: 'stocklens-dev-market-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ''
        if (!url.startsWith('/api/market')) return next()
        try {
          const mod = await server.ssrLoadModule('/api/market.js')
          let finished = false
          const response = {
            statusCode: 200,
            headers: {},
            status(code) { this.statusCode = code; return this },
            setHeader(key, value) { this.headers[key] = value; return this },
            json(body) {
              if (finished) return
              finished = true
              res.statusCode = this.statusCode
              res.setHeader('content-type', 'application/json; charset=utf-8')
              for (const [key, value] of Object.entries(this.headers)) res.setHeader(key, value)
              res.end(JSON.stringify(body))
            },
          }
          await mod.default({ headers: req.headers, method: req.method, url }, response)
          if (!finished) next()
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devMarketApi()],
  server: {
    port: 5174,
    strictPort: true,
  },
})
