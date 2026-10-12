// Log de control para contabilidad/auditoría: out/control.csv, una fila por intento de creación.
import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { enSerie } from "./mutex"
import { carpetaOut } from "./paths"
import { ahoraIso } from "./reloj"

export const ENCABEZADO_CONTROL = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts"

export type ResultadoControl = "creada" | "idempotente" | "bloqueada" | "pendiente_confirmacion" | "error"

export type FilaControl = {
  solicitud_id: string
  resultado: ResultadoControl
  numero_oc: string | null
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
}

/** Campo CSV según RFC 4180: se entrecomilla si contiene coma, comilla, punto y coma o salto de línea. */
export function campoCsv(valor: string): string {
  if (!/[",;\n\r]/.test(valor)) return valor
  return `"${valor.replace(/"/g, '""')}"`
}

export function filaCsv(f: FilaControl, ts: string): string {
  return [
    f.solicitud_id,
    f.resultado,
    f.numero_oc ?? "",
    String(f.retroactiva),
    f.bloqueos.join(";"),
    f.confirmaciones.join(";"),
    ts,
  ]
    .map(campoCsv)
    .join(",")
}

export function registrarControl(raiz: string, fila: FilaControl): Promise<void> {
  const ruta = carpetaOut(raiz, "control.csv")
  return enSerie(ruta, () => {
    mkdirSync(dirname(ruta), { recursive: true })
    if (!existsSync(ruta)) appendFileSync(ruta, `${ENCABEZADO_CONTROL}\n`, "utf8")
    appendFileSync(ruta, `${filaCsv(fila, ahoraIso())}\n`, "utf8")
  })
}
