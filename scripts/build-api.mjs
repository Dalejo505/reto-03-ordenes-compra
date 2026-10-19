// Empaqueta la API en un solo módulo ESM para la función serverless de Vercel (api/index.mjs).
import { build } from "esbuild"

await build({
  entryPoints: ["src/vercel.ts"],
  outfile: "api/_lib/manejador.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Algunas dependencias usan require(); en ESM hay que proveerlo.
  banner: { js: "import { createRequire as __crearRequire } from 'node:module'; const require = __crearRequire(import.meta.url);" },
  logLevel: "info",
})
