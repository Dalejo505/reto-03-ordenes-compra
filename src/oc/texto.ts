/** Minúsculas, sin tildes ni puntuación: "TecnoSuministros S.A.S." → "tecnosuministros s a s" */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** NIT sin puntos ni dígito de verificación: "900.555.111-2" → "900555111" */
export function normalizarNit(nit: string): string {
  return nit.split("-")[0]!.replace(/\D/g, "")
}

/** Monto en formato colombiano: "11.400.000" → 11400000, "1.234,50" → 1234.5 */
export function parsearMonto(texto: string): number | null {
  const limpio = texto.trim().replace(/\./g, "").replace(",", ".")
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null
  return Number(limpio)
}

/** Parte de fecha de un ISO con hora: "2026-08-21T10:02:00-05:00" → "2026-08-21" */
export function soloFecha(fecha: string): string {
  return fecha.slice(0, 10)
}

export function sumarDias(fechaIso: string, dias: number): string {
  const d = new Date(`${fechaIso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function formatoCop(valor: number): string {
  return valor.toLocaleString("es-CO", { maximumFractionDigits: 2 })
}
