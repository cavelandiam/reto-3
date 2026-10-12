// LLM falso para pruebas: devuelve respuestas predefinidas en orden. Hace deterministas las pruebas
// del ciclo del agente y demuestra que el adaptador es intercambiable.
import {
  type DefinicionHerramienta,
  ErrorLlm,
  type LlamadaHerramienta,
  type LlmAdapter,
  type MensajeLlm,
  type RespuestaLlm,
} from "./adapter"

/** Un paso del guion: texto final, llamadas a herramientas, un error o una función que decide según el historial. */
export type PasoGuion =
  | { texto: string }
  | { llamadas: Array<Omit<LlamadaHerramienta, "id"> & { id?: string }>; texto?: string }
  | { error: string }
  | ((mensajes: MensajeLlm[]) => PasoGuion)

export class ScriptedLLM implements LlmAdapter {
  readonly proveedor = "scripted"
  readonly modelo = "guion"
  /** Mensajes recibidos en cada llamada (para inspeccionar en pruebas). */
  readonly recibidos: MensajeLlm[][] = []
  private indice = 0

  constructor(
    private readonly guion: PasoGuion[],
    private readonly usoPorLlamada = { entrada: 100, salida: 20 },
  ) {}

  async enviar(_s: string, mensajes: MensajeLlm[], _h: DefinicionHerramienta[]): Promise<RespuestaLlm> {
    this.recibidos.push(structuredClone(mensajes))
    let paso = this.guion[this.indice++] ?? { texto: "(fin del guion)" }
    while (typeof paso === "function") paso = paso(mensajes)
    if ("error" in paso) throw new ErrorLlm(paso.error)
    const uso = this.usoPorLlamada
    if ("llamadas" in paso) {
      const llamadas = paso.llamadas.map((l, i) => ({ ...l, id: l.id ?? `llamada-${this.indice}-${i}` }))
      return { texto: paso.texto ?? "", llamadas, uso, fin: "herramientas" }
    }
    return { texto: paso.texto, llamadas: [], uso, fin: "fin" }
  }
}
