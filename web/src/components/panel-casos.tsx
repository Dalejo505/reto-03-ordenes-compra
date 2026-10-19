import { FileText, Play, Receipt } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ResumenCaso } from "@/lib/api"

const formato = (valor: number, moneda: string) =>
  `${moneda} ${valor.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`

/** Lista de solicitudes del buzón; cada una se puede enviar al agente con un clic. */
export function PanelCasos({
  casos,
  ocupado,
  onProcesar,
}: {
  casos: ResumenCaso[]
  ocupado: boolean
  onProcesar: (caso: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <FileText className="size-3.5" /> Solicitudes
      </div>
      {casos.length === 0 && <p className="px-1 text-sm text-muted-foreground">Cargando…</p>}
      {casos.map((c) => (
        <div key={c.caso} className="group rounded-lg border bg-card p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs font-medium">{c.caso}</span>
            <div className="flex items-center gap-1">
              {c.tiene_factura && (
                <Badge variant="outline" className="gap-1">
                  <Receipt /> factura
                </Badge>
              )}
              <Badge variant="secondary">{c.centro_costo}</Badge>
            </div>
          </div>
          <p className="mt-1.5 line-clamp-2 text-sm leading-snug">{c.descripcion}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{c.proveedor}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium tabular-nums">{formato(c.valor_total, c.moneda)}</span>
            <Button size="xs" variant="outline" disabled={ocupado} onClick={() => onProcesar(c.caso)}>
              <Play /> Procesar
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
