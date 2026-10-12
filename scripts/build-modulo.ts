// Genera modulo/agent.md y modulo/skill/ordenes-compra/SKILL.md desde las fuentes de la aplicación
// (agent/prompt.md y src/knowledge/ordenes-compra.md). No se editan a mano: `bun run build:modulo`.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { RAIZ_PROYECTO } from "../src/agent/prompt-loader"

export const FRONTMATTER_AGENTE = `---
description: Prepara, valida y crea órdenes de compra en SAP a partir del paquete de solicitud, cotización y aprobación.
mode: primary
permission:
  edit: deny
  bash: deny
---
`

export const FRONTMATTER_SKILL = `---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia (reglas RC1–RC10, códigos SAP, retroactivas, qué pedir ante cada bloqueo).
---
`

const leer = (ruta: string) => readFileSync(join(RAIZ_PROYECTO, ruta), "utf8")

export function contenidoAgente(): string {
  return FRONTMATTER_AGENTE + leer("agent/prompt.md")
}

export function contenidoSkill(): string {
  return FRONTMATTER_SKILL + leer("src/knowledge/ordenes-compra.md")
}

if (import.meta.main) {
  writeFileSync(join(RAIZ_PROYECTO, "modulo", "agent.md"), contenidoAgente(), "utf8")
  writeFileSync(
    join(RAIZ_PROYECTO, "modulo", "skill", "ordenes-compra", "SKILL.md"),
    contenidoSkill(),
    "utf8",
  )
  console.log("modulo/agent.md y modulo/skill/ordenes-compra/SKILL.md regenerados desde las fuentes")
}
