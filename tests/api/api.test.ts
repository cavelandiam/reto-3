import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { leerConfig } from "../../src/config"
import type { LlmAdapter } from "../../src/llm/adapter"
import { type PasoGuion, ScriptedLLM } from "../../src/llm/scripted"
import { crearApp, crearLlm } from "../../src/server"
import { borrar, proyectoTemporal } from "../helpers"

const CLAVE_FALSA = "sk-ant-PRUEBA-no-es-real-123"

let dir = ""
beforeEach(() => {
  dir = proyectoTemporal()
})
afterEach(() => borrar(dir))

function app(opciones: { llm?: LlmAdapter | null; env?: Record<string, string> } = {}) {
  const config = leerConfig({ ANTHROPIC_API_KEY: CLAVE_FALSA, ...opciones.env })
  const llm = opciones.llm === undefined ? new ScriptedLLM([{ texto: "hola" }]) : opciones.llm
  return crearApp({ config, llm, directory: dir })
}

function chat(a: ReturnType<typeof app>, cuerpo: unknown, headers: Record<string, string> = {}) {
  return a.request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(cuerpo),
  })
}

describe("API", () => {
  test("GET /api/health sin exponer la clave", async () => {
    const r = await app({ llm: crearLlm(leerConfig({ ANTHROPIC_API_KEY: CLAVE_FALSA })) }).request(
      "/api/health",
    )
    const texto = await r.text()
    expect(r.status).toBe(200)
    expect(JSON.parse(texto)).toMatchObject({
      ok: true,
      provider: "anthropic",
      model: "claude-opus-5-5",
      llm_configurado: true,
    })
    expect(texto).not.toContain(CLAVE_FALSA)
  })

  test("sin clave: health dice llm_configurado=false y /api/chat responde 503 legible", async () => {
    const a = app({ llm: null })
    expect(await (await a.request("/api/health")).json()).toMatchObject({ llm_configurado: false })
    const r = await chat(a, { message: "hola" })
    expect(r.status).toBe(503)
    expect((await r.json()).error).toContain("no está configurado")
  })

  test("POST /api/chat crea sesión y GET /api/sessions/:id devuelve el historial", async () => {
    const guion: PasoGuion[] = [
      { llamadas: [{ nombre: "oc_leer_paquete", argumentos: { caso: "sol-001" } }] },
      { texto: "Leído." },
    ]
    const a = app({ llm: new ScriptedLLM(guion) })
    const r = await chat(a, { message: "procesa sol-001" })
    const cuerpo = await r.json()
    expect(r.status).toBe(200)
    expect(cuerpo).toMatchObject({ reply: "Leído.", needsConfirmation: false, pendiente: [] })
    expect(cuerpo.toolCalls[0]).toMatchObject({ nombre: "oc_leer_paquete", ok: true })
    expect(cuerpo.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    const h = await (await a.request(`/api/sessions/${cuerpo.sessionId}`)).json()
    expect(h.mensajes.map((m: { rol: string }) => m.rol)).toEqual(["user", "assistant"])
    expect(existsSync(join(dir, "out", "sessions", `${cuerpo.sessionId}.json`))).toBe(true)
  })

  test("validación del cuerpo y sesión inexistente", async () => {
    const a = app()
    expect((await chat(a, { message: "" })).status).toBe(400)
    expect((await chat(a, { message: "x".repeat(4001) })).status).toBe(400)
    expect((await chat(a, { sessionId: "../../x", message: "hola" })).status).toBe(400)
    expect((await chat(a, { sessionId: null, message: "hola" })).status).toBe(200)
    const r = await a.request("/api/sessions/no-existe")
    expect(r.status).toBe(404)
    expect((await r.json()).error).toBe("La sesión no existe")
  })

  test("ACCESS_KEY protege /api/* salvo /api/health", async () => {
    const a = app({ env: { ACCESS_KEY: "secreta" } })
    expect((await a.request("/api/health")).status).toBe(200)
    expect((await a.request("/api/casos")).status).toBe(401)
    expect((await chat(a, { message: "hola" })).status).toBe(401)
    const ok = await a.request("/api/casos", { headers: { "x-access-key": "secreta" } })
    expect((await ok.json()).casos).toEqual([
      "sol-001",
      "sol-002",
      "sol-003",
      "sol-004",
      "sol-005",
      "sol-006",
    ])
  })

  test("rate limit por IP en /api/chat", async () => {
    const guion = Array.from({ length: 5 }, () => ({ texto: "ok" }))
    const a = app({ llm: new ScriptedLLM(guion), env: { RATE_LIMIT_POR_MINUTO: "2" } })
    const ip = { "x-forwarded-for": "10.0.0.1" }
    expect((await chat(a, { message: "1" }, ip)).status).toBe(200)
    expect((await chat(a, { message: "2" }, ip)).status).toBe(200)
    expect((await chat(a, { message: "3" }, ip)).status).toBe(429)
    expect((await chat(a, { message: "4" }, { "x-forwarded-for": "10.0.0.2" })).status).toBe(200)
  })

  test("POST /api/reset limpia out/", async () => {
    const a = app()
    await chat(a, { message: "hola" })
    expect(existsSync(join(dir, "out"))).toBe(true)
    expect((await a.request("/api/reset", { method: "POST" })).status).toBe(200)
    expect(existsSync(join(dir, "out"))).toBe(false)
  })

  test("sirve el front y no filtra la clave en log ni respuestas", async () => {
    const a = app({
      llm: new ScriptedLLM([
        { llamadas: [{ nombre: "oc_leer_paquete", argumentos: { caso: "sol-002" } }] },
        { texto: "ok" },
      ]),
    })
    const html = await (await a.request("/")).text()
    expect(html).toContain("Agente de órdenes de compra")
    expect((await a.request("/app.js")).headers.get("content-type")).toContain("javascript")
    const r = await (await chat(a, { message: "procesa sol-002" })).text()
    expect(r).not.toContain(CLAVE_FALSA)
    expect(readFileSync(join(dir, "out", "log.jsonl"), "utf8")).not.toContain(CLAVE_FALSA)
  })
})
