// Herramientas de órdenes de compra. Cada export es una herramienta; el modelo la ve como oc_<export>.
// Ninguna lanza: todas devuelven JSON { ok: true, data } | { ok: false, error }.
// Las herramientas recalculan desde el caso (fixtures + maestros) y no confían en lo que envía el modelo.
import { existsSync } from "node:fs"
import ExcelJS from "exceljs"
import { z } from "zod"
import { escribirEvidencia } from "../domain/evidencia"
import { cargarMaestros } from "../domain/maestros"
import { leerPaquete } from "../domain/paquete"
import { construirOrden, guardarTrazabilidad } from "../domain/payload"
import { type Validacion, validarPaquete } from "../domain/reglas"
import {
  DerivadosSchema,
  type OrdenCompra,
  OrdenCompraSchema,
  type Paquete,
  type PaqueteEntrada,
  PaqueteSchema,
} from "../domain/schemas"
import { describirDiferencia, primeraDiferencia } from "../infra/comparar"
import { type FilaControl, registrarControl } from "../infra/control"
import { resolverDentro } from "../infra/paths"
import { err, ok, type Resultado, safeTool } from "../infra/result"
import { type ContextoHerramienta, getSapAdapter, type Herramienta } from "./contexto"

const argCaso = z
  .string()
  .describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, p. ej. 'sol-001'")
const argPaquete = PaqueteSchema.describe(
  "Paquete devuelto por oc_leer_paquete (los campos 'texto' pueden omitirse)",
)

// ---------- recálculo desde las fuentes ----------

type Recalculo = { paquete: Paquete; validacion: Validacion }

function recalcular(ctx: ContextoHerramienta, caso: string): Resultado<Recalculo> {
  const p = leerPaquete(ctx.directory, caso)
  if (!p.ok) return p
  return ok({ paquete: p.data, validacion: validarPaquete(p.data, cargarMaestros(ctx.directory)) })
}

/** Campos del paquete que deciden la validación (PRD §7.2 sin los textos libres). */
function proyeccion(p: PaqueteEntrada) {
  const c = p.cotizacion
  const a = p.aprobacion
  return {
    correo: p.correo,
    solicitud: p.solicitud,
    cotizacion: c && {
      proveedor: c.proveedor,
      nit: c.nit,
      total: c.total,
      moneda: c.moneda,
      validez_hasta: c.validez_hasta,
    },
    aprobacion: a && { de: a.de, fecha: a.fecha, aprobado: a.aprobado },
    factura: p.factura,
  }
}

function verificarPaquete(recibido: PaqueteEntrada, calculado: Paquete): string | null {
  const d = primeraDiferencia(proyeccion(calculado), proyeccion(recibido))
  if (!d) return null
  return `El paquete recibido no coincide con el leído de las fuentes (${describirDiferencia(d)}). Vuelve a llamar oc_leer_paquete y usa su resultado sin modificarlo.`
}

function resumenValidacion(v: Validacion) {
  return {
    bloqueos: v.bloqueos.map((b) => b.codigo),
    confirmaciones: v.confirmaciones.map((c) => c.codigo),
    retroactiva: v.retroactiva,
  }
}

function filaControl(
  solicitudId: string,
  v: Validacion,
  resultado: FilaControl["resultado"],
  numero: string | null,
): FilaControl {
  return { solicitud_id: solicitudId, resultado, numero_oc: numero, ...resumenValidacion(v) }
}

// ---------- herramientas ----------

export const leer_paquete: Herramienta<{ caso: typeof argCaso }> = {
  description:
    "Lee el correo, la solicitud, la cotización, la aprobación y la factura de un caso y los devuelve normalizados.",
  args: { caso: argCaso },
  execute: (args, ctx) => safeTool(() => leerPaquete(ctx.directory, args.caso)),
}

export const validar: Herramienta<{ caso: typeof argCaso; paquete: typeof argPaquete }> = {
  description:
    "Aplica las reglas de control RC1–RC10 contra los maestros y devuelve si la OC es apta, sus bloqueos, confirmaciones, valores derivados y si es retroactiva.",
  args: { caso: argCaso, paquete: argPaquete },
  execute: (args, ctx) =>
    safeTool(() => {
      const r = recalcular(ctx, args.caso)
      if (!r.ok) return r
      const distinto = verificarPaquete(args.paquete, r.data.paquete)
      return distinto ? err(distinto) : ok(r.data.validacion)
    }),
}

const argDerivados = DerivadosSchema.describe("Objeto 'derivados' devuelto por oc_validar")

export const construir_payload: Herramienta<{
  caso: typeof argCaso
  paquete: typeof argPaquete
  derivados: typeof argDerivados
}> = {
  description:
    "Construye la orden de compra tal como quedaría en SAP, validada con su esquema, y guarda la trazabilidad de cada valor.",
  args: { caso: argCaso, paquete: argPaquete, derivados: argDerivados },
  execute: (args, ctx) =>
    safeTool(() => {
      const r = recalcular(ctx, args.caso)
      if (!r.ok) return r
      const distinto = verificarPaquete(args.paquete, r.data.paquete)
      if (distinto) return err(distinto)
      const d = primeraDiferencia(r.data.validacion.derivados, args.derivados)
      if (d)
        return err(`Los derivados recibidos no coinciden con los de oc_validar (${describirDiferencia(d)}).`)
      const o = construirOrden(r.data.paquete, r.data.validacion)
      if (!o.ok) return o
      const ruta = guardarTrazabilidad(
        ctx.directory,
        args.caso,
        r.data.paquete.solicitud.solicitud_id,
        o.data.campos,
      )
      return ok({ orden: o.data.orden, ruta_trazabilidad: ruta })
    }),
}

export const generar_evidencia: Herramienta<{ caso: typeof argCaso }> = {
  description: "Genera la evidencia del correo de aprobación en texto y PDF con su hash SHA-256.",
  args: { caso: argCaso },
  execute: (args, ctx) =>
    safeTool(async () => {
      const p = leerPaquete(ctx.directory, args.caso)
      if (!p.ok) return p
      const e = await escribirEvidencia(ctx.directory, args.caso, p.data)
      return e ? ok(e) : err("No hay correo de aprobación para generar evidencia")
    }),
}

// ---------- oc_crear ----------

const argPayload = OrdenCompraSchema.nullable().describe(
  "Payload devuelto por oc_construir_payload; null si la validación tiene bloqueos",
)
const argConfirmado = z
  .boolean()
  .optional()
  .describe("true solo si el usuario confirmó explícitamente las excepciones en su último mensaje")

type ArgsCrear = { caso: string; payload: OrdenCompra | null; confirmado?: boolean | undefined }

type CreacionOC = {
  numero_oc: string
  fecha: string | null
  idempotente: boolean
  mensaje?: string
  retroactiva?: boolean
  ruta_evidencia?: string | null
  excepciones?: OrdenCompra["excepciones"]
}

function detalleHallazgos(v: Validacion["bloqueos"]): string {
  return v.map((h) => `${h.codigo} (${h.detalle})`).join("; ")
}

async function crearOrden(args: ArgsCrear, ctx: ContextoHerramienta): Promise<Resultado<CreacionOC>> {
  const r = recalcular(ctx, args.caso)
  if (!r.ok) return r
  const { paquete, validacion: v } = r.data
  const id = paquete.solicitud.solicitud_id
  const sap = getSapAdapter(ctx)
  const existente = await sap.buscarOrdenPorReferencia(id)
  if (existente) {
    await registrarControl(ctx.directory, filaControl(id, v, "idempotente", existente.numero_oc))
    return ok({
      numero_oc: existente.numero_oc,
      fecha: null,
      idempotente: true,
      mensaje: `La solicitud ${id} ya tiene la OC ${existente.numero_oc}; no se creó otra.`,
    })
  }
  const rechazo = await rechazoPrevio(args, ctx, id, v)
  if (rechazo) return rechazo
  return await crearEnSap(args, ctx, paquete, v)
}

/** Bloqueos, confirmaciones pendientes o payload manipulado: registra el intento y devuelve el error. */
async function rechazoPrevio(
  args: ArgsCrear,
  ctx: ContextoHerramienta,
  id: string,
  v: Validacion,
): Promise<Resultado<never> | null> {
  if (!v.apta) {
    await registrarControl(ctx.directory, filaControl(id, v, "bloqueada", null))
    const acciones = v.bloqueos.map((b) => b.accion_sugerida).join(" ")
    return err(`Bloqueada: ${detalleHallazgos(v.bloqueos)}. Acción sugerida: ${acciones}`)
  }
  if (v.confirmaciones.length > 0 && args.confirmado !== true) {
    await registrarControl(ctx.directory, filaControl(id, v, "pendiente_confirmacion", null))
    return err(`requiere confirmación: ${detalleHallazgos(v.confirmaciones)}`)
  }
  return null
}

async function crearEnSap(
  args: ArgsCrear,
  ctx: ContextoHerramienta,
  paquete: Paquete,
  v: Validacion,
): Promise<Resultado<CreacionOC>> {
  const id = paquete.solicitud.solicitud_id
  const o = construirOrden(paquete, v)
  if (!o.ok) return o
  const d = args.payload
    ? primeraDiferencia(o.data.orden, args.payload, "", /^excepciones\[\d+\]\.confirmado_por$/)
    : null
  if (d) {
    await registrarControl(ctx.directory, filaControl(id, v, "error", null))
    return err(
      `El payload recibido no coincide con el calculado desde las fuentes (${describirDiferencia(d)}). No se crea la OC.`,
    )
  }
  const confirmadoPor = v.confirmaciones.length > 0 ? `analista (sesión ${ctx.sessionId})` : null
  const orden: OrdenCompra = {
    ...o.data.orden,
    excepciones: o.data.orden.excepciones.map((e) => ({ ...e, confirmado_por: confirmadoPor })),
  }
  const evidencia = await escribirEvidencia(ctx.directory, args.caso, paquete)
  guardarTrazabilidad(ctx.directory, args.caso, id, o.data.campos)
  const creada = await getSapAdapter(ctx).crearOrden(orden)
  await registrarControl(ctx.directory, filaControl(id, v, "creada", creada.numero_oc))
  return ok({
    ...creada,
    idempotente: false,
    retroactiva: v.retroactiva,
    ruta_evidencia: evidencia?.ruta_pdf ?? null,
    excepciones: orden.excepciones,
  })
}

export const crear: Herramienta<{
  caso: typeof argCaso
  payload: typeof argPayload
  confirmado: typeof argConfirmado
}> = {
  description:
    "Crea la orden de compra en SAP (simulado) solo si es apta y, cuando hay confirmaciones pendientes, solo con confirmado=true; es idempotente por solicitud.",
  args: { caso: argCaso, payload: argPayload, confirmado: argConfirmado },
  execute: (args, ctx) => safeTool(() => crearOrden(args, ctx)),
}

// ---------- oc_leer_excel (P1) ----------

const argRuta = z
  .string()
  .describe("Ruta relativa a la raíz del proyecto de un archivo .xlsx, p. ej. 'entrada/solicitud.xlsx'")

function valorCelda(v: ExcelJS.CellValue): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === "object" && "result" in v) return valorCelda(v.result as ExcelJS.CellValue)
  if (typeof v === "object" && "text" in v) return String(v.text)
  return String(v)
}

async function leerFilas(ruta: string): Promise<Array<Record<string, string | number | boolean | null>>> {
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.readFile(ruta)
  const hoja = libro.worksheets[0]
  if (!hoja) return []
  const encabezados: string[] = []
  hoja.getRow(1).eachCell((c, i) => {
    encabezados[i] = String(valorCelda(c.value) ?? `col${i}`).trim()
  })
  const filas: Array<Record<string, string | number | boolean | null>> = []
  hoja.eachRow((fila, n) => {
    if (n === 1) return
    const obj: Record<string, string | number | boolean | null> = {}
    encabezados.forEach((h, i) => {
      if (h) obj[h] = valorCelda(fila.getCell(i).value)
    })
    filas.push(obj)
  })
  return filas
}

export const leer_excel: Herramienta<{ ruta: typeof argRuta }> = {
  description: "Lee un archivo .xlsx de solicitud y devuelve sus filas como objetos.",
  args: { ruta: argRuta },
  execute: (args, ctx) =>
    safeTool(async () => {
      if (!/\.xlsx$/i.test(args.ruta)) return err("Solo se pueden leer archivos .xlsx")
      const ruta = resolverDentro(ctx.directory, args.ruta)
      if (!existsSync(ruta)) return err(`No existe el archivo '${args.ruta}'`)
      return ok({ filas: await leerFilas(ruta) })
    }),
}
