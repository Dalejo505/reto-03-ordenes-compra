// Manejador HTTP de la app (API + front compilado). Lo usan el servidor local (server.ts)
// y la función serverless de Vercel (vercel.ts).
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { extname, join, normalize } from "node:path"
import { z } from "zod"
import { procesarTurno } from "./agente/ciclo"
import { crearProveedor, LIMITES } from "./agente/config"
import { consumir, ipDe } from "./agente/limite"
import { buscarSesion, idValido } from "./agente/sesiones"
import { listarCasos } from "./oc/archivos"
import { leerPaquete } from "./oc/paquete"

export type Manejador = (req: IncomingMessage, res: ServerResponse) => Promise<void>

const CLAVE_ACCESO = process.env.ACCESS_KEY || ""
export const proveedor = crearProveedor()

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
  // En Vercel el cuerpo puede venir ya leído en req.body.
  const previo = (req as IncomingMessage & { body?: unknown }).body
  if (previo !== undefined) return typeof previo === "string" ? JSON.parse(previo || "{}") : previo
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

async function chat(raiz: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let crudo: unknown
  try {
    crudo = await leerCuerpo(req)
  } catch {
    return json(res, 400, { error: "El cuerpo debe ser JSON válido." })
  }
  const cuerpo = CuerpoChat.safeParse(crudo)
  if (!cuerpo.success) return json(res, 400, { error: cuerpo.error.issues.map((i) => i.message).join("; ") })
  const espera = consumir(ipDe(req), LIMITES.maxMensajesPorHoraIp)
  if (espera !== null) {
    return json(res, 429, { error: `Alcanzaste el límite de ${LIMITES.maxMensajesPorHoraIp} mensajes por hora. Intenta de nuevo en ${espera} min.` })
  }
  json(res, 200, await procesarTurno(raiz, proveedor, cuerpo.data.sessionId, cuerpo.data.message))
}

/** Resumen de las solicitudes del buzón para el panel lateral (no usa el modelo). */
async function casos(raiz: string, res: ServerResponse): Promise<void> {
  const lista = await Promise.all(
    (await listarCasos(raiz)).map(async (caso) => {
      try {
        const { solicitud: s, factura } = await leerPaquete(raiz, caso)
        return [{ caso, solicitud_id: s.solicitud_id, descripcion: s.descripcion, proveedor: s.proveedor_nombre, valor_total: s.valor_total, moneda: s.moneda, centro_costo: s.centro_costo, tiene_factura: factura !== null }]
      } catch {
        return []
      }
    }),
  )
  json(res, 200, { casos: lista.flat() })
}

/** Sirve el front compilado (web/dist). Rutas desconocidas sin extensión devuelven index.html. */
async function estatico(web: string, ruta: string, res: ServerResponse): Promise<void> {
  let archivo = normalize(join(web, ruta === "/" ? "index.html" : decodeURIComponent(ruta)))
  if (!archivo.startsWith(web)) return json(res, 404, { error: "No encontrado" })
  if (!existsSync(archivo) && !extname(archivo)) archivo = join(web, "index.html")
  if (!existsSync(archivo)) {
    if (!existsSync(join(web, "index.html"))) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" })
      return void res.end("El front no está compilado. Ejecuta: npm run build")
    }
    return json(res, 404, { error: "No encontrado" })
  }
  const inmutable = archivo.startsWith(join(web, "assets"))
  res.writeHead(200, {
    "content-type": TIPOS[extname(archivo)] ?? "application/octet-stream",
    "cache-control": inmutable ? "public, max-age=31536000, immutable" : "no-cache",
  })
  res.end(await readFile(archivo))
}

/** `raiz` es la raíz del proyecto (donde están fixtures/, agent/ y web/dist). */
export function crearManejador(raiz: string): Manejador {
  const web = join(raiz, "web", "dist")
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    try {
      if (url.pathname === "/api/health" && req.method === "GET") {
        return json(res, 200, { ok: true, provider: proveedor.nombre, model: proveedor.modelo, accessKey: Boolean(CLAVE_ACCESO), limites: LIMITES })
      }
      if (url.pathname.startsWith("/api/") && !autorizado(req)) return json(res, 401, { error: "Clave de acceso inválida." })
      if (url.pathname === "/api/chat" && req.method === "POST") return await chat(raiz, req, res)
      if (url.pathname === "/api/casos" && req.method === "GET") return await casos(raiz, res)
      const sesion = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname)
      if (sesion?.[1] && req.method === "GET") {
        const id = decodeURIComponent(sesion[1])
        const s = idValido(id) ? await buscarSesion(raiz, id) : null
        return s ? json(res, 200, { id: s.id, creada: s.creada, tokensUsados: s.tokensUsados, historial: s.historial }) : json(res, 404, { error: "Sesión no encontrada" })
      }
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) return await estatico(web, url.pathname, res)
      json(res, 404, { error: "No encontrado" })
    } catch (e) {
      console.error(`[${req.method} ${url.pathname}]`, e instanceof Error ? e.message : e)
      if (!res.headersSent) json(res, 500, { error: "Error interno del servidor." })
    }
  }
}
