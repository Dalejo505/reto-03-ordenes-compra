// Función serverless de Vercel. El manejador real se genera en el build
// (scripts/build-api.mjs empaqueta src/vercel.ts en api/_lib/manejador.mjs).
export { default } from "./_lib/manejador.mjs"
