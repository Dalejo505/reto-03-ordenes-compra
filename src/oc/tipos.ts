import { z } from "zod"

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha en formato YYYY-MM-DD")

// ---------- Fixtures de entrada ----------

export const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string(),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: z.number({ error: "cantidad debe ser numérica" }).positive(),
  valor_unitario: z.number({ error: "valor_unitario debe ser numérico" }).nonnegative(),
  valor_total: z.number({ error: "valor_total debe ser numérico" }).positive(),
  moneda: z.string().min(3),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: fechaIso,
})
export type Solicitud = z.infer<typeof SolicitudSchema>

export const CorreoArchivoSchema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  cuerpo: z.string().optional(),
  adjuntos: z.array(z.string()).optional(),
})

export const AprobacionArchivoSchema = z.object({
  de: z.string(),
  para: z.string(),
  cc: z.array(z.string()).optional(),
  fecha: z.string(),
  asunto: z.string(),
  cuerpo: z.string(),
})
export type AprobacionArchivo = z.infer<typeof AprobacionArchivoSchema>

// ---------- Paquete normalizado (PRD 7.2) ----------

export const PaqueteSchema = z.object({
  correo: z.object({ id: z.string(), de: z.string(), asunto: z.string(), fecha: z.string() }),
  solicitud: SolicitudSchema,
  cotizacion: z
    .object({
      numero: z.string().nullable(),
      proveedor: z.string(),
      nit: z.string().nullable(),
      total: z.number(),
      moneda: z.string(),
      validez_hasta: z.string().nullable(),
      texto: z.string(),
    })
    .nullable(),
  aprobacion: z
    .object({
      de: z.string(),
      fecha: z.string(),
      aprobado: z.boolean(),
      texto: z.string(),
    })
    .nullable(),
  factura: z.object({ numero: z.string(), fecha: z.string(), total: z.number() }).nullable(),
  faltantes: z.array(z.string()),
})
export type Paquete = z.infer<typeof PaqueteSchema>

// ---------- Maestros ----------

export const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})
export type Proveedor = z.infer<typeof ProveedorSchema>

export const CentroCostoSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), nombre: z.string().optional(), tope: z.number() })),
})
export type CentroCosto = z.infer<typeof CentroCostoSchema>

export const IndicadorIvaSchema = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() })
export const CondicionPagoSchema = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() })

export type Maestros = {
  proveedores: Proveedor[]
  centros: CentroCosto[]
  indicadoresIva: z.infer<typeof IndicadorIvaSchema>[]
  condicionesPago: z.infer<typeof CondicionPagoSchema>[]
}

// ---------- Resultado de validación ----------

export const HallazgoSchema = z.object({
  codigo: z.string(),
  detalle: z.string(),
  accion_sugerida: z.string(),
  valores: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
})
export type Hallazgo = z.infer<typeof HallazgoSchema>

export const DerivadoSchema = z.object({
  valor: z.string(),
  fuente: z.string(),
  detalle: z.string(),
})
export const DerivadosSchema = z.record(z.string(), DerivadoSchema)
export type Derivados = z.infer<typeof DerivadosSchema>

export type EstadoControl = "ok" | "bloqueo" | "confirmacion" | "derivado" | "no_evaluado"
export type Control = { codigo: string; nombre: string; estado: EstadoControl }

export type Validacion = {
  apta: boolean
  /** Estado de cada control RC1–RC10, para mostrar qué pasó y qué no. */
  controles: Control[]
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
}

// ---------- Orden de compra (PRD 7.4) ----------

export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int(),
        descripcion: z.string().max(40),
        cantidad: z.number().positive(),
        unidad: z.enum(["UN", "H", "MES"]),
        precio_unitario: z.number().nonnegative(),
        centro_costo: z.string(),
        subarea: z.string(),
        indicador_iva: z.string(),
      }),
    )
    .min(1),
  excepciones: z.array(
    z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() }),
  ),
})
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>

export type Traza = { valor: string | number | null; fuente: string; detalle?: string }
export type Trazabilidad = Record<string, Traza>
