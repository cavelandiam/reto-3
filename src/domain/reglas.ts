// Reglas de control RC1–RC10 (PRD §7.3) como funciones puras: (paquete, maestros) → ResultadoRegla.
// Cambiar un umbral o una regla solo toca este archivo; el servidor y el ciclo del agente no se enteran.
import {
  centroPorCodigo,
  centrosDondeAprueba,
  existeCondicionPago,
  existeIndicadorIva,
  proveedorPorNit,
  proveedorPorNombre,
} from "./maestros"
import {
  fechaLocal,
  formatoMonto,
  formatoPorcentaje,
  montoMencionado,
  normalizarEmail,
  normalizarTexto,
} from "./parsers"
import type { CentroCosto, CodigoRegla, Derivados, Hallazgo, Maestros, Paquete, Proveedor } from "./schemas"

/** Diferencia máxima tolerada entre cotización y solicitud (RC5). */
export const TOLERANCIA_COTIZACION = 0.02
/** Diferencia máxima tolerada entre cantidad × valor unitario y valor total (RC10), en unidades monetarias. */
export const TOLERANCIA_ARITMETICA = 1

export type EstadoRegla = "ok" | "bloqueo" | "confirmacion" | "derivado" | "no_aplica"

export type ResultadoRegla = {
  codigo: CodigoRegla
  resultado: EstadoRegla
  hallazgo?: Hallazgo
  derivados?: Derivados
  retroactiva?: boolean
}

export type Regla = (p: Paquete, m: Maestros) => ResultadoRegla

type ProveedorResuelto = { proveedor: Proveedor; resuelto_por: string; nit_buscado: string | null }

// ---------- utilidades ----------

function bloqueo(
  codigo: CodigoRegla,
  detalle: string,
  accion: string,
  valores?: Hallazgo["valores"],
): ResultadoRegla {
  return {
    codigo,
    resultado: "bloqueo",
    hallazgo: { codigo, tipo: "bloqueo", detalle, accion_sugerida: accion, valores },
  }
}

function confirmacion(
  codigo: CodigoRegla,
  detalle: string,
  accion: string,
  valores?: Hallazgo["valores"],
): ResultadoRegla {
  return {
    codigo,
    resultado: "confirmacion",
    hallazgo: { codigo, tipo: "confirmacion", detalle, accion_sugerida: accion, valores },
  }
}

function estado(codigo: CodigoRegla, resultado: "ok" | "no_aplica"): ResultadoRegla {
  return { codigo, resultado }
}

/** NIT a buscar y su origen: primero el de la solicitud, luego el de la cotización. */
function nitBuscado(p: Paquete): { nit: string; origen: string } | null {
  if (p.solicitud.proveedor_nit) return { nit: p.solicitud.proveedor_nit, origen: "por_nit_solicitud" }
  if (p.cotizacion?.nit) return { nit: p.cotizacion.nit, origen: "por_nit_cotizacion" }
  return null
}

/** Busca el proveedor por NIT (solicitud → cotización) o, si no hay NIT, por nombre normalizado. */
export function resolverProveedor(p: Paquete, m: Maestros): ProveedorResuelto | null {
  const nit = nitBuscado(p)
  if (nit) {
    const proveedor = proveedorPorNit(m, nit.nit)
    return proveedor ? { proveedor, resuelto_por: nit.origen, nit_buscado: nit.nit } : null
  }
  const proveedor = proveedorPorNombre(m, p.solicitud.proveedor_nombre)
  return proveedor ? { proveedor, resuelto_por: "por_nombre", nit_buscado: null } : null
}

function esAprobadorDe(centro: CentroCosto, email: string) {
  return centro.aprobadores.find((a) => normalizarEmail(a.email) === normalizarEmail(email)) ?? null
}

function listaAprobadores(centro: CentroCosto): string {
  return centro.aprobadores.map((a) => `${a.email} (tope ${formatoMonto(a.tope)})`).join(", ")
}

// ---------- reglas ----------

export const rc1: Regla = (p, m) => {
  const nit = nitBuscado(p)
  const r = resolverProveedor(p, m)
  const accion = "Solicitar creación del proveedor en SAP con RUT y certificación bancaria"
  if (!r) {
    const quien = nit ? `NIT ${nit.nit}` : `nombre '${p.solicitud.proveedor_nombre}'`
    return bloqueo(
      "RC1",
      `Proveedor ${quien} ("${p.solicitud.proveedor_nombre}") no existe en el maestro`,
      accion,
      {
        nit: nit?.nit ?? null,
        nombre: p.solicitud.proveedor_nombre,
      },
    )
  }
  if (!r.proveedor.activo) {
    return bloqueo(
      "RC1",
      `Proveedor inactivo: ${r.proveedor.nombre} (código SAP ${r.proveedor.codigo_sap}, NIT ${r.proveedor.nit})`,
      "Solicitar a datos maestros la reactivación del proveedor o usar un proveedor activo",
      { codigo_sap: r.proveedor.codigo_sap, nit: r.proveedor.nit },
    )
  }
  const { codigo_sap, nit: nitProv, nombre } = r.proveedor
  return {
    codigo: "RC1",
    resultado: "ok",
    derivados: { proveedor: { codigo_sap, nit: nitProv, nombre, resuelto_por: r.resuelto_por } },
  }
}

/** Si el aprobador aprueba en otro centro y el correo menciona una subárea de ese centro, lo señala. */
function pistaCentro(p: Paquete, otros: CentroCosto[]): string {
  const texto = normalizarTexto(p.aprobacion?.texto ?? "")
  for (const c of otros) {
    const sub = c.subareas.find((s) => texto.includes(normalizarTexto(s)))
    if (sub)
      return ` El correo de aprobación menciona '${sub}', subárea de ${c.centro_costo}: verifica si el centro de costo correcto es ${c.centro_costo}.`
  }
  return ""
}

export const rc2: Regla = (p, m) => {
  const a = p.aprobacion
  const cc = p.solicitud.centro_costo
  if (!a)
    return bloqueo(
      "RC2",
      "No hay correo de aprobación en el paquete",
      "Pide al solicitante reenviar el correo de aprobación de su líder",
    )
  if (!a.aprobado) {
    return bloqueo(
      "RC2",
      `El correo de aprobación de ${a.de} no contiene "Aprobado"`,
      "Pide al líder una aprobación explícita por correo",
    )
  }
  const centro = centroPorCodigo(m, cc)
  if (!centro)
    return bloqueo(
      "RC2",
      `El centro de costo ${cc} no existe en el maestro`,
      "Pide al solicitante corregir el centro de costo",
    )
  if (esAprobadorDe(centro, a.de)) return estado("RC2", "ok")
  const otros = centrosDondeAprueba(m, a.de)
  const deOtro = otros.length
    ? `, que es aprobador de ${otros.map((c) => c.centro_costo).join(", ")}, no de ${cc}`
    : `, que no es aprobador de ${cc}`
  return bloqueo(
    "RC2",
    `Aprueba ${a.de}${deOtro}. Aprobadores válidos de ${cc}: ${listaAprobadores(centro)}.`,
    `Verifica el centro de costo de la solicitud o pide la aprobación de un aprobador válido de ${cc}.${pistaCentro(p, otros)}`,
    { aprobador: a.de, centro_costo: cc },
  )
}

export const rc3: Regla = (p, m) => {
  const centro = centroPorCodigo(m, p.solicitud.centro_costo)
  if (!p.aprobacion || !centro || centro.aprobadores.length === 0) return estado("RC3", "no_aplica")
  const total = p.solicitud.valor_total
  const aprobador = esAprobadorDe(centro, p.aprobacion.de)
  if (aprobador) {
    if (total <= aprobador.tope) return estado("RC3", "ok")
    return bloqueo(
      "RC3",
      `El valor ${formatoMonto(total)} supera el tope de ${aprobador.email} (${formatoMonto(aprobador.tope)})`,
      `Pide la aprobación de un aprobador de ${centro.centro_costo} con tope suficiente`,
      { valor_total: total, tope: aprobador.tope },
    )
  }
  const maximo = Math.max(...centro.aprobadores.map((x) => x.tope))
  if (total <= maximo) return estado("RC3", "ok")
  return bloqueo(
    "RC3",
    `Ningún aprobador de ${centro.centro_costo} tiene tope ≥ ${formatoMonto(total)} (máximo ${formatoMonto(maximo)})`,
    "Escala la aprobación a un nivel con atribución suficiente o revisa si el centro de costo es el correcto",
    { valor_total: total, tope_maximo: maximo },
  )
}

export const rc4: Regla = (p, m) => {
  const centro = centroPorCodigo(m, p.solicitud.centro_costo)
  if (!centro) return estado("RC4", "no_aplica")
  const sub = normalizarTexto(p.solicitud.subarea)
  if (centro.subareas.some((s) => normalizarTexto(s) === sub)) return estado("RC4", "ok")
  return bloqueo(
    "RC4",
    `La subárea '${p.solicitud.subarea}' no pertenece a ${centro.centro_costo}. Subáreas válidas: ${centro.subareas.join(", ")}`,
    "Pide al solicitante corregir la subárea o el centro de costo",
    { subarea: p.solicitud.subarea, centro_costo: centro.centro_costo },
  )
}

export const rc5: Regla = (p) => {
  const sol = p.solicitud.valor_total
  if (!p.cotizacion) {
    return confirmacion(
      "RC5",
      "No hay cotización en el paquete",
      "Confirma crear la OC sin cotización o pide la cotización al proveedor",
      {
        solicitud: sol,
        cotizacion: null,
      },
    )
  }
  const cot = p.cotizacion.total
  const diferencia = sol === 0 ? Number.POSITIVE_INFINITY : Math.abs(cot - sol) / sol
  if (diferencia <= TOLERANCIA_COTIZACION) return estado("RC5", "ok")
  const mencionado = p.aprobacion ? montoMencionado(p.aprobacion.texto) : null
  const nota = mencionado !== null ? ` La aprobación menciona ${formatoMonto(mencionado)}.` : ""
  const ref = p.cotizacion.numero ? ` ${p.cotizacion.numero}` : ""
  // La diferencia absoluta se entrega calculada para que el modelo no tenga que restar.
  const absoluta = cot - sol
  return confirmacion(
    "RC5",
    `Solicitud ${formatoMonto(sol)} vs cotización${ref} ${formatoMonto(cot)}: diferencia ${formatoMonto(absoluta)} (${formatoPorcentaje(diferencia)}; tolerancia ${formatoPorcentaje(TOLERANCIA_COTIZACION)}).${nota}`,
    `Confirma crear la OC por el valor de la solicitud (${formatoMonto(sol)}) o pide al solicitante ajustar la solicitud a la cotización`,
    {
      solicitud: sol,
      cotizacion: cot,
      diferencia: absoluta,
      diferencia_pct: Number((diferencia * 100).toFixed(2)),
      aprobacion_menciona: mencionado,
    },
  )
}

export const rc6: Regla = (p, m) => {
  const informado = p.solicitud.indicador_iva
  if (informado) {
    if (existeIndicadorIva(m, informado)) return estado("RC6", "ok")
    return bloqueo(
      "RC6",
      `El indicador de IVA '${informado}' no existe en el maestro`,
      "Pide al solicitante un indicador válido (C0, C1, C2)",
      { indicador_iva: informado },
    )
  }
  const r = resolverProveedor(p, m)
  if (!r) return estado("RC6", "no_aplica")
  const valor = r.proveedor.indicador_iva_default
  const desc = m.indicadoresIva.find((i) => i.codigo === valor)?.descripcion ?? "desconocido"
  const res = confirmacion(
    "RC6",
    `La solicitud no informa indicador de IVA; se usa ${valor} (${desc}), el indicador por defecto del proveedor ${r.proveedor.nombre}`,
    `Confirma el indicador de IVA ${valor} o indica el correcto`,
    { indicador_iva: valor, fuente: "maestro.proveedores" },
  )
  return { ...res, derivados: { indicador_iva: { valor, fuente: "maestro.proveedores" } } }
}

export const rc7: Regla = (p, m) => {
  const informado = p.solicitud.condiciones_pago
  const r = informado ? null : resolverProveedor(p, m)
  const codigo = informado ?? r?.proveedor.condiciones_pago_default
  if (!codigo) return estado("RC7", "no_aplica")
  if (!existeCondicionPago(m, codigo)) {
    return bloqueo(
      "RC7",
      `La condición de pago '${codigo}' no existe en el maestro`,
      "Pide una condición de pago válida (Z000, Z015, Z030, Z060)",
      { condiciones_pago: codigo },
    )
  }
  if (informado) return estado("RC7", "ok")
  return {
    codigo: "RC7",
    resultado: "derivado",
    derivados: { condiciones_pago: { valor: codigo, fuente: "maestro.proveedores" } },
  }
}

export const rc8: Regla = (p) => {
  const f = p.factura
  if (!f) return estado("RC8", "no_aplica")
  if (fechaLocal(f.fecha) >= p.solicitud.fecha_solicitud) return estado("RC8", "ok")
  const res = confirmacion(
    "RC8",
    `Factura ${f.numero} del ${fechaLocal(f.fecha)} es anterior a la solicitud del ${p.solicitud.fecha_solicitud}: OC retroactiva`,
    "Confirma crear la OC retroactiva; quedará marcada retroactiva=true en el control",
    { factura: f.numero, fecha_factura: fechaLocal(f.fecha), fecha_solicitud: p.solicitud.fecha_solicitud },
  )
  return { ...res, retroactiva: true }
}

export const rc9: Regla = (p) => {
  if (!p.aprobacion) return estado("RC9", "no_aplica")
  const fecha = fechaLocal(p.aprobacion.fecha)
  if (fecha >= p.solicitud.fecha_solicitud) return estado("RC9", "ok")
  return confirmacion(
    "RC9",
    `La aprobación (${fecha}) es anterior a la solicitud (${p.solicitud.fecha_solicitud})`,
    "Confirma que la aprobación corresponde a esta solicitud o pide una aprobación posterior",
    { fecha_aprobacion: fecha, fecha_solicitud: p.solicitud.fecha_solicitud },
  )
}

export const rc10: Regla = (p) => {
  const { cantidad, valor_unitario, valor_total } = p.solicitud
  const calculado = cantidad * valor_unitario
  if (Math.abs(calculado - valor_total) <= TOLERANCIA_ARITMETICA) return estado("RC10", "ok")
  return bloqueo(
    "RC10",
    `Cantidad × valor unitario (${cantidad} × ${formatoMonto(valor_unitario)} = ${formatoMonto(calculado)}) no coincide con el valor total ${formatoMonto(valor_total)}`,
    "Pide al solicitante corregir cantidad, valor unitario o valor total",
    { cantidad, valor_unitario, valor_total },
  )
}

export const REGLAS: readonly Regla[] = [rc1, rc2, rc3, rc4, rc5, rc6, rc7, rc8, rc9, rc10]

// ---------- agregación (oc_validar) ----------

export type Validacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
  reglas_evaluadas: Array<{ codigo: CodigoRegla; resultado: EstadoRegla }>
}

/** Ejecuta todas las reglas (no se detiene en el primer bloqueo) y agrega sus resultados. */
export function validarPaquete(p: Paquete, m: Maestros): Validacion {
  const resultados = REGLAS.map((regla) => regla(p, m))
  const hallazgos = resultados.flatMap((r) => (r.hallazgo ? [r.hallazgo] : []))
  const bloqueos = hallazgos.filter((h) => h.tipo === "bloqueo")
  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones: hallazgos.filter((h) => h.tipo === "confirmacion"),
    derivados: Object.assign({}, ...resultados.map((r) => r.derivados ?? {})),
    retroactiva: resultados.some((r) => r.retroactiva === true),
    reglas_evaluadas: resultados.map((r) => ({ codigo: r.codigo, resultado: r.resultado })),
  }
}
