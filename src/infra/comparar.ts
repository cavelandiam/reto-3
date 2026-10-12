// Comparación profunda que devuelve la primera diferencia (ruta y valores), sin importar el orden de claves.

export type Diferencia = { ruta: string; esperado: unknown; recibido: unknown }

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function compararArreglos(
  a: unknown[],
  b: unknown[],
  ruta: string,
  ignorar: RegExp | null,
): Diferencia | null {
  if (a.length !== b.length) return { ruta: `${ruta}.length`, esperado: a.length, recibido: b.length }
  for (let i = 0; i < a.length; i++) {
    const d = primeraDiferencia(a[i], b[i], `${ruta}[${i}]`, ignorar)
    if (d) return d
  }
  return null
}

function compararObjetos(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  ruta: string,
  ignorar: RegExp | null,
): Diferencia | null {
  const claves = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  for (const k of claves) {
    const d = primeraDiferencia(a[k], b[k], ruta ? `${ruta}.${k}` : k, ignorar)
    if (d) return d
  }
  return null
}

/**
 * `esperado` es el valor calculado desde las fuentes; `recibido` el que llegó como argumento.
 * Las rutas que coinciden con `ignorar` no se comparan. `undefined` y ausente son equivalentes.
 */
export function primeraDiferencia(
  esperado: unknown,
  recibido: unknown,
  ruta = "",
  ignorar: RegExp | null = null,
): Diferencia | null {
  if (ignorar?.test(ruta)) return null
  if (Array.isArray(esperado) && Array.isArray(recibido))
    return compararArreglos(esperado, recibido, ruta, ignorar)
  if (esObjeto(esperado) && esObjeto(recibido)) return compararObjetos(esperado, recibido, ruta, ignorar)
  if (Object.is(esperado, recibido)) return null
  return { ruta: ruta || "(raíz)", esperado, recibido }
}

export function describirDiferencia(d: Diferencia): string {
  const fmt = (v: unknown) => (v === undefined ? "ausente" : JSON.stringify(v))
  return `campo ${d.ruta}: ${fmt(d.recibido)} ≠ ${fmt(d.esperado)}`
}
