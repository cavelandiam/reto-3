// Esquemas zod del dominio: fixtures, maestros, paquete normalizado (PRD §7.2) y OrdenCompra (PRD §7.4).
import { z } from "zod"

// ---------- Fixtures ----------

export const CorreoSchema = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string().optional(),
  asunto: z.string(),
  fecha: z.string(),
  cuerpo: z.string().optional(),
  adjuntos: z.array(z.string()).optional(),
})

export const SolicitudSchema = z.object({
  solicitud_id: z.string().describe("Identificador de la solicitud, p. ej. 'SOL-2026-001'"),
  solicitante: z.string().describe("Nombre de quien solicita"),
  proveedor_nombre: z.string().describe("Nombre del proveedor según la solicitud"),
  proveedor_nit: z.string().optional().describe("NIT del proveedor sin dígito de verificación, si viene"),
  descripcion: z.string().describe("Descripción del bien o servicio"),
  centro_costo: z.string().describe("Centro de costo, p. ej. 'CC-1010'"),
  subarea: z.string().describe("Subárea del centro de costo"),
  cantidad: z.number().describe("Cantidad solicitada"),
  valor_unitario: z.number().describe("Valor unitario (IVA incluido)"),
  valor_total: z.number().describe("Valor total (IVA incluido)"),
  moneda: z.enum(["COP", "USD"]).describe("Moneda"),
  indicador_iva: z.string().optional().describe("Código de indicador de IVA, si viene"),
  condiciones_pago: z.string().optional().describe("Código de condiciones de pago, si viene"),
  fecha_solicitud: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Fecha de la solicitud YYYY-MM-DD"),
})
export type Solicitud = z.infer<typeof SolicitudSchema>

export const AprobacionFixtureSchema = z.object({
  de: z.string(),
  para: z.string(),
  cc: z.array(z.string()).optional(),
  fecha: z.string(),
  asunto: z.string(),
  cuerpo: z.string(),
})

// ---------- Maestros ----------

export const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})
export type Proveedor = z.infer<typeof ProveedorSchema>

export const AprobadorSchema = z.object({
  email: z.string(),
  nombre: z.string().optional(),
  tope: z.number(),
})

export const CentroCostoSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(AprobadorSchema),
})
export type CentroCosto = z.infer<typeof CentroCostoSchema>

export const IndicadorIvaSchema = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() })
export const CondicionPagoSchema = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() })

export type Maestros = {
  proveedores: Proveedor[]
  centros: CentroCosto[]
  indicadoresIva: z.infer<typeof IndicadorIvaSchema>[]
  condicionesPago: z.infer<typeof CondicionPagoSchema>[]
}

// ---------- Paquete normalizado (PRD §7.2 + campos auxiliares) ----------

const textoOpcional = z.string().optional().describe("Texto original; puede omitirse al reenviar el paquete")

export const PaqueteSchema = z.object({
  correo: z.object({ id: z.string(), de: z.string(), asunto: z.string(), fecha: z.string() }),
  solicitud: SolicitudSchema,
  cotizacion: z
    .object({
      numero: z.string().nullable().optional(),
      proveedor: z.string(),
      nit: z.string().nullable(),
      total: z.number(),
      moneda: z.string(),
      validez_hasta: z.string().nullable(),
      texto: textoOpcional,
    })
    .nullable(),
  aprobacion: z
    .object({
      de: z.string(),
      para: z.string().optional(),
      cc: z.array(z.string()).optional(),
      asunto: z.string().optional(),
      fecha: z.string(),
      aprobado: z.boolean(),
      texto: textoOpcional,
    })
    .nullable(),
  factura: z.object({ numero: z.string(), fecha: z.string(), total: z.number() }).nullable(),
  faltantes: z.array(z.string()).optional(),
})
export type PaqueteEntrada = z.infer<typeof PaqueteSchema>

/** Paquete tal como lo produce oc_leer_paquete (todos los campos presentes). */
export type Paquete = {
  correo: { id: string; de: string; asunto: string; fecha: string }
  solicitud: Solicitud
  cotizacion: {
    numero: string | null
    proveedor: string
    nit: string | null
    total: number
    moneda: string
    validez_hasta: string | null
    texto: string
  } | null
  aprobacion: {
    de: string
    para: string
    cc: string[]
    asunto: string
    fecha: string
    aprobado: boolean
    texto: string
  } | null
  factura: { numero: string; fecha: string; total: number } | null
  faltantes: string[]
}

// ---------- Validación (oc_validar) ----------

export const CODIGOS_REGLA = ["RC1", "RC2", "RC3", "RC4", "RC5", "RC6", "RC7", "RC8", "RC9", "RC10"] as const
export type CodigoRegla = (typeof CODIGOS_REGLA)[number]

export type Hallazgo = {
  codigo: CodigoRegla
  tipo: "bloqueo" | "confirmacion"
  detalle: string
  accion_sugerida: string
  valores?: Record<string, string | number | null>
}

export const DerivadoSchema = z.object({ valor: z.string(), fuente: z.string() })

export const DerivadosSchema = z.object({
  indicador_iva: DerivadoSchema.optional(),
  condiciones_pago: DerivadoSchema.optional(),
  proveedor: z
    .object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string(), resuelto_por: z.string() })
    .optional(),
})
export type Derivados = z.infer<typeof DerivadosSchema>

// ---------- Orden de compra (PRD §7.4) ----------

export const PosicionSchema = z.object({
  numero: z.number().int(),
  descripcion: z.string().max(40),
  cantidad: z.number().positive(),
  unidad: z.enum(["UN", "H", "MES"]),
  precio_unitario: z.number().nonnegative(),
  centro_costo: z.string(),
  subarea: z.string(),
  indicador_iva: z.string(),
})

export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string().email(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  posiciones: z.array(PosicionSchema).min(1),
  excepciones: z.array(
    z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() }),
  ),
})
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>
