import { describe, expect, test } from "bun:test"
import { leerPaquete } from "../../src/domain/paquete"
import {
  contieneAprobado,
  fechaLocal,
  inferirUnidad,
  montoMencionado,
  normalizarEmail,
  normalizarNit,
  normalizarNombre,
  parsearCotizacion,
  parsearFactura,
  parsearMonto,
} from "../../src/domain/parsers"
import { borrar, borrarEnCaso, CASOS, escribirEnCaso, proyectoTemporal, RAIZ } from "../helpers"

describe("normalizadores", () => {
  test("NIT sin puntos ni dígito de verificación", () => {
    expect(normalizarNit("900.555.111-2")).toBe("900555111")
    expect(normalizarNit("901999000")).toBe("901999000")
  })
  test("montos COP y USD", () => {
    expect(parsearMonto("COP 11.400.000")).toEqual({ ok: true, data: { moneda: "COP", valor: 11400000 } })
    expect(parsearMonto("USD 1,250.50")).toEqual({ ok: true, data: { moneda: "USD", valor: 1250.5 } })
    expect(parsearMonto("sin monto").ok).toBe(false)
  })
  test("nombres sin tildes ni sufijos societarios", () => {
    expect(normalizarNombre("TecnoSuministros S.A.S.")).toBe("tecnosuministros")
    expect(normalizarNombre("Papelería Central Ltda.")).toBe("papeleria central")
    expect(normalizarNombre("Mobiliario Andino S.A.")).toBe("mobiliario andino")
  })
  test("email", () => {
    expect(normalizarEmail("  MLopez@Periferia-Ficticia.com ")).toBe("mlopez@periferia-ficticia.com")
  })
  test("fecha local sin corrimiento UTC", () => {
    expect(fechaLocal("2026-08-26T18:45:00-05:00")).toBe("2026-08-26")
    expect(fechaLocal("2026-08-26T23:59:00-05:00")).toBe("2026-08-26")
    expect(() => fechaLocal("ayer")).toThrow()
  })
  test("aprobado y su negación", () => {
    expect(contieneAprobado("Aprobado por 25 millones según la solicitud.")).toBe(true)
    expect(contieneAprobado("aprobada, proceder")).toBe(true)
    expect(contieneAprobado("No aprobado, falta presupuesto")).toBe(false)
    expect(contieneAprobado("Todavía no está aprobada")).toBe(false)
    expect(contieneAprobado("Lo reviso mañana")).toBe(false)
  })
  test("unidad inferida", () => {
    expect(inferirUnidad("Bolsa de 100 horas de arquitectura")).toBe("H")
    expect(inferirUnidad("Soporte mensual")).toBe("MES")
    expect(inferirUnidad("Diademas con micrófono")).toBe("UN")
    expect(inferirUnidad("Renovación licencias antivirus 120 puestos, vigencia 12 meses", 120)).toBe("UN")
    expect(inferirUnidad("Soporte 6 meses", 6)).toBe("MES")
  })
  test("monto mencionado en texto libre", () => {
    expect(montoMencionado("Aprobado por 25 millones según la solicitud.")).toBe(25000000)
    expect(montoMencionado("Aprobado.")).toBeNull()
  })
})

describe("cotizaciones y factura de los fixtures", () => {
  const esperados: Record<string, { numero: string; nit: string; total: number; hasta: string }> = {
    "sol-001": { numero: "COT-TS-2026-0451", nit: "900555111", total: 11400000, hasta: "2026-09-17" },
    "sol-002": { numero: "SDN-0093", nit: "901999000", total: 8500000, hasta: "2026-09-05" },
    "sol-003": { numero: "MA-2026-1177", nit: "830111222", total: 74000000, hasta: "2026-10-04" },
    "sol-004": { numero: "CA-2026-0310", nit: "901222333", total: 26500000, hasta: "2026-09-14" },
    "sol-005": { numero: "PC-5520", nit: "800444555", total: 3200000, hasta: "2026-09-04" },
    "sol-006": { numero: "COT-TS-2026-0468", nit: "900555111", total: 5400000, hasta: "2026-09-27" },
  }
  for (const caso of CASOS) {
    test(`cotización ${caso}`, async () => {
      const texto = await Bun.file(`${RAIZ}/fixtures/reto-03/solicitudes/${caso}/cotizacion.txt`).text()
      const r = parsearCotizacion(texto)
      if (!r.ok) throw new Error(r.error)
      const e = esperados[caso]
      expect(r.data.numero).toBe(e?.numero ?? "")
      expect(r.data.nit).toBe(e?.nit ?? "")
      expect(r.data.total).toBe(e?.total ?? 0)
      expect(r.data.moneda).toBe("COP")
      expect(r.data.validez_hasta).toBe(e?.hasta ?? "")
    })
  }
  test("cotización sin TOTAL → error legible", () => {
    const r = parsearCotizacion("COTIZACIÓN X\nFecha: 2026-01-01")
    expect(r.ok).toBe(false)
  })
  test("factura sol-005", async () => {
    const texto = await Bun.file(`${RAIZ}/fixtures/reto-03/solicitudes/sol-005/factura.txt`).text()
    expect(parsearFactura(texto)).toEqual({
      ok: true,
      data: { numero: "FC-88231", fecha: "2026-08-10", total: 3200000 },
    })
  })
})

describe("leerPaquete", () => {
  test("los 6 casos se leen y normalizan", () => {
    for (const caso of CASOS) {
      const r = leerPaquete(RAIZ, caso)
      if (!r.ok) throw new Error(`${caso}: ${r.error}`)
      expect(r.data.solicitud.solicitud_id).toMatch(/^SOL-2026-00\d$/)
      expect(r.data.cotizacion).not.toBeNull()
      expect(r.data.aprobacion?.aprobado).toBe(true)
      expect(r.data.factura === null).toBe(caso !== "sol-005")
      expect(r.data.faltantes).toEqual([])
    }
  })
  test("caso inexistente y path traversal → error, sin excepción", () => {
    expect(leerPaquete(RAIZ, "sol-999").ok).toBe(false)
    expect(leerPaquete(RAIZ, "../../etc").ok).toBe(false)
  })
  test("adjuntos ausentes → null + faltantes; JSON malformado y monto no numérico → error", async () => {
    const dir = proyectoTemporal()
    try {
      borrarEnCaso(dir, "sol-001", "cotizacion.txt")
      borrarEnCaso(dir, "sol-001", "aprobacion.json")
      const r = leerPaquete(dir, "sol-001")
      if (!r.ok) throw new Error(r.error)
      expect(r.data.cotizacion).toBeNull()
      expect(r.data.aprobacion).toBeNull()
      expect(r.data.faltantes).toEqual(["cotizacion.txt", "aprobacion.json"])

      escribirEnCaso(dir, "sol-002", "solicitud.json", "{ roto")
      const roto = leerPaquete(dir, "sol-002")
      expect(roto).toMatchObject({ ok: false })
      expect(roto.ok ? "" : roto.error).toContain("reenviar el Excel")

      const sol = JSON.parse(
        await Bun.file(`${RAIZ}/fixtures/reto-03/solicitudes/sol-003/solicitud.json`).text(),
      )
      escribirEnCaso(dir, "sol-003", "solicitud.json", JSON.stringify({ ...sol, valor_total: "abc" }))
      const monto = leerPaquete(dir, "sol-003")
      expect(monto.ok ? "" : monto.error).toBe(
        "El monto 'valor_total' no es numérico ('abc'). Pide al solicitante corregir la solicitud.",
      )

      borrarEnCaso(dir, "sol-004", "solicitud.json")
      expect(leerPaquete(dir, "sol-004").ok).toBe(false)
    } finally {
      borrar(dir)
    }
  })
})
