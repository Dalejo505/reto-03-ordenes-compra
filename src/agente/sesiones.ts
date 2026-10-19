import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { escribirArchivo, rutas } from "../oc/archivos"
import type { MensajeLLM } from "../llm/adapter"

/** Llamada a herramienta tal como se muestra en el chat. */
export type LlamadaVisible = {
  nombre: string
  argumentos: unknown
  ok: boolean
  resumen: string
  resultado: unknown
}

/** Entrada del historial visible (lo que ve la analista). */
export type EntradaHistorial =
  | { tipo: "usuario"; texto: string; ts: string }
  | { tipo: "agente"; texto: string; llamadas: LlamadaVisible[]; necesitaConfirmacion: boolean; ts: string }

export type Sesion = {
  id: string
  creada: string
  /** Conversación con el modelo (incluye resultados de herramientas). */
  mensajes: MensajeLLM[]
  historial: EntradaHistorial[]
  tokensUsados: number
  /** Casos con confirmación pendiente pedida en el turno anterior (CA3). */
  pendientes: string[]
}

const ID_VALIDO = /^[a-zA-Z0-9_-]{6,64}$/
const memoria = new Map<string, Sesion>()

export function idValido(id: string): boolean {
  return ID_VALIDO.test(id)
}

function ruta(raiz: string, id: string): string {
  return join(rutas.out(raiz), "sesiones", `${id}.json`)
}

export async function obtenerSesion(raiz: string, id: string): Promise<Sesion> {
  const enMemoria = memoria.get(id)
  if (enMemoria) return enMemoria
  const archivo = ruta(raiz, id)
  const sesion: Sesion = existsSync(archivo)
    ? (JSON.parse(await readFile(archivo, "utf8")) as Sesion)
    : { id, creada: new Date().toISOString(), mensajes: [], historial: [], tokensUsados: 0, pendientes: [] }
  memoria.set(id, sesion)
  return sesion
}

export async function buscarSesion(raiz: string, id: string): Promise<Sesion | null> {
  if (memoria.has(id) || existsSync(ruta(raiz, id))) return obtenerSesion(raiz, id)
  return null
}

export async function guardarSesion(raiz: string, sesion: Sesion): Promise<void> {
  await escribirArchivo(ruta(raiz, sesion.id), JSON.stringify(sesion, null, 2))
}
