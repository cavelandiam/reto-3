import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { RAIZ } from "./helpers"

const IGNORADOS = new Set(["node_modules", ".git", "out", ".env", "bun.lock", ".claude"])

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    if (IGNORADOS.has(nombre)) return []
    const ruta = join(dir, nombre)
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta]
  })
}

const rel = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/")

describe("seguridad", () => {
  test("ningún archivo del repositorio contiene claves de API", () => {
    // Patrón armado por partes para que este mismo archivo no coincida.
    const patron = new RegExp(["sk", "-ant-", "[A-Za-z0-9_-]{20,}"].join(""))
    const conClave = archivos(RAIZ)
      .filter((f) => !rel(f).startsWith("tests/api/"))
      .filter((f) => patron.test(readFileSync(f, "utf8")))
    expect(conClave).toEqual([])
  })

  test("las herramientas no ejecutan comandos de shell ni hacen red", () => {
    // `RegExp.prototype.exec` (precedido de ".") no cuenta.
    const prohibido = /child_process|Bun\.spawn|(?<![.\w])exec(Sync)?\(|\bfetch\(/
    const fuentes = [...archivos(join(RAIZ, "src", "tools")), ...archivos(join(RAIZ, "src", "domain"))]
    expect(fuentes.filter((f) => prohibido.test(readFileSync(f, "utf8"))).map(rel)).toEqual([])
  })

  test("fixtures/ intactos (huellas de tests/fixtures.sha256)", () => {
    const lineas = readFileSync(join(RAIZ, "tests", "fixtures.sha256"), "utf8")
      .trim()
      .split("\n")
    expect(lineas.length).toBe(29)
    for (const linea of lineas) {
      const m = /^([a-f0-9]{64}) \*?(.+)$/.exec(linea.trim())
      if (!m?.[1] || !m[2]) throw new Error(`línea inválida: ${linea}`)
      const hash = createHash("sha256")
        .update(readFileSync(join(RAIZ, m[2])))
        .digest("hex")
      expect(`${m[2]} ${hash}`).toBe(`${m[2]} ${m[1]}`)
    }
  })

  test("sin 'any' explícito en el código", () => {
    const patron = /:\s*any\b|\bas any\b|<any>/
    const carpetas = ["src", "scripts", "modulo"].map((c) => join(RAIZ, c))
    const fuentes = [...carpetas.flatMap(archivos), join(RAIZ, "demo.ts")].filter((f) => f.endsWith(".ts"))
    expect(fuentes.filter((f) => patron.test(readFileSync(f, "utf8"))).map(rel)).toEqual([])
  })
})
