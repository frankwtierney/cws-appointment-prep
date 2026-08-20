"use client";

import {
  Archive, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, ClipboardList, Download,
  FileCheck2, FileDown, Files, FileText, FolderLock, Plus, Save, Settings2, ShieldCheck,
  Sparkles, Trash2, Upload, Wrench, X,
} from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

type Status = "" | "NEW" | "RETURNING";
type StudentData = { lastName: string; firstName: string; studentId: string; awardTotal: string; payRate: string };
type EntryProfile = {
  id: string; name: string; departmentName: string; departmentPhone: string;
  entityCode: string; stateCheckSortCode: string; supervisorName: string;
  supervisorPersonNumber: string; designeeName: string; designeePersonNumber: string;
  defaultEndDate: string;
};
type LogEntry = StudentData & {
  id: string; appointmentStatus: Exclude<Status, "">; startDate: string; endDate: string;
  entryType: string; employeeTypes: "CWS"; status: "Active"; processedAt: string; fileName: string;
};
type LegacyLogEntry = Omit<Partial<LogEntry>, "status"> & { status?: string; firstDay?: string };
type FormMode = "single" | "batch";
type BatchItem = {
  id: string; fileName: string; fileSize: number; sourceBytes: Uint8Array | null;
  student: StudentData; status: Status; startDate: string; error: string;
};
type DocumentRecord = {
  id: string; sourceBytes: Uint8Array; completedBytes: Uint8Array;
  sourceFileName: string; completedFileName: string; updatedAt: string;
};

const EMPTY_STUDENT: StudentData = { lastName: "", firstName: "", studentId: "", awardTotal: "", payRate: "" };
const EMPTY_PROFILE: EntryProfile = {
  id: "", name: "", departmentName: "", departmentPhone: "", entityCode: "",
  stateCheckSortCode: "", supervisorName: "", supervisorPersonNumber: "",
  designeeName: "", designeePersonNumber: "", defaultEndDate: "",
};
const PROFILE_KEY = "fws-entry-profiles-v1";
const LOG_KEY = "fws-appointment-log-v1";
const DOCUMENT_DB = "fws-appointment-documents-v1";
const DOCUMENT_STORE = "documents";

function openDocumentDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DOCUMENT_DB, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(DOCUMENT_STORE)) request.result.createObjectStore(DOCUMENT_STORE, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Browser document storage could not be opened."));
  });
}
async function saveDocumentRecord(record: DocumentRecord) {
  const db = await openDocumentDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DOCUMENT_STORE, "readwrite");
    transaction.objectStore(DOCUMENT_STORE).put(record);
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
async function getDocumentRecord(id: string) {
  const db = await openDocumentDb();
  const result = await new Promise<DocumentRecord | undefined>((resolve, reject) => {
    const request = db.transaction(DOCUMENT_STORE, "readonly").objectStore(DOCUMENT_STORE).get(id);
    request.onsuccess = () => resolve(request.result as DocumentRecord | undefined); request.onerror = () => reject(request.error);
  });
  db.close(); return result;
}
async function deleteDocumentRecords(ids: string[]) {
  if (!ids.length) return;
  const db = await openDocumentDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DOCUMENT_STORE, "readwrite");
    const store = transaction.objectStore(DOCUMENT_STORE); ids.forEach((id) => store.delete(id));
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

function tidyCurrency(value: string) {
  const number = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(number) ? number.toFixed(2) : value.trim();
}
function formatDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${month}/${day}/${year}`;
}
function filePart(value: string) { return value.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9'-]/g, ""); }
function makeFileName(student: StudentData) {
  return `${filePart(student.lastName)}_${filePart(student.firstName.split(/\s+/)[0] || "")}_${filePart(student.studentId)}_CWS.pdf`;
}
function makeStudentFolderName(student: StudentData) {
  const folderPart = (value: string) => value.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").toUpperCase();
  return `${folderPart(student.lastName)}, ${folderPart(student.firstName)}`;
}
function uid() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function escapeCsv(value: string) {
  const safe = value.replace(/^[=+\-@]/, "'$&");
  return `"${safe.replace(/"/g, '""')}"`;
}
function makeLogCsv(entries: LogEntry[]) {
  const headers = ["lastName", "firstName", "studentid", "email", "role", "phone", "employeeTypes", "cwsAward", "centers", "status", "startDate", "endDate"];
  const rows = entries.map((item) => [
    item.lastName, item.firstName, item.studentId, "", "", "", item.employeeTypes,
    item.awardTotal, "", item.status, item.startDate, item.endDate,
  ]);
  return [headers, ...rows].map((row) => row.map((value) => escapeCsv(String(value))).join(",")).join("\r\n");
}
function makeLogCsvBytes(entries: LogEntry[]) {
  return new TextEncoder().encode(`\ufeff${makeLogCsv(entries)}`);
}

async function extractStudentData(bytes: Uint8Array): Promise<StudentData> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const document = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  if (document.numPages !== 1) throw new Error("This app currently expects the one-page UB FWS appointment form.");
  const metadata = await document.getMetadata();
  const subject = (metadata.info as { Subject?: string } | undefined)?.Subject ?? "";
  if (subject === "Completed Federal Work-Study Appointment Form") {
    throw new Error("This PDF was already completed by this app. Upload the original uncompleted FWS form to prevent duplicate text.");
  }
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  const positioned = content.items
    .filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item && "transform" in item)
    .map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
    .filter((item) => item.text);
  const rows: { y: number; items: typeof positioned }[] = [];
  positioned.sort((a, b) => b.y - a.y || a.x - b.x).forEach((item) => {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) < 2.5);
    if (row) row.items.push(item); else rows.push({ y: item.y, items: [item] });
  });
  const rowStrings = rows.map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" "));
  const fullText = rowStrings.join("\n");
  if (/THIS\s+FORM\s+EXPIRES\s+ON/i.test(fullText) || /2025\s*-\s*2026\s+Federal\s+Work-Study\s+Appointment\s+Form/i.test(fullText)) {
    throw new Error("This appears to be an expired 2025–26 appointment form. Request the current 2026–27 form from the student.");
  }
  const identityRow = rowStrings.find((row) => /\d{8}/.test(row) && row.includes(",")) ?? "";
  const identity = identityRow.match(/^\s*([^,]+),\s*(.+?)\s+(\d{8})\s*$/);
  const award = fullText.match(/Award\s*Amount\s*:\s*\$?\s*([\d,.]+)/i);
  const rate = fullText.match(/Hourly\s*Rate\s*:\s*\$?\s*([\d,.]+)/i);
  if (!identity) throw new Error("The student name and ID could not be read. Confirm this is the UB FWS appointment form.");
  return {
    lastName: identity[1].trim(), firstName: identity[2].trim().split(/\s+/)[0], studentId: identity[3],
    awardTotal: tidyCurrency(award?.[1] ?? ""), payRate: tidyCurrency(rate?.[1] ?? ""),
  };
}

function drawFittedText(
  page: import("pdf-lib").PDFPage, text: string,
  options: { x: number; y: number; maxWidth: number; size?: number; font: import("pdf-lib").PDFFont; color: import("pdf-lib").RGB },
) {
  if (!text.trim()) return;
  let size = options.size ?? 11;
  while (size > 7 && options.font.widthOfTextAtSize(text, size) > options.maxWidth) size -= 0.25;
  page.drawText(text, { x: options.x, y: options.y, size, font: options.font, color: options.color });
}

async function createCompletedPdf(
  sourceBytes: Uint8Array, student: StudentData, status: Exclude<Status, "">, firstDay: string, profile: EntryProfile,
) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.load(sourceBytes.slice());
  const page = pdf.getPages()[0];
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.03, 0.08, 0.13);
  drawFittedText(page, `${profile.departmentName} | ${profile.departmentPhone}`, { x: 50.5, y: 467, maxWidth: 345, font, color: ink });
  drawFittedText(page, profile.entityCode, { x: 410, y: 467, maxWidth: 145, font, color: ink });
  drawFittedText(page, profile.stateCheckSortCode, { x: 50.5, y: 427, maxWidth: 345, font, color: ink });
  drawFittedText(page, `${profile.supervisorName} | ${profile.supervisorPersonNumber}`, { x: 50.5, y: 387, maxWidth: 500, font, color: ink });
  drawFittedText(page, [profile.designeeName, profile.designeePersonNumber].filter(Boolean).join(" | "), { x: 50.5, y: 347, maxWidth: 500, font, color: ink });
  drawFittedText(page, formatDate(firstDay), { x: 220, y: 289, maxWidth: 145, font, color: ink, size: 11 });
  page.drawCircle({ x: status === "NEW" ? 146.9 : 326.9, y: 594.3, size: 4.2, color: ink });
  pdf.setTitle(makeFileName(student).replace(/\.pdf$/i, ""));
  pdf.setSubject("Completed Federal Work-Study Appointment Form");
  return pdf.save();
}

function Field({ label, value, onChange, placeholder, type = "text", required = false }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; required?: boolean;
}) {
  return <label className="field"><span>{label}{required && <em aria-hidden="true">*</em>}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} /></label>;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [profiles, setProfiles] = useState<EntryProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileDraft, setProfileDraft] = useState<EntryProfile | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [sourcePdfBytes, setSourcePdfBytes] = useState<Uint8Array | null>(null);
  const [student, setStudent] = useState<StudentData>(EMPTY_STUDENT);
  const [status, setStatus] = useState<Status>("");
  const [firstDay, setFirstDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generatedBlob, setGeneratedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [activeTab, setActiveTab] = useState<"form" | "log">("form");
  const [formMode, setFormMode] = useState<FormMode>("single");
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [batchDefaultStart, setBatchDefaultStart] = useState("");
  const [batchDefaultStatus, setBatchDefaultStatus] = useState<Status>("");
  const [batchZipBlob, setBatchZipBlob] = useState<Blob | null>(null);
  const [batchZipName, setBatchZipName] = useState("");
  const [includeStudentFolders, setIncludeStudentFolders] = useState(true);
  const [batchPreviewUrls, setBatchPreviewUrls] = useState<Record<string, string>>({});
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
  const [editingLogId, setEditingLogId] = useState("");

  useEffect(() => {
    try {
      const storedProfiles = (JSON.parse(localStorage.getItem(PROFILE_KEY) || "[]") as EntryProfile[])
        .map((profile) => ({ ...profile, defaultEndDate: profile.defaultEndDate ?? "" }));
      const storedLog = (JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as LegacyLogEntry[])
        .map((item): LogEntry => ({
          lastName: item.lastName ?? "", firstName: item.firstName ?? "", studentId: item.studentId ?? "",
          awardTotal: item.awardTotal ?? "", payRate: item.payRate ?? "", id: item.id ?? uid(),
          appointmentStatus: item.appointmentStatus ?? (item.status === "RETURNING" ? "RETURNING" : "NEW"),
          startDate: item.startDate ?? item.firstDay ?? "", endDate: item.endDate ?? "",
          entryType: item.entryType ?? "", employeeTypes: "CWS", status: "Active",
          processedAt: item.processedAt ?? new Date().toISOString(), fileName: item.fileName ?? "",
        }));
      // Restore device-local data after hydration; browser storage is unavailable during SSR.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfiles(storedProfiles); setSelectedProfileId(storedProfiles[0]?.id ?? ""); setLog(storedLog);
    } catch { setError("Saved browser data could not be loaded."); }
  }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === selectedProfileId) ?? null, [profiles, selectedProfileId]);
  const formReady = Boolean(file && sourcePdfBytes && selectedProfile?.defaultEndDate && status && firstDay && student.lastName && student.firstName && student.studentId && student.awardTotal && student.payRate);
  const activeBatchItem = batchItems[batchIndex] ?? null;
  const activeBatchPreviewUrl = activeBatchItem ? batchPreviewUrls[activeBatchItem.id] ?? "" : "";
  const previewableBatchIndexes = batchItems.map((item, index) => batchPreviewUrls[item.id] ? index : -1).filter((index) => index >= 0);
  const activePreviewPosition = previewableBatchIndexes.indexOf(batchIndex);
  const previousPreviewIndex = activePreviewPosition > 0 ? previewableBatchIndexes[activePreviewPosition - 1] : null;
  const nextPreviewIndex = activePreviewPosition >= 0 && activePreviewPosition < previewableBatchIndexes.length - 1 ? previewableBatchIndexes[activePreviewPosition + 1] : null;
  const duplicateBatchIds = useMemo(() => {
    const counts = new Map<string, number>();
    batchItems.forEach((item) => { if (item.student.studentId) counts.set(item.student.studentId, (counts.get(item.student.studentId) ?? 0) + 1); });
    return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
  }, [batchItems]);
  function batchIssue(item: BatchItem) {
    if (item.error) return item.error;
    if (!item.sourceBytes) return "The source PDF could not be read.";
    if (!item.student.lastName || !item.student.firstName || !item.student.studentId || !item.student.awardTotal || !item.student.payRate) return "Complete the required student details.";
    if (duplicateBatchIds.has(item.student.studentId)) return "This Student ID appears more than once in the batch.";
    if (!item.status) return "Choose New or Returning.";
    if (!item.startDate) return "Enter the First Day of Service.";
    return "";
  }
  const batchReadyItems = batchItems.filter((item) => !batchIssue(item));
  const hasUploadedForms = formMode === "single" ? Boolean(file) : batchItems.length > 0;
  const hasGeneratedOutput = formMode === "single" ? Boolean(generatedBlob) : Boolean(batchZipBlob);
  const selectedLogEntries = log.filter((item) => selectedLogIds.includes(item.id));
  function persistProfiles(next: EntryProfile[]) { setProfiles(next); localStorage.setItem(PROFILE_KEY, JSON.stringify(next)); }
  function persistLog(next: LogEntry[]) { setLog(next); localStorage.setItem(LOG_KEY, JSON.stringify(next)); }
  function clearGeneratedPdf() {
    setGeneratedBlob(null);
    setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ""; });
  }
  function clearBatchOutput() {
    setBatchZipBlob(null); setBatchZipName("");
    setBatchPreviewUrls((current) => { Object.values(current).forEach((url) => URL.revokeObjectURL(url)); return {}; });
  }
  function clearAllOutputs() { clearGeneratedPdf(); clearBatchOutput(); }
  function updateStudent(patch: Partial<StudentData>) { clearGeneratedPdf(); setStudent((current) => ({ ...current, ...patch })); }

  async function handleFile(nextFile?: File) {
    if (!nextFile) return;
    setError(""); setNotice(""); clearGeneratedPdf();
    if (nextFile.type !== "application/pdf" && !nextFile.name.toLowerCase().endsWith(".pdf")) { setError("Choose a PDF file."); return; }
    setBusy(true);
    try {
      const sourceBytes = new Uint8Array(await nextFile.arrayBuffer());
      const extracted = await extractStudentData(sourceBytes);
      setFile(nextFile); setSourcePdfBytes(sourceBytes); setStudent(extracted); setEditingLogId("");
      setNotice("Student details were read from the form. Please confirm them before creating the PDF.");
    } catch (caught) {
      setFile(null); setSourcePdfBytes(null); setStudent(EMPTY_STUDENT);
      setError(caught instanceof Error ? caught.message : "The PDF could not be read.");
    } finally { setBusy(false); }
  }

  async function handleBatchFiles(fileList?: FileList | File[], replaceExisting = false) {
    if (!fileList?.length) return;
    const existingCount = replaceExisting ? 0 : batchItems.length;
    const available = Math.max(0, 25 - existingCount);
    const incoming = Array.from(fileList).slice(0, available);
    if (!incoming.length) { setError("A batch can contain up to 25 forms."); return; }
    setBusy(true); setError(""); setNotice(""); clearBatchOutput();
    const parsed: BatchItem[] = [];
    for (const nextFile of incoming) {
      const base = { id: uid(), fileName: nextFile.name, fileSize: nextFile.size, status: replaceExisting ? "" as Status : batchDefaultStatus, startDate: replaceExisting ? "" : batchDefaultStart };
      if (nextFile.type !== "application/pdf" && !nextFile.name.toLowerCase().endsWith(".pdf")) {
        parsed.push({ ...base, sourceBytes: null, student: { ...EMPTY_STUDENT }, error: "This file is not a PDF." });
        continue;
      }
      const sourceBytes = new Uint8Array(await nextFile.arrayBuffer());
      try {
        const extracted = await extractStudentData(sourceBytes);
        parsed.push({ ...base, sourceBytes, student: extracted, error: "" });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "The PDF could not be read.";
        const manualEntryAllowed = message.includes("student name and ID could not be read");
        parsed.push({ ...base, sourceBytes: manualEntryAllowed ? sourceBytes : null, student: { ...EMPTY_STUDENT }, error: manualEntryAllowed ? "" : message });
      }
    }
    const startIndex = existingCount;
    setBatchItems((current) => replaceExisting ? parsed : [...current, ...parsed]); setBatchIndex(startIndex);
    if (replaceExisting) { setBatchDefaultStart(""); setBatchDefaultStatus(""); }
    const rejected = parsed.filter((item) => item.error).length;
    setNotice(`${parsed.length} form${parsed.length === 1 ? "" : "s"} added${rejected ? `; ${rejected} need review` : " and ready to review"}.`);
    if (incoming.length < Array.from(fileList).length) setError("Only the first available files were added because a batch is limited to 25 forms.");
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleAdaptiveFiles(fileList?: FileList | File[]) {
    if (!fileList?.length) return;
    const incoming = Array.from(fileList);
    if (incoming.length === 1) {
      setFormMode("single");
      await handleFile(incoming[0]);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    resetForm();
    setFormMode("batch");
    await handleBatchFiles(incoming, true);
  }

  async function addFormsToSingle(fileList?: FileList | File[]) {
    if (!fileList?.length || !file || !sourcePdfBytes) return;
    const existing: BatchItem = {
      id: uid(), fileName: file.name, fileSize: file.size, sourceBytes: sourcePdfBytes.slice(),
      student: { ...student }, status, startDate: firstDay, error: "",
    };
    const incoming = Array.from(fileList).slice(0, 24);
    setBusy(true); setError(""); setNotice(""); clearAllOutputs();
    try {
      const parsed: BatchItem[] = [];
      for (const nextFile of incoming) {
        const base = { id: uid(), fileName: nextFile.name, fileSize: nextFile.size, status, startDate: firstDay };
        if (nextFile.type !== "application/pdf" && !nextFile.name.toLowerCase().endsWith(".pdf")) {
          parsed.push({ ...base, sourceBytes: null, student: { ...EMPTY_STUDENT }, error: "This file is not a PDF." });
          continue;
        }
        const bytes = new Uint8Array(await nextFile.arrayBuffer());
        try {
          parsed.push({ ...base, sourceBytes: bytes, student: await extractStudentData(bytes), error: "" });
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "The PDF could not be read.";
          const manualEntryAllowed = message.includes("student name and ID could not be read");
          parsed.push({ ...base, sourceBytes: manualEntryAllowed ? bytes : null, student: { ...EMPTY_STUDENT }, error: manualEntryAllowed ? "" : message });
        }
      }
      setBatchItems([existing, ...parsed]); setBatchIndex(1); setBatchDefaultStart(firstDay); setBatchDefaultStatus(status);
      setFormMode("batch");
      const rejected = parsed.filter((item) => item.error).length;
      setNotice(`${parsed.length} additional form${parsed.length === 1 ? "" : "s"} added${rejected ? `; ${rejected} need review` : ""}. Your original form is now form 1 in the batch.`);
      if (incoming.length < Array.from(fileList).length) setError("Only the first 24 additional forms were added because a batch is limited to 25 forms.");
    } catch { setError("The additional forms could not be read."); }
    finally { setBusy(false); }
  }

  function updateBatchItem(patch: Partial<Omit<BatchItem, "id">>) {
    clearBatchOutput();
    setBatchItems((current) => current.map((item, index) => index === batchIndex ? { ...item, ...patch } : item));
  }
  function updateBatchStudent(patch: Partial<StudentData>) {
    if (!activeBatchItem) return;
    updateBatchItem({ student: { ...activeBatchItem.student, ...patch } });
  }
  function applyBatchDefaults() {
    clearBatchOutput();
    setBatchItems((current) => current.map((item) => ({ ...item, status: batchDefaultStatus || item.status, startDate: batchDefaultStart || item.startDate })));
    setNotice("The batch defaults were applied to every form. Individual forms can still be changed."); setError("");
  }
  function removeBatchItem() {
    if (!activeBatchItem) return;
    const next = batchItems.filter((item) => item.id !== activeBatchItem.id);
    setBatchItems(next); setBatchIndex(Math.min(batchIndex, Math.max(0, next.length - 1))); clearBatchOutput();
  }
  function resetBatch() {
    setBatchItems([]); setBatchIndex(0); setBatchDefaultStart(""); setBatchDefaultStatus(""); clearBatchOutput();
    setError(""); setNotice(""); if (inputRef.current) inputRef.current.value = "";
  }

  function openNewProfile() { setProfileDraft({ ...EMPTY_PROFILE, id: uid() }); }
  function saveProfile() {
    if (!profileDraft) return;
    if (!profileDraft.name.trim() || !profileDraft.defaultEndDate || !profileDraft.departmentName.trim() || !profileDraft.entityCode.trim() || !profileDraft.supervisorName.trim()) {
      setError("Complete the required Entry Type fields before saving."); return;
    }
    const next = profiles.some((profile) => profile.id === profileDraft.id)
      ? profiles.map((profile) => profile.id === profileDraft.id ? profileDraft : profile) : [...profiles, profileDraft];
    persistProfiles(next); setSelectedProfileId(profileDraft.id); clearAllOutputs(); setProfileDraft(null); setError(""); setNotice(`${profileDraft.name} is saved on this device.`);
  }
  function deleteProfile(profile: EntryProfile) {
    if (!window.confirm(`Delete the “${profile.name}” Entry Type from this device?`)) return;
    const next = profiles.filter((item) => item.id !== profile.id); persistProfiles(next); setSelectedProfileId(next[0]?.id ?? ""); clearAllOutputs(); setProfileDraft(null);
  }
  function exportProfiles() {
    if (!profiles.length) return;
    downloadBlob(new Blob([JSON.stringify({ version: 1, profiles }, null, 2)], { type: "application/json" }), "FWS_Entry_Types.json");
  }
  async function importProfiles(event: ChangeEvent<HTMLInputElement>) {
    const imported = event.target.files?.[0]; event.target.value = ""; if (!imported) return;
    try {
      const parsed = JSON.parse(await imported.text()) as { profiles?: EntryProfile[] };
      if (!Array.isArray(parsed.profiles)) throw new Error();
      const clean = parsed.profiles
        .filter((profile) => profile.id && profile.name && profile.departmentName)
        .map((profile) => ({ ...profile, defaultEndDate: profile.defaultEndDate ?? "" }));
      if (!clean.length) throw new Error();
      const byId = new Map(profiles.map((profile) => [profile.id, profile])); clean.forEach((profile) => byId.set(profile.id, profile));
      const next = [...byId.values()]; persistProfiles(next); setSelectedProfileId(clean[0].id); clearAllOutputs();
      setNotice(`${clean.length} Entry Type${clean.length === 1 ? "" : "s"} imported.`); setError("");
    } catch { setError("That file does not contain valid FWS Entry Types."); }
  }

  async function generatePdf() {
    if (!formReady || !sourcePdfBytes || !selectedProfile || !status) return;
    setBusy(true); setError("");
    try {
      const bytes = await createCompletedPdf(sourcePdfBytes, student, status, firstDay, selectedProfile);
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setGeneratedBlob(blob); setPreviewUrl(URL.createObjectURL(blob));
      setNotice("The HR-ready PDF is complete. Review the preview, then download it.");
      const key = `${student.studentId}-${firstDay}-${selectedProfile.id}`;
      const entry: LogEntry = {
        ...student, id: key, appointmentStatus: status, startDate: firstDay,
        endDate: selectedProfile.defaultEndDate, entryType: selectedProfile.name,
        employeeTypes: "CWS", status: "Active", processedAt: new Date().toISOString(),
        fileName: makeFileName(student),
      };
      persistLog([entry, ...log.filter((item) => item.id !== key && item.id !== editingLogId)]);
      try {
        await saveDocumentRecord({
          id: key, sourceBytes: sourcePdfBytes.slice(), completedBytes: new Uint8Array(bytes),
          sourceFileName: file?.name || entry.fileName, completedFileName: entry.fileName, updatedAt: new Date().toISOString(),
        });
      } catch { setNotice("The PDF is ready, but this browser could not retain it for later reopening from the log."); }
      if (editingLogId && editingLogId !== key) { try { await deleteDocumentRecords([editingLogId]); } catch { /* The replacement record is still available. */ } }
      setEditingLogId(key);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The completed PDF could not be created."); }
    finally { setBusy(false); }
  }

  async function downloadSingleOrganizedZip() {
    if (!generatedBlob || !selectedProfile || !status) return;
    setBusy(true); setError("");
    try {
      const { zipSync } = await import("fflate");
      const bytes = new Uint8Array(await generatedBlob.arrayBuffer());
      const fileName = makeFileName(student);
      const archive = {
        [fileName]: bytes,
        [`${makeStudentFolderName(student)}/${fileName}`]: bytes,
        "FWS_Appointment_Log.csv": makeLogCsvBytes([{
          ...student, id: editingLogId || `${student.studentId}-${firstDay}-${selectedProfile.id}`,
          appointmentStatus: status, startDate: firstDay, endDate: selectedProfile.defaultEndDate,
          entryType: selectedProfile.name, employeeTypes: "CWS", status: "Active",
          processedAt: new Date().toISOString(), fileName,
        }]),
      };
      downloadBlob(new Blob([new Uint8Array(zipSync(archive, { level: 6 }))], { type: "application/zip" }), fileName.replace(/\.pdf$/i, ".zip"));
      setNotice("The organized ZIP includes the PDF, student-folder copy, and CSV appointment log.");
    } catch { setError("The organized ZIP could not be created."); }
    finally { setBusy(false); }
  }

  async function previewBatchItem() {
    if (!activeBatchItem || batchIssue(activeBatchItem) || !activeBatchItem.sourceBytes || !activeBatchItem.status || !selectedProfile?.defaultEndDate) return;
    setBusy(true); setError("");
    try {
      const bytes = await createCompletedPdf(activeBatchItem.sourceBytes, activeBatchItem.student, activeBatchItem.status, activeBatchItem.startDate, selectedProfile);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
      setBatchPreviewUrls((current) => {
        if (current[activeBatchItem.id]) URL.revokeObjectURL(current[activeBatchItem.id]);
        return { ...current, [activeBatchItem.id]: url };
      });
      setNotice(`Preview created for ${activeBatchItem.student.firstName} ${activeBatchItem.student.lastName}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The preview could not be created."); }
    finally { setBusy(false); }
  }

  async function generateBatch() {
    if (!selectedProfile?.defaultEndDate || !batchReadyItems.length) return;
    setBusy(true); setError("");
    try {
      const { zipSync } = await import("fflate");
      const archive: Record<string, Uint8Array> = {};
      const previewUrls: Record<string, string> = {};
      const entries: LogEntry[] = [];
      let storageFailures = 0;
      for (const item of batchReadyItems) {
        if (!item.sourceBytes || !item.status) continue;
        const bytes = await createCompletedPdf(item.sourceBytes, item.student, item.status, item.startDate, selectedProfile);
        const fileName = makeFileName(item.student);
        archive[fileName] = new Uint8Array(bytes);
        if (includeStudentFolders) archive[`${makeStudentFolderName(item.student)}/${fileName}`] = new Uint8Array(bytes);
        previewUrls[item.id] = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
        const entry: LogEntry = {
          ...item.student, id: `${item.student.studentId}-${item.startDate}-${selectedProfile.id}`,
          appointmentStatus: item.status, startDate: item.startDate, endDate: selectedProfile.defaultEndDate,
          entryType: selectedProfile.name, employeeTypes: "CWS", status: "Active",
          processedAt: new Date().toISOString(), fileName,
        };
        entries.push(entry);
        try {
          await saveDocumentRecord({
            id: entry.id, sourceBytes: item.sourceBytes.slice(), completedBytes: new Uint8Array(bytes),
            sourceFileName: item.fileName, completedFileName: fileName, updatedAt: new Date().toISOString(),
          });
        } catch { storageFailures += 1; }
      }
      archive["FWS_Appointment_Log.csv"] = makeLogCsvBytes(entries);
      const zipped = zipSync(archive, { level: 6 });
      const dateLabel = batchDefaultStart || batchReadyItems[0]?.startDate || new Date().toISOString().slice(0, 10);
      const zipName = `CWS_Appointments_${dateLabel}.zip`;
      setBatchZipBlob(new Blob([new Uint8Array(zipped)], { type: "application/zip" })); setBatchZipName(zipName);
      setBatchPreviewUrls((current) => { Object.values(current).forEach((url) => URL.revokeObjectURL(url)); return previewUrls; });
      const entryIds = new Set(entries.map((entry) => entry.id));
      persistLog([...entries, ...log.filter((item) => !entryIds.has(item.id))]);
      const skipped = batchItems.length - entries.length;
      setNotice(`${entries.length} HR-ready PDF${entries.length === 1 ? "" : "s"} created${skipped ? `; ${skipped} form${skipped === 1 ? " was" : "s were"} skipped because they need review` : ""}${storageFailures ? `; ${storageFailures} could not be retained for later reopening` : ""}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The batch could not be created."); }
    finally { setBusy(false); }
  }

  function exportLogEntries(entries: LogEntry[], fileName: string) {
    downloadBlob(new Blob(["\ufeff", makeLogCsv(entries)], { type: "text/csv;charset=utf-8" }), fileName);
  }
  function exportLog() { exportLogEntries(log, "FWS_Appointment_Log.csv"); }
  function toggleLogSelection(id: string) {
    setSelectedLogIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  function toggleAllLogEntries() { setSelectedLogIds(selectedLogIds.length === log.length ? [] : log.map((item) => item.id)); }
  async function downloadSelectedPdfs() {
    if (!selectedLogEntries.length) return;
    setBusy(true); setError("");
    try {
      const records = (await Promise.all(selectedLogEntries.map((entry) => getDocumentRecord(entry.id)))).filter((record): record is DocumentRecord => Boolean(record));
      if (!records.length) { setError("PDFs are not available for these older log entries. Process their original forms again to enable PDF downloads."); return; }
      if (records.length === 1 && selectedLogEntries.length === 1) {
        downloadBlob(new Blob([new Uint8Array(records[0].completedBytes)], { type: "application/pdf" }), records[0].completedFileName);
      } else {
        const { zipSync } = await import("fflate");
        const archive: Record<string, Uint8Array> = {};
        records.forEach((record) => {
          let name = record.completedFileName; let copy = 2;
          while (archive[name]) { name = record.completedFileName.replace(/\.pdf$/i, `_${copy}.pdf`); copy += 1; }
          archive[name] = new Uint8Array(record.completedBytes);
        });
        const availableIds = new Set(records.map((record) => record.id));
        archive["FWS_Appointment_Log.csv"] = makeLogCsvBytes(selectedLogEntries.filter((entry) => availableIds.has(entry.id)));
        downloadBlob(new Blob([new Uint8Array(zipSync(archive, { level: 6 }))], { type: "application/zip" }), "CWS_Selected_Appointments.zip");
      }
      const unavailable = selectedLogEntries.length - records.length;
      setNotice(`${records.length} PDF${records.length === 1 ? "" : "s"} downloaded${unavailable ? `; ${unavailable} older entr${unavailable === 1 ? "y does" : "ies do"} not have a retained PDF` : ""}.`);
    } catch { setError("The selected PDFs could not be downloaded."); }
    finally { setBusy(false); }
  }
  async function deleteSelectedLogEntries() {
    if (!selectedLogEntries.length || !window.confirm(`Delete ${selectedLogEntries.length} selected appointment${selectedLogEntries.length === 1 ? "" : "s"} from this device?`)) return;
    const ids = [...selectedLogIds]; persistLog(log.filter((item) => !ids.includes(item.id))); setSelectedLogIds([]);
    try { await deleteDocumentRecords(ids); } catch { setNotice("The log entries were removed, but some locally retained PDF data could not be cleared."); }
  }
  async function reopenLogEntry(entry: LogEntry) {
    setBusy(true); setError("");
    try {
      const record = await getDocumentRecord(entry.id);
      if (!record) { setError("This older log entry does not include its source PDF. Upload the original form again to edit and re-export it."); return; }
      const source = new Uint8Array(record.sourceBytes); const completed = new Uint8Array(record.completedBytes);
      clearAllOutputs(); setActiveTab("form"); setFormMode("single"); setSelectedLogIds([]); setEditingLogId(entry.id);
      setFile(new File([source], record.sourceFileName, { type: "application/pdf" })); setSourcePdfBytes(source);
      setStudent({ lastName: entry.lastName, firstName: entry.firstName, studentId: entry.studentId, awardTotal: entry.awardTotal, payRate: entry.payRate });
      setStatus(entry.appointmentStatus); setFirstDay(entry.startDate);
      const matchingProfile = profiles.find((profile) => profile.name === entry.entryType);
      setSelectedProfileId(matchingProfile?.id ?? "");
      const blob = new Blob([completed], { type: "application/pdf" }); setGeneratedBlob(blob); setPreviewUrl(URL.createObjectURL(blob));
      setNotice(matchingProfile ? "The saved appointment is open for review or editing." : "The saved appointment is open. Choose or recreate its Entry Type before regenerating it.");
    } catch { setError("The saved appointment could not be reopened."); }
    finally { setBusy(false); }
  }
  function resetForm() {
    setFile(null); setSourcePdfBytes(null); setStudent(EMPTY_STUDENT); setStatus(""); setFirstDay(""); clearGeneratedPdf();
    setError(""); setNotice(""); setEditingLogId("");
    if (inputRef.current) inputRef.current.value = "";
  }
  async function removeLogEntry(entry: LogEntry) {
    if (!window.confirm(`Remove ${entry.firstName} ${entry.lastName} from the appointment log?`)) return;
    persistLog(log.filter((item) => item.id !== entry.id));
    setSelectedLogIds((current) => current.filter((id) => id !== entry.id));
    try { await deleteDocumentRecords([entry.id]); } catch { /* The visible log row is still removed. */ }
  }

  return (
    <main>
      <header className="app-header"><div className="header-inner">
        <div className="brand"><div className="brand-mark" aria-hidden="true"><Wrench size={22} strokeWidth={2.5} /></div><div><p>Supervision &amp; Administration Tools</p><h1>CWS Appointment Builder</h1></div></div>
        <button className="privacy-pill" onClick={() => document.getElementById("privacy-note")?.scrollIntoView({ behavior: "smooth" })}><ShieldCheck size={17} /> Processed only in this browser</button>
      </div></header>

      <div className="page-shell">
        <section className="intro"><div><span className="eyebrow"><Sparkles size={15} /> Faster appointment preparation</span><h2>CWS Appointment Prep</h2><p>Upload the student’s form, confirm the extracted details, choose an Entry Type, and download the completed file with the required name.</p></div>
          <div className="step-strip" aria-label="Three-step process"><span className={hasUploadedForms ? "complete" : "active"}><b>{hasUploadedForms ? <Check size={15} /> : "1"}</b> Upload</span><i /><span className={hasGeneratedOutput ? "complete" : hasUploadedForms ? "active" : ""}><b>{hasGeneratedOutput ? <Check size={15} /> : "2"}</b> Confirm</span><i /><span className={hasGeneratedOutput ? "active" : ""}><b>3</b> Download</span></div>
        </section>

        {(error || notice) && <div className={`message ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{error ? <CircleAlert size={19} /> : <Check size={19} />}<span>{error || notice}</span><button aria-label="Dismiss message" onClick={() => { setError(""); setNotice(""); }}><X size={17} /></button></div>}

        <div className="navigation-row"><nav className="workspace-tabs" aria-label="Appointment workspace">
          <button className={activeTab === "form" ? "active" : ""} onClick={() => setActiveTab("form")} aria-current={activeTab === "form" ? "page" : undefined}><FileText size={18} /><span>Appointment Form</span></button>
          <button className={activeTab === "log" ? "active" : ""} onClick={() => setActiveTab("log")} aria-current={activeTab === "log" ? "page" : undefined}><ClipboardList size={18} /><span>Appointment Log</span><b>{log.length}</b></button>
        </nav></div>

        {activeTab === "form" ? <>
        <div className="workspace-grid"><section className="main-column">
          <article className="card upload-card"><div className="card-heading"><div><span className="step-number">1</span><div><h3>Upload appointment forms</h3><p>Add one form or up to 25; the workspace adapts automatically.</p></div></div>{hasUploadedForms && <button className="text-button" onClick={formMode === "single" ? resetForm : resetBatch}>Start over</button>}</div>
            {!hasUploadedForms ? <label className={`drop-zone ${dragging ? "dragging" : ""}`} onDragOver={(event: DragEvent) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event: DragEvent) => { event.preventDefault(); setDragging(false); void handleAdaptiveFiles(event.dataTransfer.files); }} aria-disabled={busy}>
              <span className="upload-icon">{busy ? <span className="spinner" /> : <Upload size={26} />}</span><strong>{busy ? "Reading the form…" : "Drop one or more appointment forms here"}</strong><small>or click to choose up to 25 PDFs</small><em>PDF · one page · UB FWS format</em>
              <input ref={inputRef} className="file-input" type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={(event) => void handleAdaptiveFiles(event.target.files ?? undefined)} />
            </label> : formMode === "single" && file ? <div className="file-chip"><span><FileCheck2 size={22} /></span><div><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(0)} KB · Student details extracted</small></div><div className="single-upload-actions"><Check size={20} /><label className="secondary-button add-files"><Plus size={16} /> Add more forms<input type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={(event) => void addFormsToSingle(event.target.files ?? undefined)} /></label></div></div>
            : <div className="batch-upload-summary"><div><span><Files size={23} /></span><div><strong>{batchItems.length} form{batchItems.length === 1 ? "" : "s"} loaded</strong><small>{batchReadyItems.length} currently ready · {batchItems.length - batchReadyItems.length} need review</small></div></div><label className="secondary-button add-files"><Plus size={16} /> Add forms<input type="file" accept="application/pdf,.pdf" multiple disabled={busy || batchItems.length >= 25} onChange={(event) => void handleBatchFiles(event.target.files ?? undefined)} /></label></div>}
          </article>

          {formMode === "single" && file && <article className="card details-card"><div className="card-heading"><div><span className="step-number">2</span><div><h3>Confirm appointment details</h3><p>Correct anything that was not read accurately.</p></div></div></div>
            <div className="field-grid three"><Field label="Last Name" value={student.lastName} onChange={(value) => updateStudent({ lastName: value })} required /><Field label="First Name" value={student.firstName} onChange={(value) => updateStudent({ firstName: value })} required /><Field label="Student ID" value={student.studentId} onChange={(value) => updateStudent({ studentId: value.replace(/\D/g, "").slice(0, 8) })} required /></div>
            <div className="field-grid three lower-fields"><Field label="Award Total" value={student.awardTotal} onChange={(value) => updateStudent({ awardTotal: value })} required /><Field label="Pay Rate" value={student.payRate} onChange={(value) => updateStudent({ payRate: value })} required /><Field label="First Day of Service" value={firstDay} onChange={(value) => { clearGeneratedPdf(); setFirstDay(value); }} type="date" required /></div>
            <fieldset className="status-fieldset"><legend>Appointment Status <em>*</em></legend><div className="segmented"><label className={status === "NEW" ? "selected" : ""}><input type="radio" name="status" value="NEW" checked={status === "NEW"} onChange={() => { clearGeneratedPdf(); setStatus("NEW"); }} /><span><b>New</b><small>Fills “New FWS Student”</small></span><i /></label><label className={status === "RETURNING" ? "selected" : ""}><input type="radio" name="status" value="RETURNING" checked={status === "RETURNING"} onChange={() => { clearGeneratedPdf(); setStatus("RETURNING"); }} /><span><b>Returning</b><small>Fills “Reappointed FWS Student”</small></span><i /></label></div></fieldset>
          </article>}

          {formMode === "batch" && activeBatchItem && <article className="card details-card"><div className="card-heading batch-heading"><div><span className="step-number">2</span><div><h3>Confirm appointment details</h3><p>{activeBatchItem.fileName}</p></div></div><div className="form-navigator"><button className="icon-button" disabled={batchIndex === 0} onClick={() => setBatchIndex((current) => Math.max(0, current - 1))} aria-label="Previous form"><ChevronLeft size={19} /></button><strong>{batchIndex + 1} / {batchItems.length}</strong><button className="icon-button" disabled={batchIndex === batchItems.length - 1} onClick={() => setBatchIndex((current) => Math.min(batchItems.length - 1, current + 1))} aria-label="Next form"><ChevronRight size={19} /></button><button className="row-delete" onClick={removeBatchItem} aria-label="Remove current form" title="Remove current form"><Trash2 size={17} /></button></div></div>
            <section className="batch-defaults" aria-label="Batch defaults"><div><Field label="Default First Day of Service" value={batchDefaultStart} onChange={setBatchDefaultStart} type="date" /><label className="default-status"><span>Default Appointment Status</span><div><button className={batchDefaultStatus === "NEW" ? "selected" : ""} onClick={() => setBatchDefaultStatus("NEW")}>New</button><button className={batchDefaultStatus === "RETURNING" ? "selected" : ""} onClick={() => setBatchDefaultStatus("RETURNING")}>Returning</button></div></label></div><button className="secondary-button" disabled={!batchDefaultStart && !batchDefaultStatus} onClick={applyBatchDefaults}>Apply defaults to all</button></section>
            <div className="batch-review-label"><span>Reviewing form {batchIndex + 1}</span><b>{activeBatchItem.student.lastName || activeBatchItem.student.firstName ? `${activeBatchItem.student.lastName}, ${activeBatchItem.student.firstName}` : "Student details needed"}</b></div>
            <div className="field-grid three"><Field label="Last Name" value={activeBatchItem.student.lastName} onChange={(value) => updateBatchStudent({ lastName: value })} required /><Field label="First Name" value={activeBatchItem.student.firstName} onChange={(value) => updateBatchStudent({ firstName: value })} required /><Field label="Student ID" value={activeBatchItem.student.studentId} onChange={(value) => updateBatchStudent({ studentId: value.replace(/\D/g, "").slice(0, 8) })} required /></div>
            <div className="field-grid three lower-fields"><Field label="Award Total" value={activeBatchItem.student.awardTotal} onChange={(value) => updateBatchStudent({ awardTotal: value })} required /><Field label="Pay Rate" value={activeBatchItem.student.payRate} onChange={(value) => updateBatchStudent({ payRate: value })} required /><Field label="First Day of Service" value={activeBatchItem.startDate} onChange={(value) => updateBatchItem({ startDate: value })} type="date" required /></div>
            <fieldset className="status-fieldset"><legend>Appointment Status <em>*</em></legend><div className="segmented"><label className={activeBatchItem.status === "NEW" ? "selected" : ""}><input type="radio" name={`batch-status-${activeBatchItem.id}`} value="NEW" checked={activeBatchItem.status === "NEW"} onChange={() => updateBatchItem({ status: "NEW" })} /><span><b>New</b><small>Fills “New FWS Student”</small></span><i /></label><label className={activeBatchItem.status === "RETURNING" ? "selected" : ""}><input type="radio" name={`batch-status-${activeBatchItem.id}`} value="RETURNING" checked={activeBatchItem.status === "RETURNING"} onChange={() => updateBatchItem({ status: "RETURNING" })} /><span><b>Returning</b><small>Fills “Reappointed FWS Student”</small></span><i /></label></div></fieldset>
            <div className="batch-validation-row"><div className={`batch-validation ${batchIssue(activeBatchItem) ? "needs-review" : "ready"}`}>{batchIssue(activeBatchItem) ? <><CircleAlert size={17} /><span>{batchIssue(activeBatchItem)}</span></> : <><Check size={17} /><span>This form is ready for batch generation.</span></>}</div><button className="secondary-button" disabled={Boolean(batchIssue(activeBatchItem)) || !selectedProfile?.defaultEndDate || busy} onClick={() => void previewBatchItem()}><FileText size={16} /> {activeBatchPreviewUrl ? "Refresh preview" : "Preview this form"}</button></div>
          </article>}

          {formMode === "single" && file && <article className="card action-card"><div><span className="step-number">3</span><div><h3>Create the completed PDF</h3><p>{formReady ? `Ready to create ${makeFileName(student)}` : "Complete the required details and choose an Entry Type."}</p></div></div><button className="primary-button" disabled={!formReady || busy} onClick={() => void generatePdf()}>{busy ? <span className="spinner small" /> : <FileDown size={19} />}Create HR-ready PDF</button></article>}
          {formMode === "batch" && batchItems.length > 0 && <article className="card action-card"><div><span className="step-number">3</span><div><h3>Create the completed batch</h3><p>{selectedProfile?.defaultEndDate ? `${batchReadyItems.length} of ${batchItems.length} forms are ready. Forms needing review will be skipped.` : "Choose an Entry Type with a default end date."}</p><label className="zip-option"><input type="checkbox" checked={includeStudentFolders} onChange={(event) => { clearBatchOutput(); setIncludeStudentFolders(event.target.checked); }} /><span><b>Also create student folders</b><small>Duplicates each PDF inside an all-caps LAST NAME, FIRST NAME folder.</small></span></label></div></div><button className="primary-button" disabled={!selectedProfile?.defaultEndDate || !batchReadyItems.length || busy} onClick={() => void generateBatch()}>{busy ? <span className="spinner small" /> : <Archive size={19} />}Create {batchReadyItems.length} PDF{batchReadyItems.length === 1 ? "" : "s"}</button></article>}
        </section>

        <aside className="side-column"><article className="card profile-card"><div className="card-heading compact"><div><span className="icon-box"><Settings2 size={19} /></span><div><h3>Entry Type</h3><p>Saved department information</p></div></div></div>
          {profiles.length ? <><label className="select-label"><span>Apply Entry Type</span><div><select value={selectedProfileId} onChange={(event) => { clearAllOutputs(); setSelectedProfileId(event.target.value); }}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><ChevronDown size={17} /></div></label>
            {selectedProfile && <div className="profile-summary"><strong>{selectedProfile.departmentName}</strong><p>{selectedProfile.departmentPhone || "No phone entered"}</p><dl><div><dt>Entity code</dt><dd>{selectedProfile.entityCode}</dd></div><div><dt>Default end date</dt><dd className={selectedProfile.defaultEndDate ? "" : "missing"}>{selectedProfile.defaultEndDate || "Not set - edit profile"}</dd></div><div><dt>Supervisor</dt><dd>{selectedProfile.supervisorName}</dd></div></dl><button className="secondary-button" onClick={() => setProfileDraft({ ...selectedProfile })}>Edit Entry Type</button></div>}
            </>
            : <div className="empty-profile"><span><FolderLock size={23} /></span><strong>No Entry Types yet</strong><p>Save your department information once, then reuse it for each appointment.</p><button className="secondary-button" onClick={openNewProfile}><Plus size={17} /> Create Entry Type</button></div>}
          <div className="profile-utilities">{profiles.length > 0 && <button onClick={openNewProfile}><Plus size={15} /> New</button>}<button disabled={!profiles.length} onClick={exportProfiles}><Download size={15} /> Export</button><button onClick={() => importRef.current?.click()}><Upload size={15} /> Import</button></div>
          <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importProfiles(event)} />
        </article>

          {formMode === "single" && generatedBlob && previewUrl && <article className="card ready-card"><span><FileCheck2 size={24} /></span><h3>PDF ready</h3><p>{makeFileName(student)}</p><button className="primary-button full" onClick={() => downloadBlob(generatedBlob, makeFileName(student))}><Download size={18} /> Download completed PDF</button><button className="secondary-button full organized-zip-button" disabled={busy} onClick={() => void downloadSingleOrganizedZip()}><Archive size={17} /> Download organized ZIP</button><small className="batch-ready-note">Includes a duplicate inside an all-caps student folder</small><a href={previewUrl} target="_blank" rel="noreferrer">Open full-size preview</a></article>}
          {formMode === "batch" && batchZipBlob && <div className="ready-stack"><article className="card ready-card"><span><Archive size={24} /></span><h3>Batch ready</h3><p>{batchZipName}</p><button className="primary-button full" onClick={() => downloadBlob(batchZipBlob, batchZipName)}><Download size={18} /> Download ZIP</button><small className="batch-ready-note">{batchReadyItems.length} PDF{batchReadyItems.length === 1 ? "" : "s"}{includeStudentFolders ? " • folders" : ""} • CSV included</small></article><article className="card box-upload-card"><span><FolderLock size={25} /></span><div><h3>Upload to UB BOX</h3><p>Upload the PDFs to the secure folder.</p></div><a className="primary-button full" href="https://buffalo.app.box.com/f/46965e074fb640d096695c50a03446ea" target="_blank" rel="noreferrer"><Upload size={18} /> Open UB Box</a></article></div>}

        </aside></div>

        {formMode === "single" && previewUrl && <section className="preview-section"><div className="preview-heading"><div><span>Completed document</span><h3>PDF preview</h3></div><button className="secondary-button" onClick={() => generatedBlob && downloadBlob(generatedBlob, makeFileName(student))}><Download size={17} /> Download</button></div><iframe src={previewUrl} title="Completed FWS appointment form preview" /></section>}
        {formMode === "batch" && activeBatchItem && activeBatchPreviewUrl && <section className="preview-section"><div className="preview-heading batch-preview-heading"><div><span>Completed preview</span><h3>{activeBatchItem.student.lastName}, {activeBatchItem.student.firstName}</h3></div><div className="preview-navigator" aria-label="Batch PDF preview navigation"><button className="icon-button" disabled={previousPreviewIndex === null} onClick={() => previousPreviewIndex !== null && setBatchIndex(previousPreviewIndex)} aria-label="Previous PDF preview"><ChevronLeft size={20} /></button><strong>{batchIndex + 1} / {batchItems.length}</strong><button className="icon-button" disabled={nextPreviewIndex === null} onClick={() => nextPreviewIndex !== null && setBatchIndex(nextPreviewIndex)} aria-label="Next PDF preview"><ChevronRight size={20} /></button></div><a className="secondary-button" href={activeBatchPreviewUrl} download={makeFileName(activeBatchItem.student)}><Download size={17} /> Download this PDF</a></div><iframe src={activeBatchPreviewUrl} title={`Completed FWS appointment form preview for ${activeBatchItem.student.firstName} ${activeBatchItem.student.lastName}`} /></section>}
        </> : <section className="card log-workspace">
          <div className="log-workspace-heading"><div><span className="icon-box"><ClipboardList size={20} /></span><div><h3>Appointment Log</h3><p>{log.length} completed appointment{log.length === 1 ? "" : "s"} saved on this device.</p></div></div><button className="primary-button" disabled={!log.length} onClick={exportLog}><Download size={18} /> Export all CSV</button></div>
          {selectedLogEntries.length > 0 && <div className="selection-toolbar"><strong>{selectedLogEntries.length} selected</strong><div><button className="secondary-button" disabled={busy} onClick={() => void downloadSelectedPdfs()}><FileDown size={16} /> Download PDF{selectedLogEntries.length === 1 ? "" : "s"}</button><button className="secondary-button" onClick={() => exportLogEntries(selectedLogEntries, "CWS_Selected_Appointments.csv")}><Download size={16} /> Export CSV</button><button className="delete-selected-button" onClick={() => void deleteSelectedLogEntries()}><Trash2 size={16} /> Delete selected</button></div></div>}
          {log.length ? <div className="log-table-wrap"><table className="log-table"><thead><tr><th className="select-column"><input ref={(node) => { if (node) node.indeterminate = selectedLogIds.length > 0 && selectedLogIds.length < log.length; }} type="checkbox" checked={selectedLogIds.length === log.length} onChange={toggleAllLogEntries} aria-label={selectedLogIds.length === log.length ? "Deselect all appointments" : "Select all appointments"} /></th><th>Student</th><th>Student ID</th><th>Appointment</th><th>Entry Type</th><th>Award Total</th><th>Start Date</th><th>End Date</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{log.map((item) => <tr key={item.id} className={selectedLogIds.includes(item.id) ? "selected-row" : ""}><td className="select-column"><input type="checkbox" checked={selectedLogIds.includes(item.id)} onChange={() => toggleLogSelection(item.id)} aria-label={`Select ${item.firstName} ${item.lastName}`} /></td><td><button className="student-link" onClick={() => void reopenLogEntry(item)}>{item.lastName}, {item.firstName}</button></td><td>{item.studentId}</td><td><span className="status-badge neutral">{item.appointmentStatus === "NEW" ? "New" : "Returning"}</span></td><td>{item.entryType || "—"}</td><td>${tidyCurrency(item.awardTotal)}</td><td>{item.startDate}</td><td>{item.endDate || "—"}</td><td><span className="status-badge active">{item.status}</span></td><td><button className="row-delete" onClick={() => void removeLogEntry(item)} aria-label={`Remove ${item.firstName} ${item.lastName} from log`} title="Remove row"><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>
          : <div className="log-empty-state"><span><ClipboardList size={28} /></span><h3>No appointments yet</h3><p>Create an HR-ready PDF from the Appointment Form tab and it will appear here.</p><button className="secondary-button" onClick={() => setActiveTab("form")}>Go to Appointment Form</button></div>}
        </section>}
        <footer id="privacy-note"><ShieldCheck size={21} /><div><strong>Your documents stay on this device.</strong><p>PDF processing, Entry Types, and the appointment log remain inside this browser. Nothing is sent to a server by this app.</p></div></footer>
      </div>

      {profileDraft && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileDraft(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <div className="modal-header"><div><span className="icon-box"><Settings2 size={20} /></span><div><p>Reusable department profile</p><h2 id="profile-title">{profiles.some((profile) => profile.id === profileDraft.id) ? "Edit Entry Type" : "Create Entry Type"}</h2></div></div><button className="icon-button" onClick={() => setProfileDraft(null)} aria-label="Close"><X size={21} /></button></div>
        <div className="modal-body"><div className="field-grid two"><Field label="Entry Type Name" value={profileDraft.name} onChange={(value) => setProfileDraft({ ...profileDraft, name: value })} placeholder="e.g., Student Success Centers" required /><Field label="Default End Date" value={profileDraft.defaultEndDate} onChange={(value) => setProfileDraft({ ...profileDraft, defaultEndDate: value })} type="date" required /></div><div className="field-grid two"><Field label="Department Name" value={profileDraft.departmentName} onChange={(value) => setProfileDraft({ ...profileDraft, departmentName: value })} required /><Field label="Department Phone" value={profileDraft.departmentPhone} onChange={(value) => setProfileDraft({ ...profileDraft, departmentPhone: value })} placeholder="716-645-0000" /></div><div className="field-grid two"><Field label="Department / Entity Code" value={profileDraft.entityCode} onChange={(value) => setProfileDraft({ ...profileDraft, entityCode: value })} required /><Field label="State Check Sort Code" value={profileDraft.stateCheckSortCode} onChange={(value) => setProfileDraft({ ...profileDraft, stateCheckSortCode: value })} /></div>
          <div className="form-divider"><span>Supervisor</span></div><div className="field-grid two"><Field label="Supervisor Name" value={profileDraft.supervisorName} onChange={(value) => setProfileDraft({ ...profileDraft, supervisorName: value })} required /><Field label="Supervisor Person Number" value={profileDraft.supervisorPersonNumber} onChange={(value) => setProfileDraft({ ...profileDraft, supervisorPersonNumber: value.replace(/\D/g, "").slice(0, 8) })} /></div>
          <div className="form-divider"><span>Designee (optional)</span></div><div className="field-grid two"><Field label="Designee Name" value={profileDraft.designeeName} onChange={(value) => setProfileDraft({ ...profileDraft, designeeName: value })} /><Field label="Designee Person Number" value={profileDraft.designeePersonNumber} onChange={(value) => setProfileDraft({ ...profileDraft, designeePersonNumber: value.replace(/\D/g, "").slice(0, 8) })} /></div>
        </div>
        <div className="modal-footer">{profiles.some((profile) => profile.id === profileDraft.id) && <button className="delete-button" onClick={() => deleteProfile(profileDraft)}><Trash2 size={17} /> Delete</button>}<div><button className="secondary-button" onClick={() => setProfileDraft(null)}>Cancel</button><button className="primary-button" onClick={saveProfile}><Save size={18} /> Save Entry Type</button></div></div>
      </section></div>}
    </main>
  );
}
