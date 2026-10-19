// Cliente de la API del agente. Tipos espejo de src/agente/sesiones.ts y src/server.ts.

export type LlamadaVisible = {
  nombre: string
  argumentos: unknown
  ok: boolean
  resumen: string
  resultado: unknown
}

export type EntradaHistorial =
  | { tipo: "usuario"; texto: string; ts: string }
  | { tipo: "agente"; texto: string; llamadas: LlamadaVisible[]; necesitaConfirmacion: boolean; ts: string; error?: boolean }

export type RespuestaChat = { reply: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean }

export type Salud = { ok: boolean; provider: string; model: string; accessKey: boolean }

export type ResumenCaso = {
  caso: string
  solicitud_id: string
  descripcion: string
  proveedor: string
  valor_total: number
  moneda: string
  centro_costo: string
  tiene_factura: boolean
}

const leer = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const guardar = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    // sin almacenamiento disponible
  }
}

let claveAcceso = leer("oc.accessKey") ?? ""

export function idSesionGuardado(): string {
  return leer("oc.sessionId") ?? nuevaSesion()
}

export function nuevaSesion(): string {
  const id = crypto.randomUUID().replace(/[^a-zA-Z0-9-]/g, "")
  guardar("oc.sessionId", id)
  return id
}

export class ErrorApi extends Error {}

async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  const headers = { "content-type": "application/json", ...(claveAcceso ? { "x-access-key": claveAcceso } : {}) }
  let r: Response
  try {
    r = await fetch(ruta, { ...init, headers })
  } catch {
    throw new ErrorApi("No hay conexión con el servidor. Intenta de nuevo.")
  }
  if (r.status === 401) {
    claveAcceso = window.prompt("Este agente está protegido. Ingresa la clave de acceso:") ?? ""
    guardar("oc.accessKey", claveAcceso)
    if (claveAcceso) return pedir(ruta, init)
  }
  const datos = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) throw new ErrorApi(datos.error ?? `Error ${r.status}`)
  return datos
}

export const api = {
  salud: () => pedir<Salud>("/api/health"),
  casos: () => pedir<{ casos: ResumenCaso[] }>("/api/casos").then((r) => r.casos),
  historial: (id: string) => pedir<{ historial: EntradaHistorial[] }>(`/api/sessions/${encodeURIComponent(id)}`).then((r) => r.historial),
  chat: (sessionId: string, message: string) =>
    pedir<RespuestaChat>("/api/chat", { method: "POST", body: JSON.stringify({ sessionId, message }) }),
}
