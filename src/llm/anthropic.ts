// Implementación del adaptador LLM con la Messages API de Anthropic (tool use).
// Traduce los mensajes neutrales a bloques tool_use / tool_result y de vuelta.
import Anthropic from "@anthropic-ai/sdk"
import {
  type DefinicionHerramienta,
  ErrorLlm,
  type LlamadaHerramienta,
  type LlmAdapter,
  type MensajeLlm,
  type OpcionesLlm,
  type RespuestaLlm,
} from "./adapter"

type Esfuerzo = "low" | "medium" | "high"
type Bloque = Anthropic.Beta.BetaContentBlock
type ParamMensaje = Anthropic.Beta.BetaMessageParam

export const MODELO_POR_DEFECTO = "claude-opus-5-5"
const BETA_FALLBACK = "server-side-fallback-2026-07-01"

function contenidoAsistente(
  m: Extract<MensajeLlm, { rol: "assistant" }>,
): Anthropic.Beta.BetaContentBlockParam[] {
  // Si tenemos el contenido original (incluye bloques de razonamiento), se reenvía sin cambios.
  if (Array.isArray(m.crudo)) return m.crudo as Anthropic.Beta.BetaContentBlockParam[]
  const bloques: Anthropic.Beta.BetaContentBlockParam[] = []
  if (m.texto) bloques.push({ type: "text", text: m.texto })
  for (const l of m.llamadas)
    bloques.push({ type: "tool_use", id: l.id, name: l.nombre, input: l.argumentos ?? {} })
  return bloques
}

/** Mensajes neutrales → formato de Anthropic. */
export function aMensajesAnthropic(mensajes: MensajeLlm[]): ParamMensaje[] {
  return mensajes.map((m): ParamMensaje => {
    if (m.rol === "user") return { role: "user", content: m.contenido }
    if (m.rol === "assistant") return { role: "assistant", content: contenidoAsistente(m) }
    return {
      role: "user",
      content: m.resultados.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.id,
        content: r.contenido,
        is_error: r.es_error,
      })),
    }
  })
}

function aHerramientas(defs: DefinicionHerramienta[]): Anthropic.Beta.BetaTool[] {
  return defs.map((d, i) => ({
    name: d.nombre,
    description: d.descripcion,
    input_schema: d.esquema as Anthropic.Beta.BetaTool.InputSchema,
    // Punto de caché al final de las herramientas: system + tools se reutilizan entre llamadas.
    ...(i === defs.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }))
}

function desdeRespuesta(r: Anthropic.Beta.BetaMessage): RespuestaLlm {
  if (r.stop_reason === "refusal") {
    throw new ErrorLlm(
      "El modelo declinó responder esta solicitud. Reformula el mensaje e inténtalo de nuevo.",
    )
  }
  const texto = r.content
    .filter((b): b is Extract<Bloque, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n")
  const llamadas: LlamadaHerramienta[] = r.content
    .filter((b): b is Extract<Bloque, { type: "tool_use" }> => b.type === "tool_use")
    .map((b) => ({ id: b.id, nombre: b.name, argumentos: b.input }))
  const fin = r.stop_reason === "max_tokens" ? "limite" : llamadas.length > 0 ? "herramientas" : "fin"
  const u = r.usage
  const entrada = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  return { texto, llamadas, uso: { entrada, salida: u.output_tokens }, fin, crudo: r.content }
}

/** Errores del SDK → mensaje legible (sin detalles internos ni claves). */
export function traducirError(e: unknown, timeoutMs: number): ErrorLlm {
  if (e instanceof ErrorLlm) return e
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new ErrorLlm(
      `El proveedor de IA no respondió en ${Math.round(timeoutMs / 1000)} s. Intenta de nuevo.`,
    )
  }
  if (e instanceof Anthropic.AuthenticationError)
    return new ErrorLlm("La clave del proveedor de IA no es válida.")
  if (e instanceof Anthropic.RateLimitError)
    return new ErrorLlm("El proveedor de IA está limitando las solicitudes; espera un momento.")
  if (e instanceof Anthropic.APIConnectionError)
    return new ErrorLlm("No hay conexión con el proveedor de IA.")
  if (e instanceof Anthropic.APIError)
    return new ErrorLlm(`El proveedor de IA devolvió un error (${e.status ?? "sin código"}).`)
  return new ErrorLlm("Error inesperado al llamar al proveedor de IA.")
}

export class AnthropicLlm implements LlmAdapter {
  readonly proveedor = "anthropic"
  private readonly cliente: Anthropic

  constructor(
    apiKey: string,
    readonly modelo: string = MODELO_POR_DEFECTO,
    private readonly esfuerzo: Esfuerzo = "medium",
  ) {
    // maxRetries: el SDK reintenta 2 veces con backoff exponencial ante 408/409/429/5xx y errores de conexión.
    this.cliente = new Anthropic({ apiKey, maxRetries: 2 })
  }

  async enviar(
    sistema: string,
    mensajes: MensajeLlm[],
    herramientas: DefinicionHerramienta[],
    opciones: OpcionesLlm,
  ): Promise<RespuestaLlm> {
    try {
      const r = await this.cliente.beta.messages.create(
        {
          model: this.modelo,
          max_tokens: opciones.maxTokens,
          system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
          tools: aHerramientas(herramientas),
          messages: aMensajesAnthropic(mensajes),
          output_config: { effort: this.esfuerzo },
          // Caché automática del historial: cada iteración del ciclo reutiliza el prefijo ya enviado.
          cache_control: { type: "ephemeral" },
          betas: [BETA_FALLBACK],
          fallbacks: "default",
        },
        { timeout: opciones.timeoutMs },
      )
      return desdeRespuesta(r)
    } catch (e) {
      throw traducirError(e, opciones.timeoutMs)
    }
  }
}
