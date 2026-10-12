import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { cargarMaestros } from "../../src/domain/maestros"
import { leerPaquete } from "../../src/domain/paquete"
import { construirOrden } from "../../src/domain/payload"
import { validarPaquete } from "../../src/domain/reglas"
import type { OrdenCompra } from "../../src/domain/schemas"
import { campoCsv, filaCsv } from "../../src/infra/control"
import { MockSapAdapter } from "../../src/sap/mock"
import { borrar, proyectoTemporal, RAIZ } from "../helpers"

function orden(caso: string, solicitudId?: string): OrdenCompra {
  const p = leerPaquete(RAIZ, caso)
  if (!p.ok) throw new Error(p.error)
  const r = construirOrden(p.data, validarPaquete(p.data, cargarMaestros(RAIZ)))
  if (!r.ok) throw new Error(r.error)
  if (!solicitudId) return r.data.orden
  return { ...r.data.orden, referencia: { ...r.data.orden.referencia, solicitud_id: solicitudId } }
}

describe("MockSapAdapter", () => {
  test("numeración desde 4500000001, secuencia y búsqueda por referencia", async () => {
    const dir = proyectoTemporal()
    try {
      const sap = new MockSapAdapter(dir)
      expect(await sap.buscarOrdenPorReferencia("SOL-2026-001")).toBeNull()
      const a = await sap.crearOrden(orden("sol-001"))
      const b = await sap.crearOrden(orden("sol-004"))
      expect(a.numero_oc).toBe("4500000001")
      expect(b.numero_oc).toBe("4500000002")
      expect(a.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(await sap.buscarOrdenPorReferencia("SOL-2026-004")).toEqual({ numero_oc: "4500000002" })
      const lineas = readFileSync(join(dir, "out/sap/ordenes.jsonl"), "utf8").trim().split("\n")
      expect(lineas).toHaveLength(2)
      expect(JSON.parse(lineas[0] ?? "{}").solicitud_id).toBe("SOL-2026-001")
    } finally {
      borrar(dir)
    }
  })

  test("concurrencia: crearOrden simultáneos no repiten número", async () => {
    const dir = proyectoTemporal()
    try {
      const sap = new MockSapAdapter(dir)
      const r = await Promise.all(
        Array.from({ length: 5 }, (_, i) => sap.crearOrden(orden("sol-001", `SOL-X-${i}`))),
      )
      expect(new Set(r.map((x) => x.numero_oc)).size).toBe(5)
    } finally {
      borrar(dir)
    }
  })

  test("consultarProveedor", async () => {
    const sap = new MockSapAdapter(RAIZ)
    expect(await sap.consultarProveedor("900.555.111-2")).toEqual({ codigo_sap: "100234", activo: true })
    expect(await sap.consultarProveedor("901999000")).toBeNull()
  })
})

describe("control.csv", () => {
  test("fila con escape RFC 4180", () => {
    expect(campoCsv("RC2;RC3")).toBe('"RC2;RC3"')
    expect(campoCsv('a "b"')).toBe('"a ""b"""')
    const fila = filaCsv(
      {
        solicitud_id: "S",
        resultado: "bloqueada",
        numero_oc: null,
        retroactiva: false,
        bloqueos: ["RC2", "RC3"],
        confirmaciones: [],
      },
      "T",
    )
    expect(fila).toBe('S,bloqueada,,false,"RC2;RC3",,T')
  })
})
