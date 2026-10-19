import { createHash } from "node:crypto"
import { join } from "node:path"
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib"
import { ErrorNegocio, escribirArchivo, rutas } from "./archivos"
import { leerAprobacionArchivo } from "./paquete"
import type { AprobacionArchivo } from "./tipos"

export type Evidencia = { contenido: string; sha256: string }

/** Contenido canónico de la evidencia; el sha256 se calcula sobre este texto exacto. */
export function construirEvidencia(a: AprobacionArchivo): Evidencia {
  const contenido = [
    `De: ${a.de}`,
    `Para: ${a.para}`,
    ...(a.cc?.length ? [`CC: ${a.cc.join(", ")}`] : []),
    `Fecha: ${a.fecha}`,
    `Asunto: ${a.asunto}`,
    "",
    a.cuerpo,
  ].join("\n")
  return { contenido, sha256: createHash("sha256").update(contenido, "utf8").digest("hex") }
}

export async function evidenciaDelCaso(raiz: string, caso: string): Promise<Evidencia> {
  const archivo = await leerAprobacionArchivo(raiz, caso)
  if (!archivo) throw new ErrorNegocio("No hay correo de aprobación en el paquete; no se puede generar la evidencia.")
  return construirEvidencia(archivo)
}

export type RutasEvidencia = { txt: string; pdf: string; sha256: string }

export async function generarEvidencia(raiz: string, caso: string): Promise<RutasEvidencia> {
  const evidencia = await evidenciaDelCaso(raiz, caso)
  const dir = rutas.outCaso(raiz, caso)
  const txt = join(dir, "aprobacion.txt")
  const pdf = join(dir, "aprobacion.pdf")
  await escribirArchivo(txt, textoArchivo(evidencia))
  await escribirArchivo(pdf, await pdfEvidencia(evidencia))
  return { txt, pdf, sha256: evidencia.sha256 }
}

function textoArchivo(e: Evidencia): string {
  return `EVIDENCIA DE APROBACIÓN\n${"=".repeat(23)}\n\n${e.contenido}\n\n---\nSHA-256 del contenido (desde "De:" hasta el final del cuerpo): ${e.sha256}\n`
}

async function pdfEvidencia(e: Evidencia): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const fuente = await doc.embedFont(StandardFonts.Helvetica)
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold)
  let pagina = doc.addPage([595, 842]) // A4
  let y = 790
  const margen = 56
  const ancho = 595 - margen * 2

  const escribir = (texto: string, f: PDFFont, tam: number) => {
    for (const linea of envolver(aWinAnsi(texto), f, tam, ancho)) {
      if (y < 60) {
        pagina = doc.addPage([595, 842])
        y = 790
      }
      pagina.drawText(linea, { x: margen, y, size: tam, font: f })
      y -= tam + 5
    }
  }

  escribir("EVIDENCIA DE APROBACIÓN", negrita, 15)
  y -= 8
  for (const linea of e.contenido.split("\n")) escribir(linea || " ", fuente, 11)
  y -= 12
  escribir("SHA-256 del contenido:", negrita, 9)
  escribir(e.sha256, fuente, 9)
  return doc.save()
}

/** Las fuentes estándar de PDF solo cubren WinAnsi (Latin-1); el resto se reemplaza. */
function aWinAnsi(texto: string): string {
  return texto.replace(/[–—]/g, "-").replace(/[^ -ÿ]/g, "?")
}

function envolver(texto: string, f: PDFFont, tam: number, ancho: number): string[] {
  const lineas: string[] = []
  let actual = ""
  for (const palabra of texto.split(" ")) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (f.widthOfTextAtSize(prueba, tam) <= ancho || !actual) {
      actual = prueba
    } else {
      lineas.push(actual)
      actual = palabra
    }
  }
  lineas.push(actual)
  return lineas
}
