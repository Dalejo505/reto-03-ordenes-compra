import { AlertCircle, Bot, TriangleAlert, Wrench } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Markdown } from "@/components/markdown"
import { LlamadaHerramienta } from "@/components/llamada-herramienta"
import type { EntradaHistorial } from "@/lib/api"
import { cn } from "@/lib/utils"

export function Mensaje({ entrada }: { entrada: EntradaHistorial }) {
  if (entrada.tipo === "usuario") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
          {entrada.texto}
        </div>
      </div>
    )
  }

  const { llamadas, necesitaConfirmacion, error } = entrada
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background">
        <Bot className="size-4 text-muted-foreground" />
      </div>
      <div
        className={cn(
          "min-w-0 flex-1 space-y-3 rounded-2xl rounded-tl-md border bg-card px-4 py-3",
          necesitaConfirmacion && "border-amber-400 ring-1 ring-amber-400/40 dark:border-amber-500",
          error && "border-destructive/50",
        )}
      >
        {llamadas.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Wrench className="size-3.5" />
              {llamadas.length} {llamadas.length === 1 ? "llamada a herramienta" : "llamadas a herramientas"}
            </div>
            {llamadas.map((ll, i) => (
              <LlamadaHerramienta key={i} llamada={ll} />
            ))}
          </div>
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>No se pudo completar</AlertTitle>
            <AlertDescription>{entrada.texto}</AlertDescription>
          </Alert>
        ) : (
          <Markdown texto={entrada.texto || "(sin texto)"} />
        )}

        {necesitaConfirmacion && (
          <Alert className="border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-500/60 dark:bg-amber-950/40 dark:text-amber-100">
            <TriangleAlert />
            <AlertTitle>Requiere tu confirmación</AlertTitle>
            <AlertDescription className="text-amber-800 dark:text-amber-200/80">
              La OC no se crea hasta que confirmes de forma explícita en tu próximo mensaje.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  )
}
