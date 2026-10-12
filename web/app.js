// Front del chat: historial, tarjetas de herramientas, indicador "pensando" y banner de confirmación.
// Todo el HTML que viene del modelo se sanea con DOMPurify antes de insertarse.

const $ = (id) => document.getElementById(id)
const chat = $("chat")
const form = $("form")
const entrada = $("mensaje")
const botonEnviar = $("enviar")
const banner = $("banner")

const PROMPT_DEMO =
  'Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.'

const almacen = {
  leer(clave) {
    try {
      return sessionStorage.getItem(clave)
    } catch {
      return null
    }
  },
  escribir(clave, valor) {
    try {
      if (valor === null) sessionStorage.removeItem(clave)
      else sessionStorage.setItem(clave, valor)
    } catch {
      /* almacenamiento no disponible: se sigue sin persistir */
    }
  },
}

let sessionId = almacen.leer("sessionId")
let claveAcceso = almacen.leer("accessKey")
let ocupado = false

function cabeceras() {
  const h = { "content-type": "application/json" }
  if (claveAcceso) h["x-access-key"] = claveAcceso
  return h
}

async function pedir(ruta, opciones = {}) {
  const r = await fetch(ruta, { ...opciones, headers: cabeceras() })
  const cuerpo = await r.json().catch(() => ({ error: `Respuesta inválida (${r.status})` }))
  if (r.status === 401) {
    claveAcceso = window.prompt("Clave de acceso del agente:") || ""
    almacen.escribir("accessKey", claveAcceso)
  }
  if (!r.ok) throw new Error(cuerpo.error || `Error ${r.status}`)
  return cuerpo
}

function markdown(texto) {
  const div = document.createElement("div")
  div.className = "contenido"
  if (window.marked && window.DOMPurify) {
    div.innerHTML = window.DOMPurify.sanitize(window.marked.parse(texto))
  } else {
    div.style.whiteSpace = "pre-wrap"
    div.textContent = texto
  }
  return div
}

function tarjetaHerramienta(t) {
  const det = document.createElement("details")
  det.className = `tool ${t.ok ? "ok" : "ko"}`
  const sum = document.createElement("summary")
  const badge = document.createElement("span")
  badge.className = `badge ${t.ok ? "ok" : "ko"}`
  badge.textContent = t.ok ? "✓" : "✗"
  const nombre = document.createElement("span")
  nombre.className = "nombre"
  nombre.textContent = t.nombre
  const resumen = document.createElement("span")
  resumen.className = "resumen"
  resumen.textContent = t.resumen
  const dur = document.createElement("span")
  dur.className = "duracion"
  dur.textContent = `${t.duracion_ms} ms`
  sum.append(badge, nombre, resumen, dur)
  const pre = document.createElement("pre")
  pre.textContent = `argumentos:\n${JSON.stringify(t.argumentos, null, 2)}`
  det.append(sum, pre)
  return det
}

function avatar(esUsuario) {
  const a = document.createElement("span")
  a.className = `avatar ${esUsuario ? "persona" : "agente"}`
  a.setAttribute("aria-hidden", "true")
  a.textContent = esUsuario ? "Tú" : "OC"
  return a
}

function agregarMensaje(rol, texto, extra = {}) {
  chat.querySelector(".bienvenida")?.remove()
  const esUsuario = rol === "usuario"
  const div = document.createElement("article")
  div.className = `mensaje ${rol}`
  const burbuja = document.createElement("div")
  burbuja.className = "burbuja"
  if (esUsuario) burbuja.textContent = texto
  else {
    if (extra.needsConfirmation) {
      div.classList.add("pide")
      const sello = document.createElement("span")
      sello.className = "sello"
      sello.textContent = "⏸ Esperando tu confirmación"
      burbuja.append(sello)
    }
    if (extra.toolCalls?.length) {
      const lista = document.createElement("div")
      lista.className = "herramientas"
      for (const t of extra.toolCalls) lista.append(tarjetaHerramienta(t))
      burbuja.append(lista)
    }
    burbuja.append(markdown(texto))
  }
  div.append(avatar(esUsuario), burbuja)
  chat.append(div)
  div.scrollIntoView({ behavior: "smooth", block: "start" })
}

function mostrarBanner(pendiente) {
  if (!pendiente?.length) {
    banner.hidden = true
    return
  }
  const detalle = pendiente
    .map((p) => `${p.caso}${p.confirmaciones.length ? ` (${p.confirmaciones.join(", ")})` : ""}`)
    .join(" · ")
  $("banner-detalle").textContent = `El agente espera tu decisión para: ${detalle}.`
  banner.hidden = false
}

function ocupar(si) {
  ocupado = si
  $("pensando").hidden = !si
  botonEnviar.disabled = si
  for (const b of document.querySelectorAll("#chips button, #banner button")) b.disabled = si
}

async function enviar(texto) {
  const limpio = texto.trim()
  if (!limpio || ocupado) return
  agregarMensaje("usuario", limpio)
  entrada.value = ""
  ocupar(true)
  try {
    const r = await pedir("/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId, message: limpio }),
    })
    sessionId = r.sessionId
    almacen.escribir("sessionId", sessionId)
    agregarMensaje("asistente", r.reply, r)
    mostrarBanner(r.needsConfirmation ? r.pendiente : [])
  } catch (e) {
    agregarMensaje("asistente error", `⚠️ ${e.message}`)
  } finally {
    ocupar(false)
    entrada.focus()
  }
}

async function cargarHistorial() {
  if (!sessionId) return
  try {
    const s = await pedir(`/api/sessions/${encodeURIComponent(sessionId)}`)
    for (const m of s.mensajes) agregarMensaje(m.rol === "user" ? "usuario" : "asistente", m.texto, m)
    const ultimo = s.mensajes.at(-1)
    mostrarBanner(ultimo?.needsConfirmation ? s.pendiente : [])
  } catch {
    sessionId = null
    almacen.escribir("sessionId", null)
  }
}

function nuevaSesion() {
  sessionId = null
  almacen.escribir("sessionId", null)
  chat.replaceChildren()
  banner.hidden = true
  agregarMensaje("asistente", "Nueva sesión. ¿Qué solicitud procesamos?")
}

async function iniciar() {
  try {
    const h = await pedir("/api/health")
    const estado = $("estado")
    estado.textContent = h.llm_configurado ? `${h.model}` : "LLM sin configurar"
    estado.dataset.estado = h.llm_configurado ? "ok" : "aviso"
    estado.title = h.llm_configurado ? `Proveedor: ${h.provider}` : "Falta ANTHROPIC_API_KEY en el servidor"
    if (h.requiere_clave && !claveAcceso) {
      claveAcceso = window.prompt("Este agente requiere clave de acceso:") || ""
      almacen.escribir("accessKey", claveAcceso)
    }
    const { casos } = await pedir("/api/casos")
    const chips = $("chips")
    const demo = document.createElement("button")
    demo.type = "button"
    demo.className = "destacado"
    demo.textContent = "▶ Prompt de demo (sol-004)"
    demo.onclick = () => enviar(PROMPT_DEMO)
    chips.append(demo)
    for (const caso of casos) {
      const b = document.createElement("button")
      b.type = "button"
      b.textContent = `Procesa ${caso}`
      b.onclick = () => enviar(`Procesa la solicitud ${caso}`)
      chips.append(b)
    }
    await cargarHistorial()
  } catch (e) {
    $("estado").textContent = e.message
    $("estado").dataset.estado = "aviso"
  }
}

form.addEventListener("submit", (ev) => {
  ev.preventDefault()
  enviar(entrada.value)
})
entrada.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault()
    enviar(entrada.value)
  }
})
$("confirmar").onclick = () => enviar("Confirmo")
$("cancelar").onclick = () => enviar("No confirmo")
$("nueva").onclick = nuevaSesion
$("reset").onclick = async () => {
  if (!window.confirm("¿Borrar out/ (OC creadas, control, evidencias y sesiones)?")) return
  try {
    await pedir("/api/reset", { method: "POST" })
    nuevaSesion()
  } catch (e) {
    agregarMensaje("asistente error", `⚠️ ${e.message}`)
  }
}

iniciar()
