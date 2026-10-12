import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { clasificar } from "../../src/agent/confirmacion"
import { borrar, proyectoTemporal } from "../helpers"
import { crearCaso, nuevoAgente, prepararCaso } from "./guion"

let dir = ""
beforeEach(() => {
  dir = proyectoTemporal()
})
afterEach(() => borrar(dir))

const leer = (caso: string) => ({ llamadas: [{ nombre: "oc_leer_paquete", argumentos: { caso } }] })

describe("topes y errores", () => {
  test("CA1: tope de iteraciones → respuesta con hecho y pendiente", async () => {
    const { agente } = nuevoAgente(
      dir,
      Array.from({ length: 10 }, () => leer("sol-001")),
      { maxIteraciones: 3 },
    )
    const r = await agente.turno(undefined, "procesa sol-001")
    expect(r.reply).toStartWith("Alcancé el límite de pasos")
    expect(r.reply).toContain("Hecho:")
    expect(r.reply).toContain("Pendiente:")
    expect(r.toolCalls).toHaveLength(3)
  })

  test("CA5: error de herramienta no mata la sesión", async () => {
    const guion = [leer("sol-999"), { texto: "No existe el caso sol-999." }, { texto: "Sigo aquí." }]
    const { agente } = nuevoAgente(dir, guion)
    const r1 = await agente.turno(undefined, "procesa sol-999")
    expect(r1.toolCalls[0]?.ok).toBe(false)
    expect(r1.toolCalls[0]?.resumen).toContain("no existe")
    const r2 = await agente.turno(r1.sessionId, "¿sigues?")
    expect(r2.reply).toBe("Sigo aquí.")
  })

  test("CA5: error o timeout del LLM → mensaje claro y sesión viva", async () => {
    const guion = [
      { error: "El proveedor de IA no respondió en 60 s. Intenta de nuevo." },
      { texto: "Listo." },
    ]
    const { agente } = nuevoAgente(dir, guion)
    const r1 = await agente.turno(undefined, "hola")
    expect(r1.reply).toContain("no respondió en 60 s")
    expect(r1.reply).toContain("La sesión sigue activa")
    const r2 = await agente.turno(r1.sessionId, "reintenta")
    expect(r2.reply).toBe("Listo.")
  })

  test("tope de tokens por sesión", async () => {
    const guion = [leer("sol-001"), { texto: "ok" }, { texto: "no debería llegar" }]
    const { agente } = nuevoAgente(dir, guion, { maxTokensSesion: 150, uso: { entrada: 100, salida: 20 } })
    const r1 = await agente.turno(undefined, "procesa sol-001")
    expect(r1.reply).toBe("ok")
    const r2 = await agente.turno(r1.sessionId, "otra cosa")
    expect(r2.reply).toContain("tope de uso de esta sesión")
  })

  test("mensaje vacío o demasiado largo → error de entrada", async () => {
    const { agente } = nuevoAgente(dir, [])
    expect(agente.turno(undefined, "  ")).rejects.toThrow("vacío")
    expect(agente.turno(undefined, "x".repeat(4001))).rejects.toThrow("4000")
  })
})

describe("CA3: confirmación humana impuesta en el servidor", () => {
  test("sin confirmaciones (sol-001) crea sin intervención", async () => {
    const guion = [...prepararCaso("sol-001"), crearCaso("sol-001"), { texto: "OC 4500000001 creada." }]
    const { agente } = nuevoAgente(dir, guion)
    const r = await agente.turno(undefined, "procesa sol-001")
    expect(r.needsConfirmation).toBe(false)
    expect(r.toolCalls.at(-1)).toMatchObject({ nombre: "oc_crear", ok: true })
  })

  test("sol-004: pide confirmación; el modelo no puede autoconfirmarse; 'confirmo' crea", async () => {
    const guion = [
      ...prepararCaso("sol-004"),
      crearCaso("sol-004", true), // intento indebido en el mismo turno
      { texto: "Hay una diferencia de 6,00 %. ¿Confirmas crear la OC por 25.000.000?" },
      crearCaso("sol-004", true),
      { texto: "OC 4500000001 creada." },
    ]
    const { agente } = nuevoAgente(dir, guion)
    const r1 = await agente.turno(undefined, "Procesa sol-004")
    const intento = r1.toolCalls.at(-1)
    expect(intento).toMatchObject({ nombre: "oc_crear", ok: false })
    expect(intento?.resumen).toContain("requiere confirmación explícita")
    expect(r1.needsConfirmation).toBe(true)
    expect(r1.pendiente).toEqual([{ caso: "sol-004", confirmaciones: ["RC5"] }])

    const r2 = await agente.turno(r1.sessionId, "Confirmo")
    expect(r2.toolCalls[0]).toMatchObject({ nombre: "oc_crear", ok: true })
    expect(r2.toolCalls[0]?.resumen).toBe("OC 4500000001 creada")
    expect(r2.needsConfirmation).toBe(false)
  })

  test("'No confirmo' en el turno siguiente → oc_crear confirmado rechazado", async () => {
    const guion = [
      ...prepararCaso("sol-006"),
      { texto: "¿Confirmas el IVA C1?" },
      crearCaso("sol-006", true),
      { texto: "ok" },
    ]
    const { agente } = nuevoAgente(dir, guion)
    const r1 = await agente.turno(undefined, "procesa sol-006")
    expect(r1.needsConfirmation).toBe(true)
    const r2 = await agente.turno(r1.sessionId, "No confirmo")
    expect(r2.toolCalls[0]?.ok).toBe(false)
    expect(r2.needsConfirmation).toBe(false)
  })

  test("varios pendientes sin nombrar el caso → pide aclarar", async () => {
    const guion = [
      ...prepararCaso("sol-004"),
      ...prepararCaso("sol-006"),
      { texto: "¿Confirmas sol-004 y sol-006?" },
      crearCaso("sol-006", true),
      { texto: "¿Cuál?" },
    ]
    const { agente } = nuevoAgente(dir, guion)
    const r1 = await agente.turno(undefined, "procesa sol-004 y sol-006")
    expect(r1.pendiente.map((p) => p.caso)).toEqual(["sol-004", "sol-006"])
    const r2 = await agente.turno(r1.sessionId, "sí, confirmo")
    expect(r2.toolCalls[0]?.resumen).toContain("Hay varias OC pendientes")
  })

  test("'no la crees' bloquea oc_crear aunque no haya confirmaciones", async () => {
    const guion = [...prepararCaso("sol-001"), crearCaso("sol-001"), { texto: "Te muestro la OC. ¿La creo?" }]
    const { agente } = nuevoAgente(dir, guion)
    const r = await agente.turno(undefined, "Procesa sol-001 y no la crees hasta que yo lo confirme")
    expect(r.toolCalls.at(-1)?.ok).toBe(false)
    expect(r.needsConfirmation).toBe(true)
  })

  test("CA4: toda llamada queda en out/log.jsonl", async () => {
    const { agente } = nuevoAgente(dir, [...prepararCaso("sol-001"), { texto: "listo" }])
    const r = await agente.turno(undefined, "procesa sol-001")
    const lineas = readFileSync(join(dir, "out", "log.jsonl"), "utf8")
      .trim()
      .split("\n")
    const deSesion = lineas.map((l) => JSON.parse(l)).filter((l) => l.sessionId === r.sessionId)
    expect(deSesion.map((l) => l.herramienta)).toEqual(r.toolCalls.map((t) => t.nombre))
  })

  test("clasificador de respuestas", () => {
    expect(clasificar("Sí, confirmo")).toBe("afirmativo")
    expect(clasificar("sí")).toBe("afirmativo")
    expect(clasificar("dale, créala")).toBe("afirmativo")
    expect(clasificar("No confirmo")).toBe("negativo")
    expect(clasificar("todavía no")).toBe("negativo")
    expect(clasificar("¿qué es RC5?")).toBe("otro")
  })
})

test("grounding: un número inventado se marca en la respuesta", async () => {
  const guion = [leer("sol-001"), { texto: "El total es 11.400.000 y el IVA 2.166.000." }]
  const { agente } = nuevoAgente(dir, guion)
  const r = await agente.turno(undefined, "procesa sol-001")
  expect(r.reply).toContain("⚠️ Verifica: el valor 2166000 no proviene de una herramienta.")
})
