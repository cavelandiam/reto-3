// Normalización de textos, montos, NIT, nombres y fechas; parseo de cotización y factura en texto.
import { err, ok, type Resultado } from "../infra/result"

const PATRON_FECHA = /^(\d{4})-(\d{2})-(\d{2})/

/** "900.555.111-2" → "900555111" (sin puntos, espacios ni dígito de verificación). */
export function normalizarNit(nit: string): string {
  const sinDv = nit.split("-")[0] ?? ""
  return sinDv.replace(/[.\s]/g, "")
}

/**
 * Extrae moneda y valor de un texto como "COP 11.400.000" o "USD 1,250.50".
 * COP usa '.' para miles y ',' para decimales; USD usa ',' para miles y '.' para decimales.
 */
export function parsearMonto(texto: string): Resultado<{ moneda: "COP" | "USD"; valor: number }> {
  const m = /(COP|USD)\s*([\d.,]+)/.exec(texto)
  if (!m?.[1] || !m[2]) return err(`No se encontró un monto con moneda en '${texto.trim()}'`)
  const moneda = m[1] === "USD" ? "USD" : "COP"
  const crudo = moneda === "COP" ? m[2].replace(/\./g, "").replace(",", ".") : m[2].replace(/,/g, "")
  const valor = Number(crudo)
  if (!Number.isFinite(valor)) return err(`El monto '${m[2]}' no es numérico`)
  return ok({ moneda, valor })
}

const SUFIJOS_SOCIETARIOS = /\b(s a s|sas|ltda|s a|sa)\b/g

/** "TecnoSuministros S.A.S." → "tecnosuministros". */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(SUFIJOS_SOCIETARIOS, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase().normalize("NFC")
}

/**
 * Parte YYYY-MM-DD de una fecha ISO tal como viene (hora local −05:00).
 * No usa `new Date()` para no correr la fecha al convertir a UTC.
 */
export function fechaLocal(iso: string): string {
  const m = PATRON_FECHA.exec(iso.trim())
  if (!m) throw new Error(`Fecha inválida '${iso}'`)
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** Suma días a una fecha YYYY-MM-DD (aritmética de calendario, sin zona horaria). */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fechaLocal(fecha).split("-").map(Number)
  const t = new Date(Date.UTC(a ?? 0, (m ?? 1) - 1, (d ?? 1) + dias))
  return t.toISOString().slice(0, 10)
}

/** true si el cuerpo dice "aprobado/aprobada" sin negación ("no aprobado", "no está aprobada"). */
export function contieneAprobado(cuerpo: string): boolean {
  if (/\bno\s+(est[aá]\s+)?aprobad[oa]/i.test(cuerpo)) return false
  return /\baprobad[oa]\b/i.test(cuerpo)
}

/** Unidad SAP inferida de la descripción: horas → H, mes/mensual → MES, otro → UN. */
export function inferirUnidad(descripcion: string): "UN" | "H" | "MES" {
  if (/\bhoras?\b/i.test(descripcion)) return "H"
  if (/\bmes(es)?\b|mensual/i.test(descripcion)) return "MES"
  return "UN"
}

/** Monto mencionado en texto libre: "por 25 millones" → 25000000; "COP 3.200.000" → 3200000. */
export function montoMencionado(texto: string): number | null {
  const millones = /(\d+(?:[.,]\d+)?)\s*millones/i.exec(texto)
  if (millones?.[1]) return Math.round(Number(millones[1].replace(",", ".")) * 1_000_000)
  const r = parsearMonto(texto)
  return r.ok ? r.data.valor : null
}

function capturar(texto: string, patron: RegExp): string | null {
  const m = patron.exec(texto)
  return m?.[1]?.trim() ?? null
}

export type CotizacionParseada = {
  numero: string | null
  fecha: string | null
  proveedor: string | null
  nit: string | null
  total: number
  moneda: "COP" | "USD"
  validez_dias: number | null
  validez_hasta: string | null
  texto: string
}

export function parsearCotizacion(texto: string): Resultado<CotizacionParseada> {
  const lineaTotal = capturar(texto, /^(TOTAL[^:\n]*:.*)$/m)
  if (!lineaTotal)
    return err("La cotización no tiene una línea 'TOTAL'; pide al proveedor la cotización completa")
  const total = parsearMonto(lineaTotal)
  if (!total.ok) return err(`TOTAL de la cotización ilegible: ${total.error}`)
  const fecha = capturar(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/m)
  const dias = capturar(texto, /Validez de la oferta:\s*(\d+)\s*d[ií]as/i)
  const nit = capturar(texto, /^NIT:\s*([\d.\-\s]+)$/m)
  return ok({
    numero: capturar(texto, /COTIZACI[ÓO]N\s+(\S+)/),
    fecha,
    proveedor: capturar(texto, /^Proveedor:\s*(.+)$/m),
    nit: nit ? normalizarNit(nit) : null,
    total: total.data.valor,
    moneda: total.data.moneda,
    validez_dias: dias ? Number(dias) : null,
    validez_hasta: fecha && dias ? sumarDias(fecha, Number(dias)) : null,
    texto,
  })
}

export type FacturaParseada = { numero: string; fecha: string; total: number }

export function parsearFactura(texto: string): Resultado<FacturaParseada> {
  const numero = capturar(texto, /FACTURA[^\n]*No\.\s*(\S+)/)
  const fecha = capturar(texto, /Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/)
  const lineaTotal = capturar(texto, /^(TOTAL:.*)$/m)
  if (!numero || !fecha || !lineaTotal) {
    return err("La factura no tiene número, fecha de emisión o TOTAL legibles; pide la factura completa")
  }
  const total = parsearMonto(lineaTotal)
  if (!total.ok) return err(`TOTAL de la factura ilegible: ${total.error}`)
  return ok({ numero, fecha, total: total.data.valor })
}
