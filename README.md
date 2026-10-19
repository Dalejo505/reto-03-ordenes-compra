# Reto 03 · Agente de Órdenes de Compra SAP

Agente conversacional que lee el paquete de una solicitud de compra (correo, solicitud, cotización, aprobación y factura), lo valida contra los maestros con los controles RC1–RC10, construye la OC con trazabilidad, genera la evidencia de aprobación y crea la OC en un SAP simulado. La confirmación humana se exige cuando hay excepciones.

- **Link de prueba:** https://periferia-ordenes-compra.vercel.app
- **Clave de acceso:** no requerida (el link es abierto y está limitado a 40 mensajes por hora por IP). Si se define `ACCESS_KEY`, el front la pide al cargar.

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
| `MAX_MENSAJES_POR_HORA_IP` | Mensajes de chat por hora por IP | `40` |
| `PORT` | Puerto HTTP | `3000` |
| `ACCESS_KEY` | Si se define, la API exige el header `x-access-key` | vacío |

Lo más simple es copiar `.env.example` a `.env` y completarlo: el servidor lo carga al arrancar, y `.env` está en `.gitignore`. Las variables de la terminal tienen prioridad sobre el archivo.

## Despliegue en Vercel (link de la defensa)

`vercel.json` sirve `web/dist` como sitio estático y la API como una sola función serverless (`api/index.mjs`). El build empaqueta `src/vercel.ts` con esbuild (`scripts/build-api.mjs`) e incluye `fixtures/`, `agent/` y `src/knowledge/` en la función.

```bash
npx vercel link
npx vercel env add ANTHROPIC_API_KEY production
npx vercel deploy --prod
```

`vercel env add` pide el valor de forma interactiva; la clave nunca pasa por el repositorio. Las demás variables (`LLM_MODEL`, `ACCESS_KEY`…) se agregan igual o en el panel del proyecto.

Limitaciones de serverless:
- Solo `/tmp` es escribible: `out/` se redirige ahí con `OUT_DIR`.
- Sesiones, OC simuladas y logs viven en `/tmp` de la instancia, así que se pierden cuando Vercel recicla o cambia de instancia. Para la demo alcanza; en producción irían a una base de datos o a Vercel Blob/KV.
- El límite por IP es por instancia. La duración máxima de la función es de 300 s.

## Despliegue alternativo (Render)

El repositorio trae `render.yaml`: un solo servicio web que compila el front y sirve la API.

1. Sube el repositorio a GitHub.
2. En https://dashboard.render.com elige **New → Blueprint**, conecta el repositorio y Render detecta `render.yaml`.
3. Cuando lo pida, ingresa los secretos:
   - `ANTHROPIC_API_KEY`: la clave de la consola de Anthropic.
   - `ACCESS_KEY`: una contraseña que inventes para proteger el link, o vacía si el link es abierto.
4. Render ejecuta `npm ci && npm run build` y luego `npm start`, y verifica `/api/health`.

Notas:
- El plan gratuito "duerme" el servicio tras 15 minutos sin uso; la primera visita tarda unos 50 segundos en despertarlo. Abre el link unos minutos antes de la defensa.
- El disco es efímero: `out/` (OC, control, logs, sesiones) se reinicia en cada despliegue o reinicio. Para la demo es suficiente.
- Protección de costo: el límite es de 40 mensajes por hora por IP (`MAX_MENSAJES_POR_HORA_IP`) y de 200 mil tokens por sesión. Pon además un límite de gasto en la consola de Anthropic.
- Railway, Fly.io o Azure App Service sirven con los mismos comandos (`npm ci && npm run build`, `npm start`) y las mismas variables.

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
src/app.ts                      manejador HTTP: API y estáticos
src/server.ts                   servidor local (proceso persistente)
src/vercel.ts, api/index.mjs    función serverless de Vercel
web/                            front de chat: React + Vite + Tailwind + shadcn/ui
demo.ts                         verificación sin modelo
```
