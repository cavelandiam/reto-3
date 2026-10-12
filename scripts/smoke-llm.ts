// Prueba con el modelo real (requiere ANTHROPIC_API_KEY): ejecuta el prompt de demo del PRD §11 y
// los casos sol-001, sol-003 y sol-005 sobre una copia temporal de los fixtures, verifica el
// comportamiento esperado y mide tokens para estimar el costo por caso. Uso: bun run smoke:llm
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Agente, type RespuestaTurno } from "../src/agent/loop"
import { RAIZ_PROYECTO } from "../src/agent/prompt-loader"
import { AlmacenSesiones } from "../src/agent/session"
import { leerConfig } from "../src/config"
import type {
  DefinicionHerramienta,
  LlmAdapter,
  MensajeLlm,
  OpcionesLlm,
  RespuestaLlm,
} from "../src/llm/adapter"
import { crearLlm } from "../src/server"

/** Precios USD por millón de tokens de claude-opus-5-5 (https://platform.claude.com/docs/en/about-claude/pricing). */
const PRECIO = { entrada: 4, salida: 20, cacheLectura: 0.2, cacheEscritura: 5 }

const PROMPT_PRD =
  'Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.'

type Contador = {
  entrada: number
  salida: number
  cacheLectura: number
  cacheEscritura: number
  llamadas: number
}

/** Decorador del adaptador que acumula el uso de tokens. */
class LlmMedido implements LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  uso: Contador = { entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0, llamadas: 0 }

  constructor(private readonly base: LlmAdapter) {
    this.proveedor = base.proveedor
    this.modelo = base.modelo
  }

  async enviar(
    s: string,
    m: MensajeLlm[],
    h: DefinicionHerramienta[],
    o: OpcionesLlm,
  ): Promise<RespuestaLlm> {
    const r = await this.base.enviar(s, m, h, o)
    const lectura = r.uso.cacheLectura ?? 0
    const escritura = r.uso.cacheEscritura ?? 0
    this.uso.entrada += r.uso.entrada - lectura - escritura
    this.uso.salida += r.uso.salida
    this.uso.cacheLectura += lectura
    this.uso.cacheEscritura += escritura
    this.uso.llamadas += 1
    return r
  }

  reiniciar(): Contador {
    const previo = this.uso
    this.uso = { entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0, llamadas: 0 }
    return previo
  }
}

function costo(u: Contador): number {
  const m = 1_000_000
  return (
    (u.entrada * PRECIO.entrada + u.salida * PRECIO.salida) / m +
    (u.cacheLectura * PRECIO.cacheLectura + u.cacheEscritura * PRECIO.cacheEscritura) / m
  )
}

const fallos: string[] = []
function verificar(condicion: boolean, descripcion: string): void {
  console.log(`  ${condicion ? "✅" : "❌"} ${descripcion}`)
  if (!condicion) fallos.push(descripcion)
}

function mostrar(r: RespuestaTurno): void {
  for (const t of r.toolCalls) console.log(`  · ${t.ok ? "✓" : "✗"} ${t.nombre} — ${t.resumen}`)
  console.log(`\n${r.reply}\n`)
  console.log(`  needsConfirmation=${r.needsConfirmation} pendiente=${JSON.stringify(r.pendiente)}`)
}

const creo = (r: RespuestaTurno) => r.toolCalls.some((t) => t.nombre === "oc_crear" && t.ok)

async function escenario(
  nombre: string,
  agente: Agente,
  llm: LlmMedido,
  pasos: string[],
): Promise<RespuestaTurno[]> {
  console.log(`\n════════ ${nombre} ════════`)
  const respuestas: RespuestaTurno[] = []
  let id: string | undefined
  for (const mensaje of pasos) {
    console.log(`\n> ${mensaje}`)
    const r = await agente.turno(id, mensaje)
    id = r.sessionId
    mostrar(r)
    respuestas.push(r)
  }
  const u = llm.reiniciar()
  console.log(
    `  tokens: entrada=${u.entrada} cache_lectura=${u.cacheLectura} cache_escritura=${u.cacheEscritura} salida=${u.salida} llamadas=${u.llamadas} → USD ${costo(u).toFixed(4)}`,
  )
  return respuestas
}

async function main(): Promise<void> {
  const config = leerConfig()
  const base = crearLlm(config)
  if (base?.proveedor !== "anthropic" || !base) {
    console.error("Falta ANTHROPIC_API_KEY (y LLM_PROVIDER=anthropic) para la prueba con modelo real.")
    process.exit(1)
  }
  const llm = new LlmMedido(base)
  const dir = mkdtempSync(join(tmpdir(), "reto03-smoke-"))
  cpSync(join(RAIZ_PROYECTO, "fixtures"), join(dir, "fixtures"), { recursive: true })
  const agente = new Agente({
    directory: dir,
    llm,
    sesiones: new AlmacenSesiones(dir),
    maxIteraciones: config.AGENT_MAX_ITERATIONS,
    maxTokensSesion: config.SESSION_MAX_TOKENS,
    timeoutMs: config.LLM_TIMEOUT_MS,
    maxTokensRespuesta: config.LLM_MAX_TOKENS_RESPUESTA,
  })
  console.log(`Modelo: ${llm.proveedor} / ${llm.modelo}`)
  try {
    const [a1, a2] = await escenario("PRD §11 · sol-004", agente, llm, [PROMPT_PRD, "Confirmo"])
    if (a1 && a2) {
      verificar(a1.needsConfirmation && !creo(a1), "sol-004: pide confirmación y no crea en el primer turno")
      verificar(a1.reply.includes("25.000.000") && a1.reply.includes("26.500.000"), "muestra ambos valores")
      // La pregunta puede ir en negrita ("…?**").
      verificar(/\?[*_\s]*$/.test(a1.reply), "termina el turno con una pregunta")
      verificar(/\|.*\|/.test(a1.reply), "muestra la OC en tabla")
      verificar(creo(a2) && a2.reply.includes("4500000001"), "tras 'Confirmo' crea la OC 4500000001")
      verificar(a2.reply.includes("aprobacion"), "muestra la ruta de la evidencia")
    }
    const [b] = await escenario("sol-001", agente, llm, ["Procesa la solicitud sol-001"])
    if (b) verificar(creo(b) && !b.needsConfirmation, "sol-001: crea sin intervención")
    const [c] = await escenario("sol-003", agente, llm, ["Procesa la solicitud sol-003"])
    if (c)
      verificar(
        !creo(c) && c.reply.includes("RC2") && c.reply.includes("RC3"),
        "sol-003: bloqueada por RC2 y RC3",
      )
    const [d1, d2] = await escenario("sol-005", agente, llm, ["Procesa la solicitud sol-005", "Sí, confirmo"])
    if (d1 && d2) {
      verificar(d1.needsConfirmation && !creo(d1), "sol-005: pide confirmación (retroactiva)")
      verificar(creo(d2) && /retroactiva/i.test(d2.reply), "sol-005: creada y marcada retroactiva")
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(
    fallos.length === 0 ? "\n✅ Prueba con modelo real superada" : `\n❌ Fallos: ${fallos.join("; ")}`,
  )
  process.exit(fallos.length === 0 ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error(`La prueba falló: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
