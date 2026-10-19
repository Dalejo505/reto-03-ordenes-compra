import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Loader2, Moon, Plus, SendHorizontal, ShoppingCart, Sun, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Mensaje } from "@/components/mensaje"
import { PanelCasos } from "@/components/panel-casos"
import { api, ErrorApi, idSesionGuardado, nuevaSesion, type EntradaHistorial, type ResumenCaso } from "@/lib/api"

const EJEMPLOS = [
  "¿Qué solicitudes hay pendientes?",
  'Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.',
  "Procesa sol-002 y sol-003 y dime qué hay que pedirle a cada solicitante.",
]

function usarTema() {
  const [oscuro, setOscuro] = useState(() => document.documentElement.classList.contains("dark"))
  useEffect(() => {
    document.documentElement.classList.toggle("dark", oscuro)
    try {
      localStorage.setItem("oc.tema", oscuro ? "dark" : "light")
    } catch {
      // sin almacenamiento
    }
  }, [oscuro])
  return [oscuro, () => setOscuro((v) => !v)] as const
}

export default function App() {
  const [sesion, setSesion] = useState(idSesionGuardado)
  const [historial, setHistorial] = useState<EntradaHistorial[]>([])
  const [casos, setCasos] = useState<ResumenCaso[]>([])
  const [modelo, setModelo] = useState("…")
  const [texto, setTexto] = useState("")
  const [ocupado, setOcupado] = useState(false)
  const [oscuro, alternarTema] = usarTema()
  const fin = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.salud().then((s) => setModelo(`${s.provider} · ${s.model}`)).catch(() => setModelo("servidor no disponible"))
    api.casos().then(setCasos).catch(() => setCasos([]))
  }, [])

  useEffect(() => {
    api.historial(sesion).then(setHistorial).catch(() => setHistorial([]))
  }, [sesion])

  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [historial, ocupado])

  const enviar = useCallback(
    async (mensaje: string) => {
      const limpio = mensaje.trim()
      if (!limpio || ocupado) return
      setTexto("")
      setOcupado(true)
      const ts = new Date().toISOString()
      setHistorial((h) => [...h, { tipo: "usuario", texto: limpio, ts }])
      try {
        const r = await api.chat(sesion, limpio)
        setHistorial((h) => [...h, { tipo: "agente", texto: r.reply, llamadas: r.toolCalls, necesitaConfirmacion: r.needsConfirmation, ts: new Date().toISOString() }])
      } catch (e) {
        const detalle = e instanceof ErrorApi ? e.message : "Error inesperado."
        setHistorial((h) => [...h, { tipo: "agente", texto: detalle, llamadas: [], necesitaConfirmacion: false, ts: new Date().toISOString(), error: true }])
      } finally {
        setOcupado(false)
      }
    },
    [ocupado, sesion],
  )

  const ultima = historial[historial.length - 1]
  const esperaConfirmacion = !ocupado && ultima?.tipo === "agente" && ultima.necesitaConfirmacion

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShoppingCart className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold sm:text-base">Agente de Órdenes de Compra</h1>
            <p className="truncate text-xs text-muted-foreground">SAP simulado · Periferia IT Group</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="hidden font-mono sm:inline-flex">
            {modelo}
          </Badge>
          <Button variant="ghost" size="icon" aria-label="Cambiar tema" onClick={alternarTema}>
            {oscuro ? <Sun /> : <Moon />}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSesion(nuevaSesion())} disabled={ocupado}>
            <Plus /> Nueva sesión
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-r bg-muted/30 p-3 lg:block">
          <PanelCasos casos={casos} ocupado={ocupado} onProcesar={(c) => enviar(`Procesa la solicitud "${c}". Muéstrame la OC y las validaciones; no la crees sin mi confirmación si hay excepciones.`)} />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
              {historial.length === 0 && !ocupado && (
                <div className="py-8 text-center">
                  <h2 className="text-lg font-semibold">¿Qué solicitud procesamos?</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Leo el paquete, valido RC1–RC10 contra los maestros, armo la OC y la creo en SAP solo cuando todo cuadra o tú confirmas.
                  </p>
                  <div className="mt-6 grid gap-2 text-left">
                    {EJEMPLOS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => enviar(e)}
                        className="rounded-lg border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-muted"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {historial.map((e, i) => (
                <Mensaje key={`${e.ts}-${i}`} entrada={e} />
              ))}
              {ocupado && (
                <div className="flex items-center gap-2 pl-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> El agente está trabajando…
                </div>
              )}
              <div ref={fin} />
            </div>
          </div>

          <div className="border-t bg-background px-4 py-3">
            <div className="mx-auto max-w-3xl space-y-2">
              {esperaConfirmacion && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/60 dark:bg-amber-950/40 dark:text-amber-100">
                  <span className="mr-auto font-medium">El agente espera tu confirmación</span>
                  <Button size="sm" onClick={() => enviar("Confirmo, crea la OC.")}>
                    <Check /> Confirmo
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => enviar("No, todavía no la crees.")}>
                    <X /> No, espera
                  </Button>
                </div>
              )}
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  enviar(texto)
                }}
              >
                <Textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      enviar(texto)
                    }
                  }}
                  placeholder="Escribe tu mensaje… (Enter envía, Shift+Enter nueva línea)"
                  rows={2}
                  className="max-h-40 min-h-11 resize-none"
                />
                <Button type="submit" size="icon-lg" disabled={ocupado || !texto.trim()} aria-label="Enviar">
                  <SendHorizontal />
                </Button>
              </form>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
