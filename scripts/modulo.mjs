// Genera modulo/agent.md y modulo/skill/ordenes-compra/SKILL.md a partir de las mismas
// fuentes que usa la aplicación (agent/prompt.md y src/knowledge/ordenes-compra.md).
//   node scripts/modulo.mjs          → regenera los archivos
//   node scripts/modulo.mjs --check  → falla si están desactualizados (lo usa `npm run build`)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (ruta) => readFileSync(join(raiz, ruta), "utf8").replace(/\r\n/g, "\n").trim()
const aviso = (fuente) => `<!-- Generado por scripts/modulo.mjs desde ${fuente}. No editar a mano: edita la fuente y ejecuta \`npm run modulo\`. -->`

const salidas = {
  "modulo/agent.md": [
    "---",
    "description: Prepara, valida (RC1–RC10) y crea órdenes de compra en SAP a partir del paquete de una solicitud; pide confirmación humana ante excepciones.",
    "mode: primary",
    "permission:",
    "  edit: deny",
    "  bash: deny",
    "---",
    aviso("agent/prompt.md"),
    "",
    leer("agent/prompt.md"),
    "",
    "Antes de procesar una solicitud, carga la skill `ordenes-compra` para conocer el proceso y la matriz de controles.",
    "",
  ].join("\n"),
  "modulo/skill/ordenes-compra/SKILL.md": [
    "---",
    "name: ordenes-compra",
    "description: Proceso de órdenes de compra de Periferia IT Group — controles RC1–RC10, bloqueos vs confirmaciones, derivados, OC retroactivas, idempotencia y qué pedir al solicitante. Úsala al procesar o explicar una solicitud de compra.",
    "---",
    aviso("src/knowledge/ordenes-compra.md"),
    "",
    "# Órdenes de compra SAP",
    "",
    leer("src/knowledge/ordenes-compra.md"),
    "",
  ].join("\n"),
}

const verificar = process.argv.includes("--check")
const desactualizados = []
for (const [ruta, contenido] of Object.entries(salidas)) {
  const destino = join(raiz, ruta)
  const actual = existsSync(destino) ? readFileSync(destino, "utf8").replace(/\r\n/g, "\n") : null
  if (actual === contenido) continue
  if (verificar) {
    desactualizados.push(ruta)
  } else {
    mkdirSync(dirname(destino), { recursive: true })
    writeFileSync(destino, contenido)
    console.log(`generado ${ruta}`)
  }
}

if (desactualizados.length) {
  console.error(`modulo/ no coincide con las fuentes de la app: ${desactualizados.join(", ")}. Ejecuta: npm run modulo`)
  process.exit(1)
}
if (verificar) console.log("modulo/ está sincronizado con agent/prompt.md y src/knowledge/")
