// Cola simple por clave: serializa escrituras dentro del proceso (numeración SAP, control.csv, log.jsonl).

const colas = new Map<string, Promise<unknown>>()

/** Ejecuta `fn` cuando terminen las tareas previas con la misma `clave`. */
export function enSerie<T>(clave: string, fn: () => Promise<T> | T): Promise<T> {
  const previa = colas.get(clave) ?? Promise.resolve()
  const actual = previa.then(fn, fn)
  colas.set(
    clave,
    actual.catch(() => undefined),
  )
  return actual
}
