import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ExcelJS from "exceljs"
import type { OrdenCompra, Paquete } from "../../src/domain/schemas"
import type { ContextoHerramienta } from "../../src/tools/contexto"
import * as oc from "../../src/tools/oc"
import { ejecutarHerramienta, HERRAMIENTAS } from "../../src/tools/registry"
import { borrar, borrarEnCaso, escribirEnCaso, proyectoTemporal } from "../helpers"

type Respuesta = { ok: boolean; data?: unknown; error?: string }

let dir = ""
let ctx: ContextoHerramienta

beforeAll(() => {
  dir = proyectoTemporal()
  ctx = { directory: dir, sessionId: "test" }
})
afterAll(() => borrar(dir))

function parse(s: string): Respuesta {
  expect(typeof s).toBe("string")
  const r = JSON.parse(s) as Respuesta
  expect(typeof r.ok).toBe("boolean")
  return r
}

async function paquete(caso: string): Promise<Paquete> {
  const r = parse(await oc.leer_paquete.execute({ caso }, ctx))
  return r.data as Paquete
}

async function payload(caso: string): Promise<OrdenCompra> {
  const p = await paquete(caso)
  const v = parse(await oc.validar.execute({ caso, paquete: p }, ctx)).data as {
    derivados: Record<string, never>
  }
  const r = parse(await oc.construir_payload.execute({ caso, paquete: p, derivados: v.derivados }, ctx))
  return (r.data as { orden: OrdenCompra }).orden
}

function filasControl(): string[] {
  return readFileSync(join(dir, "out", "control.csv"), "utf8")
    .trim()
    .split("\n")
    .slice(1)
}

describe("forma de las herramientas (PRD §6.2)", () => {
  test("nombres oc_<export> y una descripción por herramienta", () => {
    expect(HERRAMIENTAS.map((h) => h.nombre).sort()).toEqual([
      "oc_construir_payload",
      "oc_crear",
      "oc_generar_evidencia",
      "oc_leer_excel",
      "oc_leer_paquete",
      "oc_validar",
    ])
    for (const h of HERRAMIENTAS) {
      expect(h.descripcion.length).toBeGreaterThan(20)
      expect(h.jsonSchema.type).toBe("object")
    }
  })
  test("cada argumento tiene .describe()", () => {
    for (const h of HERRAMIENTAS) {
      for (const [nombre, esquema] of Object.entries(h.esquema.shape)) {
        expect(`${h.nombre}.${nombre}: ${esquema.description ?? ""}`).not.toEndWith(": ")
      }
    }
  })
})

describe("nunca lanzan", () => {
  const malos = ["sol-999", "../../etc", "SOL-001", ""]
  for (const caso of malos) {
    test(`caso inválido '${caso}'`, async () => {
      for (const h of [oc.leer_paquete, oc.generar_evidencia])
        expect(parse(await h.execute({ caso }, ctx)).ok).toBe(false)
      expect(parse(await oc.crear.execute({ caso, payload: null }, ctx)).ok).toBe(false)
    })
  }
  test("JSON malformado y monto no numérico → error legible", async () => {
    const d = proyectoTemporal()
    try {
      const c = { directory: d, sessionId: "t" }
      escribirEnCaso(d, "sol-001", "solicitud.json", "{ roto")
      expect(parse(await oc.leer_paquete.execute({ caso: "sol-001" }, c)).error).toContain(
        "no es un JSON válido",
      )
      escribirEnCaso(d, "sol-002", "solicitud.json", JSON.stringify({ cantidad: "x" }))
      expect(parse(await oc.crear.execute({ caso: "sol-002", payload: null }, c)).error).toContain(
        "no es numérico",
      )
      borrarEnCaso(d, "sol-004", "cotizacion.txt")
      const p = parse(await oc.leer_paquete.execute({ caso: "sol-004" }, c))
      expect(p.data).toMatchObject({ cotizacion: null, faltantes: ["cotizacion.txt"] })
      borrarEnCaso(d, "sol-005", "aprobacion.json")
      expect(parse(await oc.generar_evidencia.execute({ caso: "sol-005" }, c)).error).toContain(
        "No hay correo de aprobación",
      )
    } finally {
      borrar(d)
    }
  })
  test("argumentos inválidos vía registry → error sin ejecutar", async () => {
    const r = await ejecutarHerramienta("oc_validar", { caso: 3 }, ctx)
    expect(r.ok).toBe(false)
    expect(parse(r.contenido).error).toStartWith("Argumentos inválidos:")
    const x = await ejecutarHerramienta("oc_inexistente", {}, ctx)
    expect(x.ok).toBe(false)
  })
})

describe("no confían en los argumentos del modelo", () => {
  test("paquete manipulado en oc_validar → error", async () => {
    const p = await paquete("sol-004")
    p.solicitud.valor_total = 26_500_000
    const r = parse(await oc.validar.execute({ caso: "sol-004", paquete: p }, ctx))
    expect(r.error).toContain("solicitud.valor_total")
  })
  test("paquete sin textos se acepta", async () => {
    const p = await paquete("sol-001")
    const sinTexto = { ...p, cotizacion: p.cotizacion && { ...p.cotizacion, texto: undefined } }
    expect(parse(await oc.validar.execute({ caso: "sol-001", paquete: sinTexto }, ctx)).ok).toBe(true)
  })
  test("payload manipulado en oc_crear → error y fila 'error'", async () => {
    const o = await payload("sol-006")
    const pos = o.posiciones[0]
    if (!pos) throw new Error("sin posición")
    const manipulado: OrdenCompra = { ...o, posiciones: [{ ...pos, precio_unitario: 1 }] }
    const r = parse(await oc.crear.execute({ caso: "sol-006", payload: manipulado, confirmado: true }, ctx))
    expect(r.error).toContain("posiciones[0].precio_unitario: 1 ≠ 180000")
    expect(filasControl().at(-1)).toStartWith("SOL-2026-006,error,")
  })
})

describe("oc_crear", () => {
  test("bloqueada → error con motivo y acción; fila 'bloqueada'", async () => {
    const r = parse(await oc.crear.execute({ caso: "sol-003", payload: null }, ctx))
    expect(r.error).toContain("Bloqueada: RC2")
    expect(r.error).toContain("Acción sugerida")
    expect(filasControl().at(-1)).toStartWith('SOL-2026-003,bloqueada,,false,"RC2;RC3"')
  })
  test("con confirmaciones y sin confirmar → 'requiere confirmación' con ambos valores", async () => {
    const r = parse(await oc.crear.execute({ caso: "sol-004", payload: await payload("sol-004") }, ctx))
    expect(r.error).toStartWith("requiere confirmación: RC5")
    expect(r.error).toContain("25.000.000")
    expect(r.error).toContain("26.500.000")
    expect(filasControl().at(-1)).toStartWith("SOL-2026-004,pendiente_confirmacion,,false,,RC5,")
  })
  test("confirmado=true → creada, excepción confirmada, idempotente después", async () => {
    const o = await payload("sol-004")
    const r = parse(await oc.crear.execute({ caso: "sol-004", payload: o, confirmado: true }, ctx))
    expect(r.data).toMatchObject({
      numero_oc: "4500000001",
      idempotente: false,
      ruta_evidencia: "out/sol-004/aprobacion.pdf",
    })
    expect(
      (r.data as { excepciones: Array<{ confirmado_por: string }> }).excepciones[0]?.confirmado_por,
    ).toBe("analista (sesión test)")
    const otra = parse(await oc.crear.execute({ caso: "sol-004", payload: o, confirmado: true }, ctx))
    expect(otra.data).toMatchObject({ numero_oc: "4500000001", idempotente: true })
    expect(
      filasControl()
        .slice(-2)
        .map((f) => f.split(",")[1]),
    ).toEqual(["creada", "idempotente"])
  })
  test("cada intento agrega una fila en control.csv", async () => {
    const antes = filasControl().length
    await oc.crear.execute({ caso: "sol-002", payload: null }, ctx)
    await oc.crear.execute({ caso: "sol-005", payload: null }, ctx)
    expect(filasControl().length).toBe(antes + 2)
  })
  test("registry escribe out/log.jsonl", async () => {
    await ejecutarHerramienta("oc_leer_paquete", { caso: "sol-001" }, ctx)
    const ultima =
      readFileSync(join(dir, "out", "log.jsonl"), "utf8")
        .trim()
        .split("\n")
        .at(-1) ?? "{}"
    expect(JSON.parse(ultima)).toMatchObject({
      sessionId: "test",
      herramienta: "oc_leer_paquete",
      caso: "sol-001",
      ok: true,
    })
  })
})

describe("oc_leer_excel (P1)", () => {
  test("lee filas de un .xlsx dentro del proyecto y rechaza rutas externas", async () => {
    const libro = new ExcelJS.Workbook()
    const hoja = libro.addWorksheet("Solicitud")
    hoja.addRow(["solicitud_id", "cantidad", "valor_unitario"])
    hoja.addRow(["SOL-2026-001", 120, 95000])
    await libro.xlsx.writeFile(join(dir, "solicitud.xlsx"))
    const r = parse(await oc.leer_excel.execute({ ruta: "solicitud.xlsx" }, ctx))
    expect(r.data).toEqual({
      filas: [{ solicitud_id: "SOL-2026-001", cantidad: 120, valor_unitario: 95000 }],
    })
    expect(parse(await oc.leer_excel.execute({ ruta: "../fuera.xlsx" }, ctx)).ok).toBe(false)
    expect(parse(await oc.leer_excel.execute({ ruta: "PRD.md" }, ctx)).ok).toBe(false)
  })
})
