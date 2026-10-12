// Lectura y normalización del paquete de un caso (correo, solicitud, cotización, aprobación, factura).
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { ZodType } from "zod"
import { carpetaCaso, validarNombreCaso } from "../infra/paths"
import { err, ok, type Resultado } from "../infra/result"
import { contieneAprobado, normalizarNit, parsearCotizacion, parsearFactura } from "./parsers"
import {
  AprobacionFixtureSchema,
  CorreoSchema,
  type Paquete,
  type Solicitud,
  SolicitudSchema,
} from "./schemas"

const CAMPOS_NUMERICOS = ["cantidad", "valor_unitario", "valor_total"] as const

type Lectura = { existe: false } | { existe: true; texto: string }

function leerArchivo(carpeta: string, nombre: string): Lectura {
  const ruta = join(carpeta, nombre)
  if (!existsSync(ruta)) return { existe: false }
  return { existe: true, texto: readFileSync(ruta, "utf8") }
}

function parsearJson(texto: string, nombre: string): Resultado<unknown> {
  try {
    return ok(JSON.parse(texto))
  } catch {
    return err(`El archivo ${nombre} no es un JSON válido`)
  }
}

function validarEsquema<T>(dato: unknown, esquema: ZodType<T>, nombre: string): Resultado<T> {
  const r = esquema.safeParse(dato)
  if (r.success) return ok(r.data)
  const issue = r.error.issues[0]
  return err(`El archivo ${nombre} tiene un campo inválido (${issue?.path.join(".")}: ${issue?.message})`)
}

/** Verifica cantidad/valores numéricos para dar un mensaje específico antes del esquema. */
function revisarMontos(dato: unknown): string | null {
  if (typeof dato !== "object" || dato === null) return null
  const registro = dato as Record<string, unknown>
  for (const campo of CAMPOS_NUMERICOS) {
    const v = registro[campo]
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return `El monto '${campo}' no es numérico ('${String(v)}'). Pide al solicitante corregir la solicitud.`
    }
  }
  return null
}

function leerSolicitud(carpeta: string): Resultado<Solicitud> {
  const sugerencia = "Pide al solicitante reenviar el Excel de solicitud."
  const archivo = leerArchivo(carpeta, "solicitud.json")
  if (!archivo.existe) return err(`Falta solicitud.json en el caso. ${sugerencia}`)
  const json = parsearJson(archivo.texto, "solicitud.json")
  if (!json.ok) return err(`${json.error}. ${sugerencia}`)
  const montos = revisarMontos(json.data)
  if (montos) return err(montos)
  const r = validarEsquema(json.data, SolicitudSchema, "solicitud.json")
  return r.ok ? r : err(`${r.error}. ${sugerencia}`)
}

function leerCorreo(carpeta: string): Resultado<Paquete["correo"]> {
  const archivo = leerArchivo(carpeta, "correo.json")
  if (!archivo.existe) return err("Falta correo.json en el caso; reenvía el correo original de la solicitud.")
  const json = parsearJson(archivo.texto, "correo.json")
  if (!json.ok) return json
  const r = validarEsquema(json.data, CorreoSchema, "correo.json")
  if (!r.ok) return r
  return ok({ id: r.data.id, de: r.data.de, asunto: r.data.asunto, fecha: r.data.fecha })
}

function leerCotizacion(carpeta: string): Resultado<Paquete["cotizacion"]> {
  const archivo = leerArchivo(carpeta, "cotizacion.txt")
  if (!archivo.existe) return ok(null)
  const r = parsearCotizacion(archivo.texto)
  if (!r.ok) return r
  const c = r.data
  return ok({
    numero: c.numero,
    proveedor: c.proveedor ?? "",
    nit: c.nit ? normalizarNit(c.nit) : null,
    total: c.total,
    moneda: c.moneda,
    validez_hasta: c.validez_hasta,
    texto: c.texto,
  })
}

function leerAprobacion(carpeta: string): Resultado<Paquete["aprobacion"]> {
  const archivo = leerArchivo(carpeta, "aprobacion.json")
  if (!archivo.existe) return ok(null)
  const json = parsearJson(archivo.texto, "aprobacion.json")
  if (!json.ok) return err(`${json.error}. Pide reenviar el correo de aprobación del líder.`)
  const r = validarEsquema(json.data, AprobacionFixtureSchema, "aprobacion.json")
  if (!r.ok) return r
  const a = r.data
  return ok({
    de: a.de,
    para: a.para,
    cc: a.cc ?? [],
    asunto: a.asunto,
    fecha: a.fecha,
    aprobado: contieneAprobado(a.cuerpo),
    texto: a.cuerpo,
  })
}

function leerFactura(carpeta: string): Resultado<Paquete["factura"]> {
  const archivo = leerArchivo(carpeta, "factura.txt")
  if (!archivo.existe) return ok(null)
  return parsearFactura(archivo.texto)
}

/** Lee y normaliza el paquete de `caso`. Los adjuntos ausentes quedan en null y en `faltantes`. */
export function leerPaquete(raiz: string, caso: string): Resultado<Paquete> {
  const invalido = validarNombreCaso(caso)
  if (invalido) return err(invalido)
  const carpeta = carpetaCaso(raiz, caso)
  if (!existsSync(carpeta)) return err(`El caso '${caso}' no existe en fixtures/reto-03/solicitudes/`)
  const correo = leerCorreo(carpeta)
  if (!correo.ok) return correo
  const solicitud = leerSolicitud(carpeta)
  if (!solicitud.ok) return solicitud
  const cotizacion = leerCotizacion(carpeta)
  if (!cotizacion.ok) return cotizacion
  const aprobacion = leerAprobacion(carpeta)
  if (!aprobacion.ok) return aprobacion
  const factura = leerFactura(carpeta)
  if (!factura.ok) return factura
  const faltantes = [
    cotizacion.data ? null : "cotizacion.txt",
    aprobacion.data ? null : "aprobacion.json",
  ].filter((x): x is string => x !== null)
  return ok({
    correo: correo.data,
    solicitud: solicitud.data,
    cotizacion: cotizacion.data,
    aprobacion: aprobacion.data,
    factura: factura.data,
    faltantes,
  })
}
