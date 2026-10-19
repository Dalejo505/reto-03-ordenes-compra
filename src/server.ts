// Servidor local (y para Render u otro host con proceso persistente).
import "./env"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { crearManejador, proveedor } from "./app"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const PUERTO = Number(process.env.PORT) || 3000

createServer(crearManejador(RAIZ)).listen(PUERTO, () => {
  console.log(`Agente de órdenes de compra en http://localhost:${PUERTO} · ${proveedor.nombre}/${proveedor.modelo}`)
  if (!process.env.ANTHROPIC_API_KEY) console.warn("Aviso: ANTHROPIC_API_KEY no está definida; el chat responderá con un error claro.")
})
