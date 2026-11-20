/* ==========================================================================
   QCPL Lost & Found — Excel export (.xlsx), no extra programs needed.

   Builds a real Excel workbook (Office Open XML) with one sheet per kind of
   record: Summary, Lost reports, Found items, Claims, Users, Staff, Activity,
   Feedback and Certificates. Header row in bold and frozen, filters on, sensible
   column widths, and real dates (Philippine time) that Excel can sort and filter.

   Never in the file: passwords (or their hashes), codes, sessions, photos.
   Text is always stored as text, so nothing in a cell is ever run as a formula.

   Used by the server (server/backend/api.mjs: /api/v1/admin/export.xlsx) and by
   the offline version (Reports page). Works in the browser and in Node.
   ========================================================================== */
(function (root) {
  "use strict";

  /* ---------- ZIP (an .xlsx file is a ZIP of XML files; stored, not compressed) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const utf8 = (s) => new TextEncoder().encode(s);
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = utf8(f.name), data = typeof f.data === "string" ? utf8(f.data) : f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0; for (const b of all) { out.set(b, p); p += b.length; }
    return out;
  }

  /* ---------- Cells ---------- */
  // Only characters XML allows; Excel's limit is 32,767 characters per cell
  const clean = (v) => String(v).replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, "").slice(0, 32000);
  const xml = (v) => clean(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const colName = (i) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  const PH = 8 * 3600_000; // Philippine time
  const serial = (v, dateOnly) => {
    if (!v) return null;
    const s = String(v);
    const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s + "T00:00:00Z") : Date.parse(s) + PH;
    if (!isFinite(t)) return null;
    const x = t / 86_400_000 + 25569;
    return dateOnly ? Math.floor(x) : x;
  };
  const STYLE = { text: 0, head: 1, date: 2, datetime: 3, num: 4, title: 5 };
  function cell(ref, value, type) {
    if (value === null || value === undefined || value === "") return "";
    if (type === "num" && isFinite(Number(value))) return `<c r="${ref}" s="${STYLE.num}"><v>${Number(value)}</v></c>`;
    if (type === "date" || type === "datetime") { const x = serial(value, type === "date"); if (x !== null) return `<c r="${ref}" s="${STYLE[type]}"><v>${x}</v></c>`; }
    return `<c r="${ref}" t="inlineStr"${type === "head" ? ` s="${STYLE.head}"` : type === "title" ? ` s="${STYLE.title}"` : ""}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }
  function sheetXml(columns, rows) {
    const last = colName(columns.length - 1);
    const head = `<row r="1">${columns.map((c, i) => cell(colName(i) + "1", c[0], "head")).join("")}</row>`;
    const body = rows.map((r, ri) => `<row r="${ri + 2}">${columns.map((c, i) => { let v; try { v = c[1](r); } catch { v = ""; } return cell(colName(i) + (ri + 2), v, c[2]); }).join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c[3] || 16}" customWidth="1"/>`).join("")}</cols>
<sheetData>${head}${body}</sheetData>
${rows.length ? `<autoFilter ref="A1:${last}${rows.length + 1}"/>` : ""}
</worksheet>`;
  }
  function summaryXml(lines) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="2" width="60" customWidth="1"/></cols>
<sheetData>${lines.map((l, i) => `<row r="${i + 1}">${cell("A" + (i + 1), l[0], i === 0 ? "title" : l[2] === "head" ? "head" : "text")}${cell("B" + (i + 1), l[1], l[2] === "num" ? "num" : l[2] === "datetime" ? "datetime" : "text")}</row>`).join("")}</sheetData></worksheet>`;
  }
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  /* ---------- The records, as sheets ---------- */
  const g = (k) => (typeof root[k] !== "undefined" ? root[k] : typeof globalThis[k] !== "undefined" ? globalThis[k] : undefined);
  function labels() {
    // In the browser and on the server these come from js/data.js
    let S = {}, C = [], L = [];
    try { S = STATUS; } catch {} try { C = CATEGORIES; } catch {} try { L = LIBRARIES; } catch {}
    void g;
    return {
      status: (kind, s) => (S[kind] && S[kind][s] ? S[kind][s].label : s || ""),
      cat: (id) => (C.find((c) => c.id === id) || {}).name || id || "",
      lib: (id) => (id === "all" ? "All libraries (head office)" : (L.find((l) => l.id === id) || {}).libraryName || id || ""),
    };
  }
  const yes = (b) => (b ? "Yes" : "No");
  const photos = (r) => (r.photos && r.photos.length) || (r.photo ? 1 : 0);
  function sheets(data, lab) {
    return [
      ["Lost reports", [
        ["Reference", (r) => r.id, "text", 20], ["Library", (r) => lab.lib(r.library), "text", 26], ["Branch", (r) => r.branch, "text", 26],
        ["Reported on", (r) => r.createdAt, "datetime", 17], ["Date lost", (r) => r.dateLost, "date", 12], ["Time of day", (r) => r.timeOfDay, "text", 14],
        ["Item", (r) => r.itemName, "text", 26], ["Type", (r) => lab.cat(r.category), "text", 18], ["Brand", (r) => r.brand, "text", 14], ["Color", (r) => r.color, "text", 12],
        ["Description", (r) => r.description, "text", 40], ["Special marks", (r) => r.uniqueDetails, "text", 34], ["Place", (r) => r.location, "text", 20],
        ["Floor", (r) => r.floor, "text", 12], ["Exact spot", (r) => r.locationDetail, "text", 24], ["Status", (r) => lab.status("lost", r.status), "text", 20],
        ["Owner", (r) => r.name, "text", 22], ["Phone", (r) => r.phone, "text", 15], ["Email", (r) => r.email, "text", 24], ["Contact by", (r) => r.contactPref, "text", 18],
        ["I am a", (r) => r.role, "text", 16], ["QCitizen ID / card no.", (r) => r.memberId, "text", 18], ["Needs assistance", (r) => yes(r.assist), "text", 10],
        ["Photos", photos, "num", 8], ["Account", (r) => r.userId, "text", 18],
      ], data.lost],
      ["Found items", [
        ["Item no.", (r) => r.id, "text", 20], ["Library", (r) => lab.lib(r.library), "text", 26], ["Branch", (r) => r.branch, "text", 26],
        ["Date found", (r) => r.date, "date", 12], ["Reported on", (r) => r.createdAt, "datetime", 17], ["Item", (r) => r.title, "text", 26], ["Type", (r) => lab.cat(r.category), "text", 18],
        ["Brand", (r) => r.brand, "text", 14], ["Color", (r) => r.color, "text", 12], ["Public description", (r) => r.description, "text", 36], ["Private details", (r) => r.privateDetails, "text", 36],
        ["Place", (r) => r.location, "text", 20], ["Floor", (r) => r.floor, "text", 12], ["Exact spot", (r) => r.locationDetail, "text", 24], ["Status", (r) => lab.status("found", r.status), "text", 22],
        ["Kept at (shelf/bin)", (r) => r.keptAt, "text", 16], ["Finder", (r) => r.finderName, "text", 22], ["Finder phone", (r) => r.finderPhone, "text", 15], ["Finder email", (r) => r.finderEmail, "text", 24],
        ["Finder is", (r) => r.finderRole, "text", 16], ["Handover", (r) => r.handover, "text", 24], ["Thank publicly", (r) => yes(r.publicThanks), "text", 10],
        ["Released to", (r) => r.release && r.release.releasedTo, "text", 22], ["ID shown", (r) => r.release && `${r.release.idType || ""}${r.release.idLast4 ? " ••" + r.release.idLast4 : ""}`, "text", 20],
        ["Released on", (r) => r.release && r.release.at, "datetime", 17], ["Released by", (r) => r.release && r.release.by, "text", 22],
        ["Donated / disposed", (r) => r.disposition && `${r.disposition.type}${r.disposition.note ? ": " + r.disposition.note : ""}`, "text", 24], ["Photos", photos, "num", 8],
      ], data.found],
      ["Claims", [
        ["Claim no.", (r) => r.id, "text", 20], ["Library", (r) => lab.lib(r.library), "text", 26], ["Item no.", (r) => r.itemId, "text", 20], ["Item", (r) => r.itemTitle, "text", 24],
        ["Claimed on", (r) => r.createdAt, "datetime", 17], ["Status", (r) => lab.status("claims", r.status), "text", 18], ["Claimant", (r) => r.name, "text", 22], ["Phone", (r) => r.phone, "text", 15],
        ["Email", (r) => r.email, "text", 24], ["How they described it", (r) => r.general, "text", 36], ["Details they gave", (r) => r.specific, "text", 36], ["Date lost", (r) => r.dateLost, "date", 12],
        ["Linked lost report", (r) => r.lostId, "text", 20], ["Pick-up", (r) => r.pickup && `${r.pickup.date} ${r.pickup.time}`, "text", 18], ["Staff note", (r) => r.reviewNote, "text", 30],
      ], data.claims],
      ["Users", [
        ["Account", (r) => r.id, "text", 22], ["Library", (r) => lab.lib(r.library), "text", 26], ["Name", (r) => r.name, "text", 24], ["Phone", (r) => r.phone, "text", 15], ["Email", (r) => r.email, "text", 26],
        ["I am a", (r) => r.role, "text", 16], ["QCitizen ID / card no.", (r) => r.memberId, "text", 18], ["ID checked at the desk", (r) => yes(r.verified), "text", 12],
        ["Mobile number confirmed", (r) => yes(r.contactVerified !== false), "text", 12], ["Active", (r) => yes(r.active !== false), "text", 8], ["Created", (r) => r.createdAt, "datetime", 17],
      ], data.users],
      ["Staff", [
        ["Username", (r) => r.username, "text", 18], ["Name", (r) => r.name, "text", 24], ["Role", (r) => r.role, "text", 14], ["Library", (r) => lab.lib(r.library), "text", 28],
        ["Active", (r) => yes(r.active !== false), "text", 8], ["Temporary password", (r) => yes(r.mustChange), "text", 12], ["Created", (r) => r.createdAt, "datetime", 17], ["Created by", (r) => r.createdBy, "text", 20],
      ], data.staff],
      ["Activity log", [
        ["When", (r) => r.at, "datetime", 17], ["Library", (r) => lab.lib(r.library), "text", 26], ["Who", (r) => r.actor, "text", 24], ["What", (r) => r.action, "text", 40],
        ["Reference", (r) => r.ref, "text", 20], ["Details", (r) => r.detail, "text", 50],
      ], data.activity],
      ["Feedback", [
        ["Reference", (r) => r.ref, "text", 20], ["Library", (r) => lab.lib(r.library), "text", 26], ["Ease (1-5)", (r) => r.ease, "num", 10], ["Satisfaction (1-5)", (r) => r.satisfaction, "num", 12],
        ["Comment", (r) => r.comment, "text", 50], ["When", (r) => r.at, "datetime", 17],
      ], data.feedback],
      ["Certificates", [
        ["Certificate no.", (r) => r.id, "text", 22], ["Library", (r) => lab.lib(r.library), "text", 26], ["Month", (r) => r.month, "text", 10], ["Name", (r) => r.name, "text", 24], ["Phone", (r) => r.phone, "text", 15],
        ["Lost reports", (r) => (r.lostIds || []).join(", "), "text", 30], ["Found items returned", (r) => (r.foundIds || []).join(", "), "text", 30], ["Issued", (r) => r.issuedAt, "datetime", 17], ["Issued by", (r) => r.issuedBy, "text", 22],
      ], data.contribs],
    ];
  }

  /** data: { lost, found, claims, users, staff, activity, feedback, contribs } (arrays). Returns the .xlsx file bytes. */
  function build(data, { scope = "", by = "", at = new Date().toISOString() } = {}) {
    const lab = labels();
    const SECRET = ["passHash", "hash"];
    const pickSafe = (list) => (list || []).map((r) => { const o = { ...r }; SECRET.forEach((k) => delete o[k]); return o; });
    const d = Object.fromEntries(["lost", "found", "claims", "users", "staff", "activity", "feedback", "contribs"].map((k) => [k, pickSafe(data[k])]));
    // Newest first
    d.lost.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    d.found.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    d.claims.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const list = sheets(d, lab);
    const summary = [
      ["QCPL Lost & Found — records", ""],
      ["Libraries", scope], ["Exported on", at, "datetime"], ["Exported by", by], ["", ""], ["What is in this file", "", "head"],
      ...list.map(([name, , rows]) => [name, rows.length, "num"]),
      ["", ""],
      ["Keep this file private", "It holds names, phone numbers and other personal details (Data Privacy Act of 2012). Store it only where authorized staff can open it, and delete copies you no longer need. It is a copy: changes made here do not change the website."],
      ["Not included", "Passwords, codes, sessions and photos."],
    ];
    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${[0, ...list.map((_, i) => i + 1)].map((i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
      { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>QCPL Lost &amp; Found records</dc:title><dc:creator>QCPL Lost &amp; Found</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${xml(at.slice(0, 19))}Z</dcterms:created></cp:coreProperties>` },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>
<sheet name="Summary" sheetId="1" r:id="rId1"/>${list.map(([name], i) => `<sheet name="${xml(name)}" sheetId="${i + 2}" r:id="rId${i + 2}"/>`).join("")}</sheets>
${(() => { const dn = list.map(([, cols, rows], i) => (rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i + 1}" hidden="1">'${xml(list[i][0])}'!$A$1:$${colName(cols.length - 1)}$${rows.length + 1}</definedName>` : "")).join(""); return dn ? `<definedNames>${dn}</definedNames>` : ""; })()}</workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[0, ...list.map((_, i) => i + 1)].map((i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}
<Relationship Id="rId${list.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", data: STYLES },
      { name: "xl/worksheets/sheet1.xml", data: summaryXml(summary) },
      ...list.map(([, cols, rows], i) => ({ name: `xl/worksheets/sheet${i + 2}.xml`, data: sheetXml(cols, rows) })),
    ];
    return zip(files);
  }

  const api = { build, MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  root.QCPL_XLSX = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
