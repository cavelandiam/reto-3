import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as moduloOc from "../modulo/tools/oc"
import {
  contenidoAgente,
  contenidoSkill,
  FRONTMATTER_AGENTE,
  FRONTMATTER_SKILL,
} from "../scripts/build-modulo"
import * as oc from "../src/tools/oc"
import { RAIZ } from "./helpers"

const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8")

test("modulo/agent.md = frontmatter + agent/prompt.md (sin divergencias)", () => {
  const agente = leer("modulo/agent.md")
  expect(agente).toBe(contenidoAgente())
  expect(agente.slice(FRONTMATTER_AGENTE.length)).toBe(leer("agent/prompt.md"))
  expect(agente).toContain("mode: primary")
  expect(agente).toContain("edit: deny")
  expect(agente).toContain("bash: deny")
})

test("modulo/skill/ordenes-compra/SKILL.md = frontmatter + src/knowledge/ordenes-compra.md", () => {
  const skill = leer("modulo/skill/ordenes-compra/SKILL.md")
  expect(skill).toBe(contenidoSkill())
  expect(skill.slice(FRONTMATTER_SKILL.length)).toBe(leer("src/knowledge/ordenes-compra.md"))
  expect(skill).toContain("name: ordenes-compra")
})

test("modulo/tools/oc.ts re-exporta los mismos objetos de herramienta", () => {
  expect(Object.keys(moduloOc).sort()).toEqual(Object.keys(oc).sort())
  const delModulo: Record<string, unknown> = { ...moduloOc }
  for (const [nombre, h] of Object.entries(oc)) expect(delModulo[nombre]).toBe(h)
})

test("las herramientas del módulo se usan sin el servidor", async () => {
  const r = JSON.parse(
    await moduloOc.leer_paquete.execute({ caso: "sol-001" }, { directory: RAIZ, sessionId: "modulo" }),
  )
  expect(r.ok).toBe(true)
  expect(r.data.solicitud.solicitud_id).toBe("SOL-2026-001")
})
