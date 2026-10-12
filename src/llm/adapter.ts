// Interfaz neutral del proveedor LLM. El ciclo del agente solo conoce estos tipos:
// cambiar de proveedor es escribir otra clase que implemente LlmAdapter.

export type LlamadaHerramienta = { id: string; nombre: string; argumentos: unknown }

export type ResultadoHerramientaLlm = { id: string; nombre: string; contenido: string; es_error: boolean }

export type MensajeLlm =
  | { rol: "user"; contenido: string }
  | {
      rol: "assistant"
      texto: string
      llamadas: LlamadaHerramienta[]
      /** Contenido original del proveedor (p. ej. bloques de razonamiento) para reenviarlo sin cambios. */
      crudo?: unknown
    }
  | { rol: "tool"; resultados: ResultadoHerramientaLlm[] }

export type DefinicionHerramienta = { nombre: string; descripcion: string; esquema: Record<string, unknown> }

export type UsoTokens = { entrada: number; salida: number }

export type RespuestaLlm = {
  texto: string
  llamadas: LlamadaHerramienta[]
  uso: UsoTokens
  fin: "fin" | "herramientas" | "limite"
  crudo?: unknown
}

export type OpcionesLlm = { timeoutMs: number; maxTokens: number }

export interface LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  enviar(
    sistema: string,
    mensajes: MensajeLlm[],
    herramientas: DefinicionHerramienta[],
    opciones: OpcionesLlm,
  ): Promise<RespuestaLlm>
}

/** Error del proveedor con mensaje legible para mostrar en el chat (nunca incluye claves). */
export class ErrorLlm extends Error {
  override readonly name = "ErrorLlm"
}
