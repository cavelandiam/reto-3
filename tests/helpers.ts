// Utilidades de prueba: proyectos temporales con copia de los fixtures para escribir out/ o romper archivos.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

export const RAIZ = resolve(import.meta.dir, "..")
export const CASOS = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"] as const

/** Copia fixtures/ a un directorio temporal y devuelve su ruta (raíz de proyecto aislada). */
export function proyectoTemporal(): string {
  const dir = mkdtempSync(join(tmpdir(), "reto03-"))
  cpSync(join(RAIZ, "fixtures"), join(dir, "fixtures"), { recursive: true })
  return dir
}

export function borrar(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

export function escribirEnCaso(dir: string, caso: string, archivo: string, contenido: string): void {
  writeFileSync(join(dir, "fixtures", "reto-03", "solicitudes", caso, archivo), contenido, "utf8")
}

export function borrarEnCaso(dir: string, caso: string, archivo: string): void {
  rmSync(join(dir, "fixtures", "reto-03", "solicitudes", caso, archivo), { force: true })
}

/** Rutas de todas las hojas de un objeto: "a.b", "c[0].d". */
export function hojas(valor: unknown, ruta = ""): string[] {
  if (Array.isArray(valor)) return valor.flatMap((v, i) => hojas(v, `${ruta}[${i}]`))
  if (typeof valor === "object" && valor !== null) {
    return Object.entries(valor).flatMap(([k, v]) => hojas(v, ruta ? `${ruta}.${k}` : k))
  }
  return [ruta]
}
