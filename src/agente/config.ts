import { ProveedorAnthropic } from "../llm/anthropic"
import type { ProveedorLLM } from "../llm/adapter"

function entero(nombre: string, porDefecto: number): number {
  const v = Number(process.env[nombre])
  return Number.isFinite(v) && v > 0 ? v : porDefecto
}

export const LIMITES = {
  maxIteraciones: entero("MAX_ITERACIONES_POR_TURNO", 25),
  maxTokensSesion: entero("MAX_TOKENS_POR_SESION", 200_000),
  timeoutMs: entero("LLM_TIMEOUT_MS", 60_000),
  maxTokensRespuesta: entero("LLM_MAX_TOKENS", 16_000),
}

const ESFUERZOS = ["low", "medium", "high", "xhigh", "max"] as const
type Esfuerzo = (typeof ESFUERZOS)[number]

export function crearProveedor(): ProveedorLLM {
  const proveedor = process.env.LLM_PROVIDER ?? "anthropic"
  if (proveedor !== "anthropic") throw new Error(`Proveedor LLM no soportado: ${proveedor}`)
  const esfuerzo = (ESFUERZOS as readonly string[]).includes(process.env.LLM_EFFORT ?? "")
    ? (process.env.LLM_EFFORT as Esfuerzo)
    : "medium"
  return new ProveedorAnthropic({
    modelo: process.env.LLM_MODEL || "claude-opus-5-5",
    timeoutMs: LIMITES.timeoutMs,
    esfuerzo,
    maxTokens: LIMITES.maxTokensRespuesta,
  })
}
