// Herramientas del agente de órdenes de compra, importables sin el servidor.
// Es la MISMA implementación que usa la aplicación (src/tools/oc.ts), reexportada:
// cada export se expone como oc_<export> en plataformas que nombran las herramientas
// como <archivo>_<export> (por ejemplo, OpenCode en .opencode/tool/oc.ts).
//
// Contrato de cada herramienta: { description, args (esquemas zod), execute(args, ctx) },
// donde ctx.directory es la raíz del proyecto que contiene fixtures/reto-03/ y execute
// devuelve un JSON { ok: true, data } o { ok: false, error } sin lanzar nunca.
export { listar_casos, leer_paquete, validar, construir_payload, generar_evidencia, crear } from "../../src/tools/oc"
