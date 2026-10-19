import "./env"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { procesarTurno } from "./agente/ciclo"
import { crearProveedor, LIMITES } from "./agente/config"
import { buscarSesion, idValido } from "./agente/sesiones"
import { listarCasos } from "./oc/archivos"
import { leerPaquete } from "./oc/paquete"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const WEB = join(RAIZ, "web", "dist")
const PUERTO = Number(process.env.PORT) || 3000
const CLAVE_ACCESO = process.env.ACCESS_KEY || ""
const proveedor = crearProveedor()

const CuerpoChat = z.object({
  sessionId: z.string().refine(idValido, "sessionId inválido"),
  message: z.string().trim().min(1, "El mensaje está vacío").max(4000, "El mensaje es demasiado largo"),
})

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
}

function json(res: ServerResponse, estado: number, cuerpo: unknown): void {
  res.writeHead(estado, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(cuerpo))
}

async function leerCuerpo(req: IncomingMessage): Promise<unknown> {
  let datos = ""
  for await (const trozo of req) {
    datos += trozo
    if (datos.length > 64_000) throw new Error("cuerpo demasiado grande")
  }
  return JSON.parse(datos || "{}")
}

function autorizado(req: IncomingMessage): boolean {
  return !CLAVE_ACCESO || req.headers["x-access-key"] === CLAVE_ACCESO
}

async function chat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let crudo: unknown
  try {
    crudo = await leerCuerpo(req)
  } catch {
    return json(res, 400, { error: "El cuerpo debe ser JSON válido." })
  }
  const cuerpo = CuerpoChat.safeParse(crudo)
  if (!cuerpo.success) return json(res, 400, { error: cuerpo.error.issues.map((i) => i.message).join("; ") })
  const r = await procesarTurno(RAIZ, proveedor, cuerpo.data.sessionId, cuerpo.data.message)
  json(res, 200, r)
}

/** Sirve el front compilado (web/dist). Rutas desconocidas sin extensión devuelven index.html. */
async function estatico(ruta: string, res: ServerResponse): Promise<void> {
  let archivo = normalize(join(WEB, ruta === "/" ? "index.html" : decodeURIComponent(ruta)))
  if (!archivo.startsWith(WEB)) return json(res, 404, { error: "No encontrado" })
  if (!existsSync(archivo) && !extname(archivo)) archivo = join(WEB, "index.html")
  if (!existsSync(archivo)) {
    if (!existsSync(join(WEB, "index.html"))) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" })
      return void res.end("El front no está compilado. Ejecuta: npm run build")
    }
    return json(res, 404, { error: "No encontrado" })
  }
  const inmutable = archivo.includes(`${join(WEB, "assets")}`)
  res.writeHead(200, {
    "content-type": TIPOS[extname(archivo)] ?? "application/octet-stream",
    "cache-control": inmutable ? "public, max-age=31536000, immutable" : "no-cache",
  })
  res.end(await readFile(archivo))
}

/** Resumen de las solicitudes del buzón para el panel lateral (no usa el modelo). */
async function casos(res: ServerResponse): Promise<void> {
  const lista = await Promise.all(
    (await listarCasos(RAIZ)).map(async (caso) => {
      try {
        const p = await leerPaquete(RAIZ, caso)
        const s = p.solicitud
        return [{ caso, solicitud_id: s.solicitud_id, descripcion: s.descripcion, proveedor: s.proveedor_nombre, valor_total: s.valor_total, moneda: s.moneda, centro_costo: s.centro_costo, tiene_factura: p.factura !== null }]
      } catch {
        return []
      }
    }),
  )
  json(res, 200, { casos: lista.flat() })
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost")
  try {
    if (url.pathname === "/api/health" && req.method === "GET") {
      return json(res, 200, { ok: true, provider: proveedor.nombre, model: proveedor.modelo, accessKey: Boolean(CLAVE_ACCESO), limites: LIMITES })
    }
    if (url.pathname.startsWith("/api/") && !autorizado(req)) return json(res, 401, { error: "Clave de acceso inválida." })
    if (url.pathname === "/api/chat" && req.method === "POST") return await chat(req, res)
    if (url.pathname === "/api/casos" && req.method === "GET") return await casos(res)
    const sesion = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname)
    if (sesion?.[1] && req.method === "GET") {
      const id = decodeURIComponent(sesion[1])
      const s = idValido(id) ? await buscarSesion(RAIZ, id) : null
      return s ? json(res, 200, { id: s.id, creada: s.creada, tokensUsados: s.tokensUsados, historial: s.historial }) : json(res, 404, { error: "Sesión no encontrada" })
    }
    if (req.method === "GET") return await estatico(url.pathname, res)
    json(res, 404, { error: "No encontrado" })
  } catch (e) {
    console.error(`[${req.method} ${url.pathname}]`, e instanceof Error ? e.message : e)
    if (!res.headersSent) json(res, 500, { error: "Error interno del servidor." })
  }
})

servidor.listen(PUERTO, () => {
  console.log(`Agente de órdenes de compra en http://localhost:${PUERTO} · ${proveedor.nombre}/${proveedor.modelo}`)
  if (!process.env.ANTHROPIC_API_KEY) console.warn("Aviso: ANTHROPIC_API_KEY no está definida; el chat responderá con un error claro.")
})
