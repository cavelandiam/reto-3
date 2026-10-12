// Resolución segura de rutas: todo se resuelve desde la raíz del proyecto (ctx.directory)
// y se rechaza cualquier ruta que escape de ella (.., rutas absolutas).
import { isAbsolute, join, relative, resolve, sep } from "node:path"

export const RUTA_SOLICITUDES = join("fixtures", "reto-03", "solicitudes")
export const RUTA_MAESTROS = join("fixtures", "reto-03", "maestros")
export const RUTA_OUT = "out"

const PATRON_CASO = /^[a-z0-9-]+$/

/** Resuelve `segmentos` dentro de `raiz`; lanza si el resultado queda fuera. */
export function resolverDentro(raiz: string, ...segmentos: string[]): string {
  for (const s of segmentos) {
    if (isAbsolute(s)) throw new Error(`Ruta no permitida: '${s}' es absoluta`)
  }
  const base = resolve(raiz)
  const destino = resolve(base, ...segmentos)
  if (destino !== base && !destino.startsWith(base + sep)) {
    throw new Error(`Ruta no permitida: '${segmentos.join("/")}' sale de la raíz del proyecto`)
  }
  return destino
}

/** Valida el nombre de un caso (carpeta) antes de usarlo en una ruta. */
export function validarNombreCaso(caso: string): string | null {
  if (!PATRON_CASO.test(caso)) {
    return `Caso inválido '${caso}': solo se permiten minúsculas, números y guiones (p. ej. 'sol-001')`
  }
  return null
}

export function carpetaCaso(raiz: string, caso: string): string {
  return resolverDentro(raiz, RUTA_SOLICITUDES, caso)
}

export function carpetaOut(raiz: string, ...segmentos: string[]): string {
  return resolverDentro(raiz, RUTA_OUT, ...segmentos)
}

/** Ruta relativa a la raíz con separador '/', para mostrar al usuario. */
export function rutaRelativa(raiz: string, absoluta: string): string {
  return relative(resolve(raiz), absoluta).split(sep).join("/")
}
