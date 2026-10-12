// Registro de herramientas: descubre los exports de cada archivo de herramientas, los nombra
// <archivo>_<export>, genera su JSON Schema, valida argumentos con zod, ejecuta y escribe out/log.jsonl.
import { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import { recortar, registrarLog } from "../infra/log"
import type { ContextoHerramienta } from "./contexto"
import * as oc from "./oc"

export type HerramientaRegistrada = {
  nombre: string
  descripcion: string
  esquema: z.ZodObject<z.ZodRawShape>
  jsonSchema: Record<string, unknown>
  execute(args: unknown, ctx: ContextoHerramienta): Promise<string>
}

/** Compuerta opcional: devuelve un motivo de rechazo o null para permitir la ejecución. */
export type Compuerta = (nombre: string, args: unknown) => string | null

export type ResultadoEjecucion = {
  nombre: string
  argumentos: unknown
  contenido: string
  ok: boolean
  resumen: string
  duracion_ms: number
}

type ExportHerramienta = {
  description: string
  args: z.ZodRawShape
  execute(args: unknown, ctx: ContextoHerramienta): Promise<string>
}

function esHerramienta(v: unknown): v is ExportHerramienta {
  if (typeof v !== "object" || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.description === "string" && typeof o.args === "object" && typeof o.execute === "function"
}

function aJsonSchema(esquema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const { $schema: _omitido, ...resto } = zodToJsonSchema(esquema, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >
  return resto
}

/** Construye el registro a partir de módulos de herramientas: { oc: import * as oc }. */
export function construirRegistro(modulos: Record<string, Record<string, unknown>>): HerramientaRegistrada[] {
  return Object.entries(modulos).flatMap(([archivo, mod]) =>
    Object.entries(mod)
      .filter((entrada): entrada is [string, ExportHerramienta] => esHerramienta(entrada[1]))
      .map(([nombreExport, h]) => {
        const esquema = z.object(h.args)
        return {
          nombre: `${archivo}_${nombreExport}`,
          descripcion: h.description,
          esquema,
          jsonSchema: aJsonSchema(esquema),
          execute: (args: unknown, ctx: ContextoHerramienta) => h.execute(args, ctx),
        }
      }),
  )
}

export const HERRAMIENTAS: HerramientaRegistrada[] = construirRegistro({ oc })

export function buscarHerramienta(nombre: string): HerramientaRegistrada | undefined {
  return HERRAMIENTAS.find((h) => h.nombre === nombre)
}

function errorArgs(e: z.ZodError): string {
  const detalle = e.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ")
  return JSON.stringify({ ok: false, error: `Argumentos inválidos: ${detalle}` })
}

function campoCaso(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null
  const caso = (args as Record<string, unknown>).caso
  return typeof caso === "string" ? caso : null
}

/** Resumen corto (≤ 200 caracteres) del resultado de una herramienta para el chat y el log. */
export function resumir(contenido: string): { ok: boolean; resumen: string } {
  try {
    const r = JSON.parse(contenido) as { ok?: boolean; error?: string; data?: Record<string, unknown> }
    if (r.ok !== true) return { ok: false, resumen: recortar(r.error ?? "error") }
    return { ok: true, resumen: recortar(resumenData(r.data ?? {})) }
  } catch {
    return { ok: false, resumen: "respuesta no es JSON" }
  }
}

function codigos(v: unknown): string {
  return Array.isArray(v) ? v.map((h) => (h as { codigo?: string }).codigo).join(",") || "-" : "-"
}

function resumenData(d: Record<string, unknown>): string {
  if ("apta" in d) {
    return `apta=${d.apta} bloqueos=${codigos(d.bloqueos)} confirmaciones=${codigos(d.confirmaciones)} retroactiva=${d.retroactiva}`
  }
  if ("numero_oc" in d) return `OC ${d.numero_oc}${d.idempotente ? " (idempotente)" : " creada"}`
  if ("sha256" in d) return `evidencia ${d.ruta} sha256=${String(d.sha256).slice(0, 12)}…`
  if ("orden" in d) return `payload construido; trazabilidad en ${d.ruta_trazabilidad}`
  if ("solicitud" in d) {
    const s = d.solicitud as { solicitud_id?: string; valor_total?: number }
    return `paquete ${s.solicitud_id} leído (valor_total ${s.valor_total})`
  }
  if ("filas" in d && Array.isArray(d.filas)) return `${d.filas.length} filas leídas`
  return "ok"
}

async function ejecutarValidado(
  h: HerramientaRegistrada,
  args: unknown,
  ctx: ContextoHerramienta,
  compuerta: Compuerta | undefined,
): Promise<string> {
  const parsed = h.esquema.safeParse(args)
  if (!parsed.success) return errorArgs(parsed.error)
  const rechazo = compuerta?.(h.nombre, parsed.data) ?? null
  if (rechazo) return JSON.stringify({ ok: false, error: rechazo })
  return h.execute(parsed.data, ctx)
}

/** Valida, aplica la compuerta, ejecuta y registra en out/log.jsonl. Nunca lanza. */
export async function ejecutarHerramienta(
  nombre: string,
  args: unknown,
  ctx: ContextoHerramienta,
  compuerta?: Compuerta,
): Promise<ResultadoEjecucion> {
  const inicio = performance.now()
  const h = buscarHerramienta(nombre)
  const contenido = h
    ? await ejecutarValidado(h, args, ctx, compuerta)
    : JSON.stringify({ ok: false, error: `Herramienta desconocida '${nombre}'` })
  const duracion_ms = Math.round(performance.now() - inicio)
  const { ok, resumen } = resumir(contenido)
  const entrada = {
    sessionId: ctx.sessionId,
    herramienta: nombre,
    caso: campoCaso(args),
    ok,
    resumen,
    duracion_ms,
  }
  await registrarLog(ctx.directory, entrada).catch(() => undefined)
  return { nombre, argumentos: args, contenido, ok, resumen, duracion_ms }
}
