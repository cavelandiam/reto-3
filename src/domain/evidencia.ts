// Evidencia de aprobación: texto canónico del correo, su SHA-256, y archivos aprobacion.txt / aprobacion.pdf.
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { PDFDocument, type PDFFont, StandardFonts } from "pdf-lib"
import { carpetaOut, rutaRelativa } from "../infra/paths"
import type { Paquete } from "./schemas"

type Aprobacion = NonNullable<Paquete["aprobacion"]>

/** Texto canónico (UTF-8, saltos \n, sin espacios finales). Es lo que se firma con SHA-256. */
export function textoCanonico(solicitudId: string, a: Aprobacion): string {
  const lineas = [
    "EVIDENCIA DE APROBACIÓN DE ORDEN DE COMPRA",
    `Solicitud: ${solicitudId}`,
    `De: ${a.de}`,
    `Para: ${a.para}`,
    `CC: ${a.cc.join(", ")}`,
    `Fecha: ${a.fecha}`,
    `Asunto: ${a.asunto}`,
    "",
    ...a.texto.replace(/\r\n?/g, "\n").split("\n"),
  ]
  return lineas.map((l) => l.trimEnd()).join("\n")
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex")
}

/** Hash de la evidencia de un paquete; el mismo que usa el payload, sin importar el orden de llamadas. */
export function hashEvidencia(p: Paquete): string | null {
  return p.aprobacion ? sha256(textoCanonico(p.solicitud.solicitud_id, p.aprobacion)) : null
}

/** Reemplaza caracteres que Helvetica (WinAnsi) no soporta por un equivalente ASCII. */
export function sanearWinAnsi(texto: string): string {
  return [...texto]
    .map((c) => {
      const code = c.codePointAt(0) ?? 0
      if (code >= 0x20 && code <= 0xff) return c
      if (c === "≥") return ">="
      if (c === "≤") return "<="
      if (c === "—" || c === "–") return "-"
      const base = c.normalize("NFD").replace(/[̀-ͯ]/g, "")
      return /^[\x20-\x7e]$/.test(base) ? base : "?"
    })
    .join("")
}

function partirLinea(linea: string, font: PDFFont, tam: number, ancho: number): string[] {
  const palabras = linea.split(" ")
  const salida: string[] = []
  let actual = ""
  for (const p of palabras) {
    const tentativa = actual ? `${actual} ${p}` : p
    if (font.widthOfTextAtSize(tentativa, tam) > ancho && actual) {
      salida.push(actual)
      actual = p
    } else actual = tentativa
  }
  salida.push(actual)
  return salida
}

/** PDF A4 en Helvetica con el texto canónico y el hash en el pie. */
export async function generarPdf(texto: string, hash: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle("Evidencia de aprobación de orden de compra")
  doc.setProducer("reto-03 ordenes de compra")
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pagina = doc.addPage([595.28, 841.89])
  const tam = 11
  let y = 790
  for (const linea of sanearWinAnsi(texto).split("\n")) {
    for (const trozo of partirLinea(linea, font, tam, 495)) {
      pagina.drawText(trozo, { x: 50, y, size: tam, font })
      y -= tam * 1.5
    }
  }
  pagina.drawText(`SHA-256 del contenido: ${hash}`, { x: 50, y: 40, size: 8, font })
  return doc.save()
}

export type Evidencia = { ruta: string; ruta_pdf: string; sha256: string }

/** Escribe out/<caso>/aprobacion.txt y aprobacion.pdf; devuelve rutas relativas y hash. */
export async function escribirEvidencia(raiz: string, caso: string, p: Paquete): Promise<Evidencia | null> {
  if (!p.aprobacion) return null
  const texto = textoCanonico(p.solicitud.solicitud_id, p.aprobacion)
  const hash = sha256(texto)
  const carpeta = carpetaOut(raiz, caso)
  mkdirSync(carpeta, { recursive: true })
  const rutaTxt = carpetaOut(raiz, caso, "aprobacion.txt")
  const rutaPdf = carpetaOut(raiz, caso, "aprobacion.pdf")
  writeFileSync(rutaTxt, `${texto}\n---\nSHA-256 del contenido anterior: ${hash}\n`, "utf8")
  writeFileSync(rutaPdf, await generarPdf(texto, hash))
  return { ruta: rutaRelativa(raiz, rutaTxt), ruta_pdf: rutaRelativa(raiz, rutaPdf), sha256: hash }
}
