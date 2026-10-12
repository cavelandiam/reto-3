// Contexto y dependencias de las herramientas. El adaptador SAP se obtiene por una factoría
// para poder sustituir el mock por una implementación real sin tocar las herramientas.
import type { z } from "zod"
import type { SapAdapter } from "../sap/adapter"
import { MockSapAdapter } from "../sap/mock"

export type ContextoHerramienta = { directory: string; sessionId: string }

/** Forma obligatoria de una herramienta (PRD §6.2). */
export type Herramienta<A extends z.ZodRawShape> = {
  description: string
  args: A
  execute(args: z.infer<z.ZodObject<A>>, ctx: ContextoHerramienta): Promise<string>
}

type FabricaSap = (ctx: ContextoHerramienta) => SapAdapter

let fabricaSap: FabricaSap = (ctx) => new MockSapAdapter(ctx.directory)

export function getSapAdapter(ctx: ContextoHerramienta): SapAdapter {
  return fabricaSap(ctx)
}

/** Reemplaza la implementación de SAP (p. ej. un adaptador OData real). */
export function configurarSap(fabrica: FabricaSap): void {
  fabricaSap = fabrica
}
