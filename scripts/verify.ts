// Verificación integral (bun run verify): compuerta final antes de entregar.
// Ejecuta los pasos en orden, imprime ✅/❌ y se detiene en el primer fallo.
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { contenidoAgente, contenidoSkill } from "./build-modulo"

const RAIZ = join(import.meta.dir, "..")
const BUN = process.execPath

type Paso = { nombre: string; ejecutar: () => string | null }

function correr(args: string[], cwd = RAIZ): { codigo: number; salida: string } {
  const r = Bun.spawnSync(args, { cwd, env: { ...process.env, ANTHROPIC_API_KEY: "" } })
  return { codigo: r.exitCode, salida: `${r.stdout.toString()}${r.stderr.toString()}` }
}

function comando(args: string[]): string | null {
  const r = correr(args)
  return r.codigo === 0 ? null : r.salida.trim().split("\n").slice(-15).join("\n")
}

function archivos(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n)
    if (statSync(ruta).isDirectory()) return archivos(ruta, ext)
    return ruta.endsWith(ext) ? [ruta] : []
  })
}

const OBLIGATORIOS = [
  "agent/prompt.md",
  "src/knowledge/ordenes-compra.md",
  "src/sap/adapter.ts",
  "src/sap/mock.ts",
  "src/llm/adapter.ts",
  "src/tools/oc.ts",
  "web/index.html",
  "demo.ts",
  ".env.example",
  "README.md",
  "SOLUCION.md",
  "modulo/agent.md",
  "modulo/tools/oc.ts",
  "modulo/skill/ordenes-compra/SKILL.md",
]

export const SECCIONES_SOLUCION = [
  "## 1. Problema en una frase",
  "## 2. Arquitectura",
  "## 3. Ciclo del agente",
  "## 4. Elección del modelo",
  "## 5. Matriz de controles",
  "## 6. Diseño del adaptador SAP real",
  "## 7. Lectura del proceso",
  "## 8. Decisiones y trade-offs",
  "## 9. Supuestos",
  "## 10. Cobertura",
  "## 11. Uso de IA",
  "## 12. Riesgos",
]

function sinAny(): string | null {
  // Patrón armado por partes para que este archivo no se detecte a sí mismo.
  const t = ["an", "y"].join("")
  const patron = new RegExp(`:\\s*${t}\\b|\\bas ${t}\\b|<${t}>`)
  const fuentes = [
    ...["src", "scripts", "modulo"].flatMap((c) => archivos(join(RAIZ, c), ".ts")),
    join(RAIZ, "demo.ts"),
  ]
  const con = fuentes.filter((f) => patron.test(readFileSync(f, "utf8")))
  return con.length ? `uso de any en: ${con.join(", ")}` : null
}

function demoDeterminista(): string | null {
  const dir = mkdtempSync(join(tmpdir(), "reto03-verify-"))
  try {
    cpSync(join(RAIZ, "fixtures"), join(dir, "fixtures"), { recursive: true })
    const enmascarar = (s: string) => s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<ts>")
    const a = correr([BUN, join(RAIZ, "demo.ts")], dir)
    const b = correr([BUN, join(RAIZ, "demo.ts")], dir)
    if (a.codigo !== 0 || b.codigo !== 0) return `demo.ts terminó con código ${a.codigo}/${b.codigo}`
    if (enmascarar(a.salida) !== enmascarar(b.salida))
      return "dos ejecuciones de demo.ts dieron salidas distintas"
    return a.salida.includes("4500000004 (confirmada, IVA derivado C1)")
      ? null
      : "la tabla final de la demo no coincide"
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function obligatorios(): string | null {
  const faltan = OBLIGATORIOS.filter((f) => !existsSync(join(RAIZ, f)) || statSync(join(RAIZ, f)).size === 0)
  return faltan.length ? `faltan o están vacíos: ${faltan.join(", ")}` : null
}

function solucion(): string | null {
  const texto = readFileSync(join(RAIZ, "SOLUCION.md"), "utf8")
  const faltan = SECCIONES_SOLUCION.filter((s) => !texto.includes(`\n${s}`))
  if (faltan.length) return `SOLUCION.md sin secciones: ${faltan.join(" | ")}`
  const [antes = "", resto = ""] = texto.split("## 11. Uso de IA")
  const despues = resto.split("## 12. Riesgos")[1] ?? ""
  return /\b(TODO|TBD)\b/.test(antes + despues) ? "SOLUCION.md tiene TODO/TBD fuera de 'Uso de IA'" : null
}

function gitignore(): string | null {
  const gi = readFileSync(join(RAIZ, ".gitignore"), "utf8")
  const faltan = ["node_modules/", "out/", ".env"].filter((e) => !gi.split("\n").includes(e))
  if (faltan.length) return `.gitignore no incluye: ${faltan.join(", ")}`
  const r = correr(["git", "ls-files"])
  if (r.codigo !== 0) return null // fuera de un repositorio git (p. ej. entrega en zip)
  const malos = r.salida
    .split("\n")
    .filter((f) => f === ".env" || f.startsWith("out/") || f.startsWith("node_modules/"))
  return malos.length ? `archivos que no deben versionarse: ${malos.join(", ")}` : null
}

function huellas(): string | null {
  const lineas = readFileSync(join(RAIZ, "tests", "fixtures.sha256"), "utf8")
    .trim()
    .split("\n")
  for (const linea of lineas) {
    const m = /^([a-f0-9]{64}) \*?(.+)$/.exec(linea.trim())
    if (!m?.[1] || !m[2]) return `línea inválida en fixtures.sha256: ${linea}`
    const hash = createHash("sha256")
      .update(readFileSync(join(RAIZ, m[2])))
      .digest("hex")
    if (hash !== m[1]) return `fixture modificado: ${m[2]}`
  }
  return null
}

function moduloSincronizado(): string | null {
  const agente = readFileSync(join(RAIZ, "modulo/agent.md"), "utf8")
  const skill = readFileSync(join(RAIZ, "modulo/skill/ordenes-compra/SKILL.md"), "utf8")
  if (agente !== contenidoAgente() || skill !== contenidoSkill())
    return "modulo/ desincronizado: ejecuta bun run build:modulo"
  const oc = readFileSync(join(RAIZ, "modulo/tools/oc.ts"), "utf8")
  return oc.includes('export * from "../../src/tools/oc"')
    ? null
    : "modulo/tools/oc.ts no re-exporta src/tools/oc"
}

function sinShell(): string | null {
  const prohibido = /child_process|Bun\.spawn|(?<![.\w])exec(Sync)?\(/
  const con = archivos(join(RAIZ, "src", "tools"), ".ts").filter((f) =>
    prohibido.test(readFileSync(f, "utf8")),
  )
  return con.length ? `herramientas con shell: ${con.join(", ")}` : null
}

const PASOS: Paso[] = [
  { nombre: "tsc --noEmit", ejecutar: () => comando([BUN, "x", "tsc", "--noEmit", "-p", "."]) },
  { nombre: "biome check", ejecutar: () => comando([BUN, "x", "biome", "check", "."]) },
  { nombre: "sin any", ejecutar: sinAny },
  { nombre: "bun test", ejecutar: () => comando([BUN, "test"]) },
  { nombre: "demo determinista (2 ejecuciones)", ejecutar: demoDeterminista },
  { nombre: "archivos obligatorios", ejecutar: obligatorios },
  { nombre: "SOLUCION.md con 12 secciones", ejecutar: solucion },
  { nombre: ".gitignore y archivos versionados", ejecutar: gitignore },
  { nombre: "fixtures intactos", ejecutar: huellas },
  { nombre: "modulo/ sincronizado", ejecutar: moduloSincronizado },
  { nombre: "herramientas sin shell", ejecutar: sinShell },
]

if (import.meta.main) {
  for (const paso of PASOS) {
    const error = paso.ejecutar()
    console.log(`${error ? "❌" : "✅"} ${paso.nombre}`)
    if (error) {
      console.log(`\n${error}`)
      process.exit(1)
    }
  }
  console.log("\n✅ Verificación completa")
}
