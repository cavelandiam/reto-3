// API HTTP (Hono) y front estático. El servidor no contiene reglas de negocio:
// solo valida la entrada, aplica límites y delega en el ciclo del agente.
import { timingSafeEqual } from "node:crypto"
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { Context, Next } from "hono"
import { Hono } from "hono"
import { z } from "zod"
import { Agente, ErrorEntrada, MAX_LARGO_MENSAJE } from "./agent/loop"
import { RAIZ_PROYECTO } from "./agent/prompt-loader"
import { AlmacenSesiones, idValido } from "./agent/session"
import { type Config, leerConfig } from "./config"
import { carpetaOut, RUTA_SOLICITUDES, resolverDentro } from "./infra/paths"
import type { LlmAdapter } from "./llm/adapter"
import { AnthropicLlm, MODELO_POR_DEFECTO } from "./llm/anthropic"
import { ScriptedLLM } from "./llm/scripted"

export type Dependencias = { config: Config; llm: LlmAdapter | null; directory: string }

const CuerpoChat = z.object({
  sessionId: z.string().refine(idValido, "sessionId inválido").nullish(),
  message: z
    .string()
    .min(1, "El mensaje está vacío")
    .max(MAX_LARGO_MENSAJE, `Máximo ${MAX_LARGO_MENSAJE} caracteres`),
})

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
}
const ESTATICOS = ["index.html", "app.js", "styles.css", "favicon.svg"]

/** Crea el LLM según la configuración; null si el proveedor no está configurado (sin clave). */
export function crearLlm(config: Config): LlmAdapter | null {
  if (config.LLM_PROVIDER === "scripted") return new ScriptedLLM([], { entrada: 0, salida: 0 })
  if (!config.ANTHROPIC_API_KEY) return null
  return new AnthropicLlm(config.ANTHROPIC_API_KEY, config.LLM_MODEL ?? MODELO_POR_DEFECTO, config.LLM_EFFORT)
}

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function ipDe(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local"
}

/** Límite de solicitudes por IP en una ventana deslizante de 60 s. */
function limitador(porMinuto: number) {
  const accesos = new Map<string, number[]>()
  return async (c: Context, next: Next) => {
    const ahora = Date.now()
    const ip = ipDe(c)
    const recientes = (accesos.get(ip) ?? []).filter((t) => ahora - t < 60_000)
    if (recientes.length >= porMinuto) {
      return c.json({ error: "Demasiadas solicitudes; espera un minuto e inténtalo de nuevo." }, 429)
    }
    recientes.push(ahora)
    accesos.set(ip, recientes)
    await next()
  }
}

function listarCasos(directory: string): string[] {
  const carpeta = resolverDentro(directory, RUTA_SOLICITUDES)
  if (!existsSync(carpeta)) return []
  return readdirSync(carpeta, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

function registrarEstaticos(app: Hono): void {
  const servir = (archivo: string) => {
    const ruta = join(RAIZ_PROYECTO, "web", archivo)
    const tipo = TIPOS[archivo.slice(archivo.lastIndexOf("."))] ?? "application/octet-stream"
    return new Response(readFileSync(ruta), {
      headers: { "content-type": tipo, "cache-control": "no-cache" },
    })
  }
  app.get("/", () => servir("index.html"))
  for (const archivo of ESTATICOS) app.get(`/${archivo}`, () => servir(archivo))
}

function registrarApi(app: Hono, deps: Dependencias, agente: Agente | null, sesiones: AlmacenSesiones): void {
  const { config, llm, directory } = deps
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      provider: llm?.proveedor ?? config.LLM_PROVIDER,
      model: llm?.modelo ?? config.LLM_MODEL ?? MODELO_POR_DEFECTO,
      llm_configurado: llm !== null,
      requiere_clave: config.ACCESS_KEY !== null,
    }),
  )
  app.get("/api/casos", (c) => c.json({ casos: listarCasos(directory) }))
  app.post("/api/chat", limitador(config.RATE_LIMIT_POR_MINUTO), async (c) => {
    const cuerpo = CuerpoChat.safeParse(await c.req.json().catch(() => null))
    if (!cuerpo.success) return c.json({ error: cuerpo.error.issues[0]?.message ?? "Cuerpo inválido" }, 400)
    if (!agente) {
      return c.json(
        { error: "El proveedor LLM no está configurado (falta ANTHROPIC_API_KEY en el servidor)." },
        503,
      )
    }
    try {
      return c.json(await agente.turno(cuerpo.data.sessionId ?? undefined, cuerpo.data.message))
    } catch (e) {
      if (e instanceof ErrorEntrada) return c.json({ error: e.message }, 400)
      throw e
    }
  })
  app.get("/api/sessions/:id", (c) => {
    const s = sesiones.obtener(c.req.param("id"))
    if (!s) return c.json({ error: "La sesión no existe" }, 404)
    return c.json({
      id: s.id,
      creada: s.creada,
      tokens: s.tokens,
      pendiente: s.pendiente,
      mensajes: s.visibles,
    })
  })
  app.post("/api/reset", (c) => {
    rmSync(carpetaOut(directory), { recursive: true, force: true })
    sesiones.vaciar()
    return c.json({ ok: true })
  })
}

export function crearApp(deps: Dependencias): Hono {
  const app = new Hono()
  const sesiones = new AlmacenSesiones(deps.directory)
  const { config, llm } = deps
  const agente = llm
    ? new Agente({
        directory: deps.directory,
        llm,
        sesiones,
        maxIteraciones: config.AGENT_MAX_ITERATIONS,
        maxTokensSesion: config.SESSION_MAX_TOKENS,
        timeoutMs: config.LLM_TIMEOUT_MS,
        maxTokensRespuesta: config.LLM_MAX_TOKENS_RESPUESTA,
      })
    : null
  const clave = config.ACCESS_KEY
  if (clave) {
    app.use("/api/*", async (c, next) => {
      if (c.req.path === "/api/health") return next()
      if (!iguales(c.req.header("x-access-key") ?? "", clave))
        return c.json({ error: "Clave de acceso inválida" }, 401)
      return next()
    })
  }
  registrarApi(app, deps, agente, sesiones)
  registrarEstaticos(app)
  app.notFound((c) => c.json({ error: "Ruta no encontrada" }, 404))
  app.onError((e, c) => {
    console.error(`[error] ${c.req.method} ${c.req.path}: ${e.message}`)
    return c.json({ error: "Error interno del servidor. Intenta de nuevo." }, 500)
  })
  return app
}

if (import.meta.main) {
  const config = leerConfig()
  const llm = crearLlm(config)
  const app = crearApp({ config, llm, directory: RAIZ_PROYECTO })
  Bun.serve({ port: config.PORT, fetch: app.fetch, idleTimeout: 255 })
  const estado = llm ? `${llm.proveedor} / ${llm.modelo}` : "LLM sin configurar (falta ANTHROPIC_API_KEY)"
  console.log(`Agente de órdenes de compra en http://localhost:${config.PORT} · ${estado}`)
}
