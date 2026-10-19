import { existsSync } from "node:fs"
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { z } from "zod"

/** Rutas siempre relativas a la raíz del proyecto (ctx.directory). */
export const rutas = {
  fixtures: (raiz: string) => join(raiz, "fixtures", "reto-03"),
  solicitudes: (raiz: string) => join(raiz, "fixtures", "reto-03", "solicitudes"),
  caso: (raiz: string, caso: string) => join(raiz, "fixtures", "reto-03", "solicitudes", caso),
  maestro: (raiz: string, nombre: string) => join(raiz, "fixtures", "reto-03", "maestros", `${nombre}.json`),
  out: (raiz: string) => join(raiz, "out"),
  outCaso: (raiz: string, caso: string) => join(raiz, "out", caso),
}

/** Error esperado de negocio: su mensaje se muestra tal cual al usuario. */
export class ErrorNegocio extends Error {}

const NOMBRE_CASO = /^[a-z0-9][a-z0-9-]{0,63}$/i

export function validarNombreCaso(caso: string): void {
  if (!NOMBRE_CASO.test(caso)) {
    throw new ErrorNegocio(`Nombre de caso inválido: "${caso}". Usa el nombre de la carpeta, por ejemplo "sol-001".`)
  }
}

export async function listarCasos(raiz: string): Promise<string[]> {
  const dir = rutas.solicitudes(raiz)
  if (!existsSync(dir)) return []
  const entradas = await readdir(dir, { withFileTypes: true })
  return entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort()
}

export async function leerTextoOpcional(ruta: string): Promise<string | null> {
  if (!existsSync(ruta)) return null
  return readFile(ruta, "utf8")
}

export async function leerJson<T>(ruta: string, schema: z.ZodType<T>, etiqueta: string): Promise<T> {
  const texto = await readFile(ruta, "utf8")
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    throw new ErrorNegocio(`${etiqueta} no es un JSON válido.`)
  }
  const r = schema.safeParse(crudo)
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")
    throw new ErrorNegocio(`${etiqueta} tiene datos inválidos: ${detalle}`)
  }
  return r.data
}

export async function escribirArchivo(ruta: string, contenido: string | Uint8Array): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true })
  await writeFile(ruta, contenido)
}

export async function agregarLinea(ruta: string, linea: string): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true })
  await appendFile(ruta, linea.endsWith("\n") ? linea : `${linea}\n`)
}

/** Ruta relativa con "/" para mostrar al usuario sin exponer rutas absolutas. */
export function relativa(raiz: string, ruta: string): string {
  return ruta.slice(raiz.length).replace(/^[\\/]+/, "").replace(/\\/g, "/")
}
