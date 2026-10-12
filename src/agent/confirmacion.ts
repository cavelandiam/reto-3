// Confirmación humana impuesta en el servidor (CA3): no basta con que el prompt lo pida.
// oc_crear con confirmado=true solo se ejecuta si el mensaje de ESTE turno confirma un caso que
// quedó pendiente en el turno anterior.
import type { Compuerta } from "../tools/registry"
import type { Pendiente } from "./session"

export type Clase = "afirmativo" | "negativo" | "otro"

/** Palabra completa con soporte de tildes (\b de JS no reconoce "sí"). */
function palabras(alternativas: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\d])(${alternativas})(?![\\p{L}\\d])`, "iu")
}

const AFIRMATIVO = palabras(
  "s[ií]|confirmo|confirmado|confirmada|procede|proceder|adelante|dale|ok|cr[eé]ala|cr[eé]alas|crea|de acuerdo|aprobado",
)
const NEGATIVO = palabras("no|cancela|cancelar|espera|todav[ií]a no")
const RETENER = palabras(
  "no la crees|no las crees|no crear|no crees|sin crearla|sin crear|no la cree|hasta que (yo )?(lo |la )?confirme",
)
const CASO = /sol-\d{3}/gi
const TODOS = palabras("todos|todas|ambos|ambas")

export function clasificar(mensaje: string): Clase {
  if (NEGATIVO.test(mensaje)) return "negativo"
  if (AFIRMATIVO.test(mensaje)) return "afirmativo"
  return "otro"
}

/** true si el usuario pidió explícitamente no crear todavía (p. ej. "no la crees hasta que confirme"). */
export function pideRetener(mensaje: string): boolean {
  return RETENER.test(mensaje)
}

export function casosMencionados(mensaje: string): string[] {
  return [...new Set((mensaje.match(CASO) ?? []).map((c) => c.toLowerCase()))]
}

export type Autorizacion = { casos: Set<string>; motivo: string | null }

/** Casos que el usuario confirma en este mensaje, dados los pendientes del turno anterior. */
export function autorizar(mensaje: string, pendiente: Pendiente[]): Autorizacion {
  const vacio = new Set<string>()
  if (pendiente.length === 0) {
    return {
      casos: vacio,
      motivo: "requiere confirmación explícita del usuario en su último mensaje (no había OC pendientes)",
    }
  }
  if (clasificar(mensaje) !== "afirmativo") {
    return { casos: vacio, motivo: "requiere confirmación explícita del usuario en su último mensaje" }
  }
  const pendientes = pendiente.map((p) => p.caso)
  const nombrados = casosMencionados(mensaje).filter((c) => pendientes.includes(c))
  if (nombrados.length > 0) return { casos: new Set(nombrados), motivo: null }
  if (pendientes.length === 1 || TODOS.test(mensaje)) return { casos: new Set(pendientes), motivo: null }
  return {
    casos: vacio,
    motivo: `Hay varias OC pendientes (${pendientes.join(", ")}); pregunta cuál confirmar`,
  }
}

function argumentosCrear(args: unknown): { caso: string; confirmado: boolean; conPayload: boolean } | null {
  if (typeof args !== "object" || args === null) return null
  const a = args as Record<string, unknown>
  return { caso: String(a.caso ?? ""), confirmado: a.confirmado === true, conPayload: a.payload != null }
}

/**
 * Compuerta para el registry:
 * - oc_crear con confirmado=true solo para casos autorizados en este turno.
 * - si el usuario pidió no crear todavía, se rechaza oc_crear con payload (solo se permite registrar bloqueos).
 */
export function crearCompuerta(auth: Autorizacion, retener: boolean): Compuerta {
  return (nombre, args) => {
    if (nombre !== "oc_crear") return null
    const a = argumentosCrear(args)
    if (!a) return null
    if (retener && (a.conPayload || a.confirmado)) {
      return "El usuario pidió no crear la OC todavía: muestra el resultado y pide confirmación"
    }
    if (a.confirmado && !auth.casos.has(a.caso.toLowerCase())) {
      return auth.motivo ?? "requiere confirmación explícita del usuario en su último mensaje"
    }
    return null
  }
}
