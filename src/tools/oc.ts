// Herramientas del agente de órdenes de compra. Cada export se expone al modelo como oc_<export>.
import { join } from "node:path"
import { z } from "zod"
import { ErrorNegocio, escribirArchivo, listarCasos, relativa, rutas } from "../oc/archivos"
import { registrarControl, type FilaControl } from "../oc/control"
import { evidenciaDelCaso, generarEvidencia } from "../oc/evidencia"
import { cargarMaestros } from "../oc/maestros"
import { leerPaquete } from "../oc/paquete"
import { construirOrden, diferenciasPayload } from "../oc/payload"
import { validarPaquete } from "../oc/reglas"
import { DerivadosSchema, OrdenCompraSchema, PaqueteSchema, type Paquete } from "../oc/tipos"
import { SapMock } from "../sap/mock"
import type { SapAdapter } from "../sap/adapter"
import { definirHerramienta, sesionDe, type ContextoHerramienta, type Exito } from "./base"

type ResultadoCrear = {
  numero_oc: string
  fecha: string | null
  idempotente: boolean
  retroactiva: boolean
  evidencia?: string
  excepciones_confirmadas?: string[]
}

const argCaso = z.string().describe('Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, por ejemplo "sol-001"')
const argPaquete = PaqueteSchema.optional().describe("Paquete devuelto por oc_leer_paquete. Opcional: si se omite se lee del caso.")

const adaptadores = new Map<string, SapAdapter>()
/** Un adaptador por raíz para que la numeración de OC se serialice entre llamadas. */
function sap(raiz: string): SapAdapter {
  let a = adaptadores.get(raiz)
  if (!a) {
    a = new SapMock(raiz)
    adaptadores.set(raiz, a)
  }
  return a
}

async function paqueteDe(ctx: ContextoHerramienta, caso: string, paquete?: Paquete): Promise<Paquete> {
  return paquete ?? leerPaquete(ctx.directory, caso)
}

export const listar_casos = definirHerramienta(
  "oc_listar_casos",
  "Lista las solicitudes de compra disponibles (carpetas en fixtures/reto-03/solicitudes/).",
  {},
  async (_args, ctx) => {
    const casos = await listarCasos(ctx.directory)
    return { data: { casos }, resumen: `${casos.length} casos` }
  },
)

export const leer_paquete = definirHerramienta(
  "oc_leer_paquete",
  "Lee y normaliza el paquete de una solicitud: correo, solicitud, cotización, aprobación y factura si existe.",
  { caso: argCaso },
  async ({ caso }, ctx) => {
    const paquete = await leerPaquete(ctx.directory, caso)
    const faltan = paquete.faltantes.length ? `; faltan: ${paquete.faltantes.join(", ")}` : ""
    return { caso, data: paquete, resumen: `${paquete.solicitud.solicitud_id} leído${faltan}` }
  },
)

export const validar = definirHerramienta(
  "oc_validar",
  "Aplica los controles RC1–RC10 contra los maestros y devuelve si la OC es apta, sus bloqueos, confirmaciones y valores derivados.",
  { caso: argCaso, paquete: argPaquete },
  async ({ caso, paquete }, ctx) => {
    const p = await paqueteDe(ctx, caso, paquete)
    const v = validarPaquete(p, await cargarMaestros(ctx.directory))
    await escribirArchivo(join(rutas.outCaso(ctx.directory, caso), "validacion.json"), JSON.stringify(v, null, 2))
    const codigos = (l: { codigo: string }[]) => l.map((h) => h.codigo).join(",") || "ninguna"
    return {
      caso,
      data: v,
      resumen: `apta=${v.apta} bloqueos=${codigos(v.bloqueos)} confirmaciones=${codigos(v.confirmaciones)} retroactiva=${v.retroactiva}`,
    }
  },
)

export const construir_payload = definirHerramienta(
  "oc_construir_payload",
  "Construye la orden de compra tal como quedaría en SAP, con la trazabilidad de cada valor; falla si la solicitud tiene bloqueos.",
  {
    caso: argCaso,
    paquete: argPaquete,
    derivados: DerivadosSchema.optional().describe("Derivados devueltos por oc_validar. Opcional: se recalculan siempre desde los maestros."),
  },
  async ({ caso, paquete }, ctx) => {
    const p = await paqueteDe(ctx, caso, paquete)
    const maestros = await cargarMaestros(ctx.directory)
    const validacion = validarPaquete(p, maestros)
    const { sha256 } = await evidenciaDelCaso(ctx.directory, caso)
    const { orden, trazabilidad } = construirOrden(p, validacion, maestros, sha256)
    const dir = rutas.outCaso(ctx.directory, caso)
    const rutaTraza = join(dir, "trazabilidad.json")
    await escribirArchivo(join(dir, "payload.json"), JSON.stringify(orden, null, 2))
    await escribirArchivo(rutaTraza, JSON.stringify(trazabilidad, null, 2))
    return {
      caso,
      data: {
        payload: orden,
        trazabilidad,
        ruta_trazabilidad: relativa(ctx.directory, rutaTraza),
        requiere_confirmacion: validacion.confirmaciones.map((c) => c.codigo),
      },
      resumen: `payload ${orden.referencia.solicitud_id} con ${orden.excepciones.length} excepciones`,
    }
  },
)

export const generar_evidencia = definirHerramienta(
  "oc_generar_evidencia",
  "Genera la evidencia de aprobación (aprobacion.txt y aprobacion.pdf) con el sha256 del correo del líder.",
  { caso: argCaso },
  async ({ caso }, ctx) => {
    const e = await generarEvidencia(ctx.directory, caso)
    return {
      caso,
      data: { ruta: relativa(ctx.directory, e.pdf), ruta_txt: relativa(ctx.directory, e.txt), sha256: e.sha256 },
      resumen: `evidencia sha256=${e.sha256.slice(0, 12)}…`,
    }
  },
)

export const crear = definirHerramienta(
  "oc_crear",
  "Crea la OC en SAP (simulado) solo si es apta y, cuando hay confirmaciones pendientes, solo con confirmado=true tras una confirmación explícita del usuario.",
  {
    caso: argCaso,
    payload: OrdenCompraSchema.optional().describe("Payload devuelto por oc_construir_payload, sin modificar. Puede omitirse solo si la solicitud tiene bloqueos (queda el intento en control)."),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente las excepciones en su último mensaje"),
  },
  async ({ caso, payload, confirmado }, ctx): Promise<Exito<ResultadoCrear>> => {
    const raiz = ctx.directory
    // Todo se recalcula desde los archivos: el modelo no puede alterar montos ni saltarse controles.
    const paquete = await leerPaquete(raiz, caso)
    const maestros = await cargarMaestros(raiz)
    const v = validarPaquete(paquete, maestros)
    const id = paquete.solicitud.solicitud_id
    const control = (resultado: FilaControl["resultado"], numero_oc: string | null = null) =>
      registrarControl(raiz, {
        solicitud_id: id,
        resultado,
        numero_oc,
        retroactiva: v.retroactiva,
        bloqueos: v.bloqueos.map((b) => b.codigo),
        confirmaciones: v.confirmaciones.map((c) => c.codigo),
      })

    const existente = await sap(raiz).buscarOrdenPorReferencia(id)
    if (existente) {
      await control("idempotente", existente.numero_oc)
      return { caso, data: { numero_oc: existente.numero_oc, fecha: null, idempotente: true, retroactiva: v.retroactiva }, resumen: `ya existía OC ${existente.numero_oc}` }
    }
    if (!v.apta) {
      await control("bloqueada")
      throw new ErrorNegocio(`OC bloqueada. ${v.bloqueos.map((b) => `${b.codigo}: ${b.detalle} Acción: ${b.accion_sugerida}`).join(" | ")}`)
    }
    if (v.confirmaciones.length && confirmado !== true) {
      await control("pendiente_confirmacion")
      throw new ErrorNegocio(`Requiere confirmación explícita del usuario antes de crear la OC: ${v.confirmaciones.map((c) => `${c.codigo}: ${c.detalle}`).join(" | ")}`)
    }

    if (!payload) {
      await control("rechazada")
      throw new ErrorNegocio("Falta el payload. Llama primero a oc_construir_payload y envía su resultado sin modificar.")
    }
    const evidencia = await generarEvidencia(raiz, caso)
    const { orden: esperada } = construirOrden(paquete, v, maestros, evidencia.sha256)
    const distintos = diferenciasPayload(payload, esperada)
    if (distintos.length) {
      await control("rechazada")
      throw new ErrorNegocio(`El payload no coincide con el construido por oc_construir_payload (campos: ${distintos.join(", ")}). Vuelve a construirlo sin modificarlo.`)
    }
    const confirmadoPor = `analista (chat, sesión ${sesionDe(ctx)})`
    const orden = { ...esperada, excepciones: esperada.excepciones.map((e) => ({ ...e, confirmado_por: confirmadoPor })) }

    const proveedorSap = await sap(raiz).consultarProveedor(orden.proveedor.nit)
    if (!proveedorSap?.activo) {
      await control("bloqueada")
      throw new ErrorNegocio(`SAP no reconoce al proveedor ${orden.proveedor.nit} como activo.`)
    }
    const { numero_oc, fecha } = await sap(raiz).crearOrden(orden)
    await control("creada", numero_oc)
    await escribirArchivo(join(rutas.outCaso(raiz, caso), "oc.json"), JSON.stringify({ numero_oc, fecha, orden }, null, 2))
    return {
      caso,
      data: {
        numero_oc,
        fecha,
        idempotente: false,
        retroactiva: v.retroactiva,
        evidencia: relativa(raiz, evidencia.pdf),
        excepciones_confirmadas: orden.excepciones.map((e) => e.codigo),
      },
      resumen: `OC ${numero_oc} creada${v.retroactiva ? " (retroactiva)" : ""}`,
    }
  },
)
