// Resultado tipado de las operaciones de dominio y herramientas: { ok, data } | { ok: false, error }.

export type Ok<T> = { ok: true; data: T }
export type Err = { ok: false; error: string }
export type Resultado<T> = Ok<T> | Err

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data }
}

export function err(error: string): Err {
  return { ok: false, error }
}

/** Mensaje legible de una excepción, sin traza. */
export function mensajeDe(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/**
 * Envuelve la ejecución de una herramienta: nunca lanza y siempre devuelve
 * el resultado serializado como JSON.
 */
export async function safeTool<T>(fn: () => Promise<Resultado<T>> | Resultado<T>): Promise<string> {
  try {
    return JSON.stringify(await fn())
  } catch (e) {
    return JSON.stringify(err(`Error inesperado: ${mensajeDe(e)}`))
  }
}
