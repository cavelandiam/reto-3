// Utilidades para guiones de ScriptedLLM: pasos que usan el último resultado de herramienta.
import { Agente } from "../../src/agent/loop"
import { AlmacenSesiones } from "../../src/agent/session"
import type { MensajeLlm } from "../../src/llm/adapter"
import { type PasoGuion, ScriptedLLM } from "../../src/llm/scripted"

type Datos = Record<string, unknown>

/** Datos (`data`) del último resultado de la herramienta `nombre` en el historial. */
export function ultimo(mensajes: MensajeLlm[], nombre: string): Datos {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i]
    if (m?.rol !== "tool") continue
    const r = m.resultados.find((x) => x.nombre === nombre)
    if (r) return (JSON.parse(r.contenido) as { data?: Datos }).data ?? {}
  }
  throw new Error(`no hay resultado de ${nombre}`)
}

/** Guion estándar: leer → validar → evidencia → payload (sin crear). */
export function prepararCaso(caso: string): PasoGuion[] {
  return [
    { llamadas: [{ nombre: "oc_leer_paquete", argumentos: { caso } }] },
    (m) => ({
      llamadas: [{ nombre: "oc_validar", argumentos: { caso, paquete: ultimo(m, "oc_leer_paquete") } }],
    }),
    (m) => ({
      llamadas: [
        { nombre: "oc_generar_evidencia", argumentos: { caso } },
        {
          nombre: "oc_construir_payload",
          argumentos: {
            caso,
            paquete: ultimo(m, "oc_leer_paquete"),
            derivados: ultimo(m, "oc_validar").derivados,
          },
        },
      ],
    }),
  ]
}

/** Paso: oc_crear con el payload del último oc_construir_payload. */
export function crearCaso(caso: string, confirmado?: boolean): PasoGuion {
  return (m) => ({
    llamadas: [
      {
        nombre: "oc_crear",
        argumentos: { caso, payload: ultimo(m, "oc_construir_payload").orden, confirmado },
      },
    ],
  })
}

export function nuevoAgente(
  dir: string,
  guion: PasoGuion[],
  opciones: {
    maxIteraciones?: number
    maxTokensSesion?: number
    uso?: { entrada: number; salida: number }
  } = {},
) {
  const llm = new ScriptedLLM(guion, opciones.uso)
  const agente = new Agente({
    directory: dir,
    llm,
    sesiones: new AlmacenSesiones(dir),
    maxIteraciones: opciones.maxIteraciones ?? 25,
    maxTokensSesion: opciones.maxTokensSesion ?? 1_000_000,
    timeoutMs: 1000,
    maxTokensRespuesta: 1000,
  })
  return { agente, llm }
}
