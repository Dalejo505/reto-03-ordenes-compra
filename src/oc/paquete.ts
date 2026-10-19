import { existsSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import {
  AprobacionArchivoSchema,
  CorreoArchivoSchema,
  SolicitudSchema,
  type AprobacionArchivo,
  type Paquete,
} from "./tipos"
import { ErrorNegocio, leerJson, leerTextoOpcional, rutas, validarNombreCaso } from "./archivos"
import { normalizarNit, parsearMonto, soloFecha, sumarDias } from "./texto"

type Cotizacion = NonNullable<Paquete["cotizacion"]>
type Factura = NonNullable<Paquete["factura"]>
type Aprobacion = NonNullable<Paquete["aprobacion"]>

export async function leerPaquete(raiz: string, caso: string): Promise<Paquete> {
  validarNombreCaso(caso)
  const dir = rutas.caso(raiz, caso)
  if (!existsSync(dir)) throw new ErrorNegocio(`No existe el caso "${caso}" en fixtures/reto-03/solicitudes/.`)

  const faltantes: string[] = []
  const correo = await leerObligatorio(join(dir, "correo.json"), CorreoArchivoSchema, "correo.json")
  const solicitud = await leerObligatorio(join(dir, "solicitud.json"), SolicitudSchema, "solicitud.json (solicitud.xlsx)")

  const textoCotizacion = await leerTextoOpcional(join(dir, "cotizacion.txt"))
  if (textoCotizacion === null) faltantes.push("cotizacion (cotizacion.pdf)")
  const aprobacionArchivo = await leerAprobacionArchivo(raiz, caso)
  if (aprobacionArchivo === null) faltantes.push("aprobacion (correo de aprobación del líder)")
  const textoFactura = await leerTextoOpcional(join(dir, "factura.txt"))

  return {
    correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha },
    solicitud,
    cotizacion: textoCotizacion === null ? null : parsearCotizacion(textoCotizacion),
    aprobacion: aprobacionArchivo === null ? null : normalizarAprobacion(aprobacionArchivo),
    factura: textoFactura === null ? null : parsearFactura(textoFactura),
    faltantes,
  }
}

export async function leerAprobacionArchivo(raiz: string, caso: string): Promise<AprobacionArchivo | null> {
  const ruta = join(rutas.caso(raiz, caso), "aprobacion.json")
  if (!existsSync(ruta)) return null
  return leerJson(ruta, AprobacionArchivoSchema, "aprobacion.json")
}

async function leerObligatorio<T>(ruta: string, schema: z.ZodType<T>, etiqueta: string): Promise<T> {
  if (!existsSync(ruta)) throw new ErrorNegocio(`Paquete incompleto: falta ${etiqueta}. Pídelo al solicitante.`)
  return leerJson(ruta, schema, etiqueta)
}

function buscar(texto: string, patron: RegExp): string | null {
  return patron.exec(texto)?.[1]?.trim() ?? null
}

export function parsearCotizacion(texto: string): Cotizacion {
  const totalMatch = /^TOTAL[^:\n]*:\s*([A-Z]{3})\s*([\d.,]+)/im.exec(texto)
  const total = totalMatch?.[2] ? parsearMonto(totalMatch[2]) : null
  if (total === null || !totalMatch?.[1]) {
    throw new ErrorNegocio("La cotización no tiene un TOTAL numérico legible. Pide al proveedor una cotización con total explícito.")
  }
  const fecha = buscar(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/im)
  const diasValidez = buscar(texto, /^Validez[^:\n]*:\s*(\d+)\s*d[ií]as/im)
  const nit = buscar(texto, /^NIT:\s*([\d.\-]+)/im)
  return {
    numero: buscar(texto, /COTIZACI[OÓ]N\s+([A-Z0-9-]+)/i),
    proveedor: buscar(texto, /^Proveedor:\s*(.+)$/im) ?? "",
    nit: nit ? normalizarNit(nit) : null,
    total,
    moneda: totalMatch[1],
    validez_hasta: fecha && diasValidez ? sumarDias(fecha, Number(diasValidez)) : null,
    texto,
  }
}

export function parsearFactura(texto: string): Factura {
  const numero = buscar(texto, /FACTURA[^\n]*No\.\s*([A-Z0-9-]+)/i)
  const fecha = buscar(texto, /Fecha de emisi[oó]n:\s*(\d{4}-\d{2}-\d{2})/i)
  const totalTexto = buscar(texto, /^TOTAL:\s*[A-Z]{3}\s*([\d.,]+)/im)
  const total = totalTexto ? parsearMonto(totalTexto) : null
  if (!numero || !fecha || total === null) {
    throw new ErrorNegocio("La factura adjunta no tiene número, fecha de emisión o total legibles.")
  }
  return { numero, fecha, total }
}

export function normalizarAprobacion(a: AprobacionArchivo): Aprobacion {
  const negada = /\bno\s+(est[aá]\s+)?aprobad[oa]\b/i.test(a.cuerpo)
  const aprobado = !negada && /\baprobad[oa]\b/i.test(a.cuerpo)
  return { de: a.de.toLowerCase(), fecha: soloFecha(a.fecha), aprobado, texto: a.cuerpo }
}
