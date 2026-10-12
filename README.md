# Agente conversacional "Órdenes de Compra SAP" — Reto 03

Agente que lee el paquete de una compra (solicitud, cotización, aprobación y factura), lo valida contra los maestros con las reglas RC1–RC10, muestra la OC como quedaría en SAP con trazabilidad de cada valor, genera la evidencia de aprobación (TXT + PDF con SHA-256) y crea la OC en un SAP simulado. Los bloqueos nunca se fuerzan y las excepciones se confirman con la analista.

**Link público:** se agrega aquí al desplegar en Render (ver [Despliegue](#despliegue)).
**Clave de acceso:** si el despliegue define `ACCESS_KEY`, el front la pide una vez; se entrega por el mismo hilo del correo, no en el repositorio.

## Requisitos

- [Bun](https://bun.sh) ≥ 1.1 (probado con 1.4.3), **o** Docker.
- Para el chat: una clave de Anthropic en `ANTHROPIC_API_KEY`. La demo y las pruebas no la necesitan.

## Arranque en un comando

```bash
bun install && bun run dev
```

Abre <http://localhost:3000>. Con Docker:

```bash
docker compose up --build
```

Las variables se leen de `.env` (copia `.env.example`). Sin clave el servidor arranca igual: `/api/health` informa `llm_configurado: false` y el chat responde un error claro.

## Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic` o `scripted` (LLM falso de pruebas). |
| `ANTHROPIC_API_KEY` | — | Clave del proveedor. Solo en el backend; nunca se imprime ni se devuelve. |
| `LLM_MODEL` | `claude-opus-5-5` | Modelo de Anthropic. |
| `LLM_EFFORT` | `medium` | Esfuerzo del modelo: `low`, `medium`, `high`. |
| `LLM_TIMEOUT_MS` | `60000` | Timeout por llamada al modelo. |
| `LLM_MAX_TOKENS_RESPUESTA` | `4096` | Máximo de tokens por respuesta del modelo. |
| `AGENT_MAX_ITERATIONS` | `25` | Tope de iteraciones herramienta → modelo por turno (CA1). |
| `SESSION_MAX_TOKENS` | `500000` | Tope de tokens por sesión, contando los leídos de caché (≈ 5 casos; ver costo en SOLUCION.md §4). |
| `RATE_LIMIT_POR_MINUTO` | `20` | Mensajes por minuto por IP en `/api/chat`. |
| `PORT` | `3000` | Puerto HTTP. |
| `ACCESS_KEY` | — | Si se define, `/api/*` (excepto `/api/health`) exige el header `x-access-key`. |

## Demo sin modelo

```bash
bun run demo
```

Limpia `out/`, procesa los 6 casos llamando directamente a las herramientas y termina con:

```
CASO     APTA  BLOQUEOS   CONFIRMACIONES  RETRO  RESULTADO
sol-001  sí    -          -               no     OC 4500000001 (2ª llamada: idempotente)
sol-002  no    RC1        -               no     Bloqueada: proveedor no existe
sol-003  no    RC2,RC3    -               no     Bloqueada: aprobador sin autoridad / tope
sol-004  sí    -          RC5             no     OC 4500000002 (confirmada)
sol-005  sí    -          RC8             sí     OC 4500000003 (confirmada, retroactiva)
sol-006  sí    -          RC6             no     OC 4500000004 (confirmada, IVA derivado C1)
```

Genera `out/sap/ordenes.jsonl`, `out/control.csv`, `out/<caso>/aprobacion.txt|pdf` y `out/<caso>/trazabilidad.json`.

## Pruebas y verificación

```bash
bun test
```

```bash
bun run verify
```

`verify` ejecuta `tsc`, Biome, búsqueda de `any`, todas las pruebas, la demo dos veces (determinismo), archivos obligatorios, secciones de `SOLUCION.md`, `.gitignore`, huellas de `fixtures/`, sincronía de `modulo/` y ausencia de shell en las herramientas.

Prueba con el modelo real (necesita `ANTHROPIC_API_KEY`; corre sobre una copia temporal de los fixtures y mide tokens):

```bash
bun run smoke:llm
```

## API

| Método | Ruta | Contrato |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ sessionId, reply, toolCalls: [{ nombre, argumentos, ok, resumen, duracion_ms }], needsConfirmation, pendiente: [{ caso, confirmaciones }] }`. Sin `sessionId` crea una sesión. |
| `GET` | `/api/sessions/:id` | Historial visible de la sesión (mensajes y tool calls) y lo pendiente. 404 si no existe. |
| `GET` | `/api/health` | `{ ok, provider, model, llm_configurado, requiere_clave }`. Nunca la clave. |
| `GET` | `/api/casos` | Casos disponibles en `fixtures/reto-03/solicitudes/`. |
| `POST` | `/api/reset` | Borra `out/` (útil antes de la defensa). |

Errores siempre como `{ error }` con el código HTTP adecuado (400, 401, 404, 429, 503, 500).

```bash
curl -s http://localhost:3000/api/health
```

```bash
curl -s -X POST http://localhost:3000/api/chat -H "content-type: application/json" -d '{"message":"Procesa la solicitud sol-001"}'
```

## Prompt de demo (PRD §11)

En una sesión nueva (o con el botón "▶ Prompt de demo"):

```
Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué
validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.
```

Resultado esperado: tarjetas con las llamadas a herramientas, la OC en una tabla, la tabla de validaciones, la confirmación RC5 con ambos valores (solicitud 25.000.000 vs cotización 26.500.000, 6,00 %), banner ámbar de confirmación y una pregunta al final. Tras "Confirmo" (o el botón Confirmar): número de OC y ruta de la evidencia (`out/sol-004/aprobacion.pdf`).

## Estructura

```
agent/prompt.md                 comportamiento (system prompt)
src/knowledge/ordenes-compra.md conocimiento del proceso (se anexa al prompt)
src/tools/oc.ts                 herramientas oc_* (ejecución) · registry.ts las nombra, valida y loguea
src/domain/                     reglas RC1–RC10, parsers, payload, evidencia (funciones puras)
src/sap/                        SapAdapter (interfaz del PRD) + mock sobre out/sap/
src/llm/                        LlmAdapter + Anthropic + ScriptedLLM (pruebas)
src/agent/                      ciclo, sesiones, compuerta de confirmación, grounding
src/server.ts                   API HTTP (Hono) y estáticos
web/                            front de chat (HTML + JS, sin build)
modulo/                         bonus: agent.md, skill y herramientas re-exportadas
demo.ts                         demo sin modelo
```

Más detalle en [SOLUCION.md](SOLUCION.md) y la guía de la defensa en [docs/GUIA-DEFENSA.md](docs/GUIA-DEFENSA.md).

## El chat

- Cada llamada a herramienta aparece como tarjeta plegable (✓/✗, nombre, resumen, duración y argumentos).
- Cuando el agente espera confirmación, el mensaje se resalta y aparece un banner ámbar con **Confirmar** / **Cancelar**.
- Chips de acceso rápido por caso, "Nueva sesión" y "Reiniciar demo".

## Despliegue

Render (Web Service con Docker):

1. Sube el repositorio a GitHub.
2. En Render: **New → Blueprint** y elige el repositorio (usa `render.yaml`), o **New → Web Service** con runtime Docker.
3. En *Environment*, define `ANTHROPIC_API_KEY` y, si quieres proteger el link, `ACCESS_KEY`.
4. Verifica `https://<servicio>.onrender.com/api/health`.

`out/` es efímero en Render (se pierde al reiniciar): suficiente para el reto. El plan gratuito se duerme tras inactividad; abre `/api/health` unos minutos antes de la defensa.

## Entrega

Sin `node_modules/`, `out/` ni `.env` (los tres están en `.gitignore`).
