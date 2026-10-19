import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { agregarLinea, rutas } from "../oc/archivos"
import { CONFIG } from "../oc/config"
import { cargarMaestros } from "../oc/maestros"
import { normalizarNit } from "../oc/texto"
import type { OrdenCompra, SapAdapter } from "./adapter"

type Registro = { numero_oc: string; fecha: string; solicitud_id: string; orden: OrdenCompra }

/** SAP simulado sobre out/sap/ordenes.jsonl. Numeración secuencial desde 4500000001. */
export class SapMock implements SapAdapter {
  private readonly archivo: string
  /** Serializa las escrituras para que dos llamadas simultáneas no tomen el mismo número. */
  private cola: Promise<unknown> = Promise.resolve()

  constructor(private readonly raiz: string) {
    this.archivo = join(rutas.out(raiz), "sap", "ordenes.jsonl")
  }

  async consultarProveedor(nit: string) {
    const { proveedores } = await cargarMaestros(this.raiz)
    const p = proveedores.find((x) => normalizarNit(x.nit) === normalizarNit(nit))
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null
  }

  async buscarOrdenPorReferencia(solicitud_id: string) {
    const r = (await this.leerRegistros()).find((x) => x.solicitud_id === solicitud_id)
    return r ? { numero_oc: r.numero_oc } : null
  }

  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const tarea = this.cola.then(async () => {
      const registros = await this.leerRegistros()
      const existente = registros.find((x) => x.solicitud_id === orden.referencia.solicitud_id)
      if (existente) return { numero_oc: existente.numero_oc, fecha: existente.fecha }
      const registro: Registro = {
        numero_oc: String(CONFIG.primerNumeroOc + registros.length),
        fecha: new Date().toISOString().slice(0, 10),
        solicitud_id: orden.referencia.solicitud_id,
        orden,
      }
      await agregarLinea(this.archivo, JSON.stringify(registro))
      return { numero_oc: registro.numero_oc, fecha: registro.fecha }
    })
    this.cola = tarea.catch(() => undefined)
    return tarea
  }

  private async leerRegistros(): Promise<Registro[]> {
    if (!existsSync(this.archivo)) return []
    const texto = await readFile(this.archivo, "utf8")
    return texto.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Registro)
  }
}
