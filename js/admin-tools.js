/* ==========================================================================
   QCPL Lost & Found — extra administrator pages
     • Reports   — monthly report per library: print / save as PDF / download for Excel
     • Old items — items past the holding period: donate, dispose or extend
     • Posters   — printable library poster with a QR code to the portal
   Loaded before js/admin.js, which adds these to the administrator menu.
   ========================================================================== */
window.LF_ADMIN_PAGES = (function () {
  "use strict";

  const monthLabel = (key) => new Date(key + "-01T00:00:00").toLocaleDateString("en-PH", { month: "long", year: "numeric" });
  function lastMonths(n) {
    const out = [], d = new Date();
    for (let i = 0; i < n; i++) { const m = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`); }
    return out;
  }
  const simpleTable = (cols, rows, empty) => rows.length
    ? `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<p class="muted">${empty}</p>`;

  /* ---------------- Monthly report ---------------- */
  function pageReports(query) {
    const { esc, icon, cat, fmtDate } = UI;
    const months = lastMonths(12);
    const key = months.includes(query.get("m")) ? query.get("m") : months[0];
    const r = LF.monthlyReport(key);
    const staff = LF.currentStaff();
    const tile = (n, label) => `<li><strong>${n}</strong><span>${label}</span></li>`;
    const countRows = (pairs, nameOf) => pairs.map(([k, v]) => `<tr><th scope="row">${esc(nameOf(k))}</th><td>${v}</td></tr>`);

    AdminShell.shell("reports", `
      <div class="no-print">
        <h1 class="staff-h1">Monthly report</h1>
        <form class="filters filters--staff" id="reportF">
          <div class="field"><label for="reportM">Month</label><select class="select" id="reportM">
            ${months.map((m) => `<option value="${m}" ${m === key ? "selected" : ""}>${esc(monthLabel(m))}</option>`).join("")}</select></div>
          <div class="btn-row" style="align-self:end">
            <button type="button" class="btn btn--primary" id="reportPrint">${icon("i-print")} Print / Save as PDF</button>
            <button type="button" class="btn btn--outline" id="reportCsv">${icon("i-doc")} This month (CSV)</button>
          </div>
        </form>
        ${LF.isSupervisor() ? `<div class="card" style="margin:1rem 0">
          <h2 class="h3">All records in Excel</h2>
          <p class="muted" style="margin-top:0">One workbook with a sheet each for lost reports, found items, claims, users, staff, the activity log, feedback and certificates. It holds personal details: keep it where only authorized staff can open it, and delete copies you no longer need. Passwords and photos are never included. Every export is written in the activity log.</p>
          <div class="btn-row">
            <button type="button" class="btn btn--primary" data-xlsx="${esc(activeLibrary().id)}">${icon("i-doc")} ${esc(LIBRARY.libraryName)} (.xlsx)</button>
            ${LF.currentStaff().library === "all" && LF.online ? `<button type="button" class="btn btn--outline" data-xlsx="all">${icon("i-doc")} All libraries (.xlsx)</button>` : ""}
          </div><p id="xlsxMsg" role="status" class="muted"></p></div>` : ""}
      </div>

      <article class="report" id="reportDoc">
        <header class="report__head">
          <div><p class="report__org">Quezon City Public Library · ${esc(LIBRARY.libraryName)}</p>
            <h2>Lost &amp; Found Report — ${esc(monthLabel(key))}</h2>
            <p class="muted">Prepared ${esc(fmtDate(new Date().toISOString()))} by ${esc(staff.name)}</p></div>
        </header>

        <ul class="kpis report__kpis">
          ${tile(r.lost.length, "Lost items reported")}${tile(r.found.length, "Found items turned in")}
          ${tile(r.returned.length, "Items returned to owners")}${tile(r.avgDays || "—", "Average days to return")}
          ${tile(`${r.claimsApproved} / ${r.claimsRejected}`, "Claims approved / not approved")}${tile(r.unclaimedNow.length, "Unclaimed items at the office now")}
          ${tile(r.disposed.length, "Items donated or disposed")}${tile(r.feedback.count ? `${r.feedback.satisfaction} / 5` : "—", `Satisfaction (${r.feedback.count} ${r.feedback.count === 1 ? "answer" : "answers"})`)}
        </ul>

        <div class="dash-grid">
          <section><h3>Lost reports by type of item</h3>${simpleTable(["Type", "Reports"], countRows(r.byCategory, (k) => cat(k).name), "No lost reports this month.")}</section>
          <section><h3>Lost reports by place</h3>${simpleTable(["Place", "Reports"], countRows(r.byLocation, (k) => k), "No lost reports this month.")}</section>
        </div>

        <section><h3>Items returned this month</h3>
          ${simpleTable(["Returned", "Item no.", "Item", "Released to", "ID shown", "Days kept", "Released by"], r.returned.map((f) => `<tr>
            <td>${esc(fmtDate(f.release.at))}</td><th scope="row" class="mono">${esc(f.id)}</th><td>${esc(f.title)}</td><td>${esc(f.release.releasedTo)}</td>
            <td>${esc(f.release.idType)}</td><td>${Math.max(0, Math.round((new Date(f.release.at.slice(0, 10)) - new Date(f.date)) / 86400000))}</td><td>${esc(f.release.by)}</td></tr>`), "No items were returned this month.")}</section>

        <section><h3>Unclaimed items at the office (as of today)</h3>
          ${simpleTable(["Found", "Item no.", "Item", "Place", "Days kept", "Kept until"], r.unclaimedNow.map((f) => `<tr>
            <td>${esc(fmtDate(f.date))}</td><th scope="row" class="mono">${esc(f.id)}</th><td>${esc(f.title)}</td><td>${esc(f.branch || f.location)}</td>
            <td>${LF.daysHeld(f)}</td><td>${esc(fmtDate(LF.heldUntil(f)))}${LF.daysLeft(f) < 0 ? ' <span class="flag">Past limit</span>' : ""}</td></tr>`), "No unclaimed items.")}</section>

        ${r.disposed.length ? `<section><h3>Donated or disposed this month</h3>${simpleTable(["Date", "Item no.", "Item", "Action", "Approved by"], r.disposed.map((f) => `<tr>
          <td>${esc(fmtDate(f.disposition.at))}</td><th scope="row" class="mono">${esc(f.id)}</th><td>${esc(f.title)}</td><td>${f.disposition.type === "donated" ? "Donated" : "Disposed"}${f.disposition.note ? ` — ${esc(f.disposition.note)}` : ""}</td><td>${esc(f.disposition.by)}</td></tr>`), "")}</section>` : ""}

        <section><h3>Feedback from owners</h3>
          ${r.feedback.count ? `<p>Ease of reporting and claiming: <strong>${r.feedback.ease} / 5</strong> · Satisfaction: <strong>${r.feedback.satisfaction} / 5</strong> · ${r.feedback.count} ${r.feedback.count === 1 ? "answer" : "answers"}</p>
            ${r.feedback.recent.length ? `<ul>${r.feedback.recent.map((x) => `<li>"${esc(x.comment)}"</li>`).join("")}</ul>` : ""}` : `<p class="muted">No feedback this month.</p>`}</section>

        <footer class="report__sign"><div><span></span>Prepared by: ${esc(staff.name)}</div><div><span></span>Noted by: Librarian-in-Charge</div></footer>
      </article>`);

    UI.$("#reportM").addEventListener("change", (e) => UI.go(`#/staff/reports?m=${e.target.value}`));
    UI.$("#reportPrint").addEventListener("click", () => window.print());
    UI.$("#reportCsv").addEventListener("click", () => downloadCsv(`QCPL-LostFound-${LIBRARY.code}-${key}.csv`, reportCsv(r, key)));
    UI.$$("[data-xlsx]").forEach((b) => b.addEventListener("click", () => exportExcel(b.dataset.xlsx, b)));
  }

  /* All records in Excel: made by the server (checked and logged there), or here in the offline version */
  async function exportExcel(library, btn) {
    const msg = UI.$("#xlsxMsg");
    btn.disabled = true; msg.textContent = "Preparing the file…";
    try {
      if (LF.online) {
        const res = await fetch(`/api/v1/admin/export.xlsx?library=${encodeURIComponent(library)}`, { credentials: "same-origin", cache: "no-store" });
        if (!res.ok) { let e = {}; try { e = await res.json(); } catch {} throw new Error(e.error || "The file could not be made. Please try again."); }
        const name = (/filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "") || [])[1] || "QCPL-Lost-and-Found.xlsx";
        saveBlob(await res.blob(), name);
      } else {
        const all = (k) => LF.db.all(k);
        const bytes = QCPL_XLSX.build({ lost: all("lost"), found: all("found"), claims: all("claims"), users: all("users"), staff: all("staff"), activity: all("activity"), feedback: all("feedback"), contribs: all("contribs") },
          { scope: LIBRARY.libraryName, by: LF.currentStaff().name });
        saveBlob(new Blob([bytes], { type: QCPL_XLSX.MIME }), `QCPL-Lost-and-Found-${activeLibrary().id}-${new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)}.xlsx`); // Philippine date
      }
      msg.textContent = "Downloaded. Open it with Excel.";
    } catch (err) { msg.textContent = err.message; }
    finally { btn.disabled = false; }
  }
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function reportCsv(r, key) {
    const { cat, fmtDate } = UI;
    const rows = [
      ["Quezon City Public Library — Lost & Found Report"], ["Library", LIBRARY.libraryName], ["Month", monthLabel(key)], [],
      ["SUMMARY"], ["Lost items reported", r.lost.length], ["Found items turned in", r.found.length], ["Items returned", r.returned.length],
      ["Average days to return", r.avgDays], ["Claims approved", r.claimsApproved], ["Claims not approved", r.claimsRejected],
      ["Unclaimed items now", r.unclaimedNow.length], ["Donated or disposed", r.disposed.length],
      ["Feedback answers", r.feedback.count], ["Ease (1-5)", r.feedback.ease], ["Satisfaction (1-5)", r.feedback.satisfaction], [],
      ["LOST REPORTS BY TYPE"], ...r.byCategory.map(([k, v]) => [cat(k).name, v]), [],
      ["LOST REPORTS BY PLACE"], ...r.byLocation.map(([k, v]) => [k, v]), [],
      ["LOST REPORTS"], ["Reference", "Date lost", "Item", "Type", "Library", "Place", "Status"],
      ...r.lost.map((l) => [l.id, l.dateLost, l.itemName, cat(l.category).name, l.branch || "", l.location, STATUS.lost[l.status].label]), [],
      ["FOUND ITEMS"], ["Item no.", "Date found", "Item", "Type", "Library", "Place", "Status"],
      ...r.found.map((f) => [f.id, f.date, f.title, cat(f.category).name, f.branch || "", f.location, STATUS.found[f.status].label]), [],
      ["ITEMS RETURNED"], ["Returned", "Item no.", "Item", "Released to", "ID shown", "Released by"],
      ...r.returned.map((f) => [fmtDate(f.release.at), f.id, f.title, f.release.releasedTo, f.release.idType, f.release.by]),
    ];
    // Cells starting with = + - @ are prefixed so Excel never runs them as formulas
    const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return rows.map((row) => row.map(cell).join(",")).join("\r\n");
  }
  function downloadCsv(name, text) {
    const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" })); // BOM so Excel reads accents
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    UI.announce("Report downloaded");
  }

  /* ---------------- Old items: donate / dispose / extend ---------------- */
  function pageOldItems() {
    const { esc, icon, fmtDate } = UI;
    const due = LF.disposalList();
    const soon = LF.db.all("found").filter((f) => ["recorded", "possible-owner", "claimed"].includes(f.status) && LF.daysLeft(f) >= 0 && LF.daysLeft(f) <= LIBRARY.remindDaysBefore);
    const done = LF.db.all("found").filter((f) => f.disposition).sort((a, b) => b.disposition.at.localeCompare(a.disposition.at)).slice(0, 20);
    AdminShell.shell("olditems", `
      <h1 class="staff-h1">Old items</h1>
      <p class="muted">Items are kept for ${LIBRARY.holdDays} days. People with a possible match or an open claim are reminded automatically ${LIBRARY.remindDaysBefore} days before the limit. Nothing is removed until you approve it here.</p>

      <h2 class="h3" style="margin-top:1.25rem">Past the holding period — needs your decision (${due.length})</h2>
      ${simpleTable(["Item no.", "Item", "Found", "Days kept", "Possible owners", "Decision"], due.map((f) => `<tr>
        <th scope="row" class="mono">${esc(f.id)}</th><td>${esc(f.title)}<br><span class="muted">${esc(f.branch || f.location)}</span></td><td>${esc(fmtDate(f.date))}</td>
        <td>${LF.daysHeld(f)} <span class="flag">${-LF.daysLeft(f)} over</span></td><td>${LF.matchesForFound(f, { includePrivate: true }).length}</td>
        <td><div class="btn-row">
          ${LF.isSupervisor() ? `<button type="button" class="btn btn--primary btn--sm" data-dispose="${esc(f.id)}|donated">Donate</button>
          <button type="button" class="btn btn--outline btn--sm" data-dispose="${esc(f.id)}|disposed">Dispose</button>` : `<span class="muted">A supervisor decides</span>`}
          <button type="button" class="btn btn--outline btn--sm" data-extend="${esc(f.id)}">Keep 15 more days</button>
          ${AdminShell.openBtn("found", f.id)}
        </div></td></tr>`), "No items are past the holding period. 🎉")}

      <h2 class="h3" style="margin-top:1.5rem">Reaching the limit soon (${soon.length})</h2>
      ${simpleTable(["Item no.", "Item", "Kept until", "Days left", "Reminder"], soon.map((f) => `<tr>
        <th scope="row" class="mono">${esc(f.id)}</th><td>${esc(f.title)}</td><td>${esc(fmtDate(LF.heldUntil(f)))}</td><td>${LF.daysLeft(f)}</td>
        <td>${(f.remindedRefs || []).length ? `<span class="status status--green">Sent to ${f.remindedRefs.length}</span>` : '<span class="status status--gray">No one to remind</span>'}</td></tr>`), "No items are close to the limit.")}

      <h2 class="h3" style="margin-top:1.5rem">Donated or disposed</h2>
      ${simpleTable(["Date", "Item no.", "Item", "Action", "Approved by"], done.map((f) => `<tr>
        <td>${esc(fmtDate(f.disposition.at))}</td><th scope="row" class="mono">${esc(f.id)}</th><td>${esc(f.title)}</td>
        <td>${f.disposition.type === "donated" ? "Donated" : "Disposed"}${f.disposition.note ? ` — ${esc(f.disposition.note)}` : ""}</td><td>${esc(f.disposition.by)}</td></tr>`), "Nothing yet.")}`);

    UI.$$("[data-dispose]").forEach((b) => b.addEventListener("click", async () => {
      const [id, type] = b.dataset.dispose.split("|");
      const note = prompt(type === "donated" ? "Donated to (for example: barangay, charity drive):" : "Reason for disposal (for example: damaged, perishable):", "");
      if (note === null) return;
      b.disabled = true;
      try { await LF.disposeItem(id, type, note.trim()); } catch (err) { b.disabled = false; alert(err.message); return; }
      UI.announce(type === "donated" ? "Item marked as donated" : "Item marked as disposed");
      pageOldItems();
    }));
    UI.$$("[data-extend]").forEach((b) => b.addEventListener("click", async () => { b.disabled = true; try { await LF.extendHold(b.dataset.extend, 15); } catch (err) { b.disabled = false; return alert(err.message); } UI.announce("Holding period extended by 15 days"); pageOldItems(); }));
  }

  /* ---------------- Library poster with QR code ---------------- */
  const SITE_KEY = "qcpllf_site_url";
  function pagePosters() {
    const { esc, icon } = UI;
    const hosted = /^https?:$/.test(location.protocol) && !/^(localhost|127\.|\[::1\])/.test(location.hostname);
    let saved = ""; try { saved = localStorage.getItem(SITE_KEY) || ""; } catch {}
    const base = saved || (hosted ? location.origin + location.pathname : "");
    const link = base ? `${base.replace(/#.*$/, "")}#/portal/${activeLibrary().id}` : "";

    AdminShell.shell("posters", `
      <div class="no-print">
        <h1 class="staff-h1">Posters &amp; QR codes</h1>
        <p class="muted">Print this poster and put it near the entrance, the baggage counter and the reading area. Scanning the QR code opens the ${esc(LIBRARY.libraryName)} portal.</p>
        <form class="filters filters--staff" id="posterF">
          <div class="field"><label for="siteUrl">Website address of this system</label>
            <p class="hint">The address people will open, for example https://qcpl.quezoncity.gov.ph/lost-and-found — the QR code is made from it.</p>
            <input class="input" id="siteUrl" type="url" value="${esc(base)}" placeholder="https://" /></div>
          <div class="btn-row" style="align-self:end">
            <button type="submit" class="btn btn--outline">Update QR code</button>
            <button type="button" class="btn btn--primary" id="posterPrint" ${link ? "" : "disabled"}>${icon("i-print")} Print poster</button>
          </div>
        </form>
        ${link ? "" : `<div class="alert alert--warn">${icon("i-info")}<p>Type the website address first. This copy is opened from a computer file or a test address, so there is no public address to put in the QR code yet.</p></div>`}
      </div>

      <article class="poster" id="poster">
        <p class="poster__mark">Quezon City Public Library</p>
        <p class="poster__org">Lost &amp; Found · ${esc(LIBRARY.libraryName)}</p>
        <h2>Lost something?<br /><em>Found something?</em></h2>
        <p class="poster__lead">Scan the code to open the QCPL Lost &amp; Found.</p>
        <div class="poster__qr">${link ? UI.qrSvg(link, 6) : '<p class="muted">QR code appears here</p>'}</div>
        ${link ? `<p class="poster__url">${esc(link)}</p>` : ""}
        <ol class="poster__steps"><li><strong>Report</strong> what you lost or found</li><li><strong>Get matched</strong> automatically</li><li><strong>Claim</strong> it with a valid ID</li></ol>
        <p class="poster__foot">${esc(LIBRARY.deskLocation)} · ${esc(LIBRARY.hours)} · ${esc(LIBRARY.phone)}</p>
      </article>`);

    UI.$("#posterF").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = UI.$("#siteUrl").value.trim();
      if (v && !/^https?:\/\//i.test(v)) { UI.$("#siteUrl").focus(); UI.announce("The address should start with https://"); return; }
      try { v ? localStorage.setItem(SITE_KEY, v) : localStorage.removeItem(SITE_KEY); } catch {}
      pagePosters();
    });
    UI.$("#posterPrint").addEventListener("click", () => window.print());
  }

  /* ---------------- Monthly Certificates of Contribution ----------------
     Lists everyone with reports in the chosen month. The administrator checks
     the reports and their outcomes, then issues the certificate. */
  function pageRecognition(query) {
    const { esc, icon } = UI;
    const months = lastMonths(12);
    const key = months.includes(query.get("m")) ? query.get("m") : months[0];
    const people = LF.contributionCandidates(key);
    const ready = people.filter((p) => p.qualifies && !p.cert).length;
    const refs = (kind, list) => list.length ? list.map((x) => `<button type="button" class="linklike mono" data-open="${kind}:${esc(x.id)}">${esc(x.id)}</button> <span class="muted">${esc(kind === "lost" ? x.itemName : x.title)} · ${esc(STATUS[kind][x.status].label)}</span>`).join("<br>") : '<span class="muted">—</span>';
    AdminShell.shell("recognition", `
      <h1 class="staff-h1">Certificates of Contribution</h1>
      <p class="muted">Given monthly to people with at least ${CONTRIB_MIN} lost reports of their own that month, or at least ${CONTRIB_MIN} found items returned to their owners that month. <strong>Open each report to check it is genuine before issuing.</strong> Lost reports you closed are not counted. Certificates are normally issued after the month ends.</p>
      <form class="filters filters--staff" id="recF">
        <div class="field"><label for="recM">Month</label><select class="select" id="recM">
          ${months.map((m) => `<option value="${m}" ${m === key ? "selected" : ""}>${esc(monthLabel(m))}${m === months[0] ? " (this month, still running)" : ""}</option>`).join("")}</select></div>
      </form>
      <p><strong>${ready}</strong> ${ready === 1 ? "person qualifies" : "people qualify"} and ${ready === 1 ? "has" : "have"} not been issued a certificate for ${esc(monthLabel(key))}.</p>
      ${simpleTable(["Person", "Lost reports this month", "Found items returned this month", "Qualifies", "Certificate"], people.map((p) => `<tr>
        <th scope="row">${esc(p.name)}<br><span class="muted">${esc(p.phone)}${p.userId ? " · has an account" : " · guest"}</span></th>
        <td><strong>${p.lost.length}</strong><br>${refs("lost", p.lost)}</td>
        <td><strong>${p.found.length}</strong><br>${refs("found", p.found)}</td>
        <td>${p.qualifies ? '<span class="status status--green">Yes</span>' : `<span class="status status--gray">Not yet</span>`}</td>
        <td>${p.cert ? `<span class="muted">Issued ${esc(UI.fmtDate(p.cert.issuedAt))}<br>by ${esc(p.cert.issuedBy)}</span><br><a href="#/contribution/${encodeURIComponent(p.cert.id)}">${icon("i-award")} View / print</a>`
          : p.qualifies ? `<button type="button" class="btn btn--primary btn--sm" data-issue="${esc(p.key)}">${icon("i-award")} Issue certificate<span class="sr-only"> to ${esc(p.name)}</span></button>` : '<span class="muted">—</span>'}</td></tr>`),
        `Nobody reported a lost item or had a found item returned in ${esc(monthLabel(key))}.`)}`);
    UI.$("#recM").addEventListener("change", (e) => UI.go(`#/staff/recognition?m=${e.target.value}`));
    UI.$$("[data-issue]").forEach((b) => b.addEventListener("click", async () => {
      const p = people.find((x) => x.key === b.dataset.issue);
      if (!confirm(`Issue a Certificate of Contribution for ${monthLabel(key)} to ${p.name}?\n\nOnly continue if you have checked their reports (${p.lost.length} lost, ${p.found.length} found and returned).`)) return;
      b.disabled = true;
      try { await LF.issueContribution(key, p.key); UI.announce("Certificate issued"); } catch (err) { alert(err.message); }
      pageRecognition(query);
    }));
  }

  /* ---------------- Backups (head administrator, with the server) ----------------
     Encrypted backups: the server makes them every day; only the recovery passphrase opens them.
     Here: turn them on, back up now, download a copy to keep elsewhere, upload one, test one, restore. */
  const csrf = () => (window.LF_REMOTE_STATE && window.LF_REMOTE_STATE.csrf) || "";
  async function backupApi(path, body, raw) {
    const res = await fetch("/api/v1/admin/backups" + path, body === undefined && !raw ? { credentials: "same-origin", cache: "no-store" }
      : { method: "POST", credentials: "same-origin", headers: raw ? { "Content-Type": "application/octet-stream", "X-CSRF": csrf() } : { "Content-Type": "application/json", "X-CSRF": csrf() }, body: raw || JSON.stringify(body) });
    let data = {}; try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  const kindOf = (b) => !b.encrypted ? "Not encrypted" : b.damaged ? "Damaged" : /before-restore/.test(b.name) ? "Safety copy (before a restore)" : /uploaded/.test(b.name) ? "Uploaded" : /manual/.test(b.name) ? "Made by hand" : /converted/.test(b.name) ? "Older copy, now encrypted" : "Daily";
  async function pageBackups() {
    const { esc, icon, fmtDateTime } = UI;
    const staff = LF.currentStaff();
    if (!LF.online) { AdminShell.shell("backups", `<h1 class="staff-h1">Backups</h1><p>Backups are made by the server. This copy of the site runs without a server, so its records stay in this browser.</p>`); return; }
    if (!staff || staff.library !== "all" || !LF.isSupervisor()) { AdminShell.shell("backups", `<h1 class="staff-h1">Backups</h1><p>Only the head administrator can manage backups.</p>`); return; }
    AdminShell.shell("backups", `<h1 class="staff-h1">Backups</h1><p class="muted">Loading…</p>`);
    let info;
    try { info = await backupApi(""); } catch (err) { UI.$("#staffMain").innerHTML = `<h1 class="staff-h1">Backups</h1><div class="alert alert--error" role="alert">${icon("i-info")}<p>${esc(err.message)}</p></div>`; return; }
    const pw = (id, label, hint, auto = "current-password") => `<div class="field"><label for="${id}">${label}</label>${hint ? `<p class="hint">${hint}</p>` : ""}<input class="input" type="password" id="${id}" autocomplete="${auto}" maxlength="200" /></div>`;
    const rows = info.list.map((b) => `<tr>
        <th scope="row">${esc(fmtDateTime(b.created))}</th><td>${esc(kindOf(b))}</td><td>${esc(size(b.size))}</td>
        <td>${b.counts ? esc(`${b.counts.lost || 0} lost, ${b.counts.found || 0} found, ${b.counts.claims || 0} claims, ${b.counts.users || 0} users, ${b.counts.photos || 0} photos`) : "—"}</td>
        <td><div class="btn-row">${b.encrypted && !b.damaged ? `<a class="btn btn--outline btn--sm" href="/api/v1/admin/backups/download?name=${encodeURIComponent(b.name)}" download>Download</a>
          <button type="button" class="btn btn--outline btn--sm" data-bk-test="${esc(b.name)}">Test</button>
          <button type="button" class="btn btn--outline btn--sm danger" data-bk-restore="${esc(b.name)}">Restore…</button>` : ""}</div></td></tr>`);
    UI.$("#staffMain").innerHTML = `
      <h1 class="staff-h1">Backups</h1>
      ${info.enabled
        ? `<div class="alert alert--info">${icon("i-shield")}<div><p><strong>Encrypted backups are on.</strong> The server makes one every day and keeps the newest 14${info.copyFolder ? `, and also copies each one off this computer to <strong>${esc(info.copyFolder)}</strong>` : ""}. Only the recovery passphrase opens them.</p>${info.copyFolder ? "" : `<p><strong>No copy is kept off this computer.</strong> If its drive fails, the backups are lost too. Set BACKUP_COPY_DIR in server/.env, or press Download now and then.</p>`}<p class="muted" style="margin:0">Key: ${esc(info.key.fingerprint)} · set ${esc(fmtDateTime(info.key.changed))}</p><p style="margin:.6rem 0 0"><button type="button" class="btn btn--outline btn--sm" id="bkSheet">${icon("i-print")} Print the recovery sheet</button></p></div></div>`
        : `<div class="alert alert--warn">${icon("i-info")}<div><p><strong>Backups are not encrypted yet.</strong> Anyone who gets a copy of a backup could read every report and account. Choose a recovery passphrase below to lock them.${info.copyFolder ? ` Once they are locked, each backup is also copied off this computer to <strong>${esc(info.copyFolder)}</strong>. Unlocked backups are never copied there.` : ""}</p></div></div>`}
      <div class="btn-row" style="margin:1rem 0">
        <button type="button" class="btn btn--primary" id="bkNow">${icon("i-check")} Back up now</button>
        <label class="btn btn--outline" for="bkFile">Upload a backup file…</label><input type="file" id="bkFile" accept=".qcplbak" class="sr-only" />
      </div>
      <div id="bkMsg" role="status"></div>
      ${!info.enabled ? `<form class="card" id="bkOn" style="margin:1rem 0">
        <h2 class="h3">Turn on encrypted backups</h2>
        <p>Choose a <strong>recovery passphrase</strong>: at least ${info.passphraseMin} characters — a short sentence of 4 or more words is best (for example, a line only you would think of). <strong>Write it on paper and keep it somewhere safe, away from this computer.</strong> Without it, no backup can be opened — by anyone.</p>
        ${pw("bkP1", "Recovery passphrase", "", "new-password")}<p class="hint" id="bkStrength" aria-live="polite"></p>${pw("bkP2", "Type it again", "", "new-password")}${pw("bkPw", "Your password", "To confirm it's you. It must be different from the recovery passphrase.")}
        <button type="submit" class="btn btn--primary">${icon("i-shield")} Turn on encrypted backups</button></form>` : ""}
      <h2 class="h3" style="margin-top:1.5rem">Backups on this server</h2>
      ${simpleTable(["Made", "Kind", "Size", "Contents", ""], rows, "No backups yet. Press Back up now.")}
      <p class="muted">Keep a copy somewhere else too: press <strong>Download</strong> now and then and save it on a USB drive or the city's backup storage. A downloaded backup stays locked; it opens only with the recovery passphrase.</p>
      ${info.enabled ? `<details class="card" style="margin-top:1rem"><summary><strong>Change the recovery passphrase</strong></summary>
        <form id="bkChange" style="margin-top:1rem"><p class="muted">Backups made before the change still open with the old passphrase; new ones with the new passphrase.</p>
        ${pw("bkOld", "Current recovery passphrase")}${pw("bkN1", "New recovery passphrase", "At least 16 characters.", "new-password")}${pw("bkN2", "Type the new one again", "", "new-password")}${pw("bkCPw", "Your password")}
        <button type="submit" class="btn btn--primary">Change it</button></form></details>
      <details class="card" style="margin-top:1rem"><summary><strong>I forgot the recovery passphrase</strong></summary>
        <form id="bkReset" style="margin-top:1rem"><div class="alert alert--warn">${icon("i-info")}<p>Backups already made <strong>can't be opened</strong> without the old passphrase — nobody can unlock them. You can start new backups with a new passphrase; the site and its data are not affected.</p></div>
        ${pw("bkR1", "New recovery passphrase", "At least 16 characters.", "new-password")}${pw("bkR2", "Type it again", "", "new-password")}${pw("bkRPw", "Your password")}
        <button type="submit" class="btn btn--outline danger">Start new backups with a new passphrase</button></form></details>` : ""}`;
    const say = (ok, t) => (UI.$("#bkMsg").innerHTML = `<div class="alert ${ok ? "alert--info" : "alert--error"}" role="alert">${icon(ok ? "i-check" : "i-info")}<p>${esc(t)}</p></div>`);
    const busy = async (btn, work) => { btn.disabled = true; try { await work(); } catch (err) { say(false, err.message); } finally { if (btn.isConnected) btn.disabled = false; } };
    UI.$("#bkNow").addEventListener("click", (e) => busy(e.currentTarget, async () => { const r = await backupApi("/now", {}); await pageBackups(); say(true, `Backup made${r.encrypted ? " (encrypted)" : " — not encrypted yet"}.`); }));
    UI.$("#bkFile").addEventListener("change", (e) => busy(UI.$("#bkNow"), async () => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      say(true, "Uploading…"); await backupApi("/upload", undefined, f); await pageBackups(); say(true, "The backup file was uploaded. You can test it or restore it from the list.");
    }));
    const on = UI.$("#bkOn");
    on && on.addEventListener("submit", (e) => { e.preventDefault(); busy(on.querySelector("button"), async () => {
      await backupApi("/passphrase", { passphrase: UI.$("#bkP1").value, passphrase2: UI.$("#bkP2").value, password: UI.$("#bkPw").value });
      await pageBackups(); say(true, "Encrypted backups are on. Older backups were locked too. Now print the recovery sheet and write the passphrase on it by hand.");
      recoverySheet();
    }); });
    // How good the passphrase is, while typing (nothing is sent)
    const p1 = UI.$("#bkP1");
    p1 && p1.addEventListener("input", () => {
      const v = p1.value, words = v.trim().split(/\s+/).filter((w) => w.length > 1).length;
      UI.$("#bkStrength").textContent = !v ? "" : v.length < info.passphraseMin ? `${info.passphraseMin - v.length} more characters needed.` : words < 4 ? "Long enough. 4 or more words make it stronger and easier to remember." : "Good: long, with several words.";
    });
    /* A sheet to print and keep with the passphrase (written by hand, never typed into a file) */
    function recoverySheet() {
      const k = info.key || {};
      const old = document.getElementById("recoverySheet"); if (old) old.remove();
      const el = document.createElement("div");
      el.id = "recoverySheet";
      el.innerHTML = `<h1>QCPL Lost &amp; Found - Backup recovery sheet</h1>
        <p><strong>Keep this sheet in a locked place, away from the server computer</strong> (for example a sealed envelope in the head office safe). Whoever has the passphrase can open every backup.</p>
        <table><tr><th>Key ID</th><td>${esc(k.fingerprint || "(print again after turning backups on)")}</td></tr>
          <tr><th>Encrypted backups turned on</th><td>${esc(k.created ? fmtDateTime(k.created) : "")}${k.changed && k.changed !== k.created ? " · passphrase changed " + esc(fmtDateTime(k.changed)) : ""}</td></tr>
          <tr><th>Backups on the server</th><td>${esc(info.backupFolder || "(the backups folder in the site's data folder)")}</td></tr>
          <tr><th>Copies off the computer</th><td>${esc(info.copyFolder || "none - use Download on the Backups page")}</td></tr>
          <tr><th>Printed by</th><td>${esc(staff.name)} (${esc(staff.username)}), ${esc(fmtDateTime(new Date().toISOString()))}</td></tr></table>
        <h2>Recovery passphrase (write it by hand)</h2>
        <div class="line"></div><div class="line"></div><div class="line"></div>
        <p class="small">Write it exactly, with capitals and spaces. Never type it into a file, email or chat.</p>
        <h2>To restore a backup</h2>
        <ol><li><strong>The site still works:</strong> sign in at /admin, open Backups, choose a backup, press <strong>Restore</strong> and type the passphrase.</li>
          <li><strong>Nobody can sign in, or on a new computer:</strong> set up the site, copy a .qcplbak file (from the copies folder above, or a downloaded one) and drag it onto <strong>Restore a backup.bat</strong>. Type the passphrase when asked, then start the site.</li>
          <li>Everyone signs in again afterwards. A safety copy of the data from before the restore is kept for 60 days.</li></ol>
        <p class="small">Without this passphrase, nobody can open the backups - not the library, not IT, not the people who built the site.</p>`;
      document.body.appendChild(el);
      document.body.classList.add("print-sheet");
      const done = () => { document.body.classList.remove("print-sheet"); el.remove(); removeEventListener("afterprint", done); };
      addEventListener("afterprint", done);
      setTimeout(() => window.print(), 50);
    }
    const sheetBtn = UI.$("#bkSheet"); sheetBtn && sheetBtn.addEventListener("click", recoverySheet);
    const ch = UI.$("#bkChange");
    ch && ch.addEventListener("submit", (e) => { e.preventDefault(); busy(ch.querySelector("button"), async () => {
      await backupApi("/passphrase", { oldPassphrase: UI.$("#bkOld").value, passphrase: UI.$("#bkN1").value, passphrase2: UI.$("#bkN2").value, password: UI.$("#bkCPw").value });
      await pageBackups(); say(true, "The recovery passphrase was changed. Print a new recovery sheet, write the new passphrase on it, and destroy the old sheet.");
    }); });
    const rs = UI.$("#bkReset");
    rs && rs.addEventListener("submit", (e) => { e.preventDefault(); if (!confirm("Start new backups with a new passphrase? Older backups will still need the old one.")) return; busy(rs.querySelector("button"), async () => {
      await backupApi("/passphrase", { startOver: true, passphrase: UI.$("#bkR1").value, passphrase2: UI.$("#bkR2").value, password: UI.$("#bkRPw").value });
      await backupApi("/now", {}); await pageBackups(); say(true, "New backups use the new passphrase. A first one was made just now.");
    }); });
    UI.$$("[data-bk-test],[data-bk-restore]").forEach((b) => b.addEventListener("click", () => backupDialog(b.dataset.bkTest || b.dataset.bkRestore, !!b.dataset.bkRestore)));
  }
  function backupDialog(name, restore) {
    const { esc, icon } = UI;
    UI.openDialog(`
      <button type="button" class="btn btn--outline btn--sm dialog__close" data-close>${icon("i-x")} Close</button>
      <h2 id="dialogTitle">${restore ? "Restore this backup?" : "Test this backup"}</h2>
      <p class="mono muted">${esc(name)}</p>
      ${restore ? `<div class="alert alert--warn">${icon("i-info")}<p><strong>Everything after this backup will be replaced</strong> by what was in it. A safety copy of the current data is made first. The site restarts for a moment and everyone has to sign in again.</p></div>`
        : `<p>This opens the backup and checks it completely, without changing anything. Use it to be sure your backups and passphrase work.</p>`}
      <form id="bkForm">
        <div class="field"><label for="bkPass">Recovery passphrase</label><input class="input" type="password" id="bkPass" autocomplete="off" maxlength="200" /></div>
        <div class="field"><label for="bkMe">Your password</label><input class="input" type="password" id="bkMe" autocomplete="current-password" maxlength="200" /></div>
        ${restore ? `<div class="field"><label for="bkConfirm">Type RESTORE to confirm</label><input class="input mono" id="bkConfirm" autocomplete="off" maxlength="10" /></div>` : ""}
        <div id="bkErr" role="alert"></div>
        <div class="btn-row"><button type="submit" class="btn ${restore ? "btn--accent" : "btn--primary"}">${restore ? "Restore" : "Test it"}</button><button type="button" class="btn btn--outline" data-close>Cancel</button></div>
      </form>`, (root) => {
      UI.$("#bkForm", root).addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
        const err = (t) => { UI.$("#bkErr", root).innerHTML = `<div class="alert alert--error">${icon("i-info")}<p>${esc(t)}</p></div>`; btn.disabled = false; };
        try {
          if (!restore) {
            const r = await backupApi("/verify", { name, passphrase: UI.$("#bkPass", root).value, password: UI.$("#bkMe", root).value });
            UI.$("#bkForm", root).outerHTML = `<div class="alert alert--info">${icon("i-check")}<p><strong>The backup is good.</strong> It opened with this passphrase and passed every check: ${esc(`${r.counts.lost || 0} lost reports, ${r.counts.found || 0} found items, ${r.counts.claims || 0} claims, ${r.counts.users || 0} users, ${r.counts.photos || 0} photos`)}.</p></div><button type="button" class="btn btn--primary" data-close>Done</button>`;
            return;
          }
          const r = await backupApi("/restore", { name, passphrase: UI.$("#bkPass", root).value, password: UI.$("#bkMe", root).value, confirm: UI.$("#bkConfirm", root).value.trim() });
          UI.$("#bkForm", root).outerHTML = `<div class="alert alert--info" role="status">${icon("i-clock")}<p><strong>Restoring…</strong> The site is restarting with the backup from ${esc(UI.fmtDateTime(r.created))}. This page will reload by itself. Safety copy of the replaced data: ${esc(r.safety)}.</p></div>`;
          // Wait for the server to come back, then reload (everyone signs in again)
          const t0 = Date.now();
          const wait = async () => { await new Promise((ok) => setTimeout(ok, 1500)); try { const h = await fetch("/api/health", { cache: "no-store" }); if (h.ok) return location.replace("/#/staff"); } catch {} if (Date.now() - t0 < 120_000) return wait(); UI.$("#dialog").querySelector(".alert p").textContent = "The site has not come back yet. If it was not started with the launcher, start it again."; };
          wait();
        } catch (x) { err(x.message); }
      });
    });
  }

  return { reports: pageReports, olditems: pageOldItems, posters: pagePosters, recognition: pageRecognition, backups: pageBackups };
})();
