// Ciclo del agente: prompt → modelo → herramientas → modelo … → respuesta, con tope de iteraciones (CA1),
// tope de tokens por sesión, errores legibles (CA5), compuerta de confirmación (CA3) y grounding (CA2).
import { registrarLog } from "../infra/log"
import { ahoraIso } from "../infra/reloj"
import { mensajeDe } from "../infra/result"
import type { DefinicionHerramienta, LlmAdapter, MensajeLlm, ResultadoHerramientaLlm } from "../llm/adapter"
import { ejecutarHerramienta, HERRAMIENTAS, type ResultadoEjecucion } from "../tools/registry"
import { autorizar, casosMencionados, clasificar, crearCompuerta, pideRetener } from "./confirmacion"
import { advertencia, numerosSinFuente } from "./grounding"
import { cargarPrompt } from "./prompt-loader"
import type { AlmacenSesiones, Pendiente, Sesion, ToolCallVisible } from "./session"

export const MAX_LARGO_MENSAJE = 4000

export type OpcionesAgente = {
  directory: string
  llm: LlmAdapter
  sesiones: AlmacenSesiones
  maxIteraciones: number
  maxTokensSesion: number
  timeoutMs: number
  maxTokensRespuesta: number
}

export type RespuestaTurno = {
  sessionId: string
  reply: string
  toolCalls: ToolCallVisible[]
  needsConfirmation: boolean
  pendiente: Array<{ caso: string; confirmaciones: string[] }>
}

export class ErrorEntrada extends Error {}

const DEFINICIONES: DefinicionHerramienta[] = HERRAMIENTAS.map((h) => ({
  nombre: h.nombre,
  descripcion: h.descripcion,
  esquema: h.jsonSchema,
}))

type DatosTool = {
  ok?: boolean
  error?: string
  data?: { apta?: boolean; confirmaciones?: Array<{ codigo: string }> }
}

function leerDatos(contenido: string): DatosTool {
  try {
    return JSON.parse(contenido) as DatosTool
  } catch {
    return {}
  }
}

function casoDe(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null
  const c = (args as Record<string, unknown>).caso
  return typeof c === "string" ? c.toLowerCase() : null
}

/** Pendientes al cerrar el turno a partir de lo que pasó en él (ver SOLUCION.md › Ciclo del agente). */
export function calcularPendiente(
  ejecuciones: ResultadoEjecucion[],
  previo: Pendiente[],
  mensaje: string,
  turno: number,
): Pendiente[] {
  const retener = pideRetener(mensaje)
  const mapa = new Map<string, Pendiente>()
  // Si el usuario no confirmó ni canceló (p. ej. hizo una pregunta), lo pendiente sigue pendiente.
  if (clasificar(mensaje) === "otro") for (const p of previo) mapa.set(p.caso, p)
  for (const e of ejecuciones) {
    const caso = casoDe(e.argumentos)
    if (!caso) continue
    const d = leerDatos(e.contenido)
    if (e.nombre === "oc_validar" && d.ok && d.data?.apta) {
      const confirmaciones = (d.data.confirmaciones ?? []).map((c) => c.codigo)
      if (confirmaciones.length > 0 || retener) mapa.set(caso, { caso, confirmaciones, turno })
    }
    if (e.nombre === "oc_crear" && d.ok) mapa.delete(caso)
    if (e.nombre === "oc_crear" && d.error?.startsWith("requiere confirmación:")) {
      const codigos = d.error.match(/RC\d+/g) ?? []
      mapa.set(caso, { caso, confirmaciones: [...new Set(codigos)], turno })
    }
  }
  return [...mapa.values()]
}

function respuestaLimite(ejecuciones: ResultadoEjecucion[]): string {
  const hecho = ejecuciones
    .filter((e) => e.ok)
    .map((e) => `${e.nombre}(${casoDe(e.argumentos) ?? ""}): ${e.resumen}`)
  const fallido = ejecuciones
    .filter((e) => !e.ok)
    .map((e) => `${e.nombre}(${casoDe(e.argumentos) ?? ""}): ${e.resumen}`)
  return [
    "Alcancé el límite de pasos de este turno.",
    `Hecho: ${hecho.length ? `\n- ${hecho.join("\n- ")}` : "nada todavía."}`,
    `Pendiente: ${fallido.length ? `\n- ${fallido.join("\n- ")}\n` : ""}continuar el procesamiento; pídemelo de nuevo para seguir.`,
  ].join("\n")
}

function aVisible(e: ResultadoEjecucion): ToolCallVisible {
  return {
    nombre: e.nombre,
    argumentos: e.argumentos,
    ok: e.ok,
    resumen: e.resumen,
    duracion_ms: e.duracion_ms,
  }
}

export class Agente {
  constructor(private readonly o: OpcionesAgente) {}

  /** Procesa un mensaje del usuario. Nunca deja la sesión inutilizable: los errores se devuelven como texto. */
  async turno(sessionId: string | undefined, mensaje: string): Promise<RespuestaTurno> {
    const texto = mensaje.trim()
    if (!texto) throw new ErrorEntrada("El mensaje está vacío")
    if (texto.length > MAX_LARGO_MENSAJE)
      throw new ErrorEntrada(`El mensaje supera ${MAX_LARGO_MENSAJE} caracteres`)
    const sesion = this.sesion(sessionId)
    sesion.turno += 1
    const compuerta = crearCompuerta(autorizar(texto, sesion.pendiente), pideRetener(texto))
    sesion.historial.push({ rol: "user", contenido: texto })
    sesion.visibles.push({ rol: "user", texto, ts: ahoraIso() })
    const ejecuciones: ResultadoEjecucion[] = []
    const reply = await this.iterar(sesion, ejecuciones, compuerta)
    sesion.pendiente = calcularPendiente(ejecuciones, sesion.pendiente, texto, sesion.turno)
    return this.cerrar(sesion, await this.verificar(sesion, reply), ejecuciones)
  }

  private sesion(id: string | undefined): Sesion {
    if (!id) return this.o.sesiones.crear()
    return this.o.sesiones.obtener(id) ?? this.o.sesiones.crear(id)
  }

  private async iterar(
    sesion: Sesion,
    ejecuciones: ResultadoEjecucion[],
    compuerta: ReturnType<typeof crearCompuerta>,
  ): Promise<string> {
    const sistema = cargarPrompt()
    for (let i = 0; i < this.o.maxIteraciones; i++) {
      if (sesion.tokens >= this.o.maxTokensSesion) {
        return "Se alcanzó el tope de uso de esta sesión. Abre una nueva sesión para continuar."
      }
      let r: Awaited<ReturnType<LlmAdapter["enviar"]>>
      try {
        r = await this.o.llm.enviar(sistema, sesion.historial, DEFINICIONES, {
          timeoutMs: this.o.timeoutMs,
          maxTokens: this.o.maxTokensRespuesta,
        })
      } catch (e) {
        return `⚠️ ${mensajeDe(e)} La sesión sigue activa; puedes reintentar.`
      }
      sesion.tokens += r.uso.entrada + r.uso.salida
      sesion.historial.push({ rol: "assistant", texto: r.texto, llamadas: r.llamadas, crudo: r.crudo })
      if (r.llamadas.length === 0) return r.texto || "(El modelo no devolvió texto.)"
      sesion.historial.push({
        rol: "tool",
        resultados: await this.ejecutar(sesion, r.llamadas, ejecuciones, compuerta),
      })
    }
    return respuestaLimite(ejecuciones)
  }

  private async ejecutar(
    sesion: Sesion,
    llamadas: Array<{ id: string; nombre: string; argumentos: unknown }>,
    ejecuciones: ResultadoEjecucion[],
    compuerta: ReturnType<typeof crearCompuerta>,
  ): Promise<ResultadoHerramientaLlm[]> {
    const ctx = { directory: this.o.directory, sessionId: sesion.id }
    const resultados: ResultadoHerramientaLlm[] = []
    // Secuencial: las herramientas escriben en out/ y el orden importa (p. ej. validar antes de crear).
    for (const l of llamadas) {
      const e = await ejecutarHerramienta(l.nombre, l.argumentos, ctx, compuerta)
      ejecuciones.push(e)
      resultados.push({ id: l.id, nombre: l.nombre, contenido: e.contenido, es_error: !e.ok })
    }
    return resultados
  }

  /** Grounding: marca números citados que no salieron de herramientas ni del usuario. */
  private async verificar(sesion: Sesion, reply: string): Promise<string> {
    const fuentes = sesion.historial.flatMap((m: MensajeLlm) =>
      m.rol === "tool" ? m.resultados.map((r) => r.contenido) : m.rol === "user" ? [m.contenido] : [],
    )
    const sinFuente = numerosSinFuente(reply, fuentes)
    if (sinFuente.length === 0) return reply
    const entrada = {
      sessionId: sesion.id,
      herramienta: "grounding",
      caso: casosMencionados(reply)[0] ?? null,
      ok: false,
      resumen: `valores sin fuente: ${sinFuente.join(", ")}`,
      duracion_ms: 0,
    }
    await registrarLog(this.o.directory, entrada).catch(() => undefined)
    return reply + advertencia(sinFuente)
  }

  private cerrar(sesion: Sesion, reply: string, ejecuciones: ResultadoEjecucion[]): RespuestaTurno {
    const toolCalls = ejecuciones.map(aVisible)
    const needsConfirmation = sesion.pendiente.length > 0
    sesion.visibles.push({ rol: "assistant", texto: reply, ts: ahoraIso(), toolCalls, needsConfirmation })
    this.o.sesiones.guardar(sesion)
    const pendiente = sesion.pendiente.map(({ caso, confirmaciones }) => ({ caso, confirmaciones }))
    return { sessionId: sesion.id, reply, toolCalls, needsConfirmation, pendiente }
  }
}
