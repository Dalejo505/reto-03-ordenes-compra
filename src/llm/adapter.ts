// Interfaz propia hacia el modelo. El ciclo del agente solo conoce estos tipos;
// cambiar de proveedor es escribir otra implementación de ProveedorLLM.
import type { DefinicionHerramienta } from "../tools"

export type BloqueTexto = { tipo: "texto"; texto: string }
export type BloqueLlamada = { tipo: "llamada"; id: string; nombre: string; argumentos: unknown }
export type BloqueResultado = { tipo: "resultado"; id: string; contenido: string; esError: boolean }

export type MensajeLLM =
  | { rol: "usuario"; bloques: (BloqueTexto | BloqueResultado)[] }
  /** `crudo` guarda el contenido nativo del proveedor (p. ej. bloques de razonamiento) para reenviarlo intacto. */
  | { rol: "asistente"; bloques: (BloqueTexto | BloqueLlamada)[]; crudo?: unknown }

export type RespuestaLLM = {
  bloques: (BloqueTexto | BloqueLlamada)[]
  fin: "fin" | "herramientas" | "limite_tokens" | "rechazo"
  uso: { entrada: number; salida: number }
  crudo: unknown
}

export interface ProveedorLLM {
  readonly nombre: string
  readonly modelo: string
  enviar(sistema: string, mensajes: MensajeLLM[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM>
}

/** Error del proveedor con un mensaje apto para mostrar al usuario (nunca incluye claves). */
export class ErrorLLM extends Error {}
