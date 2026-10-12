// Variables de entorno validadas con zod al arrancar. La clave del LLM nunca se imprime ni se expone.
import { z } from "zod"

const entero = (porDefecto: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? porDefecto : Number(v)))
    .pipe(z.number().int().positive())

const textoOpcional = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : null))

const EsquemaEntorno = z.object({
  LLM_PROVIDER: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : "anthropic"))
    .pipe(z.enum(["anthropic", "scripted"])),
  ANTHROPIC_API_KEY: textoOpcional,
  LLM_MODEL: textoOpcional,
  LLM_EFFORT: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : "medium"))
    .pipe(z.enum(["low", "medium", "high"])),
  LLM_TIMEOUT_MS: entero(60_000),
  LLM_MAX_TOKENS_RESPUESTA: entero(4096),
  AGENT_MAX_ITERATIONS: entero(25),
  SESSION_MAX_TOKENS: entero(200_000),
  RATE_LIMIT_POR_MINUTO: entero(20),
  PORT: entero(3000),
  ACCESS_KEY: textoOpcional,
})

export type Config = z.infer<typeof EsquemaEntorno>

/** Lee y valida el entorno; lanza con un mensaje que nombra la variable inválida (sin su valor). */
export function leerConfig(env: Record<string, string | undefined> = process.env): Config {
  const r = EsquemaEntorno.safeParse(env)
  if (r.success) return r.data
  const campos = r.error.issues.map((i) => i.path.join(".")).join(", ")
  throw new Error(`Variables de entorno inválidas: ${campos}. Revisa .env.example.`)
}
