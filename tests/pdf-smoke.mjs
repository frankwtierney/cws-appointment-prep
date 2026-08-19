import { readFile, writeFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Pass input and output PDF paths.");

const source = new Uint8Array(await readFile(input));
const document = await getDocument({ data: source }).promise;
const page = await document.getPage(1);
const content = await page.getTextContent();
const positioned = content.items
  .filter((item) => "str" in item && "transform" in item)
  .map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
  .filter((item) => item.text)
  .sort((a, b) => b.y - a.y || a.x - b.x);
const rows = [];
for (const item of positioned) {
  const row = rows.find((candidate) => Math.abs(candidate.y - item.y) < 2.5);
  if (row) row.items.push(item); else rows.push({ y: item.y, items: [item] });
}
const lines = rows.map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" "));
const fullText = lines.join("\n");
const identityRow = lines.find((line) => /\d{8}/.test(line) && line.includes(",")) ?? "";
const identity = identityRow.match(/^\s*([^,]+),\s*(.+?)\s+(\d{8})\s*$/);
const award = fullText.match(/Award\s*Amount\s*:\s*\$?\s*([\d,.]+)/i);
const rate = fullText.match(/Hourly\s*Rate\s*:\s*\$?\s*([\d,.]+)/i);
if (!identity || !award || !rate) throw new Error(`Extraction failed:\n${fullText}`);

const pdf = await PDFDocument.load(await readFile(input));
const target = pdf.getPages()[0];
const font = await pdf.embedFont(StandardFonts.Helvetica);
const ink = rgb(0.03, 0.08, 0.13);
target.drawText("Test Department | 000-000-0000", { x: 50.5, y: 467, size: 11, font, color: ink });
target.drawText("123456", { x: 410, y: 467, size: 11, font, color: ink });
target.drawText("000", { x: 50.5, y: 427, size: 11, font, color: ink });
target.drawText("Test Supervisor | 00000000", { x: 50.5, y: 387, size: 11, font, color: ink });
target.drawText("08/24/2026", { x: 220, y: 289, size: 11, font, color: ink });
target.drawCircle({ x: 326.9, y: 594.3, size: 4.2, color: ink });
await writeFile(output, await pdf.save());

console.log(JSON.stringify({
  lastName: identity[1].trim(),
  firstName: identity[2].trim().split(/\s+/)[0],
  studentId: identity[3],
  awardTotal: award[1],
  payRate: rate[1],
  output,
}, null, 2));
