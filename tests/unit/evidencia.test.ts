import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { escribirEvidencia, sanearWinAnsi, sha256, textoCanonico } from "../../src/domain/evidencia"
import { cargarMaestros } from "../../src/domain/maestros"
import { leerPaquete } from "../../src/domain/paquete"
import { construirOrden } from "../../src/domain/payload"
import { validarPaquete } from "../../src/domain/reglas"
import { borrar, proyectoTemporal, RAIZ } from "../helpers"

function paquete(caso: string) {
  const p = leerPaquete(RAIZ, caso)
  if (!p.ok) throw new Error(p.error)
  return p.data
}

describe("evidencia de aprobación", () => {
  test("texto canónico estable (sol-001)", () => {
    const p = paquete("sol-001")
    if (!p.aprobacion) throw new Error("sin aprobación")
    expect(textoCanonico(p.solicitud.solicitud_id, p.aprobacion)).toBe(
      [
        "EVIDENCIA DE APROBACIÓN DE ORDEN DE COMPRA",
        "Solicitud: SOL-2026-001",
        "De: mlopez@periferia-ficticia.com",
        "Para: juan.camargo@periferia-ficticia.com",
        "CC: compras@periferia-ficticia.com",
        "Fecha: 2026-08-21T10:02:00-05:00",
        "Asunto: RE: Solicitud de orden de compra SOL-001",
        "",
        "Aprobado, proceder con la orden de compra.",
        "",
        "Mariana López",
        "Gerente de Tecnología",
      ].join("\n"),
    )
  })

  test("txt y pdf creados; hash reproducible e igual al del payload", async () => {
    const dir = proyectoTemporal()
    try {
      const p = paquete("sol-001")
      const e1 = await escribirEvidencia(dir, "sol-001", p)
      const e2 = await escribirEvidencia(dir, "sol-001", p)
      expect(e1?.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(e1?.sha256).toBe(e2?.sha256 ?? "")
      expect(e1?.ruta).toBe("out/sol-001/aprobacion.txt")
      const txt = readFileSync(join(dir, "out/sol-001/aprobacion.txt"), "utf8")
      expect(txt).toContain(`SHA-256 del contenido anterior: ${e1?.sha256}`)
      const pdf = readFileSync(join(dir, "out/sol-001/aprobacion.pdf"))
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
      const orden = construirOrden(p, validarPaquete(p, cargarMaestros(RAIZ)))
      if (!orden.ok) throw new Error(orden.error)
      expect(orden.data.orden.aprobador.evidencia_sha256).toBe(e1?.sha256 ?? "")
      expect(sha256(txt.split("\n---\n")[0] ?? "")).toBe(e1?.sha256 ?? "")
    } finally {
      borrar(dir)
    }
  })

  test("todos los casos con aprobación generan PDF (caracteres especiales saneados)", async () => {
    const dir = proyectoTemporal()
    try {
      for (const caso of ["sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]) {
        await escribirEvidencia(dir, caso, paquete(caso))
        expect(existsSync(join(dir, "out", caso, "aprobacion.pdf"))).toBe(true)
      }
      expect(sanearWinAnsi("tope ≥ 30 — ok ✓")).toBe("tope >= 30 - ok ?")
    } finally {
      borrar(dir)
    }
  })

  test("sin aprobación → null", async () => {
    const p = { ...paquete("sol-001"), aprobacion: null }
    expect(await escribirEvidencia(RAIZ, "sol-001", p)).toBeNull()
  })
})
