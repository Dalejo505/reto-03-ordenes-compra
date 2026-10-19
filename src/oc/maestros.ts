import { z } from "zod"
import { leerJson, rutas } from "./archivos"
import {
  CentroCostoSchema,
  CondicionPagoSchema,
  IndicadorIvaSchema,
  ProveedorSchema,
  type Maestros,
  type Proveedor,
} from "./tipos"
import { normalizarNit, normalizarNombre } from "./texto"

export async function cargarMaestros(raiz: string): Promise<Maestros> {
  const [proveedores, centros, indicadoresIva, condicionesPago] = await Promise.all([
    leerJson(rutas.maestro(raiz, "proveedores"), z.array(ProveedorSchema), "maestro proveedores.json"),
    leerJson(rutas.maestro(raiz, "centros-costo"), z.array(CentroCostoSchema), "maestro centros-costo.json"),
    leerJson(rutas.maestro(raiz, "indicadores-iva"), z.array(IndicadorIvaSchema), "maestro indicadores-iva.json"),
    leerJson(rutas.maestro(raiz, "condiciones-pago"), z.array(CondicionPagoSchema), "maestro condiciones-pago.json"),
  ])
  return { proveedores, centros, indicadoresIva, condicionesPago }
}

export type BusquedaProveedor = { proveedor: Proveedor | null; criterio: "nit" | "nombre" }

/** RC1: por NIT si la solicitud lo trae; si no, por nombre normalizado. */
export function buscarProveedor(
  proveedores: Proveedor[],
  nit: string | undefined,
  nombre: string,
): BusquedaProveedor {
  if (nit) {
    const n = normalizarNit(nit)
    return { proveedor: proveedores.find((p) => normalizarNit(p.nit) === n) ?? null, criterio: "nit" }
  }
  const objetivo = normalizarNombre(nombre)
  return {
    proveedor: proveedores.find((p) => normalizarNombre(p.nombre) === objetivo) ?? null,
    criterio: "nombre",
  }
}
