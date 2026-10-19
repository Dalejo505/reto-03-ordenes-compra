# SOLUCIÓN · Reto 03 — Agente conversacional "Órdenes de Compra SAP"

## 1. Problema en una frase

La analista administrativa digita a mano en SAP cada orden de compra y valida de memoria quién puede aprobar qué. Eso cuesta tiempo, deja pasar errores que se corrigen en el cierre contable y no permite medir cuántas OC se crean después de la factura. Le duele a la analista (tiempo), a contabilidad y auditoría (control) y a la dirección (medición).

## 2. Arquitectura

```
┌───────────────┐  POST /api/chat   ┌─────────────────────────────────────────────┐
│ web/ (chat)   │ ────────────────▶ │ src/server.ts (node:http)                    │
│ · historial   │ ◀──────────────── │   └─ src/agente/ciclo.ts                     │
│ · tool calls  │  reply, toolCalls,│        prompt → ProveedorLLM → herramientas  │
│ · confirmar   │  needsConfirmation│        · tope de iteraciones y de tokens     │
└───────────────┘                   │        · regla de confirmación (CA3)         │
                                    │   └─ src/llm/adapter.ts ← anthropic.ts        │
                                    │   └─ src/tools/oc.ts (zod) ──▶ src/oc/*      │
                                    │                         └──▶ src/sap/mock.ts │
                                    └──────────────┬────────────────────┬─────────┘
                                                   │                    │
                                   fixtures/ (solo lectura)       out/ (escritura)
                                   solicitudes, maestros          sap/ordenes.jsonl, control.csv,
                                                                  log.jsonl, <caso>/*, sesiones/
```

| Pieza | Dónde vive | Qué contiene |
|---|---|---|
| Comportamiento | `agent/prompt.md` | Orden de las herramientas, reglas de no inventar, cuándo preguntar y formato de respuesta |
| Conocimiento | `src/knowledge/ordenes-compra.md` | El proceso, la matriz RC1–RC10, la regla de idempotencia, qué es una OC retroactiva y qué pedir al solicitante |
| Ejecución | `src/tools/oc.ts` → `src/oc/*` | Lectura del paquete, reglas, payload, evidencia, control y adaptador SAP |
| Parámetros de negocio | `src/oc/config.ts` | Tolerancia del 2 %, ±1 de aritmética, 40 caracteres, sociedad, primer número de OC |

El system prompt se arma con `prompt.md` más el archivo de conocimiento. Un cambio en las reglas de negocio toca `src/oc/` o `config.ts`; nunca el servidor ni el ciclo.

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

Implementada en `src/oc/reglas.ts`. Cada regla es una función pura `(contexto) → { bloqueos, confirmaciones, derivados, retroactiva }` y `validarPaquete` las agrega.

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

### Dependencias y por qué

| Dependencia | Para qué |
|---|---|
| `zod` | Esquemas de los argumentos de las herramientas (obligatorio), validación de los fixtures y del payload de la OC, y JSON Schema para el modelo (`z.toJSONSchema`). |
| `@anthropic-ai/sdk` | SDK oficial de Claude, con tipos, errores tipados, reintentos y timeout. Solo se usa en `src/llm/anthropic.ts`. |
| `pdf-lib` | Generar `aprobacion.pdf` (HU-4, P1) sin binarios nativos. |
| `tsx` | Ejecutar TypeScript en Node sin paso de compilación, igual que Bun. |
| `concurrently` (dev) | Que `npm run dev` levante backend y front con un solo comando. |
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
| Despliegue y link público | Pendiente | — |
| Bonus `modulo/` | Pendiente | — |

## 11. Uso de IA

> Completar con el detalle real antes de entregar.

- **Claude Code (Claude Opus 5.5)** se usó para: leer y resumir el PRD; diseñar la arquitectura; escribir el código de dominio, las herramientas, el ciclo del agente, el adaptador LLM, el front, la demo y esta documentación; y probar el ciclo con un proveedor guionado.
- **Revisión humana:** _(qué revisé línea por línea, qué cambié y qué descarté de lo propuesto, y por qué)_.

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
