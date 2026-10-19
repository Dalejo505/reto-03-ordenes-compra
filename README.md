# Reto 03 · Agente de Órdenes de Compra SAP

Agente conversacional que lee el paquete de una solicitud de compra (correo, solicitud, cotización, aprobación y factura), lo valida contra los maestros con los controles RC1–RC10, construye la OC con trazabilidad, genera la evidencia de aprobación y crea la OC en un SAP simulado. La confirmación humana se exige cuando hay excepciones.

- **Link de prueba:** _pendiente de despliegue_
- **Clave de acceso:** solo si se define `ACCESS_KEY` en el servidor; el front la pide al cargar.

## Requisitos

- Node 20 o superior (probado con Node 24). También funciona con Bun.
- Una clave de Anthropic para el chat. `demo.ts` no la necesita.

## Levantar en local (un comando)

```bash
npm install && npm run dev
```

`npm install` instala también las dependencias del front (`web/`). `npm run dev` levanta el backend (puerto 3000) y el front con recarga en caliente (Vite, puerto 5173): abre **http://localhost:5173**.

En producción, el backend sirve el front compilado desde un solo puerto:

```bash
npm run build && npm start
```

Después abre http://localhost:3000. Las variables se leen del entorno; ver `.env.example`:

| Variable | Uso | Valor por defecto |
|---|---|---|
| `ANTHROPIC_API_KEY` | Clave del modelo. Solo vive en el backend. | — (obligatoria para el chat) |
| `LLM_MODEL` | Modelo de Claude | `claude-opus-5-5` |
| `LLM_EFFORT` | Esfuerzo de razonamiento (`low`…`max`) | `medium` |
| `MAX_ITERACIONES_POR_TURNO` | Tope de ciclos modelo → herramientas por turno | `25` |
| `MAX_TOKENS_POR_SESION` | Tope de tokens por sesión | `200000` |
| `LLM_TIMEOUT_MS` | Timeout de cada llamada al modelo | `60000` |
| `PORT` | Puerto HTTP | `3000` |
| `ACCESS_KEY` | Si se define, la API exige el header `x-access-key` | vacío |

Lo más simple es copiar `.env.example` a `.env` y completarlo: el servidor lo carga al arrancar, y `.env` está en `.gitignore`. Las variables de la terminal tienen prioridad sobre el archivo.

## Demo sin modelo

```bash
npm run demo
```

Equivale a `bun run demo.ts`. Limpia `out/` y procesa los 6 casos llamando directamente a las herramientas. Imprime `apta`, bloqueos, confirmaciones, `retroactiva` y el número de OC o el motivo. Además:

- ejecuta `sol-001` dos veces para mostrar la idempotencia;
- confirma `sol-004` y `sol-005` de forma explícita.

Resultado esperado:

| Caso | Resultado |
|---|---|
| sol-001 | OC 4500000001 creada; en la segunda ejecución devuelve el mismo número |
| sol-002 | Bloqueada: RC1, proveedor inexistente |
| sol-003 | Bloqueada: RC2, el aprobador no pertenece a CC-2020 |
| sol-004 | Pendiente por RC5 (6 % de diferencia); con confirmación, OC 4500000002 |
| sol-005 | Pendiente por RC8 (retroactiva); con confirmación, OC 4500000003 con `retroactiva=true` |
| sol-006 | Pendiente por RC6 (IVA derivado C1); además informa derivados de NIT y condiciones de pago |

Salidas: `out/sap/ordenes.jsonl`, `out/control.csv`, `out/log.jsonl` y, por caso, `out/<caso>/{validacion,payload,trazabilidad,oc}.json` y `aprobacion.{txt,pdf}`.

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | `{ id, creada, tokensUsados, historial[] }` |
| `GET` | `/api/health` | `{ ok, provider, model, accessKey, limites }` (sin claves) |
| `GET` | `/api/casos` | Resumen de las solicitudes del buzón para el panel lateral (no usa el modelo) |

`sessionId`: 6 a 64 caracteres `[a-zA-Z0-9_-]`. El front lo genera y lo guarda en el navegador.

## Estructura

```
agent/prompt.md                 comportamiento (system prompt)
src/knowledge/ordenes-compra.md conocimiento del proceso
src/tools/oc.ts                 herramientas oc_* (zod, { ok, data } | { ok:false, error })
src/tools/base.ts               envoltorio: valida args, nunca lanza, escribe out/log.jsonl
src/oc/                         dominio: paquete, maestros, reglas RC1–RC10, payload, evidencia, control
src/sap/adapter.ts, mock.ts     interfaz SapAdapter y SAP simulado sobre out/sap/
src/llm/adapter.ts, anthropic.ts interfaz ProveedorLLM e implementación para Claude
src/agente/                     ciclo del agente, sesiones, límites
src/server.ts                   API HTTP y estáticos
web/                            front de chat: React + Vite + Tailwind + shadcn/ui
demo.ts                         verificación sin modelo
```
