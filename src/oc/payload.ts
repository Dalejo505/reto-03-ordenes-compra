import { CONFIG } from "./config"
import { ErrorNegocio } from "./archivos"
import { buscarProveedor } from "./maestros"
import {
  OrdenCompraSchema,
  type Derivados,
  type Maestros,
  type OrdenCompra,
  type Paquete,
  type Trazabilidad,
  type Validacion,
} from "./tipos"

type Posicion = OrdenCompra["posiciones"][number]

/**
 * Construye la OC solo con valores de la solicitud, los maestros o los derivados
 * calculados por la validación. Cada valor queda registrado en la trazabilidad.
 */
export function construirOrden(
  paquete: Paquete,
  validacion: Validacion,
  maestros: Maestros,
  evidenciaSha256: string,
): { orden: OrdenCompra; trazabilidad: Trazabilidad } {
  if (!validacion.apta) {
    const motivos = validacion.bloqueos.map((b) => `${b.codigo}: ${b.detalle}`).join(" | ")
    throw new ErrorNegocio(`No se puede construir la OC porque hay bloqueos. ${motivos}`)
  }
  const s = paquete.solicitud
  const proveedor = buscarProveedor(maestros.proveedores, s.proveedor_nit, s.proveedor_nombre).proveedor
  const aprobacion = paquete.aprobacion
  if (!proveedor || !aprobacion) throw new ErrorNegocio("Validación inconsistente: falta proveedor o aprobación.")

  const traza: Trazabilidad = {}
  const iva = valorODerivado(s.indicador_iva, validacion.derivados, "indicador_iva")
  const pago = valorODerivado(s.condiciones_pago, validacion.derivados, "condiciones_pago")
  const descripcion = textoBreve(s.descripcion)
  const unidad = inferirUnidad(s.descripcion)

  traza["referencia.solicitud_id"] = { valor: s.solicitud_id, fuente: "solicitud" }
  traza["referencia.correo_id"] = { valor: paquete.correo.id, fuente: "correo" }
  traza["referencia.cotizacion_ref"] = { valor: paquete.cotizacion?.numero ?? null, fuente: paquete.cotizacion ? "cotizacion" : "derivado", detalle: paquete.cotizacion ? undefined : "sin cotización" }
  traza["sociedad"] = { valor: CONFIG.sociedad, fuente: "config", detalle: "constante de la sociedad" }
  traza["organizacion_compras"] = { valor: CONFIG.organizacionCompras, fuente: "config", detalle: "constante de organización de compras" }
  traza["proveedor.codigo_sap"] = { valor: proveedor.codigo_sap, fuente: "maestro.proveedores" }
  traza["proveedor.nit"] = { valor: proveedor.nit, fuente: s.proveedor_nit ? "solicitud" : "maestro.proveedores", detalle: s.proveedor_nit ? "verificado contra maestro.proveedores" : "derivado por nombre del proveedor" }
  traza["proveedor.nombre"] = { valor: proveedor.nombre, fuente: "maestro.proveedores" }
  traza["moneda"] = { valor: s.moneda, fuente: "solicitud" }
  traza["condiciones_pago"] = { valor: pago.valor, fuente: pago.fuente, detalle: pago.detalle }
  traza["aprobador.email"] = { valor: aprobacion.de, fuente: "aprobacion", detalle: "verificado contra maestro.centros-costo" }
  traza["aprobador.fecha_aprobacion"] = { valor: aprobacion.fecha, fuente: "aprobacion" }
  traza["aprobador.evidencia_sha256"] = { valor: evidenciaSha256, fuente: "derivado", detalle: "sha256 de la evidencia de aprobación" }
  traza["posiciones[0].numero"] = { valor: CONFIG.posicionInicial, fuente: "config" }
  traza["posiciones[0].descripcion"] = { valor: descripcion, fuente: "solicitud", detalle: descripcion === s.descripcion ? undefined : `recortada a ${CONFIG.maxDescripcion} caracteres (texto breve SAP)` }
  traza["posiciones[0].cantidad"] = { valor: s.cantidad, fuente: "solicitud" }
  traza["posiciones[0].unidad"] = { valor: unidad.valor, fuente: "derivado", detalle: unidad.detalle }
  traza["posiciones[0].precio_unitario"] = { valor: s.valor_unitario, fuente: "solicitud" }
  traza["posiciones[0].centro_costo"] = { valor: s.centro_costo, fuente: "solicitud", detalle: "verificado contra maestro.centros-costo" }
  traza["posiciones[0].subarea"] = { valor: s.subarea, fuente: "solicitud", detalle: "verificado contra maestro.centros-costo" }
  traza["posiciones[0].indicador_iva"] = { valor: iva.valor, fuente: iva.fuente, detalle: iva.detalle }

  const posicion: Posicion = {
    numero: CONFIG.posicionInicial,
    descripcion,
    cantidad: s.cantidad,
    unidad: unidad.valor,
    precio_unitario: s.valor_unitario,
    centro_costo: s.centro_costo,
    subarea: s.subarea,
    indicador_iva: iva.valor,
  }

  const orden = OrdenCompraSchema.parse({
    referencia: { solicitud_id: s.solicitud_id, correo_id: paquete.correo.id, cotizacion_ref: paquete.cotizacion?.numero ?? null },
    sociedad: CONFIG.sociedad,
    organizacion_compras: CONFIG.organizacionCompras,
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda: s.moneda,
    condiciones_pago: pago.valor,
    aprobador: { email: aprobacion.de, fecha_aprobacion: aprobacion.fecha, evidencia_sha256: evidenciaSha256 },
    posiciones: [posicion],
    excepciones: validacion.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
  })
  return { orden, trazabilidad: traza }
}

function valorODerivado(
  valor: string | undefined,
  derivados: Derivados,
  clave: string,
): { valor: string; fuente: string; detalle?: string } {
  if (valor) return { valor, fuente: "solicitud" }
  const d = derivados[clave]
  if (!d) throw new ErrorNegocio(`No hay valor ni derivado para ${clave}.`)
  return { valor: d.valor, fuente: d.fuente, detalle: d.detalle }
}

function textoBreve(texto: string): string {
  if (texto.length <= CONFIG.maxDescripcion) return texto
  const corte = texto.slice(0, CONFIG.maxDescripcion)
  const ultimoEspacio = corte.lastIndexOf(" ")
  return (ultimoEspacio > 20 ? corte.slice(0, ultimoEspacio) : corte).trim()
}

function inferirUnidad(descripcion: string): { valor: Posicion["unidad"]; detalle: string } {
  if (/\bhoras?\b/i.test(descripcion)) return { valor: "H", detalle: "la descripción habla de horas" }
  if (/\bmensual(es)?\b|\bpor mes\b/i.test(descripcion)) return { valor: "MES", detalle: "la descripción habla de un cobro mensual" }
  return { valor: "UN", detalle: "unidad por defecto (unidades)" }
}

/** Compara el payload recibido con el esperado ignorando quién confirmó las excepciones. */
export function diferenciasPayload(recibido: OrdenCompra, esperado: OrdenCompra): string[] {
  const limpiar = (o: OrdenCompra) => ({ ...o, excepciones: o.excepciones.map((e) => ({ ...e, confirmado_por: null })) })
  const a = limpiar(recibido)
  const b = limpiar(esperado)
  return (Object.keys(b) as (keyof OrdenCompra)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
}
