# SOLUCIÓN · Reto 03 — Agente conversacional "Órdenes de Compra SAP"

## 1. Problema en una frase

La analista administrativa digita a mano en SAP cada orden de compra y valida de memoria quién puede aprobar qué. Eso cuesta tiempo, deja pasar errores que se corrigen en el cierre contable y no permite medir cuántas OC se crean después de la factura. Le duele a la analista (tiempo), a contabilidad y auditoría (control) y a la dirección (medición).

## 2. Arquitectura

```
┌──────────────────────┐  POST /api/chat    ┌───────────────────────────────────────────────┐
│ web/ React + shadcn  │ ─────────────────▶ │ src/app.ts (manejador HTTP: API + estáticos)  │
│ · panel solicitudes  │ ◀───────────────── │   montado por src/server.ts (local / Render)  │
│ · historial          │ reply, toolCalls,  │   o src/vercel.ts → api/index.mjs (Vercel)    │
│ · tool calls         │ needsConfirmation  │   └─ src/agente/ciclo.ts                      │
│ · confirmar          │                    │        prompt → ProveedorLLM → herramientas   │
└──────────────────────┘                    │        · topes de iteraciones, tokens, IP     │
                                            │        · regla de confirmación (CA3)          │
                                            │   └─ src/llm/adapter.ts ← anthropic.ts         │
                                            │   └─ src/tools/oc.ts (zod) ──▶ src/oc/*       │
                                            │                          └──▶ src/sap/mock.ts │
                                            └───────────────┬─────────────────────┬─────────┘
                                                            │                     │
                                            fixtures/ (solo lectura)      out/ u OUT_DIR (escritura)
                                            solicitudes, maestros         sap/ordenes.jsonl, control.csv,
                                                                          log.jsonl, <caso>/*, sesiones/

modulo/ (bonus) = agent.md (← agent/prompt.md) + tools/oc.ts (reexporta src/tools/oc.ts) + skill/ (← src/knowledge/)
```

| Pieza | Dónde vive | Qué contiene |
|---|---|---|
| Comportamiento | `agent/prompt.md` | Orden de las herramientas, reglas de no inventar, cuándo preguntar y formato de respuesta |
| Conocimiento | `src/knowledge/ordenes-compra.md` | El proceso, la matriz RC1–RC10, la regla de idempotencia, qué es una OC retroactiva y qué pedir al solicitante |
| Ejecución | `src/tools/oc.ts` → `src/oc/*` | Lectura del paquete, reglas, payload, evidencia, control y adaptador SAP |
| Parámetros de negocio | `src/oc/config.ts` | Tolerancia del 2 %, ±1 de aritmética, 40 caracteres, sociedad, primer número de OC |

El system prompt se arma con `prompt.md` más el archivo de conocimiento. Un cambio en las reglas de negocio toca `src/oc/` o `config.ts`; nunca el servidor ni el ciclo.

**Links:** app https://periferia-ordenes-compra.vercel.app · código https://github.com/Dalejo505/reto-03-ordenes-compra

## 3. Ciclo del agente

`src/agente/ciclo.ts`:

1. Agrega el mensaje del usuario a la sesión. La sesión vive en memoria y se persiste en `out/sesiones/<id>.json`.
2. Repite hasta `MAX_ITERACIONES_POR_TURNO` veces (25 por defecto):
   - Si la sesión superó `MAX_TOKENS_POR_SESION`, responde que se alcanzó el tope.
   - Llama a `proveedor.enviar(sistema, mensajes, herramientas)`, con el timeout configurable.
   - Si el modelo pide herramientas, las ejecuta. Cada herramienta valida sus argumentos con zod y nunca lanza. El resultado vuelve al modelo como `tool_result`, se guarda para el front y queda en `out/log.jsonl`.
   - Si el modelo termina, esa es la respuesta.
3. Al llegar al tope de iteraciones, responde con lo hecho y lo que falta (CA1).
4. Un error del proveedor (`ErrorLLM`) se convierte en un mensaje claro. Las llamadas sin resultado se cierran para que el historial siga siendo válido y la sesión siga viva (CA5).
5. Los turnos de una misma sesión se serializan.

**Confirmación humana (CA3), aplicada en el código y no solo en el prompt:**

- Si en un turno `oc_validar` o `oc_construir_payload` devuelve confirmaciones, o `oc_crear` responde "Requiere confirmación", el caso queda como `pendiente`. Ese turno se marca `needsConfirmation: true` y el front lo resalta con los botones "Confirmo / No, espera".
- `oc_crear` con `confirmado: true` solo se ejecuta si se cumplen dos condiciones: el caso quedó pendiente en el turno inmediatamente anterior y el mensaje actual del usuario es una confirmación explícita ("sí", "confirmo", "adelante"… y sin negaciones). Si el modelo intenta confirmar en el mismo turno en que presentó las excepciones, el servidor le devuelve un error y no se crea nada. Esto está probado con un proveedor guionado.

**El modelo no puede afirmar ni alterar valores (CA2):** `oc_crear` no confía en el payload que le pasa el modelo. Vuelve a leer el paquete desde los archivos, revalida, reconstruye la OC esperada y la compara campo por campo con la recibida. Si algo difiere (un monto "arreglado", otra moneda), rechaza la creación.

## 4. Elección del modelo

- **Proveedor:** Anthropic, con `@anthropic-ai/sdk`.
- **Modelo:** `claude-sonnet-5-5` con esfuerzo `medium`. Ambos se cambian con `LLM_MODEL` y `LLM_EFFORT`, sin tocar código. Si `LLM_MODEL` no se define, el código usa `claude-opus-5-5`.
- **Por qué:** el agente orquesta herramientas, explica bloqueos y redacta preguntas de confirmación. Necesita seguir instrucciones con precisión y usar herramientas de forma fiable. Toda la lógica crítica es determinista y vive en las herramientas, así que un modelo de gama media basta y cuesta la mitad que Opus. Opus queda como opción si se necesita más razonamiento.
- **Protecciones:**
  - Se usa `fallbacks: "default"` para que una negativa por clasificador se reintente en otro modelo.
  - El system prompt se cachea (`cache_control`).
  - Hay timeout, un solo reintento y topes de iteraciones y de tokens.
- **Costo por caso, medido:** el flujo del PRD con `sol-004` (procesar, mostrar la OC, pedir confirmación, "confirmo" y crear) usó 60.286 tokens en 2 turnos, según `tokensUsados` de la sesión. Son unas 6 llamadas al modelo y 5 herramientas. Con Sonnet 5.5 ($2 por millón de tokens de entrada y $10 por millón de salida), y siendo casi todo entrada, cuesta unos **US$0,12 a 0,15 por caso** sin contar la caché del system prompt, que lo reduce. Con Opus 5.5 ($4 / $20) sería más o menos el doble.
- Cambiar de proveedor implica escribir otra implementación de `ProveedorLLM` en `src/llm/`. El ciclo no cambia.

## 5. Matriz de controles

Implementada en `src/oc/reglas.ts`. Cada regla es una función pura `(contexto) → { bloqueos, confirmaciones, derivados, retroactiva }` y `validarPaquete` las agrega. `oc_validar` devuelve también `controles`, con el estado de cada RC (`ok`, `bloqueo`, `confirmacion`, `derivado` o `no_evaluado`), para que el agente diga qué pasó y qué no sin inferirlo.

| Regla | Implementación | Tipo | Caso que la dispara |
|---|---|---|---|
| RC1 | Busca el proveedor por NIT normalizado (sin puntos ni DV) o, sin NIT, por nombre normalizado (sin tildes ni puntuación). Exige que esté `activo`. Si lo encontró por nombre, informa el NIT como derivado. | Bloqueo | sol-002 |
| RC2 | Exige aprobación, la palabra "Aprobado" (detecta negaciones como "no aprobado") y un remitente listado en los aprobadores del `centro_costo`. | Bloqueo | sol-003 (fvargas aprueba en CC-3030 y la compra es de CC-2020) |
| RC3 | Compara `valor_total` con el tope del aprobador. Sugiere qué aprobadores del centro sí tienen tope suficiente. | Bloqueo | — |
| RC4 | Exige que el centro de costo exista y que la subárea le pertenezca. | Bloqueo | — |
| RC5 | Calcula `abs(cot − sol) / sol` frente al 2 %, y revisa que la moneda coincida. Sin cotización, también pide confirmación. Devuelve ambos valores. | Confirmación | sol-004 (6 %) |
| RC6 | Si no hay IVA, deriva `indicador_iva_default` y pide confirmación. Un código que no esté en el maestro es bloqueo. | Confirmación + derivado | sol-006 |
| RC7 | Si no hay condiciones de pago, deriva las del proveedor y solo lo informa. Un código inexistente es bloqueo. | Derivado | sol-006 |
| RC8 | Si la fecha de la factura es menor que `fecha_solicitud`, marca `retroactiva = true` y pide confirmación. | Confirmación | sol-005 |
| RC9 | Si la fecha de la aprobación es menor que `fecha_solicitud`, pide confirmación. | Confirmación | — |
| RC10 | Verifica que `|cantidad × valor_unitario − valor_total|` sea menor o igual a 1. | Bloqueo | — |
| Moneda | La OC solo admite COP y USD (por esquema). | Bloqueo | — |

**La más difícil fue RC1 sin NIT (sol-006).** Identificar un proveedor por nombre es frágil: "TecnoSuministros S.A.S." frente a "Tecnosuministros SAS". Opté por una coincidencia exacta del nombre normalizado, que es determinista, y no por una similitud difusa. Si no hay coincidencia exacta, prefiero bloquear y pedir el NIT antes que crear una OC con el proveedor equivocado. Además, el NIT derivado se informa explícitamente.

## 6. Diseño del adaptador SAP real

**Opción elegida: OData `API_PURCHASEORDER_PROCESS_SRV` (S/4HANA), expuesto a través de SAP Integration Suite o API Management.** Es la API estándar y publicada para crear órdenes de compra, usa REST y JSON (encaja con TypeScript y no necesita SDK propietario) y trae CSRF y ETag. Si el sistema es ECC, la alternativa es `BAPI_PO_CREATE1` por RFC detrás de un microservicio puente con el conector JCo o node-rfc. Mientras la viabilidad no esté confirmada, el código ya depende solo de la interfaz `SapAdapter`: cambiar `SapMock` por `SapODataAdapter` es una línea.

**Mapeo del payload (7.4) a `A_PurchaseOrder`:**

| Payload | OData |
|---|---|
| `sociedad` | `CompanyCode` |
| `organizacion_compras` | `PurchasingOrganization` (+ `PurchasingGroup` configurable) |
| `proveedor.codigo_sap` | `Supplier` |
| `moneda` | `DocumentCurrency` |
| `condiciones_pago` | `PaymentTerms` |
| `referencia.solicitud_id` | `CorrespondncExternalReference` (clave de idempotencia) |
| `posiciones[].numero` | `PurchaseOrderItem` (10, 20…) |
| `descripcion` | `PurchaseOrderItemText` (40 caracteres) |
| `cantidad` / `unidad` | `OrderQuantity` / `PurchaseOrderQuantityUnit` (UN→`EA`, H→`H`, MES→`MON` según customizing) |
| `precio_unitario` | `NetPriceAmount` |
| `indicador_iva` | `TaxCode` |
| `centro_costo` | `to_AccountAssignment.CostCenter` con `AccountAssignmentCategory = K` |
| `subarea` | Campo de imputación configurable: centro de beneficio, orden interna o texto, según la definición de finanzas |
| `aprobador` y evidencia | La evidencia en PDF se adjunta con `API_CV_ATTACHMENT_SRV` (GOS) y el sha256 va en el texto de cabecera |
| `excepciones` | Nota de cabecera de la OC |

**Autenticación y credenciales:**

- Se usa un usuario técnico de comunicación (Communication Arrangement), con OAuth2 client credentials o un certificado X.509 a través de Integration Suite.
- Las credenciales viven en un gestor de secretos (Azure Key Vault o AWS Secrets Manager) y las lee solo el proceso del adaptador. Nunca están en el prompt, en el modelo, en los logs ni en el repositorio.
- El agente no ve tokens: solo llama a `oc_crear`.

**Idempotencia y errores:**

- Antes de crear, `buscarOrdenPorReferencia` hace un GET filtrando por `CorrespondncExternalReference = solicitud_id`. Si la OC existe, se devuelve su número.
- Los reintentos llevan backoff solo ante 429, 5xx y timeouts.
- Un timeout no implica que la OC no se creó, así que antes de reintentar se vuelve a consultar por referencia.
- Un error de negocio (400 con mensajes en `sap-message`) no se reintenta. Se traduce a lenguaje claro y queda en `control.csv` como `rechazada_sap`.
- Si la cabecera se crea pero falla el adjunto, la OC se registra como creada con la excepción "evidencia pendiente" y una cola reintenta el adjunto. Nunca se borra la OC automáticamente.

**Plan B si la conexión no es viable:** el agente hace todo igual hasta el payload validado y luego:

1. genera un archivo de carga masiva (CSV o plantilla para LSMW / Migration Cockpit, o la transacción ME21N vía script de SAP GUI ejecutado por la analista);
2. genera una ficha "lista para pegar" con los campos en el orden de ME21N y la evidencia en PDF.

Así, la validación, la trazabilidad y la medición de retroactivas, que son la mayor parte del valor, funcionan sin integración. La analista solo pega o carga.

## 7. Lectura del proceso: OC retroactivas

En los fixtures, sol-005 muestra el patrón: la factura FC-88231 es del 10 de agosto, la solicitud del 27 y la aprobación del 28. Hasta el aprobador escribe "Ya llegó la factura, por favor crear la OC para poder radicarla". La OC deja de ser un control previo del gasto y pasa a ser un trámite para poder pagar.

**Qué le diría a la dirección:** una OC retroactiva significa que el compromiso de gasto se adquirió sin aprobación previa, sin comparar cotizaciones y sin verificar el presupuesto del centro de costo. El riesgo no es la factura en sí, sino que la aprobación se vuelve un sello que no puede decir que no. El agente ya mide cada caso (`retroactiva=true` en `out/control.csv`). En un mes tendremos el porcentaje real por centro de costo, por proveedor y por aprobador, que es el dato que hoy no existe.

**Cambio de proceso que propongo:**

1. Ninguna factura se radica sin una OC con fecha anterior a la factura. Las excepciones las aprueba una instancia superior (por ejemplo, la dirección financiera), no el mismo líder.
2. Se publica el indicador mensual "% de OC retroactivas" por centro de costo, con meta descendente.
3. Las compras recurrentes (papelería, licencias) pasan a contratos marco u OC abiertas anuales, para que no haya excusa para comprar sin OC.
4. Se comunica a los proveedores que facturas sin número de OC se devuelven.

## 8. Decisiones y trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| `oc_crear` recalcula todo desde archivos y compara el payload | Confiar en el payload que envía el modelo | El modelo podría "arreglar" un monto. La comparación hace imposible alterarlo, cumple CA2 por diseño y mantiene el contrato `{ caso, payload, confirmado }`. |
| La regla de confirmación (CA3) se aplica en el servidor | Confiar solo en el prompt | Un prompt se puede saltar. El servidor solo deja pasar `confirmado=true` si hubo pendiente en el turno anterior y el usuario confirmó. |
| Ciclo manual sobre la Messages API | El Tool Runner del SDK | Necesito control fino por iteración: tope, presupuesto de tokens, autorización de llamadas y cierre de llamadas huérfanas. Además el ciclo queda desacoplado del proveedor gracias a `ProveedorLLM`. |
| Reglas como funciones puras en `src/oc/reglas.ts` | Reglas en el prompt o en el conocimiento | Los controles deben ser deterministas, probables sin modelo (`demo.ts`) y auditables. El conocimiento solo explica las reglas al modelo. |
| Proveedor sin NIT: coincidencia exacta del nombre normalizado | Similitud difusa (Levenshtein, embeddings) | Un falso positivo crea una OC al proveedor equivocado. Es mejor bloquear y pedir el NIT. |
| Precio de la OC tomado de la solicitud | Tomar el de la cotización | La solicitud es lo que aprobó el líder. Si difiere de la cotización, se confirma; si debe cambiar, se re-aprueba. |
| Backend con `node:http`; front con React, Vite y shadcn/ui, compilado y servido por el mismo backend | Express/Hono, o un front desplegado aparte | El backend necesita pocas rutas y no amerita un framework. shadcn da componentes accesibles (colapsables, alertas, tablas) y modo oscuro sin escribir CSS a mano. Servir `web/dist` desde Node deja un solo servicio para desplegar y evita configurar CORS. |
| Node + `tsx` | Bun | Bun no estaba disponible en la máquina de desarrollo. El código es compatible con ambos. |
| Desplegar en Vercel (función serverless + estáticos) | Render u otro host con proceso persistente | Vercel da un link estable y rápido, sin "dormir" el servicio. A cambio, el estado (sesiones, SAP simulado, logs) vive en `/tmp` y puede perderse si cambia la instancia. Por eso el manejador HTTP está separado del servidor (`src/app.ts`): el mismo código corre en local, en Render (`render.yaml`) o en Vercel. |
| `esbuild` empaqueta la API en un solo módulo para Vercel | Dejar que Vercel compile el TypeScript | El código usa imports ESM sin extensión (estilo bundler). Empaquetar evita errores de resolución en el runtime y deja un artefacto único y verificable localmente. |
| `modulo/` reexporta y genera desde las fuentes de la app | Copiar prompt, conocimiento y herramientas en `modulo/` | Las copias divergen con el tiempo. Con el reexport y la generación, más el chequeo en `npm run build`, el módulo es por construcción el mismo agente que corre en la app. |
| Límite de mensajes por IP en `/api/chat` | Solo el tope de tokens por sesión | Con un link público, cualquiera puede abrir sesiones nuevas sin parar. El límite por IP acota el gasto total de la clave. |

### Dependencias y por qué

| Dependencia | Para qué |
|---|---|
| `zod` | Esquemas de los argumentos de las herramientas (obligatorio), validación de los fixtures y del payload de la OC, y JSON Schema para el modelo (`z.toJSONSchema`). |
| `@anthropic-ai/sdk` | SDK oficial de Claude, con tipos, errores tipados, reintentos y timeout. Solo se usa en `src/llm/anthropic.ts`. |
| `pdf-lib` | Generar `aprobacion.pdf` (HU-4, P1) sin binarios nativos. |
| `tsx` | Ejecutar TypeScript en Node sin paso de compilación, igual que Bun. |
| `concurrently` (dev) | Que `npm run dev` levante backend y front con un solo comando. |
| `esbuild` (dev) | Empaquetar la API en una función serverless para Vercel. |
| Front: `react`, `vite`, `tailwindcss`, componentes de shadcn/ui (`@base-ui/react`, `lucide-react`, `cn`) | La interfaz del chat. |
| Front: `react-markdown` + `remark-gfm` | Mostrar las tablas Markdown del agente sin interpretar HTML crudo, lo que evita XSS. |

## 9. Supuestos

- La fecha de la aprobación se compara solo por día (sin hora ni zona horaria) contra `fecha_solicitud`.
- "Aprobado" se detecta con una expresión regular sin distinguir mayúsculas, y se excluyen negaciones explícitas ("no aprobado").
- La OC lleva una sola posición por solicitud, porque la solicitud trae un único ítem.
- La unidad se infiere de la descripción: "hora(s)" → `H`; "mensual" o "por mes" → `MES`; en otro caso `UN`. "Licencias por 12 meses" es `UN`, porque se compran 120 licencias, no meses.
- Los valores de la cotización son con IVA incluido, igual que `valor_total`.
- La evidencia se genera para todo caso con correo de aprobación, incluso si está bloqueado, como soporte del rechazo.
- `control.csv` registra cada llamada a `oc_crear` que llega a ejecutarse (creada, idempotente, bloqueada, pendiente_confirmacion o rechazada). Los rechazos que hace el guardián de confirmación del servidor no llegan a la herramienta. Quedan en el historial de la sesión y en `out/log.jsonl` como "rechazada por el ciclo".
- En un reintento idempotente, `oc_crear` devuelve el número de OC existente con `fecha: null`, porque la interfaz obligatoria `buscarOrdenPorReferencia` solo devuelve `numero_oc`.
- `confirmado_por` registra "analista (chat, sesión X)", porque el reto no tiene autenticación. En producción sería el usuario autenticado.

## 10. Cobertura

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 Leer el paquete | Hecho | Leer `.xlsx`, `.pdf` y `.eml` reales (P1 `oc_leer_excel` no implementado). |
| HU-2 Validar contra maestros | Hecho (RC1–RC10) | Consultar los maestros en SAP en línea, no en JSON. |
| HU-3 Construir el payload y la trazabilidad | Hecho | Mapear la unidad y la subárea al customizing real. |
| HU-4 Evidencia (txt P0 + pdf P1) | Hecho | Adjuntar el `.eml` original o un PDF firmado si auditoría lo exige. |
| HU-5 Crear en SAP simulado, idempotencia y control | Hecho | Adaptador OData real (sección 6). |
| HU-6 Manejo de errores | Hecho | Pruebas con paquetes corruptos adicionales a los fixtures. |
| Front, API, ciclo y confirmación | Hecho, probado con el modelo real (flujo `sol-004` del PRD) | Streaming y autenticación de usuarios. |
| Despliegue y link público | Hecho: https://periferia-ordenes-compra.vercel.app (Vercel) | Persistencia fuera de /tmp (Blob/KV o base de datos). |
| Bonus `modulo/` | Hecho: `tools/oc.ts` reexporta las herramientas de la app; `agent.md` y `SKILL.md` se generan desde `agent/prompt.md` y `src/knowledge/` y el build falla si divergen | Probarlo dentro de una plataforma de agentes real (por ejemplo OpenCode). |

## 11. Uso de IA

**Asistente usado para construir:** Claude Code (aplicación de escritorio) con el modelo Claude Opus 5.5. Otra cosa es el modelo que usa el agente en ejecución (Claude Sonnet 5.5, sección 4): ese es parte del producto, no una herramienta de desarrollo.

**Para qué lo usé:**

| Etapa | Qué hizo el asistente | Qué decidí o revisé yo |
|---|---|---|
| Análisis | Leyó y resumió los tres PRD (01 proveedores, 02 contratos, 03 OC), comparó dificultad y riesgo, y recomendó el 03. Luego leyó los fixtures y anticipó el resultado esperado de cada caso. | Elegí el reto 03. Contrasté el resumen con el instructivo en PDF del reto. |
| Dominio y herramientas | Escribió `src/oc/*` (lectura del paquete, reglas RC1–RC10, payload, evidencia, control), `src/sap/*` y `src/tools/oc.ts` con zod. | Revisé que cada regla correspondiera a la tabla 7.3 y que los 6 casos dieran el resultado esperado del PRD. |
| Ciclo del agente | Escribió el ciclo manual, el adaptador `ProveedorLLM`, el guardián de confirmación y el prompt. | Acepté aplicar CA3 en el servidor y no solo en el prompt. |
| Front | Hizo una primera versión en HTML plano. | **La descarté** y pedí rehacerla con React + shadcn/ui para una mejor experiencia y presentación. |
| Despliegue | Propuso Render (`render.yaml`). | **Elegí Vercel.** El asistente adaptó la app a serverless: separó el manejador HTTP, empaquetó con esbuild y movió `out/` a `/tmp`. Dejé `render.yaml` como alternativa. |
| Bonus | Armó `modulo/` reexportando las herramientas y generando `agent.md` y `SKILL.md` desde las fuentes, con un chequeo en el build. | Pedí el bonus y validé que no fueran copias divergentes. |
| Documentación | Redactó README y este documento a partir del trabajo hecho. | Ajusté decisiones, modelo y costos a lo que realmente elegí y medí. |

**Propuestas que cambié o descarté:**

- **Modelo:** el asistente propuso Claude Opus 5.5 por defecto. Lo cambié a Sonnet 5.5 por costo: la lógica crítica es determinista y está en las herramientas, y el flujo real cuesta la mitad (sección 4).
- **Sin pagar la API:** propuso usar Gemini (capa gratuita) mediante un adaptador nuevo. Lo descarté y usé una API key de Anthropic con límite de gasto.
- **Front en HTML plano y despliegue en Render:** reemplazados como se describe arriba.

**Problemas que salieron al revisar y probar, y cómo se corrigieron:**

1. El servidor no leía `.env`; solo usaba las variables de la terminal. Se agregó `src/env.ts` (`process.loadEnvFile`).
2. Al configurar el entorno, un token quedó en la variable equivocada (`ACCESS_KEY`) y en `.env.example`. El asistente lo detectó sin mostrar el valor, se corrigió antes del primer commit y se verificó que el historial de git no contenga claves.
3. En la auditoría contra el PRD: las llamadas que bloquea el guardián de confirmación no quedaban en `out/log.jsonl` (CA4). Se agregó ese registro.
4. Con el modelo real, el agente avisó que `oc_validar` no detallaba el resultado de cada control. Se agregó `controles` (estado por RC) y se actualizó el prompt.
5. shadcn instaló una dependencia llamada `cn`. Antes de aceptarla se verificó que es la utilidad oficial del mantenedor de shadcn.
6. La CLI de Vercel rechazó el nombre de proyecto con dígitos. Se creó el proyecto como `periferia-ordenes-compra`.

**Cómo se verificó lo que entrego:**

- Typecheck estricto sin `any`.
- `demo.ts` ejecutado dos veces con salida idéntica (determinismo).
- Un proveedor LLM guionado para probar el ciclo sin costo: confirmación en el mismo turno rechazada, confirmación en el turno siguiente aceptada, payload alterado rechazado, error del proveedor sin tumbar la sesión.
- El flujo de ejemplo del PRD (`sol-004` y luego "confirmo") con el modelo real.
- El build en una copia limpia con `NODE_ENV=production`, la función de Vercel montada en local y pruebas del link desplegado.

Todo el código entregado lo generó el asistente bajo mi dirección. Las decisiones de alcance, tecnología, modelo y despliegue son mías, y antes de la defensa repasé la lógica de `src/oc/reglas.ts`, `src/tools/oc.ts` y `src/agente/ciclo.ts`, que es la que sostiene los controles.

## 12. Riesgos de producción y mitigación

| Riesgo | Mitigación |
|---|---|
| La conexión a SAP no es viable a corto plazo | Plan B (sección 6). El valor de validación y medición no depende de la integración. |
| El modelo inventa o altera montos | Las herramientas son la única fuente de valores. `oc_crear` reconstruye y compara el payload. El prompt prohíbe afirmar valores. |
| Se crea una OC sin confirmación | El guardián del servidor y `confirmado` exigido por la herramienta. Todo intento queda en `control.csv`. |
| Fixtures distintos a la realidad (Excel con otro formato, cotizaciones escaneadas) | Lector `.xlsx` con validación de esquema, OCR para cotizaciones escaneadas y, ante baja confianza, confirmación en vez de valores supuestos. |
| Maestros desactualizados | Leer los maestros desde SAP en tiempo real con caché corta y un dueño del dato. |
| Costo del modelo | Topes de iteraciones y tokens por sesión, caché del prompt, esfuerzo `medium` y medición de `usage` por caso. |
| Credenciales filtradas | La clave solo vive en una variable de entorno del backend y nunca va a logs ni respuestas. `ACCESS_KEY` es opcional para el link y en producción se usaría SSO. |
| Concurrencia (dos analistas sobre la misma solicitud) | El mock serializa las escrituras. En SAP, la idempotencia por referencia externa y el bloqueo optimista. |
| Estado efímero en serverless: en Vercel, sesiones, OC simuladas y logs viven en `/tmp` y se pierden al reciclar la instancia | En producción: sesiones y log de control en una base de datos (Postgres, Vercel KV o Blob) y la OC en SAP real, que es la fuente de verdad. El manejador ya está separado del almacenamiento por rutas (`OUT_DIR`). |
| Abuso del link público (gasto de la clave) | Límite de 40 mensajes por hora por IP, 200 mil tokens por sesión, `ACCESS_KEY` opcional y un límite de gasto mensual en la consola de Anthropic. |
| Instrucciones maliciosas dentro de un correo o una cotización (prompt injection) | El texto de los adjuntos es dato: los controles son código determinista. Crear una OC exige que el payload coincida con el reconstruido desde los archivos y una confirmación humana explícita en el turno siguiente. Ningún texto puede saltarse RC1–RC10. |
