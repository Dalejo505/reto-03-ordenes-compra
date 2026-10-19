// Límite de mensajes de chat por IP (ventana fija de una hora).
// Con el link público, evita que alguien gaste la clave del modelo sin control
// abriendo sesiones nuevas una tras otra.
import type { IncomingMessage } from "node:http"

const VENTANA_MS = 60 * 60 * 1000
const contadores = new Map<string, { inicio: number; usados: number }>()

export function ipDe(req: IncomingMessage): string {
  const reenviada = req.headers["x-forwarded-for"]
  const primera = (Array.isArray(reenviada) ? reenviada[0] : reenviada)?.split(",")[0]?.trim()
  return primera || req.socket.remoteAddress || "desconocida"
}

/** Devuelve los minutos que faltan si la IP superó el límite, o null si puede seguir. */
export function consumir(ip: string, maximo: number, ahora = Date.now()): number | null {
  const c = contadores.get(ip)
  if (!c || ahora - c.inicio >= VENTANA_MS) {
    contadores.set(ip, { inicio: ahora, usados: 1 })
    return null
  }
  if (c.usados >= maximo) return Math.ceil((c.inicio + VENTANA_MS - ahora) / 60_000)
  c.usados++
  return null
}
