// Construcción de la OrdenCompra (PRD §7.4) con trazabilidad de cada valor a su fuente.
import { mkdirSync, writeFileSync } from "node:fs"
import { carpetaOut, rutaRelativa } from "../infra/paths"
import { ahoraIso } from "../infra/reloj"
import { err, ok, type Resultado } from "../infra/result"
import { hashEvidencia } from "./evidencia"
import { fechaLocal, inferirUnidad } from "./parsers"
import type { Validacion } from "./reglas"
import { type OrdenCompra, OrdenCompraSchema, type Paquete } from "./schemas"

export const LARGO_DESCRIPCION_SAP = 40

export type Fuente =
  | "solicitud"
  | "cotizacion"
  | "aprobacion"
  | "correo"
  | "maestro.proveedores"
  | "derivado"
  | "constante"
  | "evidencia"

export type CampoTrazado = {
  ruta: string
  valor: string | number | null
  fuente: Fuente
  detalle: string
  transformacion?: string
  original?: string
}

export type OrdenConTrazabilidad = { orden: OrdenCompra; campos: CampoTrazado[] }

/** Corta a `max` caracteres en el último espacio (si lo hay) para no partir palabras. */
export function truncarDescripcion(texto: string, max = LARGO_DESCRIPCION_SAP): string {
  const limpio = texto.trim()
  if (limpio.length <= max) return limpio
  const corte = limpio.slice(0, max)
  const espacio = corte.lastIndexOf(" ")
  return (espacio > 0 ? corte.slice(0, espacio) : corte).trimEnd()
}

/** Valor y fuente de un campo que puede venir en la solicitud o derivarse del maestro. */
function informadoODerivado(
  informado: string | undefined,
  derivado: { valor: string } | undefined,
  campo: string,
  regla: string,
): { valor: string; fuente: Fuente; detalle: string } | null {
  if (informado) return { valor: informado, fuente: "solicitud", detalle: campo }
  if (derivado)
    return {
      valor: derivado.valor,
      fuente: "derivado",
      detalle: `maestro.proveedores.${campo}_default (${regla})`,
    }
  return null
}

function trazarPosicion(p: Paquete, iva: { valor: string; fuente: Fuente; detalle: string }): CampoTrazado[] {
  const s = p.solicitud
  const desc = truncarDescripcion(s.descripcion)
  const campoDesc: CampoTrazado = {
    ruta: "posiciones[0].descripcion",
    valor: desc,
    fuente: "solicitud",
    detalle: "descripcion",
  }
  if (desc !== s.descripcion) {
    campoDesc.transformacion = `truncado a ${LARGO_DESCRIPCION_SAP} (límite SAP texto breve)`
    campoDesc.original = s.descripcion
  }
  return [
    {
      ruta: "posiciones[0].numero",
      valor: 10,
      fuente: "constante",
      detalle: "una posición por solicitud (10)",
    },
    campoDesc,
    { ruta: "posiciones[0].cantidad", valor: s.cantidad, fuente: "solicitud", detalle: "cantidad" },
    {
      ruta: "posiciones[0].unidad",
      valor: inferirUnidad(s.descripcion, s.cantidad),
      fuente: "derivado",
      detalle: "inferida de la descripción (horas → H, <cantidad> meses/mensual → MES, otro → UN)",
    },
    {
      ruta: "posiciones[0].precio_unitario",
      valor: s.valor_unitario,
      fuente: "solicitud",
      detalle: "valor_unitario (IVA incluido)",
    },
    {
      ruta: "posiciones[0].centro_costo",
      valor: s.centro_costo,
      fuente: "solicitud",
      detalle: "centro_costo",
    },
    { ruta: "posiciones[0].subarea", valor: s.subarea, fuente: "solicitud", detalle: "subarea" },
    { ruta: "posiciones[0].indicador_iva", ...iva },
  ]
}

function trazarExcepciones(v: Validacion): CampoTrazado[] {
  return v.confirmaciones.flatMap((c, i) => [
    { ruta: `excepciones[${i}].codigo`, valor: c.codigo, fuente: "derivado" as const, detalle: "oc_validar" },
    {
      ruta: `excepciones[${i}].detalle`,
      valor: c.detalle,
      fuente: "derivado" as const,
      detalle: "oc_validar",
    },
    {
      ruta: `excepciones[${i}].confirmado_por`,
      valor: null,
      fuente: "derivado" as const,
      detalle: "se completa al confirmar en oc_crear",
    },
  ])
}

/** Lista de campos trazados; la orden se arma a partir de ella para que no haya valores sin fuente. */
function trazar(p: Paquete, v: Validacion, hash: string): Resultado<CampoTrazado[]> {
  const s = p.solicitud
  const prov = v.derivados.proveedor
  const a = p.aprobacion
  const pago = informadoODerivado(s.condiciones_pago, v.derivados.condiciones_pago, "condiciones_pago", "RC7")
  const iva = informadoODerivado(s.indicador_iva, v.derivados.indicador_iva, "indicador_iva", "RC6")
  if (!prov || !a || !pago || !iva)
    return err("Faltan datos para construir la OC (proveedor, aprobación, IVA o condiciones de pago)")
  const detalleProv = `buscado ${prov.resuelto_por.replaceAll("_", " ")} (${prov.nit})`
  return ok([
    { ruta: "referencia.solicitud_id", valor: s.solicitud_id, fuente: "solicitud", detalle: "solicitud_id" },
    { ruta: "referencia.correo_id", valor: p.correo.id, fuente: "correo", detalle: "id" },
    {
      ruta: "referencia.cotizacion_ref",
      valor: p.cotizacion?.numero ?? null,
      fuente: "cotizacion",
      detalle: "número de cotización",
    },
    { ruta: "sociedad", valor: "1000", fuente: "constante", detalle: "PRD §7.4" },
    { ruta: "organizacion_compras", valor: "1000", fuente: "constante", detalle: "PRD §7.4" },
    {
      ruta: "proveedor.codigo_sap",
      valor: prov.codigo_sap,
      fuente: "maestro.proveedores",
      detalle: detalleProv,
    },
    { ruta: "proveedor.nit", valor: prov.nit, fuente: "maestro.proveedores", detalle: detalleProv },
    { ruta: "proveedor.nombre", valor: prov.nombre, fuente: "maestro.proveedores", detalle: detalleProv },
    { ruta: "moneda", valor: s.moneda, fuente: "solicitud", detalle: "moneda" },
    { ruta: "condiciones_pago", ...pago },
    { ruta: "aprobador.email", valor: a.de, fuente: "aprobacion", detalle: "de" },
    {
      ruta: "aprobador.fecha_aprobacion",
      valor: fechaLocal(a.fecha),
      fuente: "aprobacion",
      detalle: "fecha (parte local YYYY-MM-DD)",
    },
    {
      ruta: "aprobador.evidencia_sha256",
      valor: hash,
      fuente: "evidencia",
      detalle: "SHA-256 del texto canónico de aprobación",
    },
    ...trazarPosicion(p, iva),
    ...trazarExcepciones(v),
  ])
}

function valor(campos: CampoTrazado[], ruta: string): string | number | null {
  return campos.find((c) => c.ruta === ruta)?.valor ?? null
}

function armarOrden(campos: CampoTrazado[], v: Validacion): unknown {
  const val = (r: string) => valor(campos, r)
  return {
    referencia: {
      solicitud_id: val("referencia.solicitud_id"),
      correo_id: val("referencia.correo_id"),
      cotizacion_ref: val("referencia.cotizacion_ref"),
    },
    sociedad: val("sociedad"),
    organizacion_compras: val("organizacion_compras"),
    proveedor: {
      codigo_sap: val("proveedor.codigo_sap"),
      nit: val("proveedor.nit"),
      nombre: val("proveedor.nombre"),
    },
    moneda: val("moneda"),
    condiciones_pago: val("condiciones_pago"),
    aprobador: {
      email: val("aprobador.email"),
      fecha_aprobacion: val("aprobador.fecha_aprobacion"),
      evidencia_sha256: val("aprobador.evidencia_sha256"),
    },
    posiciones: [
      {
        numero: val("posiciones[0].numero"),
        descripcion: val("posiciones[0].descripcion"),
        cantidad: val("posiciones[0].cantidad"),
        unidad: val("posiciones[0].unidad"),
        precio_unitario: val("posiciones[0].precio_unitario"),
        centro_costo: val("posiciones[0].centro_costo"),
        subarea: val("posiciones[0].subarea"),
        indicador_iva: val("posiciones[0].indicador_iva"),
      },
    ],
    excepciones: v.confirmaciones.map((c) => ({
      codigo: c.codigo,
      detalle: c.detalle,
      confirmado_por: null,
    })),
  }
}

/** Construye la orden validada con zod. Falla si la validación tiene bloqueos. */
export function construirOrden(p: Paquete, v: Validacion): Resultado<OrdenConTrazabilidad> {
  if (!v.apta)
    return err(`No se puede construir la OC: bloqueos ${v.bloqueos.map((b) => b.codigo).join(", ")}`)
  const hash = hashEvidencia(p)
  if (!hash) return err("No se puede construir la OC: no hay correo de aprobación")
  const campos = trazar(p, v, hash)
  if (!campos.ok) return campos
  const r = OrdenCompraSchema.safeParse(armarOrden(campos.data, v))
  if (!r.success)
    return err(
      `La OC construida no cumple el esquema: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`,
    )
  return ok({ orden: r.data, campos: campos.data })
}

/** Guarda out/<caso>/trazabilidad.json y devuelve su ruta relativa. */
export function guardarTrazabilidad(
  raiz: string,
  caso: string,
  solicitudId: string,
  campos: CampoTrazado[],
): string {
  mkdirSync(carpetaOut(raiz, caso), { recursive: true })
  const ruta = carpetaOut(raiz, caso, "trazabilidad.json")
  writeFileSync(
    ruta,
    `${JSON.stringify({ solicitud_id: solicitudId, generado: ahoraIso(), campos }, null, 2)}\n`,
    "utf8",
  )
  return rutaRelativa(raiz, ruta)
}
