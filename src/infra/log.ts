// Log de llamadas a herramientas (CA4): out/log.jsonl, una línea JSON por llamada.
import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { enSerie } from "./mutex"
import { carpetaOut } from "./paths"
import { ahoraIso } from "./reloj"

export type EntradaLog = {
  sessionId: string
  herramienta: string
  caso: string | null
  ok: boolean
  resumen: string
  duracion_ms: number
}

const MAX_RESUMEN = 200

export function recortar(texto: string, max = MAX_RESUMEN): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`
}

export function registrarLog(raiz: string, entrada: EntradaLog): Promise<void> {
  const ruta = carpetaOut(raiz, "log.jsonl")
  const linea = JSON.stringify({ ts: ahoraIso(), ...entrada, resumen: recortar(entrada.resumen) })
  return enSerie(ruta, () => {
    mkdirSync(dirname(ruta), { recursive: true })
    appendFileSync(ruta, `${linea}\n`, "utf8")
  })
}
