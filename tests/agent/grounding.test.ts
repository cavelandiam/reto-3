import { expect, test } from "bun:test"
import { numerosCitados, numerosSinFuente } from "../../src/agent/grounding"

test("extrae números de ≥ 4 dígitos normalizando separadores", () => {
  expect(numerosCitados("OC 4500000001 por 25.000.000 (6,00 %) el 2026-08-26 y USD 1,250.50")).toEqual([
    "4500000001",
    "25000000",
    "2026",
    "125050",
  ])
})

test("no marca valores que vienen de herramientas y sí los inventados", () => {
  const fuentes = [JSON.stringify({ ok: true, data: { valor_total: 25000000, numero_oc: "4500000002" } })]
  expect(numerosSinFuente("OC 4500000002 por 25.000.000", fuentes)).toEqual([])
  expect(numerosSinFuente("OC 4500000009 por 26.000.000", fuentes)).toEqual(["4500000009", "26000000"])
})
