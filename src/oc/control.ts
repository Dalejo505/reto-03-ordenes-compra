import { existsSync } from "node:fs"
import { join } from "node:path"
import { agregarLinea, rutas } from "./archivos"

export type ResultadoControl = "creada" | "idempotente" | "bloqueada" | "pendiente_confirmacion" | "rechazada"

export type FilaControl = {
  solicitud_id: string
  resultado: ResultadoControl
  numero_oc: string | null
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
}

const ENCABEZADO = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts"

/** Una fila por intento de crear OC en out/control.csv (consumido por contabilidad y auditoría). */
export async function registrarControl(raiz: string, fila: FilaControl): Promise<void> {
  const ruta = join(rutas.out(raiz), "control.csv")
  if (!existsSync(ruta)) await agregarLinea(ruta, ENCABEZADO)
  const celdas = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    fila.bloqueos.join(";"),
    fila.confirmaciones.join(";"),
    new Date().toISOString(),
  ]
  await agregarLinea(ruta, celdas.map(csv).join(","))
}

function csv(valor: string): string {
  return /[",\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}
