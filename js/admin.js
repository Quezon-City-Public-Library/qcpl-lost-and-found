/* ==========================================================================
   QCPL Lost & Found — Quezon City Public Library
   Staff / administrator pages: dashboard & analytics, lost and found records,
   smart-match review, claim verification, returns, users and activity log.

   DEMO ONLY: the staff login here runs in the browser. Before launch, move
   staff sign-in and all records to a secure server.
   ========================================================================== */
window.LF_ROUTES = window.LF_ROUTES || {};
(function () {
  "use strict";

  const TABS = [
    ["dashboard", "Dashboard", "i-chart"],
    ["claims", "Claims to verify", "i-shield"],
    ["matches", "Smart matches", "i-spark"],
    ["lost", "Lost reports", "i-doc"],
    ["found", "Found items", "i-box"],
    ["returned", "Returned", "i-check"],
    ["recognition", "Certificates", "i-award"],
    ["users", "Users", "i-user"],
    ["olditems", "Old items", "i-clock"],
    ["reports", "Reports", "i-chart"],
    ["posters", "Posters & QR", "i-print"],
    ["activity", "Activity log", "i-status"],
    ["staff", "Staff accounts", "i-shield"],
    ["backups", "Backups", "i-box"],
  ];
  const SUPERVISOR_TABS = ["staff"];

  const openClaims = () => LF.db.all("claims").filter((c) => ["submitted", "under-verification"].includes(c.status));
  const allMatches = () => LF.db.all("lost")
    .filter((l) => ["reported", "searching", "possible-match"].includes(l.status))
    .flatMap((l) => LF.matchesForLost(l, { includePrivate: true }).map((m) => ({ lost: l, found: m.item, score: m.score, strength: m.strength, reasons: m.reasons })))
    .sort((a, b) => b.score - a.score);

  /* ---------------- Shell ---------------- */
  function shell(tab, content) {
    const { esc, icon } = UI;
    const staff = LF.currentStaff();
    const badges = { claims: openClaims().length, matches: allMatches().length, olditems: LF.disposalList().length };
    UI.main.innerHTML = `
      <div class="staff-bar"><div class="container staff-bar__inner">
        <p><strong>Administrator area · ${esc(LIBRARY.libraryName)}</strong><br />${esc(staff.name)} <span class="muted">(${esc(staff.role)}${staff.level === "desk" || /supervisor/i.test(staff.role || "") ? "" : " · supervisor"})</span></p>
        ${staff.library === "all" ? `<div class="library-switch"><label for="librarySwitch">Viewing portal</label>
          <select class="select" id="librarySwitch">${LIBRARIES.map((c) => `<option value="${c.id}" ${c.id === activeLibrary().id ? "selected" : ""}>${esc(c.libraryName)}</option>`).join("")}</select></div>` : ""}
        <div class="btn-row">
          <a class="btn btn--light btn--sm" href="#/report-found">${icon("i-doc-plus")} Log a found item</a>
          <button type="button" class="btn btn--ghost-light btn--sm" id="staffPw">${icon("i-shield")} My password</button>
          <button type="button" class="btn btn--ghost-light btn--sm" id="staffOut">Sign out</button>
        </div>
      </div></div>
      ${staff.mustChange ? `<div class="container"><div class="alert alert--warn" style="margin-top:1rem">${icon("i-shield")}<p><strong>You are using a temporary password.</strong> Please press <strong>My password</strong> above and choose your own.</p></div></div>` : ""}
      <div class="container no-print"><form class="ref-find" id="refFind" role="search">
        <label for="refInput">Find a record</label>
        <input class="input mono" id="refInput" placeholder="Type or scan a reference, e.g. L-${esc(LIBRARY.code)}-261005-1234" autocomplete="off" autocapitalize="characters" />
        <button type="submit" class="btn btn--primary btn--sm">${icon("i-search")} Open</button>
        <button type="button" class="btn btn--outline btn--sm" id="refScan" hidden>${icon("i-camera")} Scan QR code</button>
        <span class="ref-find__msg" id="refMsg" role="status"></span>
      </form></div>
      <div class="container staff-layout">
        <nav class="staff-nav no-print" aria-label="Staff sections">
          <ul>${TABS.filter(([k]) => (!SUPERVISOR_TABS.includes(k) || LF.isSupervisor()) && (k !== "backups" || (staff.library === "all" && LF.isSupervisor()))).map(([k, label, ic]) => `<li><a href="#/staff/${k}" ${k === tab ? 'aria-current="page"' : ""}>${icon(ic)} ${label}
            ${badges[k] ? `<span class="count-badge">${badges[k]}<span class="sr-only"> waiting</span></span>` : ""}</a></li>`).join("")}</ul>
        </nav>
        <div class="staff-main" id="staffMain">${staff.mustChange ? `<h1 class="staff-h1">Choose your own password first</h1><p>You signed in with a temporary password. For safety, the administrator area opens after you choose your own.</p><button type="button" class="btn btn--primary btn--lg" id="mustPw">${icon("i-shield")} Choose my password</button>` : content}</div>
      </div>`;
    UI.$("#refFind").addEventListener("submit", (ev) => { ev.preventDefault(); openRecord(UI.$("#refInput").value); });
    if ("BarcodeDetector" in window && navigator.mediaDevices) { UI.$("#refScan").hidden = false; UI.$("#refScan").addEventListener("click", scanQr); }
    const sw = UI.$("#librarySwitch");
    sw && sw.addEventListener("change", async () => { sw.disabled = true; try { await LF.setLibrary(sw.value); } catch (err) { sw.disabled = false; return alert(err.message); } UI.announce(`Now viewing ${LIBRARY.libraryName}`); UI.route(); });
    UI.$("#staffOut").addEventListener("click", async () => { try { await LF.signOut(); } catch (err) { return alert(err.message); } UI.renderLibraryShell(); UI.announce("Signed out"); UI.go("#/staff"); });
    UI.$("#staffPw").addEventListener("click", myPasswordDialog);
    if (staff.mustChange) { UI.$("#mustPw").addEventListener("click", myPasswordDialog); myPasswordDialog(); }
  }

  /* Any staff member: change their own password */
  function myPasswordDialog() {
    const { icon, esc } = UI;
    UI.openDialog(`
      <button type="button" class="btn btn--outline btn--sm dialog__close" data-close>${icon("i-x")} Close</button>
      <h2 id="dialogTitle">Change my password</h2>
      <form id="pwForm">
        <div class="field"><label for="pwCur">Current password</label><input class="input" type="password" id="pwCur" autocomplete="current-password" /></div>
        <div class="field"><label for="pwNew">New password</label><p class="hint">At least 8 letters or numbers.</p><input class="input" type="password" id="pwNew" autocomplete="new-password" /></div>
        <div class="field"><label for="pwNew2">Type the new password again</label><input class="input" type="password" id="pwNew2" autocomplete="new-password" /></div>
        <div id="pwMsg" role="status"></div>
        <button class="btn btn--primary" type="submit">${icon("i-check")} Save new password</button>
      </form>`, (root) => {
      UI.$("#pwForm", root).addEventListener("submit", async (e) => {
        e.preventDefault();
        const say = (ok, t) => (UI.$("#pwMsg", root).innerHTML = `<div class="alert ${ok ? "alert--info" : "alert--error"}" role="alert">${icon("i-info")}<p>${esc(t)}</p></div>`);
        if (UI.$("#pwNew", root).value !== UI.$("#pwNew2", root).value) return say(false, "The two new passwords are not the same.");
        try { await LF.changeStaffPassword(UI.$("#pwCur", root).value, UI.$("#pwNew", root).value); say(true, "Your password was changed."); setTimeout(() => { UI.closeDialog(); UI.route(); }, 900); }
        catch (err) { say(false, err.message); }
      });
    });
  }

  /* Show a temporary password once, so staff can give it to the person */
  function showTempPassword(who, temp) {
    const { icon, esc } = UI;
    UI.openDialog(`
      <button type="button" class="btn btn--outline btn--sm dialog__close" data-close>${icon("i-x")} Close</button>
      <h2 id="dialogTitle">Temporary password for ${esc(who)}</h2>
      <p>Give this to the person <strong>in person</strong>. It is shown only once. They will be asked to choose their own password after signing in.</p>
      <p class="temp-pw mono">${esc(temp)}</p>
      <button type="button" class="btn btn--primary" data-close>Done</button>`);
  }

  /* Correct the details of a lost report or found item */
  function editDialog(kind, id) {
    const { icon, esc } = UI;
    const r = LF.db.byId(kind, id);
    const lost = kind === "lost";
    const val = (k) => esc(r[k] || "");
    const sel = (name, opts, cur, blank) => `<select class="select" name="${name}">${blank ? `<option value="">${blank}</option>` : ""}${opts.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(t)}</option>`; }).join("")}</select>`;
    UI.openDialog(`
      <button type="button" class="btn btn--outline btn--sm dialog__close" data-close>${icon("i-x")} Close</button>
      <p class="muted mono" style="margin:0">${esc(r.id)}</p>
      <h2 id="dialogTitle">Correct the details</h2>
      <p class="muted">Every change is saved in the activity log with your name. Matching is checked again after saving.</p>
      <form id="editForm" class="stack-form">
        <div class="grid-2">
          <div class="field"><label>Item name<input class="input" name="${lost ? "itemName" : "title"}" value="${val(lost ? "itemName" : "title")}" /></label></div>
          <div class="field"><label>Type of item${sel("category", CATEGORIES.map((c) => [c.id, c.name]), r.category)}</label></div>
          <div class="field"><label>Brand<input class="input" name="brand" value="${val("brand")}" /></label></div>
          <div class="field"><label>Color${sel("color", COLORS, r.color, "Not given")}</label></div>
          <div class="field"><label>${lost ? "Date lost" : "Date found"}<input class="input" type="date" name="${lost ? "dateLost" : "date"}" value="${val(lost ? "dateLost" : "date")}" /></label></div>
          <div class="field"><label>Library${sel("branch", LIBRARY.branches, r.branch)}</label></div>
          <div class="field"><label>Place${sel("location", LOCATIONS, r.location)}</label></div>
          <div class="field"><label>Floor${sel("floor", FLOORS, r.floor, "Not given")}</label></div>
        </div>
        <div class="field"><label>Exact spot<input class="input" name="locationDetail" value="${val("locationDetail")}" /></label></div>
        <div class="field"><label>${lost ? "Description" : "Public description"}<textarea class="textarea" name="description">${val("description")}</textarea></label></div>
        <div class="field"><label>${lost ? "Special marks" : "Private details"}<textarea class="textarea" name="${lost ? "uniqueDetails" : "privateDetails"}">${val(lost ? "uniqueDetails" : "privateDetails")}</textarea></label></div>
        <div class="btn-row"><button type="submit" class="btn btn--primary">${icon("i-check")} Save corrections</button><button type="button" class="btn btn--outline" data-close>Cancel</button></div>
      </form>
      ${(r.edits || []).length ? `<h3>Earlier corrections</h3><ul class="edit-log">${r.edits.slice().reverse().map((e) => `<li><strong>${esc(UI.fmtDateTime(e.at))}</strong> · ${esc(e.by)}<br><span class="muted">${esc(e.changes.join("; "))}</span></li>`).join("")}</ul>` : ""}`, (root) => {
      UI.$("#editForm", root).addEventListener("submit", async (e) => {
        e.preventDefault();
        const changes = Object.fromEntries([...new FormData(e.target).entries()].map(([k, v]) => [k, String(v).trim().slice(0, k === "description" || k === "uniqueDetails" || k === "privateDetails" ? 1000 : 120)]));
        const say = (t) => { UI.$("#editErr", root)?.remove(); e.target.insertAdjacentHTML("afterbegin", `<div class="alert alert--error" role="alert" id="editErr">${icon("i-info")}<p>${esc(t)}</p></div>`); };
        if (!(changes.itemName ?? changes.title)) return say("Please type the item name.");
        const d = changes.dateLost ?? changes.date;
        if (!d) return say("Please choose the date.");
        if (d > UI.todayISO()) return say("The date can't be in the future.");
        try { await LF.updateRecord(kind, id, changes); } catch (err) { return say(err.message); }
        // A staff correction of the type or name teaches the photo helper on this computer (counts the most)
        const nameKey = lost ? "itemName" : "title";
        if (UI.photosOf(r).length && (changes.category !== r.category || changes[nameKey] !== r[nameKey]))
          PhotoAI.learn({ photos: UI.photosOf(r), category: changes.category, itemName: changes[nameKey], kind: lost ? "lost" : "found", staff: true });
        UI.announce("Details corrected");
        UI.route();
        (lost ? lostDialog : foundDialog)(id);
      });
    });
  }

  /* Open a lost report, found item or claim from its reference number */
  function openRecord(ref) {
    const hit = LF.findRef(ref);
    const msg = UI.$("#refMsg");
    if (!hit) { if (msg) msg.textContent = `No record "${String(ref).trim()}" in the ${LIBRARY.libraryName} portal.`; UI.announce("No record found"); return false; }
    if (msg) msg.textContent = "";
    ({ lost: lostDialog, found: foundDialog, claims: claimDialog })[hit.kind](hit.item.id);
    return true;
  }

  /* Scan the QR code on a reference ticket with the device camera.
     (Uses the browser's built-in barcode reader — Chrome and Edge on Android and most laptops.) */
  async function scanQr() {
    const { icon } = UI;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); }
    catch { UI.$("#refMsg").textContent = "The camera could not be opened. Type the reference instead."; return; }
    let stopped = false;
    const stop = () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); };
    UI.openDialog(`<button type="button" class="btn btn--outline btn--sm dialog__close" data-close>${icon("i-x")} Close</button>
      <h2 id="dialogTitle">Scan a reference QR code</h2><p class="muted">Hold the ticket's QR code in front of the camera.</p>
      <video id="scanVideo" class="scan-video" playsinline muted></video>`);
    const dlg = UI.$("#dialog");
    dlg.addEventListener("close", stop, { once: true });
    const video = UI.$("#scanVideo");
    video.srcObject = stream;
    try { await video.play(); } catch { UI.closeDialog(); UI.announce("The camera could not start."); return; }
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const loop = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) { const value = codes[0].rawValue; stop(); UI.closeDialog(); UI.$("#refInput").value = value; openRecord(value); return; }
      } catch { /* keep trying */ }
      setTimeout(loop, 300);
    };
    loop();
  }

  const table = (cols, rows, empty = "Nothing here yet.") => rows.length
    ? `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<div class="empty">${UI.icon("i-doc")}<p style="margin:.5rem 0 0">${empty}</p></div>`;

  const openBtn = (kind, id, label = "Open") => `<button type="button" class="btn btn--outline btn--sm" data-open="${kind}:${UI.esc(id)}">${label}<span class="sr-only"> ${UI.esc(id)}</span></button>`;

  function filterBar(id, statuses, kind, current, q) {
    const { esc } = UI;
    return `<form class="filters filters--staff" id="${id}" role="search">
      <div class="field"><label for="${id}-q">Search</label><input class="input" id="${id}-q" name="q" type="search" value="${esc(q || "")}" placeholder="Name, item, reference…" /></div>
      <div class="field"><label for="${id}-s">Status</label><select class="select" id="${id}-s" name="s">
        <option value="">All</option>${statuses.map((s) => `<option value="${s}" ${s === current ? "selected" : ""}>${esc(STATUS[kind][s].label)}</option>`).join("")}
      </select></div>
    </form>`;
  }
  function wireFilter(id, tab) {
    const f = UI.$("#" + id);
    if (!f) return;
    const apply = () => UI.go(`#/staff/${tab}?q=${encodeURIComponent(f.q.value)}&s=${encodeURIComponent(f.s.value)}`);
    f.addEventListener("change", apply);
    f.addEventListener("submit", (e) => { e.preventDefault(); apply(); });
  }
  const matchesQ = (rec, q, fields) => !q || fields.map((k) => rec[k]).join(" ").toLowerCase().includes(q.toLowerCase());

  /* ---------------- Administrator sign-in ----------------
     A page of its own (open /admin, or #/staff), separate from the public site:
     no menus, no link to it anywhere on the public pages, and the public sign-in
     page is for users only. Signing in here as an administrator ends any user
     sign-in on this browser. */
  function gate(r) {
    const { esc, icon } = UI;
    const next = r && r.param && PAGES[r.param] ? location.hash : "#/staff/dashboard";
    const idle = r && r.query && r.query.get && r.query.get("idle");
    document.body.classList.add("is-admin-signin"); // no public header, menu or footer on this page
    UI.main.innerHTML = `
      <section class="auth-stage admin-signin"><div class="container">
        <form class="otp-card" id="admForm" novalidate aria-labelledby="admTitle">
          <div class="otp-card__badge" aria-hidden="true">${icon("i-shield")}</div>
          <p class="auth__kicker">QCPL Lost &amp; Found · Staff only</p>
          <h1 id="admTitle">Administrator sign in</h1>
          <p class="auth__lead">For library Lost &amp; Found staff. Visitors and members sign in on the website instead.</p>
          <div class="auth-err" id="admErr">${idle ? `<div class="alert alert--info" role="status">${icon("i-clock")}<p>You were signed out because the page was not used for a while. Please sign in again.</p></div>` : ""}</div>
          <div class="field auth-field"><label for="admId">Username</label><div class="auth-input">${icon("i-user")}<input class="input" id="admId" autocomplete="username" autocapitalize="none" spellcheck="false" /></div></div>
          <div class="field auth-field"><label for="admPw">Password</label><div class="auth-input">${icon("i-shield")}<input class="input" id="admPw" type="password" autocomplete="current-password" />
            <button type="button" class="auth-eye" id="admEye" aria-pressed="false">Show</button></div></div>
          <p class="auth__forgot"><span class="muted">Forgot your password? Ask your supervisor to reset it.</span></p>
          <button class="btn btn--primary btn--lg btn--block" type="submit">Sign in ${icon("i-arrow")}</button>
        </form>
      </div></section>`;
    const form = UI.$("#admForm"), err = UI.$("#admErr"), pw = UI.$("#admPw");
    const showErr = (m, id) => { err.innerHTML = `<div class="alert alert--error" role="alert" tabindex="-1">${icon("i-info")}<p>${esc(m)}</p></div>`; (id ? UI.$("#" + id) : err.firstChild).focus(); UI.announce(m); };
    UI.$("#admEye").addEventListener("click", (e) => { const show = pw.type === "password"; pw.type = show ? "text" : "password"; e.currentTarget.textContent = show ? "Hide" : "Show"; e.currentTarget.setAttribute("aria-pressed", String(show)); });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = UI.$("#admId").value.trim();
      if (!id) return showErr("Please type your username.", "admId");
      if (!pw.value) return showErr("Please type your password.", "admPw");
      const btn = form.querySelector('[type="submit"]'); btn.disabled = true;
      try {
        await LF.signIn("admin", id, pw.value);
        UI.renderAccountLink(); UI.renderLibraryShell();
        UI.announce(`Signed in as administrator. You are using the ${LIBRARY.libraryName}.`);
        UI.go(next);
      } catch (ex) { btn.disabled = false; pw.value = ""; showErr(ex.message); }
    });
    UI.$("#admId").focus({ preventScroll: true });
  }

  /* ---------------- Dashboard ---------------- */
  function hbar(rows, labelFn, unit) {
    if (!rows.length) return `<p class="muted">Nothing to show yet.</p>`;
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return `<ul class="hbars">${rows.map(([k, v]) => `
      <li title="${UI.esc(labelFn(k))}: ${v} ${unit}">
        <span class="hbars__label">${UI.esc(labelFn(k))}</span>
        <span class="hbars__track"><span class="hbars__bar" style="width:${(v / max) * 100}%"></span></span>
        <span class="hbars__value">${v}</span>
      </li>`).join("")}</ul>`;
  }
  function pageDashboard() {
    const { icon, esc } = UI;
    const s = LF.stats();
    const assist = LF.db.all("lost").filter((l) => l.assist && ["reported", "searching", "possible-match", "claim-submitted", "under-verification", "ready"].includes(l.status));
    const tiles = [
      ["Lost items reported", s.lostTotal, "#/staff/lost"],
      ["Found items reported", s.foundTotal, "#/staff/found"],
      ["Returned to owners", s.returned, "#/staff/returned"],
      ["Unresolved lost cases", s.unresolved, "#/staff/lost"],
      ["Unclaimed items at the office", s.unclaimed, "#/staff/found?s=recorded"],
      ["Claims waiting", s.pendingClaims, "#/staff/claims"],
    ];
    const attention = [
      s.pendingClaims && [`${s.pendingClaims} ${s.pendingClaims === 1 ? "claim needs" : "claims need"} verification`, "#/staff/claims"],
      allMatches().length && [`${allMatches().length} smart ${allMatches().length === 1 ? "match" : "matches"} to review`, "#/staff/matches"],
      s.awaitingTurnover && [`${s.awaitingTurnover} found ${s.awaitingTurnover === 1 ? "item hasn't" : "items haven't"} reached the office yet`, "#/staff/found?s=found"],
      s.overdue.length && [`${s.overdue.length} ${s.overdue.length === 1 ? "item is" : "items are"} past the ${LIBRARY.holdDays}-day holding period`, "#/staff/olditems"],
      assist.length && [`${assist.length} ${assist.length === 1 ? "person needs" : "people need"} PWD / extra assistance`, "#/staff/lost"],
    ].filter(Boolean);

    shell("dashboard", `
      <h1 class="staff-h1">Dashboard</h1>
      <p class="muted" id="channelStatus" role="status"></p>
      <ul class="kpis">${tiles.map(([l, v, h]) => `<li><a href="${h}"><strong>${v}</strong><span>${l}</span></a></li>`).join("")}</ul>

      <div class="dash-grid">
        <div class="card">
          <h2 class="h3">Needs attention</h2>
          ${attention.length ? `<ul class="attention">${attention.map(([t, h]) => `<li><a href="${h}">${icon("i-info")} ${esc(t)} ${icon("i-arrow")}</a></li>`).join("")}</ul>` : `<p class="muted">All caught up. 🎉</p>`}
        </div>
        <div class="card hero-stats">
          <div><strong>${s.recoveryRate}%</strong><span>of items handled were returned to their owners</span></div>
          <div><strong>${s.avgDays || "—"}</strong><span>average days from found to returned</span></div>
        </div>
      </div>

      ${(() => {
        const today = toISODate(new Date()), list = LF.pickupsOn(today);
        const moving = LF.db.all("found").filter((f) => f.transfer);
        return `<div class="card" style="margin-top:1.25rem">
          <h2 class="h3">${icon("i-cal")} Today's pick-ups</h2>
          ${list.length ? `<ul class="pickup-list">${list.map((c) => { const f = LF.db.byId("found", c.itemId); return `<li>
            <strong class="mono">${esc(new Date(`${c.pickup.date}T${c.pickup.time}:00`).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }))}</strong>
            <span>${esc(c.name)} — ${esc(c.itemTitle)}<br><span class="muted">${esc(c.pickup.place || LF.keptAt(f))}${f && f.storage ? ` · shelf / bin ${esc(f.storage)}` : ""}</span></span>
            ${openBtn("claims", c.id, "Release")}</li>`; }).join("")}</ul>` : `<p class="muted">No pick-ups booked for today.</p>`}
          ${moving.length ? `<p style="margin:.75rem 0 0">${icon("i-box")} ${moving.length} ${moving.length === 1 ? "item is" : "items are"} being moved between libraries: ${moving.map((f) => `<button type="button" class="linklike mono" data-open="found:${esc(f.id)}">${esc(f.id)}</button> → ${esc(f.transfer.to)}`).join(", ")}</p>` : ""}
        </div>`;
      })()}

      <div class="card" style="margin-top:1.25rem">
        <h2 class="h3">Items returned and reports each month — last 12 months</h2>
        ${UI.statTiles()}
        ${UI.monthlyChart(LF.monthlyTotals(12), "adminChart")}
      </div>

      <div class="dash-grid" style="margin-top:1.25rem">
        <div class="card"><h2 class="h3">Most commonly lost items</h2>${hbar(s.byCategory, (k) => UI.cat(k).name, "reports")}</div>
        <div class="card"><h2 class="h3">Where items are lost most</h2>${hbar(s.byLocation, (k) => k, "reports")}
          <p class="muted" style="margin:.75rem 0 0;font-size:.9rem">Tip: areas at the top may need reminders, signs or more guard rounds.</p></div>
      </div>

      <div class="card" style="margin-top:1.25rem">
        <h2 class="h3">${icon("i-heart")} Feedback from owners</h2>
        ${(() => {
          const fb = LF.feedbackStats();
          return fb.count ? `<div class="hero-stats fb-stats">
              <div><strong>${fb.ease}</strong><span>out of 5 — how easy it was to report and claim</span></div>
              <div><strong>${fb.satisfaction}</strong><span>out of 5 — satisfaction with the service (${fb.count} ${fb.count === 1 ? "answer" : "answers"})</span></div>
            </div>
            ${fb.recent.length ? `<ul class="fb-comments">${fb.recent.map((x) => `<li>"${esc(x.comment)}" <span class="muted">— ${esc(UI.fmtDate(x.at))}</span></li>`).join("")}</ul>` : ""}`
            : `<p class="muted">No feedback yet. Owners are asked two questions after their item is returned.</p>`;
        })()}
      </div>

      <div class="card" style="margin-top:1.25rem">
        <h2 class="h3">${icon("i-award")} Top honest finders</h2>
        ${(() => {
          const top = LF.topFinders(5);
          return top.length ? `<ol class="top-finders">${top.map((t) => `<li>
            <span class="top-finders__name">${esc(t.name)}<br><span class="muted">${esc(t.phone)}</span></span>
            <span>${t.badge ? `<span class="badge-chip">${icon(t.badge.icon)} ${esc(t.badge.name)}</span>` : ""}</span>
            <span class="top-finders__count"><strong>${t.count}</strong> returned</span></li>`).join("")}</ol>
            <p class="muted" style="margin:.75rem 0 0;font-size:.9rem">Consider recognizing top finders on the library's bulletin board or Facebook page.</p>`
            : `<p class="muted">No items found by visitors or staff have been returned yet.</p>`;
        })()}
      </div>

      ${LF.isSupervisor() ? `<div class="btn-row" style="margin-top:1.5rem">
        <button type="button" class="btn btn--outline btn--sm" id="clearAll">Clear all records for this library</button>
      </div>` : ""}`);
    // Tell the administrator whether updates also go out by email / SMS
    LF.channels().then((c) => {
      const el = UI.$("#channelStatus");
      if (!el) return;
      const on = (b) => (b ? "ON" : "OFF");
      el.innerHTML = `Updates to users — on the website: <strong>ON</strong> · by email: <strong>${on(c.email)}</strong> · by text message: <strong>${on(c.sms)}</strong>${c.email || c.sms ? "" : ". Email and SMS are set up on the server (see README)."}`;
    });
    UI.drawCharts();
    UI.$("#clearAll") && UI.$("#clearAll").addEventListener("click", async () => {
      const word = prompt(`This permanently erases every report, found item, claim, user account, update and feedback of the ${LIBRARY.libraryName}. It cannot be undone.\n\nType DELETE to continue.`, "");
      if (word === "DELETE") { try { await LF.clearLibraryRecords(); } catch (err) { return alert(err.message); } UI.announce("All records cleared"); pageDashboard(); }
    });
  }

  /* ---------------- Lost reports ---------------- */
  function pageLost(query) {
    const { esc } = UI;
    const q = query.get("q") || "", st = query.get("s") || "";
    const list = LF.db.all("lost").filter((l) => (!st || l.status === st) && matchesQ(l, q, ["id", "itemName", "name", "phone", "brand", "location"]));
    shell("lost", `
      <h1 class="staff-h1">Lost reports</h1>
      ${filterBar("lostF", Object.keys(STATUS.lost), "lost", st, q)}
      ${table(["Ref", "Item", "Lost on", "Place", "Owner", "Matches", "Status", ""], list.map((l) => {
        const m = ["reported", "searching", "possible-match"].includes(l.status) ? LF.matchesForLost(l, { includePrivate: true }).length : "—";
        return `<tr><th scope="row" class="mono">${esc(l.id)}</th>
          <td>${esc(l.itemName)}<br><span class="muted">${esc(UI.cat(l.category).name)}${l.brand ? " · " + esc(l.brand) : ""}${l.color ? " · " + esc(l.color) : ""}</span>${l.assist ? '<br><span class="flag">PWD / extra assistance</span>' : ""}</td>
          <td>${esc(UI.fmtDate(l.dateLost))}</td><td>${l.branch ? `${esc(l.branch)}<br><span class="muted">${esc(l.location)}</span>` : esc(l.location)}</td>
          <td>${esc(l.name)}<br><span class="muted">${esc(l.phone)}</span></td>
          <td>${m}</td><td>${UI.statusBadge("lost", l.status)}</td><td>${openBtn("lost", l.id)}</td></tr>`;
      }), "No lost reports match.")}`);
    wireFilter("lostF", "lost");
  }

  function lostDialog(id) {
    const { esc, icon } = UI;
    const l = LF.db.byId("lost", id);
    const ms = ["reported", "searching", "possible-match"].includes(l.status) ? LF.matchesForLost(l, { includePrivate: true }) : [];
    UI.openDialog(`
      <button type="button" class="btn btn--outline btn--sm dialog__close" data-close>${icon("i-x")} Close</button>
      <p class="muted mono" style="margin:0">${esc(l.id)}</p>
      <h2 id="dialogTitle">${esc(l.itemName)}</h2>
      ${UI.photoStrip(UI.photosOf(l), "Photo from the owner")}
      <dl class="review-list">
        <dt>Type</dt><dd>${esc(UI.cat(l.category).name)}</dd>
        ${l.brand ? `<dt>Brand</dt><dd>${esc(l.brand)}</dd>` : ""}${l.color ? `<dt>Color</dt><dd>${esc(l.color)}</dd>` : ""}
        <dt>Description</dt><dd>${esc(l.description || "—")}</dd>
        <dt>Special marks</dt><dd>${esc(l.uniqueDetails || "—")}</dd>
        <dt>Lost</dt><dd>${esc(UI.fmtDate(l.dateLost))}${l.timeOfDay ? ", " + esc(l.timeOfDay.toLowerCase()) : ""}</dd>
        <dt>Where</dt><dd>${l.branch ? esc(l.branch) + " · " : ""}${esc(l.location)}${l.floor ? ", " + esc(l.floor) : ""}${l.locationDetail ? `<br><span class="muted">${esc(l.locationDetail)}</span>` : ""}</dd>
        <dt>Owner</dt><dd>${esc(l.name)}${l.role ? ` · ${esc(l.role)}` : ""}${l.memberId ? ` · No. ${esc(l.memberId)}` : ""} · <a href="tel:${esc(UI.digits(l.phone))}">${esc(l.phone)}</a>${l.email ? ` · ${esc(l.email)}` : ""}<br><span class="muted">Prefers: ${esc(l.contactPref || "Call me")}</span>${l.assist ? '<br><span class="flag">Needs PWD / extra assistance</span>' : ""}</dd>
      </dl>
      <div class="btn-row" style="margin:.5rem 0 1rem"><button type="button" class="btn btn--outline btn--sm" data-edit="lost|${esc(l.id)}">${icon("i-doc")} Correct details</button></div>
      <h3>Progress</h3>${UI.timeline("lost", l)}
      ${ms.length ? `<h3>Suggested matches</h3><ul class="mini-matches">${ms.map((m) => `<li>
        <div><strong>${esc(m.item.title)}</strong> <span class="mono muted">${esc(m.item.id)}</span><br><span class="muted">${m.score}% · ${esc(m.reasons.join(" · "))}</span></div>
        <div class="btn-row"><button type="button" class="btn btn--primary btn--sm" data-contact="${esc(l.id)}|${esc(m.item.id)}">Contact owner</button>
        <button type="button" class="btn btn--outline btn--sm" data-dismiss="${esc(l.id)}|${esc(m.item.id)}">Not a match</button></div></li>`).join("")}</ul>` : ""}
      ${statusForm("lost", l)}`, wireDialogActions);
  }

  /* ---------------- Found items ---------------- */
  function pageFound(query) {
    const { esc } = UI;
    const q = query.get("q") || "", st = query.get("s") || "";
    const list = LF.db.all("found").filter((f) => (!st || f.status === st) && matchesQ(f, q, ["id", "title", "brand", "finderName", "location"]));
    shell("found", `
      <h1 class="staff-h1">Found items</h1>
      ${filterBar("foundF", Object.keys(STATUS.found), "found", st, q)}
      ${table(["Ref", "Item", "Found on", "Place", "Days held", "Finder", "Status", ""], list.map((f) => {
        const held = LF.daysHeld(f);
        const live = PUBLIC_FOUND.includes(f.status);
        return `<tr><th scope="row" class="mono">${esc(f.id)}</th>
          <td>${esc(f.title)}<br><span class="muted">${esc(UI.cat(f.category).name)}${f.brand ? " · " + esc(f.brand) : ""}${f.color ? " · " + esc(f.color) : ""}</span></td>
          <td>${esc(UI.fmtDate(f.date))}</td><td>${f.branch ? `${esc(f.branch)}<br><span class="muted">${esc(f.location)}</span>` : esc(f.location)}</td>
          <td>${live ? `${held}${held > LIBRARY.holdDays ? ' <span class="flag">Over limit</span>' : ""}` : "—"}</td>
          <td>${esc(f.finderName || "")}${f.finderPhone ? `<br><span class="muted">${esc(f.finderPhone)}</span>` : ""}</td>
          <td>${UI.statusBadge("found", f.status)}</td><td>${openBtn("found", f.id)}</td></tr>`;
      }), "No found items match.")}`);
    wireFilter("foundF", "found");
  }

  function foundDialog(id) {
    const { esc, icon } = UI;
    const f = LF.db.byId("found", id);
    const owners = ["recorded", "possible-owner"].includes(f.status) ? LF.matchesForFound(f, { includePrivate: true }) : [];
    const live = PUBLIC_FOUND.includes(f.status);
    UI.openDialog(`
      <button type="button" class="btn btn--outline btn--sm dialog__close" data-close>${icon("i-x")} Close</button>
      <p class="muted mono" style="margin:0">${esc(f.id)}</p>
      <h2 id="dialogTitle">${esc(f.title)}</h2>
      ${UI.photoStrip(UI.photosOf(f), "Photo of the found item")}
      <dl class="review-list">
        <dt>Type</dt><dd>${esc(UI.cat(f.category).name)}</dd>
        ${f.brand ? `<dt>Brand</dt><dd>${esc(f.brand)}</dd>` : ""}${f.color ? `<dt>Color</dt><dd>${esc(f.color)}</dd>` : ""}
        <dt>Public description</dt><dd>${esc(f.description || "—")}</dd>
        <dt>Private details</dt><dd class="private-val">${icon("i-shield")} ${esc(f.privateDetails || "None recorded — please add details for verification.")}</dd>
        <dt>Found</dt><dd>${esc(UI.fmtDate(f.date))} · ${f.branch ? esc(f.branch) + " · " : ""}${esc(f.location)}${f.floor ? ", " + esc(f.floor) : ""}${f.locationDetail ? `<br><span class="muted">${esc(f.locationDetail)}</span>` : ""}</dd>
        <dt>Finder</dt><dd>${esc(f.finderName || "—")}${f.finderRole ? ` · ${esc(f.finderRole)}` : ""}${f.finderMemberId ? ` · No. ${esc(f.finderMemberId)}` : ""}${f.finderPhone ? ` · ${esc(f.finderPhone)}` : ""}${f.handover ? `<br><span class="muted">${esc(f.handover)}</span>` : ""}</dd>
        ${live ? `<dt>Days held</dt><dd>${LF.daysHeld(f)} of ${LIBRARY.holdDays}</dd>` : ""}
        ${f.release ? `<dt>Released to</dt><dd>${esc(f.release.releasedTo)} · ${esc(f.release.idType)} ••${esc(f.release.idLast4 || "")}<br><span class="muted">${esc(UI.fmtDateTime(f.release.at))} by ${esc(f.release.by)}</span></dd>` : ""}
      </dl>
      ${LF.isRecognizable(f) ? `<div class="recognition recognition--staff">
        <h3>${icon("i-award")} Finder recognition</h3>
        <p>${esc(f.finderName)} · ${LF.honestyFor({ userId: f.userId, phone: f.finderPhone }).count} item(s) returned · Wall of Honesty: <strong>${f.publicThanks ? "Yes" : "No (private)"}</strong></p>
        ${f.thankNote ? `<blockquote class="thank-note"><p>"${esc(f.thankNote)}"</p></blockquote>` : ""}
        <form data-thanks="${esc(f.id)}"><div class="field"><label for="thanksNote">${f.thankNote ? "Send another" : "Send a"} thank-you message</label>
          <textarea class="textarea" id="thanksNote" name="note" style="min-height:4.5rem" placeholder="e.g. Thank you for your honesty!"></textarea></div>
          <div class="btn-row" style="margin-top:.6rem"><button type="submit" class="btn btn--primary btn--sm">Send message</button>
          <a class="btn btn--outline btn--sm" href="#/certificate/${encodeURIComponent(f.id)}">${icon("i-award")} View certificate</a></div></form>
      </div>` : ""}
      <section class="keep card">
        <h3>${icon("i-box")} Where the item is kept</h3>
        <p><strong>${esc(LF.keptAt(f))}</strong>${f.storage ? ` · shelf / bin <strong class="mono">${esc(f.storage)}</strong>` : ""}</p>
        ${f.transfer ? `<div class="alert alert--warn">${icon("i-info")}<p>Being moved to <strong>${esc(f.transfer.to)}</strong> (sent ${esc(UI.fmtDateTime(f.transfer.at))} by ${esc(f.transfer.by)}${f.transfer.note ? ` — ${esc(f.transfer.note)}` : ""}).</p></div>
          <button type="button" class="btn btn--primary btn--sm" data-receive="${esc(f.id)}">${icon("i-check")} Mark as received at ${esc(f.transfer.to)}</button>` : ""}
        <form class="inline-form" data-storage="${esc(f.id)}">
          <label for="stor">Shelf or bin</label><input class="input" id="stor" name="storage" value="${esc(f.storage || "")}" placeholder="e.g. Shelf B · Bin 3" maxlength="60" />
          <button type="submit" class="btn btn--outline btn--sm">Save</button>
        </form>
        ${!f.transfer && live && LIBRARY.branches.length > 1 ? `<form class="inline-form" data-transfer="${esc(f.id)}">
          <label for="xferTo">Move to another library</label>
          <select class="select" id="xferTo" name="to">${LIBRARY.branches.filter((b) => b !== LF.keptAt(f)).map((b) => `<option>${esc(b)}</option>`).join("")}</select>
          <input class="input" name="note" placeholder="Reason (optional), e.g. owner lives nearby" />
          <button type="submit" class="btn btn--outline btn--sm">Send</button>
        </form>` : ""}
        ${(f.transfers || []).length ? `<p class="muted" style="font-size:.85rem">Moved before: ${f.transfers.map((x) => `${esc(x.from)} → ${esc(x.to)} (${esc(UI.fmtDate(x.receivedAt))})`).join("; ")}</p>` : ""}
        <div class="btn-row"><a class="btn btn--outline btn--sm" href="#/staff/tag?id=${encodeURIComponent(f.id)}" data-close>${icon("i-print")} Print item tag</a>
          <button type="button" class="btn btn--outline btn--sm" data-edit="found|${esc(f.id)}">${icon("i-doc")} Correct details</button></div>
      </section>
      <h3>Progress</h3>${UI.timeline("found", f)}
      ${owners.length ? `<h3>Possible owners</h3><ul class="mini-matches">${owners.map((m) => `<li>
        <div><strong>${esc(m.item.name)}</strong> — ${esc(m.item.itemName)} <span class="mono muted">${esc(m.item.id)}</span><br><span class="muted">${m.score}% · ${esc(m.reasons.join(" · "))}</span></div>
        <div class="btn-row"><button type="button" class="btn btn--primary btn--sm" data-contact="${esc(m.item.id)}|${esc(f.id)}">Contact owner</button>
        <button type="button" class="btn btn--outline btn--sm" data-dismiss="${esc(m.item.id)}|${esc(f.id)}">Not a match</button></div></li>`).join("")}</ul>` : ""}
      <div class="btn-row" style="margin:1rem 0">
        ${f.status === "found" ? `<button type="button" class="btn btn--primary" data-quick="found|${esc(f.id)}|recorded">${icon("i-check")} Mark as received at the office</button>` : ""}
        ${live && !["claimed"].includes(f.status) && LF.isSupervisor() ? `<button type="button" class="btn btn--outline" data-quick="found|${esc(f.id)}|disposed">Mark as donated / disposed</button>` : ""}
      </div>
      ${statusForm("found", f)}`, wireDialogActions);
  }

  /* Manual status change (with a note for the activity log) */
  function statusForm(kind, rec) {
    const { esc } = UI;
    return `<form class="status-form" data-status-form="${kind}|${esc(rec.id)}">
      <h3>Change status</h3>
      <div class="grid-2">
        <div class="field"><label for="sf-status">New status</label><select class="select" id="sf-status" name="status">
          ${Object.keys(STATUS[kind]).map((s) => `<option value="${s}" ${s === rec.status ? "selected" : ""}>${esc(STATUS[kind][s].label)}</option>`).join("")}</select></div>
        <div class="field"><label for="sf-note">Note <span class="opt">(optional)</span></label><input class="input" id="sf-note" name="note" /></div>
      </div>
      <button type="submit" class="btn btn--outline" style="margin-top:.75rem">Save status</button>
    </form>`;
  }

  function wireDialogActions(root) {
    const refresh = () => { UI.closeDialog(); UI.route(); };
    // Every button waits for the server; it is disabled meanwhile and shows any error
    const doIt = async (el, work) => { if (el) el.disabled = true; try { await work(); return true; } catch (err) { alert(err.message); return false; } finally { if (el && el.isConnected) el.disabled = false; } };
    UI.$$("[data-contact]", root).forEach((b) => b.addEventListener("click", async () => {
      const [l, f] = b.dataset.contact.split("|"); if (!(await doIt(b, () => LF.contactOwner(l, f)))) return;
      b.textContent = "Owner notified ✓"; b.disabled = true; UI.announce("Owner notified");
    }));
    UI.$$("[data-dismiss]", root).forEach((b) => b.addEventListener("click", async () => {
      const [l, f] = b.dataset.dismiss.split("|"); if (!(await doIt(b, () => LF.dismissMatch(l, f)))) return; UI.announce("Match dismissed"); refresh();
    }));
    UI.$$("[data-quick]", root).forEach((b) => b.addEventListener("click", async () => {
      const [kind, id, st] = b.dataset.quick.split("|");
      if (st === "disposed" && !confirm("Mark this item as donated / disposed? It will be removed from the public list.")) return;
      if (!(await doIt(b, () => LF.setStatus(kind, id, st)))) return; UI.announce("Status updated"); refresh();
    }));
    UI.$$("[data-thanks]", root).forEach((form) => form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const note = form.note.value.trim();
      if (!note) { form.note.focus(); return; }
      if (!(await doIt(form.querySelector("button"), () => LF.setThankNote(form.dataset.thanks, note)))) return; UI.announce("Thank-you message sent"); foundDialog(form.dataset.thanks);
    }));
    UI.$$("[data-status-form]", root).forEach((form) => form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const [kind, id] = form.dataset.statusForm.split("|");
      if (await doIt(form.querySelector("button"), () => LF.setStatus(kind, id, form.status.value, form.note.value.trim()))) { UI.announce("Status updated"); refresh(); }
    }));
    UI.$$("[data-edit]", root).forEach((b) => b.addEventListener("click", () => { const [k, id] = b.dataset.edit.split("|"); editDialog(k, id); }));
    UI.$$("[data-storage]", root).forEach((form) => form.addEventListener("submit", async (e) => {
      e.preventDefault(); if (!(await doIt(form.querySelector("button"), () => LF.setStorage(form.dataset.storage, form.storage.value)))) return; UI.announce("Storage location saved"); UI.route(); foundDialog(form.dataset.storage);
    }));
    UI.$$("[data-transfer]", root).forEach((form) => form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (await doIt(form.querySelector("button"), () => LF.startTransfer(form.dataset.transfer, form.to.value, form.note.value.trim()))) { UI.announce("Item marked as being moved"); UI.route(); foundDialog(form.dataset.transfer); }
    }));
    UI.$$("[data-receive]", root).forEach((b) => b.addEventListener("click", async () => {
      if (!(await doIt(b, () => LF.receiveTransfer(b.dataset.receive)))) return; UI.announce("Item received"); UI.route(); foundDialog(b.dataset.receive);
    }));
  }

  /* ---------------- Smart matches ---------------- */
  function pageMatches(query) {
    const { esc, icon } = UI;
    const all = allMatches(), limit = Math.max(50, Number(query && query.get("n")) || 50), list = all.slice(0, limit);
    shell("matches", `
      <h1 class="staff-h1">Smart matches</h1>
      <p class="muted">The system compares type, name, brand, color, date, place and description — including private details. Matches are suggestions: please check before contacting the owner.</p>
      ${list.length ? `<ul class="match-list">${list.map((m) => `<li class="card match-row">
        <div class="match-row__score ${m.score >= 75 ? "is-strong" : ""}"><strong>${m.score}%</strong><span>${esc(m.strength)}</span></div>
        <div class="compare">
          <div><p class="compare__h">Lost report <span class="mono">${esc(m.lost.id)}</span></p>
            <p><strong>${esc(m.lost.itemName)}</strong><br><span class="muted">${esc(m.lost.name)} · ${esc(UI.fmtDate(m.lost.dateLost))} · ${esc(m.lost.branch || m.lost.location)}</span></p></div>
          <div><p class="compare__h">Found item <span class="mono">${esc(m.found.id)}</span></p>
            <p><strong>${esc(m.found.title)}</strong><br><span class="muted">${esc(UI.fmtDate(m.found.date))} · ${esc(m.found.branch || m.found.location)}</span></p></div>
        </div>
        <p class="match-why">${icon("i-spark")} ${esc(m.reasons.join(" · "))}</p>
        <div class="btn-row">
          <button type="button" class="btn btn--primary btn--sm" data-contact="${esc(m.lost.id)}|${esc(m.found.id)}">Contact owner</button>
          <button type="button" class="btn btn--outline btn--sm" data-dismiss="${esc(m.lost.id)}|${esc(m.found.id)}">Not a match</button>
          ${openBtn("lost", m.lost.id, "Open lost report")} ${openBtn("found", m.found.id, "Open found item")}
        </div></li>`).join("")}</ul>${all.length > list.length ? `<p style="text-align:center"><span class="muted">Showing the ${list.length} strongest of ${all.length} matches.</span> <a class="btn btn--outline" href="#/staff/matches?n=${limit + 50}">Show 50 more</a></p>` : ""}` : `<div class="empty">${icon("i-spark")}<p>No new matches to review.</p></div>`}`);
    wireDialogActions(UI.$("#staffMain"));
  }

  /* ---------------- Claims & verification ---------------- */
  function pageClaims(query) {
    const { esc } = UI;
    const st = query.has("s") ? query.get("s") : "open", q = query.get("q") || "";
    const list = LF.db.all("claims").filter((c) => (st === "open" ? ["submitted", "under-verification"].includes(c.status) : !st || c.status === st) && matchesQ(c, q, ["id", "itemTitle", "name", "phone", "itemId"]));
    shell("claims", `
      <h1 class="staff-h1">Claims to verify</h1>
      <form class="filters filters--staff" id="claimF" role="search">
        <div class="field"><label for="claimF-q">Search</label><input class="input" id="claimF-q" name="q" type="search" value="${esc(q)}" placeholder="Name, item, reference…" /></div>
        <div class="field"><label for="claimF-s">Show</label><select class="select" id="claimF-s" name="s">
          <option value="open" ${st === "open" ? "selected" : ""}>Waiting for a decision</option><option value="" ${!st ? "selected" : ""}>All claims</option>
          ${Object.keys(STATUS.claims).map((s) => `<option value="${s}" ${s === st ? "selected" : ""}>${esc(STATUS.claims[s].label)}</option>`).join("")}</select></div>
      </form>
      ${table(["Ref", "Item claimed", "Claimant", "Sent", "Status", ""], list.map((c) => `<tr>
        <th scope="row" class="mono">${esc(c.id)}</th>
        <td>${esc(c.itemTitle)}<br><span class="muted mono">${esc(c.itemId)}</span></td>
        <td>${esc(c.name)}<br><span class="muted">${esc(c.phone)}</span></td>
        <td>${esc(UI.fmtDateTime(c.createdAt))}</td><td>${UI.statusBadge("claims", c.status)}</td>
        <td>${openBtn("claims", c.id, ["submitted", "under-verification"].includes(c.status) ? "Verify" : c.status === "approved" ? "Release" : "Open")}</td></tr>`), "No claims waiting. 🎉")}`);
    wireFilter("claimF", "claims");
  }

  function claimDialog(id) {
    const { esc, icon } = UI;
    const c = LF.db.byId("claims", id);
    const f = LF.db.byId("found", c.itemId);
    const l = c.lostId ? LF.db.byId("lost", c.lostId) : null;
    const others = LF.db.all("claims").filter((x) => x.itemId === c.itemId && x.id !== c.id && ["submitted", "under-verification", "approved"].includes(x.status));
    const open = ["submitted", "under-verification"].includes(c.status);
    UI.openDialog(`
      <button type="button" class="btn btn--outline btn--sm dialog__close" data-close>${icon("i-x")} Close</button>
      <p class="muted mono" style="margin:0">${esc(c.id)}</p>
      <h2 id="dialogTitle">Verify claim: ${esc(c.itemTitle)}</h2>
      ${UI.statusBadge("claims", c.status)}
      ${others.length ? `<div class="alert alert--warn" style="margin-top:1rem">${icon("i-info")}<p>${others.length} other ${others.length === 1 ? "person has" : "people have"} also claimed this item (${others.map((o) => esc(o.id)).join(", ")}). Compare carefully.</p></div>` : ""}
      <div class="verify-grid">
        <section><h3>What the claimant says</h3>
          <dl class="review-list review-list--stack">
            <dt>Description</dt><dd>${esc(c.general)}</dd>
            <dt>${esc(UI.cat(f ? f.category : "others").question)}</dt><dd>${esc(c.specific || "—")}</dd>
            <dt>Date lost</dt><dd>${esc(UI.fmtDate(c.dateLost))}</dd>
            <dt>QCPL account</dt><dd>${(() => { const u = c.userId && LF.db.byId("users", c.userId); return u ? (u.verified ? '<span class="status status--green">Verified account</span>' : '<span class="status status--amber">Account not verified — check a valid ID</span>') : '<span class="status status--gray">Guest (no account) — check a valid ID</span>'; })()}</dd>
            <dt>Claimant</dt><dd>${esc(c.name)}${c.role ? ` · ${esc(c.role)}` : ""}${c.memberId ? ` · No. ${esc(c.memberId)}` : ""} · <a href="tel:${esc(UI.digits(c.phone))}">${esc(c.phone)}</a>${c.email ? ` · ${esc(c.email)}` : ""}</dd>
            ${l ? `<dt>Their lost report</dt><dd class="mono">${esc(l.id)}</dd><dt>Special marks they reported</dt><dd>${esc(l.uniqueDetails || "—")}</dd>` : `<dt>Lost report</dt><dd class="muted">None linked</dd>`}
          </dl></section>
        <section class="verify-private"><h3>${icon("i-shield")} What we know (private)</h3>
          ${f ? `<dl class="review-list review-list--stack">
            <dt>Item</dt><dd>${esc(f.title)}${f.brand ? " · " + esc(f.brand) : ""}${f.color ? " · " + esc(f.color) : ""}</dd>
            <dt>Private details</dt><dd><strong>${esc(f.privateDetails || "None recorded")}</strong></dd>
            <dt>Found</dt><dd>${esc(UI.fmtDate(f.date))} · ${f.branch ? esc(f.branch) + " · " : ""}${esc(f.location)}</dd>
          </dl>` : "<p>Item record missing.</p>"}</section>
      </div>
      ${c.status === "approved" ? `<p class="pickup-note">${UI.icon("i-cal")} ${c.pickup ? `Pick-up booked: <strong>${esc(LF.pickupLabel(c.pickup))}</strong> at ${esc(c.pickup.place || LF.keptAt(f))}` : `No pick-up time booked yet. The item is kept at <strong>${esc(LF.keptAt(f))}</strong>${f && f.storage ? ` (shelf / bin ${esc(f.storage)})` : ""}.`}</p>` : ""}
      <h3>Progress</h3>${UI.timeline("claims", c)}
      ${c.reviewNote ? `<p><strong>Note:</strong> ${esc(c.reviewNote)}</p>` : ""}
      ${open ? `<div class="decision">
          ${c.status === "submitted" ? `<button type="button" class="btn btn--outline" data-claim="under-verification">Start verification</button>` : ""}
          <button type="button" class="btn btn--primary" data-claim="approved">${icon("i-check")} Approve — details match</button>
          <div class="field" style="margin-top:1rem"><label for="rejectNote">Reason if not approved</label>
            <input class="input" id="rejectNote" placeholder="e.g. Description does not match the private details" /></div>
          <button type="button" class="btn btn--outline" data-claim="rejected" style="margin-top:.6rem">${icon("i-x")} Do not approve</button>
        </div>` : ""}
      ${c.status === "approved" ? `<form class="release card" id="releaseForm" novalidate>
          <h3>Record the return</h3>
          <p class="muted">Check the owner's valid ID in person before releasing the item.</p>
          <div id="relErr"></div>
          <div class="grid-2">
            <div class="field"><label for="relTo">Released to</label><input class="input" id="relTo" name="releasedTo" value="${esc(c.name)}" /></div>
            <div class="field"><label for="relId">ID presented</label><select class="select" id="relId" name="idType"><option value="">Choose ID</option>${ID_TYPES.map((t) => `<option>${esc(t)}</option>`).join("")}</select></div>
            <div class="field"><label for="relLast4">Last 4 characters of ID number</label><input class="input" id="relLast4" name="idLast4" maxlength="4" autocomplete="off" /></div>
            <div class="field"><label for="relNotes">Notes <span class="opt">(optional)</span></label><input class="input" id="relNotes" name="notes" placeholder="e.g. Picked up by daughter with authorization letter" /></div>
          </div>
          ${f && LF.digits(f.finderPhone) ? `<div class="field" style="margin-top:1rem"><label for="relThanks">Thank-you message for the finder, ${esc(f.finderName)} <span class="opt">(optional)</span></label>
            <p class="hint">Sent with their Certificate of Honesty.</p>
            <textarea class="textarea" id="relThanks" name="thankNote" placeholder="e.g. Salamat po! The owner was so relieved."></textarea></div>` : ""}
          <label class="checkline" for="relSigned" style="font-weight:400;margin-top:.75rem"><input type="checkbox" id="relSigned" name="signed" /><span>The owner signed the release logbook.</span></label>
          <button type="submit" class="btn btn--accent btn--lg" style="margin-top:1rem">${icon("i-check")} Mark as returned</button>
        </form>` : ""}`, (root) => {
      UI.$$("[data-claim]", root).forEach((b) => b.addEventListener("click", async () => {
        const st = b.dataset.claim;
        const note = st === "rejected" ? UI.$("#rejectNote", root).value.trim() : "";
        if (st === "rejected" && !note) { UI.$("#rejectNote", root).focus(); UI.announce("Please type a reason first"); UI.$("#rejectNote", root).closest(".field").classList.add("has-error"); return; }
        b.disabled = true;
        try { await LF.setClaimStatus(c.id, st, note); } catch (err) { b.disabled = false; return alert(err.message); }
        UI.route();            // refresh the list behind the dialog
        claimDialog(c.id);     // re-open with the new status
        UI.announce(`Claim status: ${STATUS.claims[st].label}`);
      }));
      const rf = UI.$("#releaseForm", root);
      rf && rf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errs = [];
        if (!rf.releasedTo.value.trim()) errs.push("Type who received the item.");
        if (!rf.idType.value) errs.push("Choose the ID presented.");
        if (!/^[A-Za-z0-9]{4}$/.test(rf.idLast4.value.trim())) errs.push("Type the last 4 characters of the ID number.");
        if (!rf.signed.checked) errs.push("Confirm the owner signed the logbook.");
        if (errs.length) { UI.$("#relErr", root).innerHTML = `<div class="alert alert--error" role="alert">${icon("i-info")}<ul style="margin:0">${errs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`; return; }
        try {
          await LF.recordReturn(c.id, { releasedTo: rf.releasedTo.value.trim().slice(0, 80), idType: rf.idType.value, idLast4: rf.idLast4.value.trim(), notes: rf.notes.value.trim().slice(0, 500),
            thankNote: rf.thankNote ? rf.thankNote.value.trim().slice(0, 120) : "" });
        } catch (err) { UI.$("#relErr", root).innerHTML = `<div class="alert alert--error" role="alert">${icon("i-info")}<p>${esc(err.message)}</p></div>`; return; }
        UI.announce("Item marked as returned");
        UI.closeDialog(); UI.route();
      });
    });
  }

  /* ---------------- Returned ---------------- */
  function pageReturned() {
    const { esc } = UI;
    const list = LF.db.all("found").filter((f) => f.status === "returned" && f.release).sort((a, b) => b.release.at.localeCompare(a.release.at));
    shell("returned", `
      <h1 class="staff-h1">Returned items</h1>
      <p class="muted">Official record of every item released to its owner.</p>
      ${table(["Ref", "Item", "Returned on", "Released to", "ID presented", "Days", "Released by", "Finder"], list.map((f) => `<tr>
        <th scope="row" class="mono">${esc(f.id)}</th><td>${esc(f.title)}<br><span class="muted">${esc(UI.cat(f.category).name)}</span></td>
        <td>${esc(UI.fmtDate(f.release.at))}</td><td>${esc(f.release.releasedTo)}${f.release.notes ? `<br><span class="muted">${esc(f.release.notes)}</span>` : ""}</td>
        <td>${esc(f.release.idType)}${f.release.idLast4 ? ` ••${esc(f.release.idLast4)}` : ""}</td>
        <td>${Math.max(0, Math.round((new Date(f.release.at.slice(0, 10)) - new Date(f.date)) / 86400000))}</td><td>${esc(f.release.by)}</td>
        <td>${LF.isRecognizable(f) ? `${esc(f.finderName)}<br><a href="#/certificate/${encodeURIComponent(f.id)}">Certificate</a>` : `<span class="muted">${esc(f.finderName || "Staff")}</span>`}</td></tr>`), "No items returned yet.")}`);
  }

  /* ---------------- Users ---------------- */
  function pageUsers() {
    const { esc } = UI;
    const users = LF.db.all("users");
    shell("users", `
      <h1 class="staff-h1">Registered users</h1>
      <p class="muted">Library members and visitors who created an account. Press <strong>Verify</strong> after checking the person's valid ID in person. Guests who report without an account are not listed here.</p>
      ${table(["Name", "Role", "Mobile", "Email", "Joined", "Reports", "ID / card no.", "Account", ""], users.map((u) => {
        const r = LF.recordsForPerson({ userId: u.id, phone: u.phone });
        return `<tr><th scope="row">${esc(u.name)}</th><td>${esc(u.role || USER_ROLES[0])}${u.memberId ? `<br><span class="muted">${esc(u.memberId)}</span>` : ""}</td><td>${esc(u.phone)}</td><td>${esc(u.email || "—")}</td><td>${esc(UI.fmtDate(u.createdAt))}</td>
          <td>${r.lost.length} lost · ${r.found.length} found · ${r.claims.length} claims</td>
          <td>${u.verified ? '<span class="status status--green">Verified</span>' : '<span class="status status--amber">Not verified</span>'}</td>
          <td>${u.active ? '<span class="status status--green">Active</span>' : '<span class="status status--gray">Turned off</span>'}</td>
          <td><div class="btn-row"><button type="button" class="btn btn--primary btn--sm" data-verify="${esc(u.id)}" data-on="${u.verified ? "0" : "1"}">${u.verified ? "Remove verification" : "Verify (ID checked)"}<span class="sr-only"> ${esc(u.name)}</span></button>
          <button type="button" class="btn btn--outline btn--sm" data-user="${esc(u.id)}" data-active="${u.active ? "0" : "1"}">${u.active ? "Turn off" : "Turn on"}<span class="sr-only"> ${esc(u.name)}</span></button>
          <button type="button" class="btn btn--outline btn--sm" data-reset-user="${esc(u.id)}">Reset password<span class="sr-only"> for ${esc(u.name)}</span></button></div></td></tr>`;
      }), "No registered users yet.")}`);
    UI.$$("[data-verify]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true; try { await LF.setUserVerified(b.dataset.verify, b.dataset.on === "1"); } catch (err) { b.disabled = false; return alert(err.message); } UI.announce("Verification updated"); pageUsers();
    }));
    UI.$$("[data-user]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true; try { await LF.setUserActive(b.dataset.user, b.dataset.active === "1"); } catch (err) { b.disabled = false; return alert(err.message); } UI.announce("Account updated"); pageUsers();
    }));
    UI.$$("[data-reset-user]").forEach((b) => b.addEventListener("click", async () => {
      const u = LF.db.byId("users", b.dataset.resetUser);
      if (!confirm(`Reset the password of ${u.name}?\n\nOnly do this after checking their valid ID in person.`)) return;
      try { showTempPassword(u.name, await LF.adminResetUserPassword(u.id)); } catch (err) { alert(err.message); UI.route(); }
    }));
  }

  /* ---------------- Staff accounts (supervisors) ---------------- */
  function pageStaff() {
    const { esc, icon } = UI;
    if (!LF.isSupervisor()) { shell("staff", `<h1 class="staff-h1">Staff accounts</h1><p>Only a supervisor can manage staff accounts.</p>`); return; }
    const built = STAFF_ACCOUNTS.filter((a) => a.library === activeLibrary().id || a.library === "all");
    const made = LF.staffList();
    shell("staff", `
      <h1 class="staff-h1">Staff accounts</h1>
      <p class="muted">Give every staff member their own account, so the activity log shows who did what. <strong>Desk staff</strong> handle reports, claims and returns. <strong>Supervisors</strong> can also manage staff, issue certificates, dispose of old items and clear records.</p>
      ${table(["Name", "Username", "Role", "Status", ""], [
        ...built.map((a) => `<tr><th scope="row">${esc(a.name)}</th><td class="mono">${esc(a.username)}</td><td>${esc(a.role)} <span class="muted">(built-in)</span></td><td><span class="status status--green">Active</span></td><td class="muted">Changes own password with "My password"</td></tr>`),
        ...made.map((s) => `<tr><th scope="row">${esc(s.name)}</th><td class="mono">${esc(s.username)}</td>
          <td><select class="select" data-role="${esc(s.id)}" aria-label="Role of ${esc(s.name)}">${STAFF_ROLES.map((r) => `<option ${r === s.role ? "selected" : ""}>${r}</option>`).join("")}</select></td>
          <td>${s.active ? '<span class="status status--green">Active</span>' : '<span class="status status--gray">Turned off</span>'}${s.mustChange ? '<br><span class="muted">Temporary password</span>' : ""}</td>
          <td><div class="btn-row"><button type="button" class="btn btn--outline btn--sm" data-staff-active="${esc(s.id)}|${s.active ? 0 : 1}">${s.active ? "Turn off" : "Turn on"}</button>
            <button type="button" class="btn btn--outline btn--sm" data-staff-reset="${esc(s.id)}">Reset password</button></div></td></tr>`),
      ], "No staff accounts yet.")}
      <form class="card" id="newStaff" style="margin-top:1.5rem">
        <h2 class="h3">Add a staff account</h2>
        <div class="grid-2">
          <div class="field"><label for="nsName">Full name</label><input class="input" id="nsName" name="name" /></div>
          <div class="field"><label for="nsUser">Username</label><p class="hint">Letters and numbers, no spaces. e.g. juan.cruz</p><input class="input" id="nsUser" name="username" autocapitalize="none" /></div>
          <div class="field"><label for="nsRole">Role</label><select class="select" id="nsRole" name="role">${STAFF_ROLES.map((r) => `<option>${r}</option>`).join("")}</select></div>
          <div class="field"><label for="nsPw">First password</label><p class="hint">At least 8 characters. They will be asked to change it.</p><input class="input" id="nsPw" name="password" type="text" autocomplete="off" /></div>
        </div>
        <div id="nsMsg" role="status"></div>
        <button class="btn btn--primary" type="submit">${icon("i-user")} Add staff account</button>
      </form>`);
    UI.$("#newStaff").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      try { await LF.createStaff({ name: f.name.value, username: f.username.value, role: f.role.value, password: f.password.value }); UI.announce("Staff account added"); pageStaff(); }
      catch (err) { UI.$("#nsMsg").innerHTML = `<div class="alert alert--error" role="alert">${icon("i-info")}<p>${esc(err.message)}</p></div>`; }
    });
    UI.$$("[data-role]").forEach((s) => s.addEventListener("change", async () => { try { await LF.setStaffRole(s.dataset.role, s.value); UI.announce("Role changed"); } catch (err) { alert(err.message); pageStaff(); } }));
    UI.$$("[data-staff-active]").forEach((b) => b.addEventListener("click", async () => { const [id, on] = b.dataset.staffActive.split("|"); b.disabled = true; try { await LF.setStaffActive(id, on === "1"); } catch (err) { alert(err.message); } pageStaff(); }));
    UI.$$("[data-staff-reset]").forEach((b) => b.addEventListener("click", async () => {
      const s = LF.staffList().find((x) => x.id === b.dataset.staffReset);
      if (!confirm(`Reset the password of ${s.name}?`)) return;
      try { showTempPassword(s.name, await LF.resetStaffPassword(s.id)); pageStaff(); } catch (err) { alert(err.message); UI.route(); }
    }));
  }

  /* ---------------- Printable item tag ---------------- */
  function pageTag(query) {
    const { esc, icon } = UI;
    const f = LF.db.byId("found", query.get("id") || "");
    if (!f) { shell("found", `<h1 class="staff-h1">Item tag</h1><p>Item not found.</p>`); return; }
    shell("found", `
      <div class="no-print"><h1 class="staff-h1">Item tag</h1>
        <p class="muted">Print and attach this tag to the item or its bag. Scanning the QR code with "Scan QR code" opens the record.</p>
        <div class="btn-row" style="margin-bottom:1rem"><button type="button" class="btn btn--primary" data-print>${icon("i-print")} Print tag</button>
          <a class="btn btn--outline" href="#/staff/found">${icon("i-back")} Back to found items</a></div></div>
      <article class="item-tag">
        <div class="item-tag__qr">${UI.qrSvg(f.id)}</div>
        <div class="item-tag__body">
          <p class="item-tag__org">QCPL Lost &amp; Found · ${esc(LIBRARY.shortName)}</p>
          <p class="item-tag__ref mono">${esc(f.id)}</p>
          <p class="item-tag__title">${esc(f.title)}</p>
          <dl>
            <dt>Found</dt><dd>${esc(UI.fmtDate(f.date))} · ${esc(f.branch || "")}</dd>
            <dt>Kept at</dt><dd>${esc(LF.keptAt(f))}${f.storage ? ` · <strong>${esc(f.storage)}</strong>` : ""}</dd>
            <dt>Keep until</dt><dd>${esc(UI.fmtDate(LF.heldUntil(f)))}</dd>
          </dl>
        </div>
      </article>`);
  }

  /* ---------------- Activity ---------------- */
  function pageActivity(query) {
    const { esc } = UI;
    const q = query.get("q") || "";
    const list = LF.db.all("activity").filter((a) => matchesQ(a, q, ["actor", "action", "ref", "detail"])).slice(0, 300);
    shell("activity", `
      <h1 class="staff-h1">Activity log</h1>
      <p class="muted">Every important action — reports, claims, approvals, status changes and returns — is recorded here.</p>
      <form class="filters filters--staff" id="actF" role="search"><div class="field"><label for="actF-q">Search</label>
        <input class="input" id="actF-q" name="q" type="search" value="${esc(q)}" placeholder="Staff name, action, reference…" /></div></form>
      ${table(["When", "Who", "Action", "Reference", "Details"], list.map((a) => `<tr><td style="white-space:nowrap">${esc(UI.fmtDateTime(a.at))}</td>
        <td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td class="mono">${esc(a.ref)}</td><td>${esc(a.detail)}</td></tr>`), "No activity yet.")}`);
    const f = UI.$("#actF");
    f.addEventListener("submit", (e) => { e.preventDefault(); UI.go(`#/staff/activity?q=${encodeURIComponent(f.q.value)}`); });
    f.addEventListener("change", () => UI.go(`#/staff/activity?q=${encodeURIComponent(f.q.value)}`));
  }

  /* Open buttons in any staff table */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]");
    if (!b) return;
    const [kind, id] = b.dataset.open.split(":");
    ({ lost: lostDialog, found: foundDialog, claims: claimDialog })[kind](id);
  });

  /* ---------------- Route ---------------- */
  const PAGES = { dashboard: pageDashboard, lost: pageLost, found: pageFound, matches: pageMatches, claims: pageClaims, returned: pageReturned, users: pageUsers, activity: pageActivity, staff: pageStaff, tag: pageTag, ...(window.LF_ADMIN_PAGES || {}) };
  window.AdminShell = { shell, table, openBtn, openRecord };
  window.LF_ROUTES.staff = {
    title: "Administrator Area",
    render(r) {
      if (!LF.currentStaff()) return gate(r);
      if (r.param && !PAGES[r.param]) return shell("dashboard", `<h1 class="staff-h1">Page not found</h1><p>This administrator page does not exist.</p><a class="btn btn--primary" href="#/staff/dashboard">Go to the dashboard</a>`);
      (PAGES[r.param] || pageDashboard)(r.query);
    },
  };
})();
