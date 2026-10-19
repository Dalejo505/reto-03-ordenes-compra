import { z } from "zod"
import type { Herramienta } from "./base"
import * as oc from "./oc"

/** Registro de herramientas: el nombre que ve el modelo es `<archivo>_<export>`. */
export const herramientas: Record<string, Herramienta> = Object.fromEntries(
  Object.entries(oc).map(([nombre, h]) => [`oc_${nombre}`, h as Herramienta]),
)

export type DefinicionHerramienta = { nombre: string; descripcion: string; esquema: Record<string, unknown> }

/** Definiciones en JSON Schema para el proveedor LLM. */
export function definicionesHerramientas(): DefinicionHerramienta[] {
  return Object.entries(herramientas).map(([nombre, h]) => ({
    nombre,
    descripcion: h.description,
    esquema: z.toJSONSchema(z.object(h.args), { io: "input" }) as Record<string, unknown>,
  }))
}
