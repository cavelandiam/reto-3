// Interfaz del adaptador SAP (exacta al PRD §7.4). El mock la implementa sobre archivos;
// una implementación real (OData / BAPI) la implementaría sin tocar herramientas ni agente.
import type { OrdenCompra } from "../domain/schemas"

export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>
}
