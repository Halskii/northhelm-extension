// Job Autofill — turn a stored resume (PDF, DOCX, TXT, RTF) into plain text,
// entirely in the browser. PDF text comes from Mozilla's pdf.js (lib/vendor).
import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/vendor/pdf.worker.min.mjs");

function dataUrlToBytes(dataUrl) {
  const b64 = String(dataUrl).split(",")[1] || "";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function kindOf(file, bytes) {
  const name = (file.name || "").toLowerCase();
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf"; // %PDF
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "zip";                                          // PK (docx)
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return "doc";                                          // old Word
  if (name.endsWith(".rtf") || (bytes[0] === 0x7b && bytes[1] === 0x5c)) return "rtf";               // {\
  return "txt";
}

async function pdfText(bytes) {
  const task = pdfjsLib.getDocument({ data: bytes, isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let line = "", lastY = null, text = "";
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      const y = it.transform ? Math.round(it.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { text += line.trimEnd() + "\n"; line = ""; }
      line += it.str + (it.hasEOL ? "\n" : "");
      if (it.str && !it.str.endsWith(" ") && !it.hasEOL) line += " ";
      lastY = y;
    }
    text += line;
    pages.push(text.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " "));
  }
  try { await task.destroy(); } catch (_) {}
  return pages.join("\n\n");
}

// Minimal ZIP reader (enough for .docx): central directory + deflate-raw.
async function unzipEntry(bytes, wanted) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid .docx file");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (name !== wanted) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + csize);
    if (method === 0) return dec.decode(data);
    if (method !== 8) throw new Error("Unsupported compression in .docx");
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(stream).text();
  }
  throw new Error("No document text found in that .docx");
}

function decodeXml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

async function docxText(bytes) {
  const xml = await unzipEntry(bytes, "word/document.xml");
  return decodeXml(xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:(br|cr)\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/\n{3,}/g, "\n\n");
}

function rtfText(s) {
  return s.replace(/\\par[d]?/g, "\n").replace(/\{\\\*[^{}]*\}/g, "").replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "").replace(/\n{3,}/g, "\n\n");
}

/** @param {{name:string,type:string,data:string}} file stored resume (data URL) */
export async function resumeToText(file) {
  if (!file || !file.data) throw new Error("No resume uploaded for this profile");
  const bytes = dataUrlToBytes(file.data);
  const kind = kindOf(file, bytes);
  let text;
  if (kind === "pdf") text = await pdfText(bytes);
  else if (kind === "zip") text = await docxText(bytes);
  else if (kind === "doc") throw new Error("Old .doc files can't be read. Save it as .docx or PDF and upload again");
  else if (kind === "rtf") text = rtfText(new TextDecoder().decode(bytes));
  else text = new TextDecoder().decode(bytes);
  text = text.replace(/\u0000/g, "").trim();
  if (text.length < 40) throw new Error("Couldn't find text in that resume. If it's a scanned image, upload a PDF exported from Word or Google Docs");
  return text;
}
