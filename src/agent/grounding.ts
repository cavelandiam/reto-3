// Verificación de grounding (refuerzo de CA2): todo número de ≥ 4 dígitos que el modelo afirme
// debe aparecer en algún resultado de herramienta (o en lo que escribió el usuario).

const NUMERO = /\d[\d.,]*\d/g
const MIN_DIGITOS = 4

/** Quita separadores de miles/decimales: "25.000.000" → "25000000", "1.250,5" → "12505". */
function sinSeparadores(texto: string): string {
  return texto.replace(/(?<=\d)[.,](?=\d)/g, "")
}

/** Números citados en el texto con al menos 4 dígitos, normalizados. */
export function numerosCitados(texto: string): string[] {
  const encontrados = (texto.match(NUMERO) ?? []).map(sinSeparadores)
  return [...new Set(encontrados.map((n) => n.replace(/[.,]/g, "")).filter((n) => n.length >= MIN_DIGITOS))]
}

/** Números del texto que no aparecen en ninguna de las fuentes. */
export function numerosSinFuente(texto: string, fuentes: string[]): string[] {
  const corpus = sinSeparadores(fuentes.join("\n"))
  return numerosCitados(texto).filter((n) => !corpus.includes(n))
}

export function advertencia(sinFuente: string[]): string {
  return `\n\n⚠️ Verifica: ${sinFuente.length === 1 ? "el valor" : "los valores"} ${sinFuente.join(", ")} no ${
    sinFuente.length === 1 ? "proviene" : "provienen"
  } de una herramienta.`
}
