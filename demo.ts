// Demo sin modelo (PRD §6.6): procesa los 6 casos llamando directamente a las herramientas de src/tools/oc.ts.
// No necesita clave de ningún proveedor. Limpia out/ al inicio. Uso: bun run demo.ts
import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { Validacion } from "./src/domain/reglas"
import type { Hallazgo, OrdenCompra, Paquete } from "./src/domain/schemas"
import type { ContextoHerramienta } from "./src/tools/contexto"
import * as oc from "./src/tools/oc"

const ctx: ContextoHerramienta = { directory: process.cwd(), sessionId: "demo" }

type Respuesta<T> = { ok: true; data: T } | { ok: false; error: string }
type Creacion = {
  numero_oc: string
  idempotente: boolean
  retroactiva?: boolean
  ruta_evidencia?: string | null
}
type FilaResumen = {
  caso: string
  apta: boolean
  bloqueos: string
  confirmaciones: string
  retro: boolean
  resultado: string
}

const resumen: FilaResumen[] = []

function leer<T>(json: string): Respuesta<T> {
  return JSON.parse(json) as Respuesta<T>
}

function exigir<T>(r: Respuesta<T>, paso: string): T {
  if (!r.ok) throw new Error(`${paso}: ${r.error}`)
  return r.data
}

function codigos(h: Hallazgo[]): string {
  return h.map((x) => x.codigo).join(",") || "-"
}

function imprimirValidacion(v: Validacion): void {
  console.log(`  apta: ${v.apta ? "sí" : "no"}   retroactiva: ${v.retroactiva}`)
  for (const b of v.bloqueos)
    console.log(`  ✗ BLOQUEO ${b.codigo}: ${b.detalle}\n      acción: ${b.accion_sugerida}`)
  for (const c of v.confirmaciones) console.log(`  ? CONFIRMAR ${c.codigo}: ${c.detalle}`)
  const d = v.derivados
  if (d.indicador_iva)
    console.log(`  ↳ derivado indicador_iva = ${d.indicador_iva.valor} (${d.indicador_iva.fuente})`)
  if (d.condiciones_pago)
    console.log(`  ↳ derivado condiciones_pago = ${d.condiciones_pago.valor} (${d.condiciones_pago.fuente})`)
  if (d.proveedor)
    console.log(`  ↳ proveedor ${d.proveedor.codigo_sap} ${d.proveedor.nombre} (${d.proveedor.resuelto_por})`)
}

async function crear(
  caso: string,
  payload: OrdenCompra | null,
  confirmado?: boolean,
): Promise<Respuesta<Creacion>> {
  const r = leer<Creacion>(await oc.crear.execute({ caso, payload, confirmado }, ctx))
  const etiqueta = confirmado ? "crear (confirmado=true)" : "crear"
  if (r.ok) {
    const extra = r.data.idempotente
      ? " → idempotente: true (no se creó otra)"
      : ` → evidencia ${r.data.ruta_evidencia}`
    console.log(`  ${etiqueta}: OC ${r.data.numero_oc}${extra}`)
  } else console.log(`  ${etiqueta}: ✗ ${r.error}`)
  return r
}

/** leer → validar → (si apta) evidencia → payload. Devuelve validación y payload. */
async function preparar(caso: string): Promise<{ v: Validacion; payload: OrdenCompra | null }> {
  console.log(`\n=== ${caso} ===`)
  const paquete = exigir(leer<Paquete>(await oc.leer_paquete.execute({ caso }, ctx)), "leer_paquete")
  console.log(`  ${paquete.solicitud.solicitud_id} · ${paquete.solicitud.descripcion}`)
  const v = exigir(leer<Validacion>(await oc.validar.execute({ caso, paquete }, ctx)), "validar")
  imprimirValidacion(v)
  if (!v.apta) return { v, payload: null }
  const ev = exigir(
    leer<{ ruta: string; sha256: string }>(await oc.generar_evidencia.execute({ caso }, ctx)),
    "evidencia",
  )
  console.log(`  evidencia: ${ev.ruta} sha256=${ev.sha256}`)
  const args = { caso, paquete, derivados: v.derivados }
  const p = exigir(
    leer<{ orden: OrdenCompra; ruta_trazabilidad: string }>(await oc.construir_payload.execute(args, ctx)),
    "payload",
  )
  const pos = p.orden.posiciones[0]
  console.log(
    `  payload: ${p.orden.proveedor.nombre} · ${pos?.cantidad} ${pos?.unidad} × ${pos?.precio_unitario} · IVA ${pos?.indicador_iva} · ${p.orden.condiciones_pago}`,
  )
  return { v, payload: p.orden }
}

function registrar(caso: string, v: Validacion, resultado: string): void {
  resumen.push({
    caso,
    apta: v.apta,
    bloqueos: codigos(v.bloqueos),
    confirmaciones: codigos(v.confirmaciones),
    retro: v.retroactiva,
    resultado,
  })
}

async function casoDirecto(caso: string): Promise<void> {
  const { v, payload } = await preparar(caso)
  const r1 = exigir(await crear(caso, payload), "crear")
  const r2 = exigir(await crear(caso, payload), "crear (2ª)")
  const igual = r1.numero_oc === r2.numero_oc && r2.idempotente
  registrar(caso, v, `OC ${r1.numero_oc} (2ª llamada: ${igual ? "idempotente" : "¡DUPLICADA!"})`)
}

async function casoBloqueado(caso: string, motivo: string): Promise<void> {
  const { v } = await preparar(caso)
  await crear(caso, null)
  registrar(caso, v, `Bloqueada: ${motivo}`)
}

async function casoConConfirmacion(caso: string, nota: string): Promise<void> {
  const { v, payload } = await preparar(caso)
  await crear(caso, payload)
  console.log("  → el usuario confirma explícitamente las excepciones")
  const r = exigir(await crear(caso, payload, true), "crear confirmado")
  registrar(caso, v, `OC ${r.numero_oc} (${nota})`)
}

function imprimirControl(): void {
  const ruta = join(ctx.directory, "out", "control.csv")
  console.log("\n=== out/control.csv ===")
  console.log(existsSync(ruta) ? readFileSync(ruta, "utf8").trimEnd() : "(vacío)")
}

function imprimirResumen(): void {
  const col = (s: string, n: number) => s.padEnd(n)
  console.log("\n=== Resumen ===")
  console.log(
    `${col("CASO", 9)}${col("APTA", 6)}${col("BLOQUEOS", 11)}${col("CONFIRMACIONES", 16)}${col("RETRO", 7)}RESULTADO`,
  )
  for (const f of resumen) {
    console.log(
      `${col(f.caso, 9)}${col(f.apta ? "sí" : "no", 6)}${col(f.bloqueos, 11)}${col(f.confirmaciones, 16)}${col(f.retro ? "sí" : "no", 7)}${f.resultado}`,
    )
  }
}

async function main(): Promise<void> {
  rmSync(join(ctx.directory, "out"), { recursive: true, force: true })
  console.log("Demo de herramientas de órdenes de compra (sin modelo de lenguaje)")
  await casoDirecto("sol-001")
  await casoBloqueado("sol-002", "proveedor no existe")
  await casoBloqueado("sol-003", "aprobador sin autoridad / tope")
  await casoConConfirmacion("sol-004", "confirmada")
  await casoConConfirmacion("sol-005", "confirmada, retroactiva")
  await casoConConfirmacion("sol-006", "confirmada, IVA derivado C1")
  imprimirControl()
  imprimirResumen()
}

main().catch((e: unknown) => {
  console.error(`La demo falló: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
