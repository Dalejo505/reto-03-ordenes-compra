// Verificación sin modelo: procesa los 6 casos llamando directamente a las herramientas.
// Uso: npm run demo   (o: bun run demo.ts)
import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { rutas } from "./src/oc/archivos"
import * as oc from "./src/tools/oc"

const raiz = fileURLToPath(new URL(".", import.meta.url))
const ctx = { directory: raiz, sessionId: "demo" }

type Respuesta = { ok: true; data: Record<string, unknown> } | { ok: false; error: string }
type Hallazgo = { codigo: string; detalle: string }

async function llamar(h: { execute(a: unknown, c: typeof ctx): Promise<string> }, args: Record<string, unknown>): Promise<Respuesta> {
  return JSON.parse(await h.execute(args, ctx)) as Respuesta
}

function codigos(lista: unknown): string {
  const l = lista as Hallazgo[]
  return l.length ? l.map((h) => h.codigo).join(", ") : "—"
}

async function procesar(caso: string, confirmado?: boolean): Promise<void> {
  const etiqueta = confirmado ? `${caso} (con confirmado=true)` : caso
  console.log(`\n■ ${etiqueta}`)
  const paquete = await llamar(oc.leer_paquete, { caso })
  if (!paquete.ok) return console.log(`  error al leer: ${paquete.error}`)

  const v = await llamar(oc.validar, { caso })
  if (!v.ok) return console.log(`  error al validar: ${v.error}`)
  console.log(`  apta: ${v.data.apta}   retroactiva: ${v.data.retroactiva}`)
  const controles = v.data.controles as { codigo: string; estado: string }[]
  console.log(`  controles: ${controles.map((c) => `${c.codigo}=${c.estado}`).join(" ")}`)
  console.log(`  bloqueos: ${codigos(v.data.bloqueos)}`)
  for (const b of v.data.bloqueos as Hallazgo[]) console.log(`    · ${b.codigo}: ${b.detalle}`)
  console.log(`  confirmaciones: ${codigos(v.data.confirmaciones)}`)
  for (const c of v.data.confirmaciones as Hallazgo[]) console.log(`    · ${c.codigo}: ${c.detalle}`)
  const derivados = Object.entries(v.data.derivados as Record<string, { valor: string }>)
  if (derivados.length) console.log(`  derivados: ${derivados.map(([k, d]) => `${k}=${d.valor}`).join(", ")}`)

  const payload = await llamar(oc.construir_payload, { caso })
  const ev = await llamar(oc.generar_evidencia, { caso })
  if (ev.ok) console.log(`  evidencia: ${ev.data.ruta} (sha256 ${String(ev.data.sha256).slice(0, 12)}…)`)

  // Si no hay payload (bloqueo) se intenta igual, para que el intento quede en out/control.csv.
  const r = await llamar(oc.crear, { caso, payload: payload.ok ? payload.data.payload : undefined, confirmado })
  if (r.ok) {
    console.log(`  → OC ${r.data.numero_oc}${r.data.idempotente ? " (idempotente: ya existía)" : ""}`)
  } else if (!payload.ok) {
    console.log(`  → sin OC: ${payload.error}`)
  } else {
    console.log(`  → sin OC: ${r.error}`)
  }
}

async function main(): Promise<void> {
  await rm(rutas.out(raiz), { recursive: true, force: true })
  console.log("Reto 03 · Órdenes de compra SAP · demo sin modelo")

  console.log("\n=== Primera pasada: los 6 casos sin confirmar ===")
  for (const caso of ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]) await procesar(caso)

  console.log("\n=== Idempotencia: sol-001 por segunda vez ===")
  await procesar("sol-001")

  console.log("\n=== Confirmaciones explícitas del usuario ===")
  await procesar("sol-004", true)
  await procesar("sol-005", true)

  console.log("\nArchivos: out/sap/ordenes.jsonl, out/control.csv, out/log.jsonl, out/<caso>/")
}

main().catch((e: unknown) => {
  console.error("La demo falló:", e instanceof Error ? e.message : e)
  process.exitCode = 1
})
