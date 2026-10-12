// Sesiones del chat: en memoria y persistidas en out/sessions/<id>.json para sobrevivir reinicios.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { carpetaOut } from "../infra/paths"
import { ahoraIso } from "../infra/reloj"
import type { MensajeLlm } from "../llm/adapter"

export type ToolCallVisible = {
  nombre: string
  argumentos: unknown
  ok: boolean
  resumen: string
  duracion_ms: number
}

export type Pendiente = { caso: string; confirmaciones: string[]; turno: number }

export type MensajeVisible = {
  rol: "user" | "assistant"
  texto: string
  ts: string
  toolCalls?: ToolCallVisible[]
  needsConfirmation?: boolean
}

export type Sesion = {
  id: string
  creada: string
  turno: number
  tokens: number
  /** Historial completo enviado al modelo (incluye resultados de herramientas). */
  historial: MensajeLlm[]
  /** Lo que ve el usuario en el chat. */
  visibles: MensajeVisible[]
  /** Casos que esperan confirmación explícita en el siguiente mensaje. */
  pendiente: Pendiente[]
}

const PATRON_ID = /^[A-Za-z0-9-]{1,64}$/

export function idValido(id: string): boolean {
  return PATRON_ID.test(id)
}

export class AlmacenSesiones {
  private readonly memoria = new Map<string, Sesion>()

  constructor(private readonly raiz: string) {}

  private ruta(id: string): string {
    return carpetaOut(this.raiz, "sessions", `${id}.json`)
  }

  obtener(id: string): Sesion | null {
    if (!idValido(id)) return null
    const enMemoria = this.memoria.get(id)
    if (enMemoria) return enMemoria
    const ruta = this.ruta(id)
    if (!existsSync(ruta)) return null
    const sesion = JSON.parse(readFileSync(ruta, "utf8")) as Sesion
    this.memoria.set(id, sesion)
    return sesion
  }

  crear(id: string = crypto.randomUUID()): Sesion {
    const sesion: Sesion = {
      id,
      creada: ahoraIso(),
      turno: 0,
      tokens: 0,
      historial: [],
      visibles: [],
      pendiente: [],
    }
    this.memoria.set(id, sesion)
    return sesion
  }

  guardar(sesion: Sesion): void {
    this.memoria.set(sesion.id, sesion)
    mkdirSync(carpetaOut(this.raiz, "sessions"), { recursive: true })
    writeFileSync(this.ruta(sesion.id), JSON.stringify(sesion, null, 2), "utf8")
  }

  /** Olvida las sesiones en memoria (tras limpiar out/). */
  vaciar(): void {
    this.memoria.clear()
  }
}
