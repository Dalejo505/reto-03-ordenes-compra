import { CONFIG } from "./config"
import { buscarProveedor } from "./maestros"
import type { CentroCosto, Control, Derivados, EstadoControl, Hallazgo, Maestros, Paquete, Proveedor, Validacion } from "./tipos"
import { formatoCop } from "./texto"

/** Lo que cada regla puede aportar al resultado. */
type Aporte = {
  bloqueos?: Hallazgo[]
  confirmaciones?: Hallazgo[]
  derivados?: Derivados
  retroactiva?: boolean
}

type Contexto = {
  paquete: Paquete
  maestros: Maestros
  proveedor: Proveedor | null
  criterioProveedor: "nit" | "nombre"
  centro: CentroCosto | null
}

type Regla = (c: Contexto) => Aporte

// ---------- Bloqueos ----------

const rc1Proveedor: Regla = ({ paquete, proveedor, criterioProveedor }) => {
  const s = paquete.solicitud
  const ref = s.proveedor_nit ? `NIT ${s.proveedor_nit}` : `nombre "${s.proveedor_nombre}"`
  if (!proveedor) {
    return {
      bloqueos: [{
        codigo: "RC1",
        detalle: `El proveedor "${s.proveedor_nombre}" (${ref}) no existe en el maestro de proveedores.`,
        accion_sugerida: "Solicitar la creación del proveedor en SAP (RUT, certificación bancaria, cámara de comercio) o confirmar con el solicitante si se debe usar un proveedor ya registrado.",
      }],
    }
  }
  const derivados: Derivados = {}
  if (criterioProveedor === "nombre") {
    derivados.proveedor_nit = {
      valor: proveedor.nit,
      fuente: "maestro.proveedores",
      detalle: `La solicitud no trae NIT; se identificó el proveedor por nombre (${proveedor.nombre}).`,
    }
  }
  if (!proveedor.activo) {
    return {
      derivados,
      bloqueos: [{
        codigo: "RC1",
        detalle: `El proveedor "${proveedor.nombre}" (código SAP ${proveedor.codigo_sap}) está inactivo.`,
        accion_sugerida: "Solicitar a datos maestros la reactivación del proveedor o escoger un proveedor activo.",
      }],
    }
  }
  return { derivados }
}

const rc2Aprobacion: Regla = ({ paquete, centro }) => {
  const a = paquete.aprobacion
  const cc = paquete.solicitud.centro_costo
  if (!a) {
    return { bloqueos: [{ codigo: "RC2", detalle: "El paquete no trae correo de aprobación.", accion_sugerida: `Pedir al solicitante el correo de aprobación de un aprobador de ${cc}.` }] }
  }
  if (!a.aprobado) {
    return { bloqueos: [{ codigo: "RC2", detalle: `El correo de ${a.de} no contiene una aprobación explícita ("Aprobado").`, accion_sugerida: "Pedir al líder una respuesta explícita con la palabra \"Aprobado\"." }] }
  }
  if (!centro) return {} // el centro inexistente lo reporta RC4
  if (!centro.aprobadores.some((ap) => ap.email.toLowerCase() === a.de)) {
    const validos = centro.aprobadores.map((ap) => ap.email).join(", ")
    return {
      bloqueos: [{
        codigo: "RC2",
        detalle: `${a.de} no es aprobador del centro de costo ${cc}. Aprobadores válidos: ${validos}.`,
        accion_sugerida: `Reenviar la solicitud para aprobación de ${validos}, o corregir el centro de costo si la compra pertenece a otra área.`,
      }],
    }
  }
  return {}
}

const rc3Tope: Regla = ({ paquete, centro }) => {
  const a = paquete.aprobacion
  const aprobador = a && centro?.aprobadores.find((ap) => ap.email.toLowerCase() === a.de)
  if (!aprobador) return {} // sin aprobador válido no hay tope que evaluar (RC2 ya bloquea)
  const total = paquete.solicitud.valor_total
  if (total <= aprobador.tope) return {}
  const superiores = centro!.aprobadores.filter((ap) => ap.tope >= total).map((ap) => ap.email)
  return {
    bloqueos: [{
      codigo: "RC3",
      detalle: `El valor ${formatoCop(total)} supera el tope de ${aprobador.email} (${formatoCop(aprobador.tope)}) en ${paquete.solicitud.centro_costo}.`,
      accion_sugerida: superiores.length
        ? `Solicitar aprobación de: ${superiores.join(", ")}.`
        : "Ningún aprobador del centro tiene tope suficiente; escalar a dirección financiera.",
      valores: { valor_total: total, tope: aprobador.tope },
    }],
  }
}

const rc4Subarea: Regla = ({ paquete, centro }) => {
  const { centro_costo, subarea } = paquete.solicitud
  if (!centro) {
    return { bloqueos: [{ codigo: "RC4", detalle: `El centro de costo ${centro_costo} no existe en el maestro.`, accion_sugerida: "Confirmar con el solicitante el centro de costo correcto." }] }
  }
  if (centro.subareas.includes(subarea)) return {}
  return {
    bloqueos: [{
      codigo: "RC4",
      detalle: `La subárea "${subarea}" no pertenece a ${centro_costo}. Subáreas válidas: ${centro.subareas.join(", ")}.`,
      accion_sugerida: "Pedir al solicitante que corrija la subárea o el centro de costo.",
    }],
  }
}

const rc10Aritmetica: Regla = ({ paquete }) => {
  const { cantidad, valor_unitario, valor_total } = paquete.solicitud
  const calculado = cantidad * valor_unitario
  if (Math.abs(calculado - valor_total) <= CONFIG.toleranciaAritmetica) return {}
  return {
    bloqueos: [{
      codigo: "RC10",
      detalle: `cantidad × valor_unitario = ${formatoCop(calculado)} no coincide con valor_total = ${formatoCop(valor_total)}.`,
      accion_sugerida: "Pedir al solicitante que corrija la solicitud (cantidad, valor unitario o total).",
      valores: { calculado, valor_total },
    }],
  }
}

const monedaSoportada: Regla = ({ paquete }) => {
  const m = paquete.solicitud.moneda
  if ((CONFIG.monedasSoportadas as readonly string[]).includes(m)) return {}
  return { bloqueos: [{ codigo: "MONEDA", detalle: `La moneda ${m} no está soportada para OC (solo ${CONFIG.monedasSoportadas.join(", ")}).`, accion_sugerida: "Confirmar con el solicitante la moneda de la compra." }] }
}

// ---------- Confirmaciones y derivados ----------

const rc5Cotizacion: Regla = ({ paquete }) => {
  const c = paquete.cotizacion
  const s = paquete.solicitud
  if (!c) {
    return { confirmaciones: [{ codigo: "RC5", detalle: "El paquete no trae cotización del proveedor.", accion_sugerida: "Confirmar que se acepta crear la OC sin cotización, o pedirla al solicitante.", valores: { solicitud: s.valor_total, cotizacion: null } }] }
  }
  const diferencia = Math.abs(c.total - s.valor_total) / s.valor_total
  const hallazgos: Hallazgo[] = []
  if (diferencia > CONFIG.toleranciaCotizacion) {
    hallazgos.push({
      codigo: "RC5",
      detalle: `La cotización (${c.moneda} ${formatoCop(c.total)}) difiere ${(diferencia * 100).toFixed(2)} % de la solicitud (${s.moneda} ${formatoCop(s.valor_total)}); la tolerancia es ${CONFIG.toleranciaCotizacion * 100} %.`,
      accion_sugerida: "Confirmar con cuál valor se crea la OC. La OC usa el valor de la solicitud (el aprobado); si debe ser el de la cotización, pedir una solicitud y aprobación corregidas.",
      valores: { solicitud: s.valor_total, cotizacion: c.total, diferencia_pct: Number((diferencia * 100).toFixed(2)) },
    })
  }
  if (c.moneda !== s.moneda) {
    hallazgos.push({ codigo: "RC5", detalle: `La cotización está en ${c.moneda} y la solicitud en ${s.moneda}.`, accion_sugerida: "Confirmar la moneda de la OC.", valores: { solicitud: s.moneda, cotizacion: c.moneda } })
  }
  return { confirmaciones: hallazgos }
}

const rc6Iva: Regla = ({ paquete, maestros, proveedor }) => {
  const actual = paquete.solicitud.indicador_iva
  if (actual) {
    if (maestros.indicadoresIva.some((i) => i.codigo === actual)) return {}
    return { bloqueos: [{ codigo: "RC6", detalle: `El indicador de IVA "${actual}" no existe en el maestro.`, accion_sugerida: `Usar uno de: ${maestros.indicadoresIva.map((i) => i.codigo).join(", ")}.` }] }
  }
  if (!proveedor) return {} // sin proveedor no hay de dónde derivar; RC1 ya bloquea
  const codigo = proveedor.indicador_iva_default
  const desc = maestros.indicadoresIva.find((i) => i.codigo === codigo)?.descripcion ?? "sin descripción"
  return {
    derivados: { indicador_iva: { valor: codigo, fuente: "maestro.proveedores", detalle: `IVA por defecto del proveedor: ${codigo} (${desc}).` } },
    confirmaciones: [{
      codigo: "RC6",
      detalle: `La solicitud no informa indicador de IVA; se propone ${codigo} (${desc}), el valor por defecto de ${proveedor.nombre.replace(/\.$/, "")}.`,
      accion_sugerida: `Confirmar que el indicador de IVA es ${codigo}.`,
      valores: { indicador_iva_propuesto: codigo },
    }],
  }
}

const rc7CondicionesPago: Regla = ({ paquete, maestros, proveedor }) => {
  const actual = paquete.solicitud.condiciones_pago
  if (actual) {
    if (maestros.condicionesPago.some((c) => c.codigo === actual)) return {}
    return { bloqueos: [{ codigo: "RC7", detalle: `La condición de pago "${actual}" no existe en el maestro.`, accion_sugerida: `Usar una de: ${maestros.condicionesPago.map((c) => c.codigo).join(", ")}.` }] }
  }
  if (!proveedor) return {}
  const codigo = proveedor.condiciones_pago_default
  const desc = maestros.condicionesPago.find((c) => c.codigo === codigo)?.descripcion ?? "sin descripción"
  return { derivados: { condiciones_pago: { valor: codigo, fuente: "maestro.proveedores", detalle: `Condición de pago por defecto del proveedor: ${codigo} (${desc}).` } } }
}

const rc8Retroactiva: Regla = ({ paquete }) => {
  const f = paquete.factura
  const fechaSolicitud = paquete.solicitud.fecha_solicitud
  if (!f || f.fecha >= fechaSolicitud) return {}
  return {
    retroactiva: true,
    confirmaciones: [{
      codigo: "RC8",
      detalle: `OC retroactiva: la factura ${f.numero} es del ${f.fecha}, anterior a la solicitud del ${fechaSolicitud}.`,
      accion_sugerida: "Confirmar la creación de la OC retroactiva; quedará marcada en el log de control para auditoría.",
      valores: { fecha_factura: f.fecha, fecha_solicitud: fechaSolicitud },
    }],
  }
}

const rc9FechaAprobacion: Regla = ({ paquete }) => {
  const a = paquete.aprobacion
  const fechaSolicitud = paquete.solicitud.fecha_solicitud
  if (!a || a.fecha >= fechaSolicitud) return {}
  return {
    confirmaciones: [{
      codigo: "RC9",
      detalle: `La aprobación (${a.fecha}) es anterior a la fecha de la solicitud (${fechaSolicitud}).`,
      accion_sugerida: "Confirmar que la aprobación corresponde a esta solicitud.",
      valores: { fecha_aprobacion: a.fecha, fecha_solicitud: fechaSolicitud },
    }],
  }
}

const REGLAS: Regla[] = [
  rc1Proveedor, rc2Aprobacion, rc3Tope, rc4Subarea, rc5Cotizacion,
  rc6Iva, rc7CondicionesPago, rc8Retroactiva, rc9FechaAprobacion, rc10Aritmetica, monedaSoportada,
]

const NOMBRES_CONTROLES: [string, string][] = [
  ["RC1", "Proveedor existe y está activo"],
  ["RC2", "Aprobación válida del centro de costo"],
  ["RC3", "Valor dentro del tope del aprobador"],
  ["RC4", "Subárea pertenece al centro de costo"],
  ["RC5", "Cotización coincide con la solicitud (±2 %)"],
  ["RC6", "Indicador de IVA informado"],
  ["RC7", "Condiciones de pago informadas"],
  ["RC8", "No es retroactiva (factura posterior a la solicitud)"],
  ["RC9", "Aprobación posterior o igual a la solicitud"],
  ["RC10", "cantidad × valor unitario = total"],
]

function estadoControles(v: Omit<Validacion, "controles" | "apta">): Control[] {
  const con = (lista: Hallazgo[], codigo: string) => lista.some((h) => h.codigo === codigo)
  return NOMBRES_CONTROLES.map(([codigo, nombre]) => {
    let estado: EstadoControl = "ok"
    if (con(v.bloqueos, codigo)) estado = "bloqueo"
    else if (con(v.confirmaciones, codigo)) estado = "confirmacion"
    else if (codigo === "RC3" && con(v.bloqueos, "RC2")) estado = "no_evaluado"
    else if (codigo === "RC7" && v.derivados.condiciones_pago) estado = "derivado"
    else if ((codigo === "RC6" || codigo === "RC7") && con(v.bloqueos, "RC1")) estado = "no_evaluado"
    return { codigo, nombre, estado }
  })
}

/** Aplica RC1–RC10 al paquete. Función pura: no lee ni escribe archivos. */
export function validarPaquete(paquete: Paquete, maestros: Maestros): Validacion {
  const s = paquete.solicitud
  const { proveedor, criterio } = buscarProveedor(maestros.proveedores, s.proveedor_nit, s.proveedor_nombre)
  const contexto: Contexto = {
    paquete,
    maestros,
    proveedor,
    criterioProveedor: criterio,
    centro: maestros.centros.find((c) => c.centro_costo === s.centro_costo) ?? null,
  }
  const resultado: Validacion = { apta: true, controles: [], bloqueos: [], confirmaciones: [], derivados: {}, retroactiva: false }
  for (const regla of REGLAS) {
    const aporte = regla(contexto)
    resultado.bloqueos.push(...(aporte.bloqueos ?? []))
    resultado.confirmaciones.push(...(aporte.confirmaciones ?? []))
    Object.assign(resultado.derivados, aporte.derivados ?? {})
    if (aporte.retroactiva) resultado.retroactiva = true
  }
  resultado.apta = resultado.bloqueos.length === 0
  resultado.controles = estadoControles(resultado)
  return resultado
}
