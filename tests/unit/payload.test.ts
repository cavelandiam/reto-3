import { describe, expect, test } from "bun:test"
import { cargarMaestros } from "../../src/domain/maestros"
import { leerPaquete } from "../../src/domain/paquete"
import { construirOrden, truncarDescripcion } from "../../src/domain/payload"
import { validarPaquete } from "../../src/domain/reglas"
import { OrdenCompraSchema } from "../../src/domain/schemas"
import { hojas, RAIZ } from "../helpers"

const m = cargarMaestros(RAIZ)

function construir(caso: string) {
  const p = leerPaquete(RAIZ, caso)
  if (!p.ok) throw new Error(p.error)
  return construirOrden(p.data, validarPaquete(p.data, m))
}

describe("payload de la OC", () => {
  for (const caso of ["sol-001", "sol-004", "sol-005", "sol-006"]) {
    test(`${caso}: válido, descripción ≤ 40 y trazabilidad del 100 % de las hojas`, () => {
      const r = construir(caso)
      if (!r.ok) throw new Error(r.error)
      expect(OrdenCompraSchema.safeParse(r.data.orden).success).toBe(true)
      expect(r.data.orden.posiciones[0]?.descripcion.length).toBeLessThanOrEqual(40)
      const trazadas = new Set(r.data.campos.map((c) => c.ruta))
      for (const h of hojas(r.data.orden)) expect(trazadas.has(h)).toBe(true)
      expect(r.data.campos).toHaveLength(hojas(r.data.orden).length)
    })
  }

  test("sol-001: valores y truncado documentado", () => {
    const r = construir("sol-001")
    if (!r.ok) throw new Error(r.error)
    const o = r.data.orden
    expect(o.proveedor).toEqual({ codigo_sap: "100234", nit: "900555111", nombre: "TecnoSuministros S.A.S." })
    expect(o.referencia.cotizacion_ref).toBe("COT-TS-2026-0451")
    expect(o.posiciones[0]?.descripcion).toBe("Renovación licencias antivirus")
    expect(o.excepciones).toEqual([])
    const desc = r.data.campos.find((c) => c.ruta === "posiciones[0].descripcion")
    expect(desc?.transformacion).toContain("truncado a 40")
    expect(desc?.original).toContain("120 puestos")
  })

  test("sol-004: unidad H, precio de la solicitud, excepción RC5 pendiente", () => {
    const r = construir("sol-004")
    if (!r.ok) throw new Error(r.error)
    const pos = r.data.orden.posiciones[0]
    expect(pos?.unidad).toBe("H")
    expect(pos?.cantidad).toBe(100)
    expect(pos?.precio_unitario).toBe(250000)
    expect(r.data.orden.excepciones).toMatchObject([{ codigo: "RC5", confirmado_por: null }])
  })

  test("sol-006: IVA y condiciones derivados con fuente 'derivado'", () => {
    const r = construir("sol-006")
    if (!r.ok) throw new Error(r.error)
    expect(r.data.orden.posiciones[0]?.indicador_iva).toBe("C1")
    expect(r.data.orden.condiciones_pago).toBe("Z030")
    const iva = r.data.campos.find((c) => c.ruta === "posiciones[0].indicador_iva")
    expect(iva?.fuente).toBe("derivado")
    expect(iva?.detalle).toContain("RC6")
  })

  test("caso bloqueado → error", () => {
    expect(construir("sol-003")).toEqual({
      ok: false,
      error: "No se puede construir la OC: bloqueos RC2, RC3",
    })
  })

  test("truncado sin partir palabras", () => {
    expect(truncarDescripcion("corto")).toBe("corto")
    expect(truncarDescripcion("a".repeat(50))).toHaveLength(40)
  })
})
