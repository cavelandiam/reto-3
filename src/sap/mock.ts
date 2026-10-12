// SAP simulado: numeración secuencial desde 4500000001 y órdenes en out/sap/ordenes.jsonl.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import { cargarMaestros, proveedorPorNit } from "../domain/maestros"
import type { OrdenCompra } from "../domain/schemas"
import { enSerie } from "../infra/mutex"
import { carpetaOut } from "../infra/paths"
import { hoyLocal } from "../infra/reloj"
import type { SapAdapter } from "./adapter"

export const PRIMER_NUMERO_OC = 4500000001

type RegistroOrden = { numero_oc: string; fecha: string; solicitud_id: string; orden: OrdenCompra }

export class MockSapAdapter implements SapAdapter {
  private readonly ruta: string

  constructor(private readonly raiz: string) {
    this.ruta = carpetaOut(raiz, "sap", "ordenes.jsonl")
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const p = proveedorPorNit(cargarMaestros(this.raiz), nit)
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null
  }

  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    return enSerie(this.ruta, () => {
      const registros = this.leer()
      const maximo = Math.max(PRIMER_NUMERO_OC - 1, ...registros.map((r) => Number(r.numero_oc)))
      const registro: RegistroOrden = {
        numero_oc: String(maximo + 1),
        fecha: hoyLocal(),
        solicitud_id: orden.referencia.solicitud_id,
        orden,
      }
      mkdirSync(dirname(this.ruta), { recursive: true })
      appendFileSync(this.ruta, `${JSON.stringify(registro)}\n`, "utf8")
      return { numero_oc: registro.numero_oc, fecha: registro.fecha }
    })
  }

  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null> {
    const r = this.leer().find((x) => x.solicitud_id === solicitud_id)
    return r ? { numero_oc: r.numero_oc } : null
  }

  private leer(): RegistroOrden[] {
    if (!existsSync(this.ruta)) return []
    return readFileSync(this.ruta, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as RegistroOrden)
  }
}
