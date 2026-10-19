import { join } from "node:path"
import { z } from "zod"
import { agregarLinea, ErrorNegocio, rutas } from "../oc/archivos"

/**
 * Contexto que recibe cada herramienta. `sessionId` es el de esta app; `sessionID` es como lo
 * entregan plataformas de agentes como OpenCode al usar el módulo reutilizable (modulo/).
 */
export type ContextoHerramienta = { directory: string; sessionId?: string; sessionID?: string }

export function sesionDe(ctx: ContextoHerramienta): string {
  return ctx.sessionId ?? ctx.sessionID ?? "sin-sesion"
}

type Forma = Record<string, z.ZodType>
export type ArgsDe<S extends Forma> = z.output<z.ZodObject<S>>

/** Lo que la lógica de una herramienta devuelve cuando todo sale bien. */
export type Exito<T> = { data: T; resumen: string; caso?: string }

export type Herramienta<S extends Forma = Forma> = {
  description: string
  args: S
  execute(args: unknown, ctx: ContextoHerramienta): Promise<string>
}

/**
 * Envuelve la lógica de una herramienta: valida argumentos con zod, nunca lanza,
 * devuelve JSON `{ ok, data }` o `{ ok: false, error }` y deja traza en out/log.jsonl.
 */
export function definirHerramienta<S extends Forma, T>(
  nombre: string,
  description: string,
  args: S,
  logica: (args: ArgsDe<S>, ctx: ContextoHerramienta) => Promise<Exito<T>>,
): Herramienta<S> {
  const esquema = z.object(args)
  return {
    description,
    args,
    async execute(crudos, ctx) {
      const caso = casoDe(crudos)
      const parseo = esquema.safeParse(crudos ?? {})
      if (!parseo.success) {
        const error = `Argumentos inválidos: ${parseo.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")}`
        await registrar(ctx, nombre, caso, false, error)
        return JSON.stringify({ ok: false, error })
      }
      try {
        const r = await logica(parseo.data, ctx)
        await registrar(ctx, nombre, r.caso ?? caso, true, r.resumen)
        return JSON.stringify({ ok: true, data: r.data })
      } catch (e) {
        const error = mensajeLegible(nombre, e)
        await registrar(ctx, nombre, caso, false, error)
        return JSON.stringify({ ok: false, error })
      }
    },
  }
}

function mensajeLegible(nombre: string, e: unknown): string {
  if (e instanceof ErrorNegocio) return e.message
  if (e instanceof z.ZodError) return `Datos inválidos: ${e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
  const detalle = e instanceof Error ? e.message : String(e)
  return `Error inesperado en ${nombre}: ${detalle}`
}

function casoDe(crudos: unknown): string | null {
  if (crudos && typeof crudos === "object" && "caso" in crudos && typeof crudos.caso === "string") return crudos.caso
  return null
}

async function registrar(ctx: ContextoHerramienta, herramienta: string, caso: string | null, ok: boolean, resumen: string) {
  const linea = { ts: new Date().toISOString(), sesion: sesionDe(ctx), herramienta, caso, ok, resumen }
  try {
    await agregarLinea(join(rutas.out(ctx.directory), "log.jsonl"), JSON.stringify(linea))
  } catch {
    // El log nunca debe tumbar la herramienta.
  }
}
