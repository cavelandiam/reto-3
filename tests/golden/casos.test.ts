import { describe, expect, test } from "bun:test"
import { cargarMaestros } from "../../src/domain/maestros"
import { leerPaquete } from "../../src/domain/paquete"
import { validarPaquete } from "../../src/domain/reglas"
import { CASOS, RAIZ } from "../helpers"
import esperados from "./esperados.json"

type Esperado = {
  apta: boolean
  bloqueos: string[]
  confirmaciones: string[]
  derivados: Record<string, { valor: string; fuente: string }>
  proveedor_resuelto_por: string | null
  retroactiva: boolean
}
const tabla: Record<string, Esperado> = esperados

describe("golden: resultados esperados por caso (tabla 5.3)", () => {
  const maestros = cargarMaestros(RAIZ)
  for (const caso of CASOS) {
    test(caso, () => {
      const p = leerPaquete(RAIZ, caso)
      if (!p.ok) throw new Error(p.error)
      const v = validarPaquete(p.data, maestros)
      const e = tabla[caso]
      if (!e) throw new Error(`sin esperado para ${caso}`)
      expect(v.apta).toBe(e.apta)
      expect(v.bloqueos.map((b): string => b.codigo)).toEqual(e.bloqueos)
      expect(v.confirmaciones.map((c): string => c.codigo)).toEqual(e.confirmaciones)
      expect(v.derivados.indicador_iva).toEqual(e.derivados.indicador_iva)
      expect(v.derivados.condiciones_pago).toEqual(e.derivados.condiciones_pago)
      expect(v.derivados.proveedor?.resuelto_por ?? null).toBe(e.proveedor_resuelto_por)
      expect(v.retroactiva).toBe(e.retroactiva)
      expect(v.reglas_evaluadas).toHaveLength(10)
    })
  }

  test("detalles con valores concretos", () => {
    const detalle = (caso: string) => {
      const p = leerPaquete(RAIZ, caso)
      if (!p.ok) throw new Error(p.error)
      return validarPaquete(p.data, maestros)
    }
    expect(detalle("sol-002").bloqueos[0]?.detalle).toContain("NIT 901999000")
    const s3 = detalle("sol-003")
    expect(s3.bloqueos[0]?.detalle).toContain(
      "fvargas@periferia-ficticia.com, que es aprobador de CC-3030, no de CC-2020",
    )
    expect(s3.bloqueos[0]?.accion_sugerida).toContain("Preventa")
    expect(s3.bloqueos[1]?.detalle).toBe(
      "Ningún aprobador de CC-2020 tiene tope ≥ 74.000.000 (máximo 30.000.000)",
    )
    const s4 = detalle("sol-004").confirmaciones[0]
    expect(s4?.detalle).toContain("25.000.000")
    expect(s4?.detalle).toContain("26.500.000")
    expect(s4?.detalle).toContain("diferencia 1.500.000 (6,00 %")
    expect(s4?.detalle).toContain("La aprobación menciona 25.000.000")
    expect(detalle("sol-005").confirmaciones[0]?.detalle).toBe(
      "Factura FC-88231 del 2026-08-10 es anterior a la solicitud del 2026-08-27: OC retroactiva",
    )
  })
})
