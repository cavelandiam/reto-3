// Carga y búsqueda en los maestros (proveedores, centros de costo, IVA, condiciones de pago).
import { readFileSync } from "node:fs"
import { type ZodType, z } from "zod"
import { RUTA_MAESTROS, resolverDentro } from "../infra/paths"
import { normalizarEmail, normalizarNit, normalizarNombre } from "./parsers"
import {
  type CentroCosto,
  CentroCostoSchema,
  CondicionPagoSchema,
  IndicadorIvaSchema,
  type Maestros,
  type Proveedor,
  ProveedorSchema,
} from "./schemas"

function leerMaestro<T>(raiz: string, archivo: string, esquema: ZodType<T>): T[] {
  const ruta = resolverDentro(raiz, RUTA_MAESTROS, archivo)
  const crudo: unknown = JSON.parse(readFileSync(ruta, "utf8"))
  const r = z.array(esquema).safeParse(crudo)
  if (!r.success) throw new Error(`Maestro ${archivo} con formato inválido: ${r.error.issues[0]?.message}`)
  return r.data
}

/** Lee los cuatro maestros desde fixtures/reto-03/maestros/. Lanza si alguno falta o es inválido. */
export function cargarMaestros(raiz: string): Maestros {
  return {
    proveedores: leerMaestro(raiz, "proveedores.json", ProveedorSchema),
    centros: leerMaestro(raiz, "centros-costo.json", CentroCostoSchema),
    indicadoresIva: leerMaestro(raiz, "indicadores-iva.json", IndicadorIvaSchema),
    condicionesPago: leerMaestro(raiz, "condiciones-pago.json", CondicionPagoSchema),
  }
}

export function proveedorPorNit(m: Maestros, nit: string): Proveedor | null {
  const buscado = normalizarNit(nit)
  return m.proveedores.find((p) => normalizarNit(p.nit) === buscado) ?? null
}

export function proveedorPorNombre(m: Maestros, nombre: string): Proveedor | null {
  const buscado = normalizarNombre(nombre)
  return m.proveedores.find((p) => normalizarNombre(p.nombre) === buscado) ?? null
}

export function centroPorCodigo(m: Maestros, codigo: string): CentroCosto | null {
  return m.centros.find((c) => c.centro_costo.trim().toUpperCase() === codigo.trim().toUpperCase()) ?? null
}

/** Centros de costo en los que `email` figura como aprobador. */
export function centrosDondeAprueba(m: Maestros, email: string): CentroCosto[] {
  const buscado = normalizarEmail(email)
  return m.centros.filter((c) => c.aprobadores.some((a) => normalizarEmail(a.email) === buscado))
}

export function existeIndicadorIva(m: Maestros, codigo: string): boolean {
  return m.indicadoresIva.some((i) => i.codigo === codigo)
}

export function existeCondicionPago(m: Maestros, codigo: string): boolean {
  return m.condicionesPago.some((c) => c.codigo === codigo)
}
