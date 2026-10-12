# Guía para la defensa

## Antes de empezar (5 minutos antes)

1. Abre `https://<servicio>/api/health` para despertar el servicio (plan gratuito) y comprobar `llm_configurado: true`.
2. En el chat, pulsa **Reiniciar demo** (o `POST /api/reset`) para que la numeración empiece en 4500000001.
3. Ten a mano una terminal local con `bun run demo` por si el link o el proveedor fallan.

## Recorrido de 5 minutos

| Min | Qué hacer | Qué mostrar |
|---|---|---|
| 0:00 | Botón **▶ Prompt de demo** (sol-004). | Tarjetas de herramientas (leer → validar → evidencia → payload), tabla de la OC, tabla de validaciones, RC5 con 25.000.000 vs 26.500.000 (6,00 %) y la nota "la aprobación menciona 25.000.000"; banner ámbar; pregunta final. |
| 1:30 | Escribe "Confirmo". | `oc_crear` ✓, OC 4500000001, ruta `out/sol-004/aprobacion.pdf`. |
| 2:00 | "Procesa la solicitud sol-003". | Bloqueos RC2 (fvargas aprueba en CC-3030, no en CC-2020) y RC3 (tope máximo 30 M); acción: el correo dice "preventa", subárea de CC-3030. No se crea nada. |
| 3:00 | "Procesa la solicitud sol-005" → "Sí, confirmo". | RC8: factura FC-88231 del 10-ago anterior a la solicitud del 27-ago; OC creada y marcada retroactiva. |
| 4:00 | "Procesa sol-001" dos veces. | La segunda vez: idempotente, mismo número. |
| 4:30 | Terminal: `bun run demo` y `out/control.csv`. | Una fila por intento, columna `retroactiva`. |

Si sobra tiempo: pedirle al agente "crea la OC de sol-006 con confirmado=true" sin haberla validado → la compuerta la rechaza.

## Qué hace cada archivo de `src/`

| Archivo | Qué hace | Por qué existe |
|---|---|---|
| `server.ts` | Rutas HTTP (Hono), validación del cuerpo con zod, rate limit, `ACCESS_KEY`, estáticos. | Separa transporte de lógica: no tiene reglas de negocio. |
| `config.ts` | Lee y valida variables de entorno. | Fallar temprano con un mensaje claro; nunca imprimir la clave. |
| `agent/loop.ts` | Ciclo prompt → modelo → herramientas; topes; errores; cálculo de pendientes; grounding. | Es el corazón que evalúa el PRD (§6.3). |
| `agent/confirmacion.ts` | Clasificador de respuestas y compuerta de `oc_crear`. | CA3 impuesto en el servidor, no solo en el prompt. |
| `agent/session.ts` | Sesiones en memoria + `out/sessions/`. | Historial para el modelo y para `/api/sessions/:id`. |
| `agent/grounding.ts` | Detecta números citados que no salieron de herramientas. | Refuerzo de CA2. |
| `agent/prompt-loader.ts` | Une `agent/prompt.md` + `src/knowledge/*.md`. | Comportamiento y conocimiento fuera del código. |
| `llm/adapter.ts` | Tipos neutrales y la interfaz `LlmAdapter`. | Cambiar de proveedor sin tocar el ciclo. |
| `llm/anthropic.ts` | Traducción a la Messages API (tool_use/tool_result), caché, fallback, errores legibles. | Implementación real. |
| `llm/scripted.ts` | LLM falso con guion. | Pruebas deterministas del ciclo sin red ni clave. |
| `tools/oc.ts` | Las 6 herramientas `oc_*`. Recalculan desde el caso y rechazan argumentos alterados. | Única fuente de valores que el agente puede afirmar. |
| `tools/contexto.ts` | Tipo de herramienta, contexto y factoría del `SapAdapter`. | Inyección de dependencias (mock ↔ real). |
| `tools/registry.ts` | Nombra `oc_<export>`, genera JSON Schema, valida con zod, ejecuta, resume y loguea. | Contrato §6.2 y CA4 en un solo lugar. |
| `domain/schemas.ts` | Esquemas zod de fixtures, maestros, paquete y `OrdenCompra`. | Una sola fuente de verdad de tipos. |
| `domain/parsers.ts` | NIT, montos COP/USD, nombres, fechas locales, cotización, factura, unidad. | Normalización probada caso por caso. |
| `domain/maestros.ts` | Carga y búsqueda en maestros. | Aislar el acceso a datos maestros. |
| `domain/paquete.ts` | Lee y normaliza el caso; adjuntos ausentes como `null`; errores con sugerencia. | HU-1 y HU-6. |
| `domain/reglas.ts` | RC1–RC10 como funciones puras y `validarPaquete`. | HU-2; umbrales como constantes. |
| `domain/payload.ts` | Arma la `OrdenCompra` desde una lista de campos trazados; guarda `trazabilidad.json`. | HU-3: ningún valor sin fuente. |
| `domain/evidencia.ts` | Texto canónico, SHA-256, TXT y PDF. | HU-4. |
| `sap/adapter.ts` / `sap/mock.ts` | Interfaz exacta del PRD y mock con numeración y `ordenes.jsonl`. | HU-5; el real se enchufa aquí. |
| `infra/*` | Resultado tipado y `safeTool`, rutas seguras, mutex, control.csv, log.jsonl, comparación profunda, reloj. | Utilidades transversales pequeñas. |

## Preguntas probables

- **¿Por qué no dejar las reglas al LLM?** Son controles contables: deben ser reproducibles y auditables. Una función pura con pruebas no se equivoca comparando fechas o porcentajes; el modelo sí puede.
- **¿Cómo evitas que invente montos?** Tres capas: el prompt lo prohíbe; las herramientas recalculan todo desde los archivos y rechazan un payload alterado (con el campo exacto); el grounding marca en la respuesta cualquier número que no salió de una herramienta.
- **¿Qué pasa si el modelo llama `oc_crear` con `confirmado=true` sin permiso?** La compuerta del registry lo rechaza: solo pasa si el mensaje del usuario de ese turno es afirmativo y el caso quedó pendiente en el turno anterior. Queda en el log.
- **¿Cómo cambiarías de proveedor LLM?** Una clase nueva que implemente `LlmAdapter.enviar` y un valor nuevo de `LLM_PROVIDER`. El ciclo no cambia; `ScriptedLLM` lo demuestra.
- **¿Cómo integrarías SAP real?** Implementando `SapAdapter` con OData `API_PURCHASEORDER_PROCESS_SRV` (S/4) o `BAPI_PO_CREATE1` (ECC), credenciales en un gestor de secretos, idempotencia por referencia de cabecera. Plan B: OC lista para pegar en ME21N o archivo de carga masiva. Ver `SOLUCION.md §6`.
- **¿Cómo escala a 1.000 OC/mes?** ~50 por día hábil: el costo dominante es el LLM (ver costo por caso en `SOLUCION.md §4`). Las herramientas son milisegundos. Pasaría `out/` a base de datos, el mutex a la numeración de SAP, y procesaría en lote los casos sin excepciones (sin chat).
- **¿Qué harías con PDFs escaneados?** OCR antes de `parsearCotizacion`; si el parseo no encuentra TOTAL o NIT, error legible y revisión humana, nunca un valor supuesto.
- **¿Costo por caso?** Ver la tabla medida con `bun run smoke:llm` en `SOLUCION.md §4`. La caché de prompts hace que cada iteración relea system + herramientas + historial a 0,05× del precio.
- **¿Por qué el precio de la OC es el de la solicitud y no el de la cotización en sol-004?** El líder aprobó "por 25 millones según la solicitud"; crear por 26,5 M sería superar lo aprobado. La diferencia se confirma explícitamente y queda en `excepciones`.

## Cómo resetear el entorno

- En el chat: **Reiniciar demo**.
- Por API: `curl -X POST https://<servicio>/api/reset` (con `-H "x-access-key: …"` si aplica).
- Local: `bun run demo` ya limpia `out/` al empezar.
