---
name: ordenes-compra
description: Proceso de órdenes de compra de Periferia IT Group — controles RC1–RC10, bloqueos vs confirmaciones, derivados, OC retroactivas, idempotencia y qué pedir al solicitante. Úsala al procesar o explicar una solicitud de compra.
---
<!-- Generado por scripts/modulo.mjs desde src/knowledge/ordenes-compra.md. No editar a mano: edita la fuente y ejecuta `npm run modulo`. -->

# Órdenes de compra SAP

## El proceso

Cada compra llega a administración por correo con tres piezas: la solicitud (Excel), la cotización del proveedor y el correo de aprobación del líder. Con eso se crea una orden de compra (OC) en SAP y se adjunta el correo de aprobación como evidencia (PDF).

Actores:
- **Solicitante**: envía el paquete. Es a quien se le piden correcciones.
- **Líder aprobador**: aprueba por correo con la palabra "Aprobado". Debe estar registrado como aprobador del centro de costo y su tope debe cubrir el valor.
- **Analista administrativa**: crea la OC y confirma las excepciones. Es tu usuaria.
- **Contabilidad / Auditoría**: consume `out/control.csv`, donde queda cada intento (creada, bloqueada, pendiente, idempotente).

## Controles (RC1–RC10)

| Código | Control | Efecto |
|---|---|---|
| RC1 | El proveedor existe en el maestro (por NIT; sin NIT, por nombre) y está activo | Bloqueo |
| RC2 | Hay correo de aprobación, dice "Aprobado" y lo envía un aprobador del centro de costo | Bloqueo |
| RC3 | El valor total no supera el tope del aprobador en ese centro | Bloqueo |
| RC4 | La subárea pertenece al centro de costo | Bloqueo |
| RC5 | Cotización y solicitud difieren como máximo 2 %; sin cotización también se confirma | Confirmación |
| RC6 | Sin indicador de IVA: se deriva el del proveedor y se confirma | Confirmación + derivado |
| RC7 | Sin condiciones de pago: se derivan del proveedor | Solo se informa |
| RC8 | Factura con fecha anterior a la solicitud: OC **retroactiva** | Confirmación + marca en control |
| RC9 | La aprobación es anterior a la fecha de la solicitud | Confirmación |
| RC10 | cantidad × valor unitario = valor total (±1) | Bloqueo |

- Un **bloqueo** impide crear la OC. Se explica y se devuelve al solicitante con la acción sugerida.
- Una **confirmación** permite crear la OC solo si la analista la confirma de forma explícita. La confirmación queda registrada en `excepciones[].confirmado_por`.
- Un **derivado** es un valor completado desde los maestros. Siempre se informa.

## La orden de compra

- Sociedad `1000` y organización de compras `1000`.
- Una posición (10) por solicitud. La descripción se recorta a 40 caracteres (límite SAP del texto breve).
- Unidad: `H` si la compra es por horas, `MES` si es un cobro mensual y `UN` en los demás casos.
- El precio unitario y el total salen de la **solicitud** (lo que aprobó el líder). Cuando la cotización difiere, la OC no toma el valor cotizado: se pide confirmación o una solicitud corregida.
- Cada valor del payload tiene su fuente en `out/<caso>/trazabilidad.json`.
- La evidencia de aprobación (`aprobacion.txt` y `aprobacion.pdf`) lleva el sha256 del correo, que también va en `aprobador.evidencia_sha256`.

## OC retroactivas

Una OC es retroactiva cuando la factura ya llegó antes de la solicitud: la compra se hizo sin el control previo y se salteó la cotización. La dirección quiere medirlas. Se crean solo con confirmación y quedan con `retroactiva = true` en `out/control.csv`.

## Idempotencia

Crear dos veces la misma solicitud devuelve el número de OC existente y no crea una segunda. El SAP simulado numera desde 4500000001.

## Qué pedir al solicitante según el problema

- Proveedor inexistente: creación del proveedor en SAP (RUT, certificación bancaria, cámara de comercio) o un proveedor alternativo ya registrado.
- Aprobador sin autoridad o tope insuficiente: aprobación de un aprobador válido del centro de costo.
- Subárea o centro de costo incorrectos: la solicitud corregida.
- Aritmética que no cuadra: la solicitud corregida.
- Sin cotización o con cotización distinta: la cotización vigente o una solicitud ajustada y re-aprobada.
