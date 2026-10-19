// Ciclo del agente: prompt → modelo → herramientas → respuesta, con tope de iteraciones,
// presupuesto de tokens y la regla de confirmación humana (CA3) aplicada en el servidor.
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ErrorLLM, type BloqueResultado, type MensajeLLM, type ProveedorLLM } from "../llm/adapter"
import { agregarLinea, rutas } from "../oc/archivos"
import { definicionesHerramientas, herramientas } from "../tools"
import { LIMITES } from "./config"
import { guardarSesion, obtenerSesion, type LlamadaVisible, type Sesion } from "./sesiones"

export type ResultadoTurno = { reply: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean }

type RespuestaHerramienta = { ok: true; data: unknown } | { ok: false; error: string }

let sistemaCache: string | null = null

/** System prompt = comportamiento (agent/prompt.md) + conocimiento (src/knowledge/). */
async function sistema(raiz: string): Promise<string> {
  if (sistemaCache) return sistemaCache
  const [prompt, conocimiento] = await Promise.all([
    readFile(join(raiz, "agent", "prompt.md"), "utf8"),
    readFile(join(raiz, "src", "knowledge", "ordenes-compra.md"), "utf8"),
  ])
  sistemaCache = `${prompt}\n\n---\n\n# Conocimiento del proceso\n\n${conocimiento}`
  return sistemaCache
}

const colas = new Map<string, Promise<unknown>>()

/** Ejecuta un turno; los turnos de una misma sesión se serializan. */
export function procesarTurno(raiz: string, proveedor: ProveedorLLM, sesionId: string, texto: string): Promise<ResultadoTurno> {
  const previo = colas.get(sesionId) ?? Promise.resolve()
  const tarea = previo.then(() => turno(raiz, proveedor, sesionId, texto))
  colas.set(sesionId, tarea.catch(() => undefined))
  return tarea
}

async function turno(raiz: string, proveedor: ProveedorLLM, sesionId: string, texto: string): Promise<ResultadoTurno> {
  const sesion = await obtenerSesion(raiz, sesionId)
  const confirmaAhora = esConfirmacion(texto)
  const pendientesPrevios = new Set(sesion.pendientes)
  const pendientesNuevos = new Set<string>()
  const llamadas: LlamadaVisible[] = []

  sesion.historial.push({ tipo: "usuario", texto, ts: new Date().toISOString() })
  sesion.mensajes.push({ rol: "usuario", bloques: [{ tipo: "texto", texto }] })

  let reply = ""
  try {
    reply = await bucle(raiz, proveedor, sesion, llamadas, (nombre, args) => autorizar(nombre, args, confirmaAhora, pendientesPrevios), (nombre, args, r) => actualizarPendientes(nombre, args, r, pendientesNuevos))
  } catch (e) {
    reply = e instanceof ErrorLLM ? `No pude completar la respuesta: ${e.message}` : "Ocurrió un error inesperado en el agente. La sesión sigue activa; intenta de nuevo."
    // Deja la conversación en un estado válido para el siguiente turno.
    cerrarLlamadasHuerfanas(sesion.mensajes)
  }

  sesion.pendientes = [...pendientesNuevos]
  const needsConfirmation = pendientesNuevos.size > 0
  sesion.historial.push({ tipo: "agente", texto: reply, llamadas, necesitaConfirmacion: needsConfirmation, ts: new Date().toISOString() })
  await guardarSesion(raiz, sesion)
  return { reply, toolCalls: llamadas, needsConfirmation }
}

type Autorizador = (nombre: string, args: unknown) => string | null
type Observador = (nombre: string, args: unknown, r: RespuestaHerramienta) => void

async function bucle(raiz: string, proveedor: ProveedorLLM, sesion: Sesion, llamadas: LlamadaVisible[], autorizar: Autorizador, observar: Observador): Promise<string> {
  const definiciones = definicionesHerramientas()
  const prompt = await sistema(raiz)

  for (let i = 0; i < LIMITES.maxIteraciones; i++) {
    if (sesion.tokensUsados >= LIMITES.maxTokensSesion) {
      return `Esta sesión alcanzó su tope de ${LIMITES.maxTokensSesion.toLocaleString("es-CO")} tokens. Abre una sesión nueva para continuar.`
    }
    const r = await proveedor.enviar(prompt, sesion.mensajes, definiciones)
    sesion.tokensUsados += r.uso.entrada + r.uso.salida
    sesion.mensajes.push({ rol: "asistente", bloques: r.bloques, crudo: r.crudo })
    const texto = r.bloques.flatMap((b) => (b.tipo === "texto" ? [b.texto] : [])).join("\n").trim()

    if (r.fin === "rechazo") return texto || "El modelo declinó responder esta solicitud."
    if (r.fin !== "herramientas") {
      return r.fin === "limite_tokens" ? `${texto}\n\n(La respuesta se cortó por longitud.)` : texto
    }

    const resultados: BloqueResultado[] = []
    for (const b of r.bloques) {
      if (b.tipo !== "llamada") continue
      const { visible, resultado } = await ejecutar(raiz, sesion.id, b.nombre, b.argumentos, autorizar, observar)
      llamadas.push(visible)
      resultados.push({ tipo: "resultado", id: b.id, contenido: resultado, esError: !visible.ok })
    }
    sesion.mensajes.push({ rol: "usuario", bloques: resultados })
  }
  return `Alcancé el tope de ${LIMITES.maxIteraciones} pasos en este turno. Lo que hice está en las llamadas a herramientas de arriba; pídeme que continúe para terminar lo que falta.`
}

async function ejecutar(raiz: string, sesionId: string, nombre: string, args: unknown, autorizar: Autorizador, observar: Observador) {
  const h = herramientas[nombre]
  const negado = h ? autorizar(nombre, args) : `La herramienta ${nombre} no existe.`
  let texto: string
  if (!h || negado) {
    texto = JSON.stringify({ ok: false, error: negado })
    // Las llamadas que no llegan a ejecutarse también quedan en el log (CA4).
    await registrarLlamada(raiz, { ts: new Date().toISOString(), sesion: sesionId, herramienta: nombre, caso: casoDe(args), ok: false, resumen: `rechazada por el ciclo: ${negado}` })
  } else {
    texto = await h.execute(args, { directory: raiz, sessionId: sesionId })
  }
  const r = JSON.parse(texto) as RespuestaHerramienta
  observar(nombre, args, r)
  const visible: LlamadaVisible = { nombre, argumentos: args, ok: r.ok, resumen: r.ok ? resumir(nombre, r.data) : r.error, resultado: r.ok ? r.data : null }
  return { visible, resultado: texto }
}

// ---------- Confirmación humana (CA3 / HU-5) ----------

const AFIRMATIVO = /\b(s[ií]|confirmo|confirmado|confirmada|adelante|procede|proced[eé]|dale|ok|okay|de acuerdo|cr[eé]ala|cr[eé]alas|aprobado|hazlo|correcto)\b/i
const NEGATIVO = /\b(no|cancela|cancelar|espera|detente|todav[ií]a|a[uú]n)\b/i

export function esConfirmacion(texto: string): boolean {
  return AFIRMATIVO.test(texto) && !NEGATIVO.test(texto)
}

function casoDe(args: unknown): string | null {
  return args && typeof args === "object" && "caso" in args && typeof args.caso === "string" ? args.caso : null
}

/** oc_crear con confirmado=true solo pasa si el turno anterior pidió confirmación para ese caso y el usuario confirmó. */
function autorizar(nombre: string, args: unknown, confirmaAhora: boolean, pendientes: Set<string>): string | null {
  if (nombre !== "oc_crear") return null
  const confirmado = args && typeof args === "object" && "confirmado" in args && args.confirmado === true
  if (!confirmado) return null
  const caso = casoDe(args)
  if (caso && pendientes.has(caso) && confirmaAhora) return null
  return "Requiere confirmación explícita del usuario: primero presenta las excepciones y termina el turno con una pregunta; solo en el turno siguiente, si el usuario confirma, llama con confirmado=true."
}

function actualizarPendientes(nombre: string, args: unknown, r: RespuestaHerramienta, pendientes: Set<string>): void {
  const caso = casoDe(args)
  if (!caso) return
  if (nombre === "oc_crear") {
    if (r.ok) pendientes.delete(caso)
    else if (r.error.startsWith("Requiere confirmación")) pendientes.add(caso)
    return
  }
  if (!r.ok || typeof r.data !== "object" || r.data === null) return
  const d = r.data as { apta?: boolean; confirmaciones?: unknown[]; requiere_confirmacion?: unknown[] }
  if (nombre === "oc_validar" && d.apta && d.confirmaciones?.length) pendientes.add(caso)
  if (nombre === "oc_construir_payload" && d.requiere_confirmacion?.length) pendientes.add(caso)
}

// ---------- Utilidades ----------

async function registrarLlamada(raiz: string, linea: Record<string, unknown>): Promise<void> {
  try {
    await agregarLinea(join(rutas.out(raiz), "log.jsonl"), JSON.stringify(linea))
  } catch {
    // El log nunca debe tumbar el turno.
  }
}

function resumir(nombre: string, data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>
  const codigos = (v: unknown) => (Array.isArray(v) && v.length ? v.map((h) => (h as { codigo: string }).codigo).join(", ") : "ninguna")
  switch (nombre) {
    case "oc_listar_casos": return `${(d.casos as unknown[] | undefined)?.length ?? 0} solicitudes`
    case "oc_leer_paquete": return `Paquete ${(d.solicitud as { solicitud_id?: string } | undefined)?.solicitud_id ?? ""} leído`
    case "oc_validar": return `apta=${String(d.apta)} · bloqueos: ${codigos(d.bloqueos)} · confirmaciones: ${codigos(d.confirmaciones)} · retroactiva=${String(d.retroactiva)}`
    case "oc_construir_payload": return `Payload construido · trazabilidad en ${String(d.ruta_trazabilidad)}`
    case "oc_generar_evidencia": return `Evidencia en ${String(d.ruta)}`
    case "oc_crear": return `OC ${String(d.numero_oc)}${d.idempotente ? " (ya existía)" : " creada"}`
    default: return "ok"
  }
}

/** Si un error cortó el turno con llamadas sin resultado, se cierran para que la API acepte el historial. */
function cerrarLlamadasHuerfanas(mensajes: MensajeLLM[]): void {
  const ultimo = mensajes[mensajes.length - 1]
  if (ultimo?.rol !== "asistente") return
  const huerfanas = ultimo.bloques.filter((b) => b.tipo === "llamada")
  if (!huerfanas.length) return
  mensajes.push({
    rol: "usuario",
    bloques: huerfanas.map((b) => ({ tipo: "resultado" as const, id: b.tipo === "llamada" ? b.id : "", contenido: JSON.stringify({ ok: false, error: "interrumpido" }), esError: true })),
  })
}
