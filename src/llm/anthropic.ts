import Anthropic from "@anthropic-ai/sdk"
import type { DefinicionHerramienta } from "../tools"
import { ErrorLLM, type BloqueLlamada, type BloqueTexto, type MensajeLLM, type ProveedorLLM, type RespuestaLLM } from "./adapter"

type Esfuerzo = "low" | "medium" | "high" | "xhigh" | "max"

export type OpcionesAnthropic = { modelo: string; timeoutMs: number; esfuerzo: Esfuerzo; maxTokens: number }

/** Implementación de ProveedorLLM sobre la API de Claude (Messages API). */
export class ProveedorAnthropic implements ProveedorLLM {
  readonly nombre = "anthropic"
  readonly modelo: string
  private readonly cliente: Anthropic

  constructor(private readonly opciones: OpcionesAnthropic) {
    this.modelo = opciones.modelo
    // La clave se lee de ANTHROPIC_API_KEY dentro del SDK; nunca pasa por este código.
    this.cliente = new Anthropic({ timeout: opciones.timeoutMs, maxRetries: 1 })
  }

  async enviar(sistema: string, mensajes: MensajeLLM[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM> {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      throw new ErrorLLM("El servidor no tiene configurada la clave del modelo (ANTHROPIC_API_KEY). Las herramientas funcionan sin modelo con `npm run demo`.")
    }
    try {
      const r = await this.cliente.beta.messages.create({
        model: this.modelo,
        max_tokens: this.opciones.maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: this.opciones.esfuerzo },
        system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
        tools: herramientas.map((h) => ({
          name: h.nombre,
          description: h.descripcion,
          input_schema: h.esquema as Anthropic.Beta.BetaTool.InputSchema,
        })),
        messages: mensajes.map(aMensajeAnthropic),
      })
      return {
        bloques: r.content.flatMap(aBloque),
        fin: finDe(r.stop_reason),
        uso: { entrada: r.usage.input_tokens + (r.usage.cache_read_input_tokens ?? 0), salida: r.usage.output_tokens },
        crudo: r.content,
      }
    } catch (e) {
      throw new ErrorLLM(mensajeError(e))
    }
  }
}

function aMensajeAnthropic(m: MensajeLLM): Anthropic.Beta.BetaMessageParam {
  if (m.rol === "asistente") {
    // Se reenvía el contenido nativo (incluye bloques de razonamiento) sin modificarlo.
    if (m.crudo) return { role: "assistant", content: m.crudo as Anthropic.Beta.BetaContentBlockParam[] }
    return {
      role: "assistant",
      content: m.bloques.map((b) =>
        b.tipo === "texto"
          ? { type: "text" as const, text: b.texto }
          : { type: "tool_use" as const, id: b.id, name: b.nombre, input: b.argumentos },
      ),
    }
  }
  return {
    role: "user",
    content: m.bloques.map((b) =>
      b.tipo === "texto"
        ? { type: "text" as const, text: b.texto }
        : { type: "tool_result" as const, tool_use_id: b.id, content: b.contenido, is_error: b.esError },
    ),
  }
}

function aBloque(b: Anthropic.Beta.BetaContentBlock): (BloqueTexto | BloqueLlamada)[] {
  if (b.type === "text") return [{ tipo: "texto", texto: b.text }]
  if (b.type === "tool_use") return [{ tipo: "llamada", id: b.id, nombre: b.name, argumentos: b.input }]
  return []
}

function finDe(motivo: Anthropic.Beta.BetaMessage["stop_reason"]): RespuestaLLM["fin"] {
  if (motivo === "tool_use") return "herramientas"
  if (motivo === "max_tokens") return "limite_tokens"
  if (motivo === "refusal") return "rechazo"
  return "fin"
}

function mensajeError(e: unknown): string {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "El modelo no respondió a tiempo. Intenta de nuevo en un momento."
  if (e instanceof Anthropic.AuthenticationError) return "El servidor no tiene una clave válida del proveedor de IA. Revisa ANTHROPIC_API_KEY."
  if (e instanceof Anthropic.RateLimitError) return "El proveedor de IA está limitando las solicitudes. Espera unos segundos y reintenta."
  if (e instanceof Anthropic.BadRequestError) return `El proveedor de IA rechazó la solicitud: ${e.message}`
  if (e instanceof Anthropic.APIConnectionError) return "No hay conexión con el proveedor de IA."
  if (e instanceof Anthropic.APIError) return `Error del proveedor de IA (${e.status ?? "sin estado"}).`
  return "Error inesperado al llamar al modelo."
}
