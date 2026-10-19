# Módulo reutilizable: agente de órdenes de compra

El mismo agente de la aplicación, empaquetado para integrarlo en otras plataformas de agentes sin depender del servidor HTTP.

```
modulo/
├── agent.md                          # frontmatter (description, mode: primary, permission edit/bash: deny) + system prompt
├── tools/oc.ts                       # herramientas oc_* (reexporta src/tools/oc.ts: misma implementación)
└── skill/ordenes-compra/SKILL.md     # frontmatter (name, description) + conocimiento del proceso
```

## Por qué no hay copias divergentes

| Pieza | Fuente única | Cómo se mantiene igual |
|---|---|---|
| `tools/oc.ts` | `src/tools/oc.ts` | Es un reexport; no hay código duplicado. |
| `agent.md` | `agent/prompt.md` | Lo genera `npm run modulo`. `npm run build`, que también corre en el despliegue, falla si quedó desactualizado. |
| `SKILL.md` | `src/knowledge/ordenes-compra.md` | Igual que `agent.md`. |

## Integración (ejemplo con OpenCode)

El formato coincide con los agentes, herramientas y skills de OpenCode. Las herramientas se nombran `<archivo>_<export>`, así que `tools/oc.ts` expone `oc_leer_paquete`, `oc_validar`, etc.

1. **Agente**: copia `modulo/agent.md` a `.opencode/agent/ordenes-compra.md`.
2. **Herramientas**: crea `.opencode/tool/oc.ts` con:
   ```ts
   export * from "<ruta-al-repo>/modulo/tools/oc"
   ```
   Cada herramienta recibe `ctx.directory`, que debe ser la carpeta que contiene `fixtures/reto-03/`. Escribe sus salidas en `out/`, o en `OUT_DIR` si se define.
3. **Skill**: copia `modulo/skill/ordenes-compra/` a la carpeta de skills de la plataforma (por ejemplo `.opencode/skill/`).

Contrato de cada herramienta: `{ description, args, execute(args, ctx) }`. `args` son esquemas zod con `.describe()` y `execute` devuelve un JSON `{ ok: true, data }` o `{ ok: false, error }` sin lanzar nunca. La regla de confirmación humana está dentro de `oc_crear`: exige `confirmado: true` si hay excepciones y revalida el payload contra los archivos. Por eso el control se mantiene aunque la plataforma anfitriona no tenga el guardián del servidor de esta app.
