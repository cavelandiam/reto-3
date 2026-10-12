// Carga el system prompt (agent/prompt.md = comportamiento) y le anexa el conocimiento
// (src/knowledge/*.md). Se lee en cada turno: cambiar el prompt no requiere tocar código.
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { resolverDentro } from "../infra/paths"

/** Raíz del código (donde viven agent/ y src/knowledge/), independiente del directorio de datos. */
export const RAIZ_PROYECTO = resolve(import.meta.dir, "..", "..")
export const RUTA_PROMPT = "agent/prompt.md"
export const RUTA_CONOCIMIENTO = "src/knowledge"

export function cargarConocimiento(raiz: string = RAIZ_PROYECTO): string {
  const carpeta = resolverDentro(raiz, RUTA_CONOCIMIENTO)
  return readdirSync(carpeta)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => readFileSync(resolverDentro(raiz, RUTA_CONOCIMIENTO, f), "utf8").trim())
    .join("\n\n")
}

export function cargarPrompt(raiz: string = RAIZ_PROYECTO): string {
  const prompt = readFileSync(resolverDentro(raiz, RUTA_PROMPT), "utf8").trim()
  return `${prompt}\n\n${cargarConocimiento(raiz)}\n`
}
