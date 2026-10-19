import { useState } from "react"
import { CheckCircle2, ChevronRight, XCircle } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { LlamadaVisible } from "@/lib/api"
import { cn } from "@/lib/utils"

/** Una llamada a herramienta: nombre, resumen y, al expandir, argumentos y resultado. */
export function LlamadaHerramienta({ llamada }: { llamada: LlamadaVisible }) {
  const [abierta, setAbierta] = useState(false)
  const Icono = llamada.ok ? CheckCircle2 : XCircle
  return (
    <Collapsible open={abierta} onOpenChange={setAbierta} className="rounded-lg border bg-muted/40 text-xs">
      <CollapsibleTrigger className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/70">
        <ChevronRight className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform", abierta && "rotate-90")} />
        <Icono className={cn("mt-0.5 size-3.5 shrink-0", llamada.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")} />
        <span className="shrink-0 font-mono font-medium">{llamada.nombre}</span>
        <span className={cn("min-w-0 truncate", llamada.ok ? "text-muted-foreground" : "text-destructive")}>{llamada.resumen}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-2 border-t px-3 py-2">
          <Bloque titulo="Argumentos" valor={llamada.argumentos} />
          <Bloque titulo="Resultado" valor={llamada.ok ? llamada.resultado : llamada.resumen} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Bloque({ titulo, valor }: { titulo: string; valor: unknown }) {
  return (
    <div>
      <div className="mb-1 font-medium text-muted-foreground">{titulo}</div>
      <pre className="max-h-72 overflow-auto rounded-md bg-background p-2 font-mono text-[11px] leading-relaxed">
        {typeof valor === "string" ? valor : JSON.stringify(valor, null, 2)}
      </pre>
    </div>
  )
}
