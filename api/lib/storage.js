// Blob path namespacing per Vercel environment (26 Nov 2026).
//
// Problem: preview deployments share the project's Blob store with
// production, so a write test on a preview URL could pollute production
// data (and a preview reader would see production theses / NAV history).
//
// Rule: production keeps the historical paths unchanged, so existing data
// never moves. Every other environment gets its own prefix, so preview
// and development can never read or write production paths:
//
//   production  -> stocklens/theses.json
//   preview     -> stocklens/preview/theses.json
//   development -> stocklens/development/theses.json
//
// `VERCEL_ENV` is set by Vercel on every deployment ('production' |
// 'preview' | 'development'); locally it is unset, which intentionally
// maps to 'development' so local runs cannot touch production either.

export function blobEnv() {
  return process.env.VERCEL_ENV || 'development'
}

export function blobPath(path) {
  const env = blobEnv()
  if (env === 'production') return path
  const suffix = path.startsWith('stocklens/') ? path.slice('stocklens/'.length) : path
  return `stocklens/${env}/${suffix}`
}
