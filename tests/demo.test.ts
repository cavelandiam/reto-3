import { expect, test } from "bun:test"
import { join } from "node:path"
import { borrar, proyectoTemporal, RAIZ } from "./helpers"

const TABLA_ESPERADA = `CASO     APTA  BLOQUEOS   CONFIRMACIONES  RETRO  RESULTADO
sol-001  sí    -          -               no     OC 4500000001 (2ª llamada: idempotente)
sol-002  no    RC1        -               no     Bloqueada: proveedor no existe
sol-003  no    RC2,RC3    -               no     Bloqueada: aprobador sin autoridad / tope
sol-004  sí    -          RC5             no     OC 4500000002 (confirmada)
sol-005  sí    -          RC8             sí     OC 4500000003 (confirmada, retroactiva)
sol-006  sí    -          RC6             no     OC 4500000004 (confirmada, IVA derivado C1)`

/** Ejecuta demo.ts en un proyecto temporal, sin variables de proveedor LLM. */
function correrDemo(dir: string): { codigo: number; salida: string } {
  const env = { ...process.env, ANTHROPIC_API_KEY: "", LLM_PROVIDER: "" }
  const r = Bun.spawnSync([process.execPath, join(RAIZ, "demo.ts")], { cwd: dir, env })
  return { codigo: r.exitCode, salida: r.stdout.toString() }
}

const enmascarar = (s: string) => s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<ts>")

test("demo.ts corre sin clave, es determinista y muestra la tabla esperada", () => {
  const dir = proyectoTemporal()
  try {
    const a = correrDemo(dir)
    const b = correrDemo(dir)
    expect(a.codigo).toBe(0)
    expect(b.codigo).toBe(0)
    expect(enmascarar(a.salida)).toBe(enmascarar(b.salida))
    expect(a.salida.replace(/\r\n/g, "\n")).toContain(TABLA_ESPERADA)
    expect(a.salida).toContain("idempotente: true")
    expect(a.salida).toContain("requiere confirmación: RC5")
  } finally {
    borrar(dir)
  }
}, 30_000)
