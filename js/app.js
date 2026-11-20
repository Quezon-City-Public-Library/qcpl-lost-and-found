/* ==========================================================================
   QCPL Lost & Found — Quezon City Public Library
   Public website: routing, pages, step-by-step forms, accessibility tools.
   Staff/admin pages live in js/admin.js and use the helpers exported as UI.
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------- Helpers ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const main = $("#main");

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Reports linked only by mobile number appear on someone's page once that number is confirmed
  const myPhone = (u) => (u && u.contactVerified !== false ? u.phone : "");
  const icon = (id, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const cat = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
  const todayISO = () => toISODate(new Date());
  const digits = LF.digits;

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
    return d.toLocaleDateString(uiLocale(), { month: "long", day: "numeric", year: "numeric" });
  }
  function fmtDateTime(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString(uiLocale(), { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function relDay(iso) {
    const diff = Math.round((new Date(todayISO() + "T00:00:00") - new Date(iso + "T00:00:00")) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7) return `${diff} days ago`;
    return fmtDate(iso);
  }
  function statusBadge(kind, key) {
    const s = (STATUS[kind] || {})[key] || { label: key, tone: "gray" };
    return `<span class="status status--${s.tone}">${esc(s.label)}</span>`;
  }
  function announce(msg) {
    const a = $("#announcer");
    a.textContent = "";
    setTimeout(() => (a.textContent = msg), 60);
  }
  function parseHash() {
    const raw = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = raw.split("?");
    const parts = path.split("/").filter(Boolean);
    return { name: parts[0] || "home", param: parts[1] || null, parts, query: new URLSearchParams(qs || "") };
  }
  /* Media files: in the single-file offline build they are embedded
     (window.OFFLINE_ASSETS) and turned into blob URLs once. */
  const assetCache = {};
  function assetUrl(path) {
    const a = window.OFFLINE_ASSETS && window.OFFLINE_ASSETS[path];
    if (!a) return path;
    if (!assetCache[path]) {
      const bin = atob(a.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      assetCache[path] = URL.createObjectURL(new Blob([bytes], { type: a.type }));
    }
    return assetCache[path];
  }
  /* QR code (assets/vendor/qrcode.js). Holds just the reference number, so it
     works offline and the office can scan it instead of typing. */
  function qrSvg(text, cell = 4) {
    try { const q = qrcode(0, "M"); q.addData(String(text)); q.make(); return q.createSvgTag(cell, 8); }
    catch { return ""; }
  }
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

  /* ---------------- Library details into the shell ---------------- */
  /* A signed-in user, or a library administrator, stays inside their own library. */
  function libraryLocked() {
    const staff = LF.currentStaff();
    return !!LF.currentUser() || (!!staff && staff.library !== "all");
  }
  function renderLibraryShell() {
    const chosen = !!LF.selectedLibraryId() || libraryLocked();
    $$("[data-library-label]").forEach((el) => (el.textContent = "Lost & Found")); // the library itself is shown in the chip above
    const chip = $("#libraryChip");
    chip.hidden = !chosen;
    chip.innerHTML = `${icon("i-pin")} <span class="chip__long">${esc(LIBRARY.libraryName)}</span><span class="chip__short">${esc(LIBRARY.shortName)}</span>${libraryLocked() ? "" : ' <span class="library-chip__change">Change</span>'}`;
    chip.setAttribute("aria-label", libraryLocked() ? `You are using the ${LIBRARY.libraryName}` : `You are using the ${LIBRARY.libraryName}. Change library`);
    fillLibraryDetails();
  }

  function fillLibraryDetails(root = document) {
    $$("[data-library-text]", root).forEach((el) => (el.textContent = LIBRARY[el.dataset.libraryText]));
    $$("[data-library]", root).forEach((el) => (el.href = LIBRARY[el.dataset.library]));
    $$("[data-library-social]", root).forEach((el) => (el.href = LIBRARY.social[el.dataset.librarySocial]));
    $$("[data-library-mail]", root).forEach((el) => { el.href = "mailto:" + LIBRARY.email; el.textContent = LIBRARY.email; });
  }

  /* ---------------- Accessibility preferences ---------------- */
  const prefs = LF.prefs();
  function applyPrefs() {
    document.documentElement.dataset.contrast = String(!!prefs.contrast);
    $("#contrastBtn").setAttribute("aria-pressed", String(!!prefs.contrast));
  }
  $("#contrastBtn").addEventListener("click", () => {
    prefs.contrast = !prefs.contrast;
    LF.savePrefs(prefs); applyPrefs();
    announce(prefs.contrast ? "High contrast on" : "High contrast off");
  });

  /* Read aloud (uses the browser's built-in voice) */
  const readBtn = $("#readBtn");
  const canSpeak = "speechSynthesis" in window;
  if (!canSpeak) readBtn.hidden = true;
  function stopReading() {
    if (!canSpeak) return;
    speechSynthesis.cancel();
    readBtn.setAttribute("aria-pressed", "false");
    readBtn.querySelector("span").textContent = "Read page aloud";
    main.classList.remove("is-speaking");
  }
  readBtn.addEventListener("click", () => {
    if (readBtn.getAttribute("aria-pressed") === "true") return stopReading();
    const text = main.innerText.replace(/\s+\n/g, "\n").trim();
    const chunks = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
    speechSynthesis.cancel();
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c.trim());
      u.lang = typeof I18N !== "undefined" && I18N.lang === "fil" ? "fil-PH" : "en-PH";
      u.rate = 0.9;
      if (i === chunks.length - 1) u.onend = stopReading;
      speechSynthesis.speak(u);
    });
    readBtn.setAttribute("aria-pressed", "true");
    readBtn.querySelector("span").textContent = "Stop reading";
    main.classList.add("is-speaking");
  });

  /* Mobile menu */
  const menuBtn = $(".menu-toggle");
  const nav = $("#primaryNav");
  menuBtn.addEventListener("click", () => {
    const open = menuBtn.getAttribute("aria-expanded") !== "true";
    menuBtn.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  });
  function closeMenu() { menuBtn.setAttribute("aria-expanded", "false"); nav.classList.remove("is-open"); }

  /* Account link in the header (shows unread updates) */
  function unreadFor(user) {
    return user ? LF.notificationsFor({ userId: user.id, phone: myPhone(user) }).filter((n) => !n.read).length : 0;
  }
  function renderAccountLink() {
    const a = $("#accountLink");
    const user = LF.currentUser();
    if (LF.currentStaff()) {
      a.href = "#/staff/dashboard";
      a.dataset.nav = "staff";
      a.innerHTML = `${icon("i-shield")} <span class="account-link__text">Admin dashboard</span>`;
    } else if (user) {
      const n = unreadFor(user);
      a.href = "#/my";
      a.dataset.nav = "my";
      a.innerHTML = `${icon("i-bell")} <span class="account-link__text">My reports</span>${n ? ` <span class="count-badge">${n}<span class="sr-only"> new ${n === 1 ? "update" : "updates"}</span></span>` : ""}`;
    } else {
      a.href = "#/signin";
      a.dataset.nav = "signin";
      a.innerHTML = `${icon("i-user")} <span class="account-link__text">Sign in</span>`;
    }
  }

  /* ---------------- Shared UI pieces ---------------- */
  /* Picture area of an item: the real photo if there is one, otherwise an
     illustration of that kind of item drawn in the item's own color. */
  /* Photos of IDs, cards, wallets and phones (lock screens) can show someone's name, number
     or face, so the public sees an illustration instead. Staff and the person who sent
     the report still see the real photo. */
  const PRIVATE_PHOTO_CATS = ["wallets", "phones"];
  // A photo from the form (data:…) or one stored on the server (/api/v1/photo/…)
  const safePhoto = (u) => typeof u === "string" && (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u) || /^\/api\/v1\/photo\/[a-f0-9]{32}$/.test(u));
  function photoVisible(item) {
    if (!item || !safePhoto(item.photo)) return false;
    if (LF.currentStaff() || !PRIVATE_PHOTO_CATS.includes(item.category)) return true;
    const u = LF.currentUser();
    return !!(u && item.userId && item.userId === u.id);
  }
  function thumb(item, withChip = true) {
    const c = cat(item.category);
    const title = item.title || item.itemName;
    const inner = photoVisible(item)
      ? `<img src="${item.photo}" alt="Photo of ${esc(title)}" />`
      : `${ItemArt.svg(item)}<span class="art-note">Illustration</span>`;
    return `<div class="item-thumb ${photoVisible(item) ? "has-photo" : ""}">
      ${inner}${withChip ? `<span class="chip-cat">${icon(c.icon)} ${esc(c.name)}</span>` : ""}
    </div>`;
  }

  /* Color swatch + color name + brand, e.g. "● Black · Casio" */
  function itemFacts(item) {
    const bits = [];
    if (item.color && item.color !== "Other") bits.push(`<span class="swatch" style="background:${ItemArt.hex(item.color)}"></span>${esc(item.color)}`);
    if (item.brand) bits.push(esc(item.brand));
    return bits.length ? `<p class="item-facts">${bits.join('<span class="dot" aria-hidden="true">·</span>')}</p>` : "";
  }

  /* "District Library – Roxas Branch (under renovation)" → "Roxas Branch" */
  const shortBranch = (b) => String(b || "").replace(/^District Library – /, "").replace(/ \(.*\)$/, "");

  // The administrator area always stays in English
  const isFil = () => typeof I18N !== "undefined" && I18N.lang === "fil" && !document.body.classList.contains("is-staff");
  /* ---------------- Analytics: stat tiles + monthly chart ----------------
     Counts only — never which items were lost or found. Used on the home page
     and on the administrator dashboard. Written in the chosen language directly. */
  const SERIES = [
    ["lost", "Lost reports", "Ulat ng nawala", "var(--viz-1)"],
    ["found", "Found items reported", "Iniulat na napulot", "var(--viz-2)"],
    ["returned", "Returned to owners", "Naibalik sa may-ari", "var(--viz-3)"],
  ];
  const L = (en, fil) => (isFil() ? fil : en);
  function niceTop(max) {
    if (max <= 4) return { top: 4, step: 1 };
    const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
    return { top: Math.ceil(max / step) * step, step };
  }
  const monthShort = (key) => new Date(key + "-01T00:00:00").toLocaleDateString(uiLocale(), { month: "short" });
  const monthLong = (key) => new Date(key + "-01T00:00:00").toLocaleDateString(uiLocale(), { month: "long", year: "numeric" });
  function statTiles() {
    const t = LF.totals(), m = LF.monthlyTotals(2), now = m[1], prev = m[0];
    const delta = now.returned - prev.returned;
    const tile = (label, value, note) => `<li class="stat"><span class="stat__label">${esc(label)}</span><strong class="stat__value">${value}</strong>${note ? `<span class="stat__note">${note}</span>` : ""}</li>`;
    return `<div class="stats-row">
      <div class="stat stat--hero">
        <span class="stat__label">${esc(L("Items returned to their owners", "Mga gamit na naibalik sa may-ari"))}</span>
        <strong class="stat__value">${t.returned.toLocaleString(uiLocale())}</strong>
        <span class="stat__note">${esc(L(`${now.returned} this month`, `${now.returned} ngayong buwan`))}${prev.returned || now.returned ? ` · <span class="delta ${delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""}">${delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} ${esc(L(`${Math.abs(delta)} vs last month`, `${Math.abs(delta)} kumpara noong nakaraang buwan`))}</span>` : ""}</span>
      </div>
      <ul class="stats">
        ${tile(L("Lost reports", "Ulat ng nawala"), t.lost.toLocaleString(uiLocale()), esc(L(`${now.lost} this month`, `${now.lost} ngayong buwan`)))}
        ${tile(L("Found items reported", "Iniulat na napulot"), t.found.toLocaleString(uiLocale()), esc(L(`${now.found} this month`, `${now.found} ngayong buwan`)))}
        ${tile(L("Found items returned", "Napulot na naibalik"), `${t.returnRate}%`, esc(L("of all found items", "ng lahat ng napulot")))}
      </ul>
    </div>`;
  }
  /* The chart is drawn to fit the width it has (wider bars' spacing on big
     screens, a sideways-scrolling chart on phones), and redrawn on resize. */
  function chartSvg(months, width) {
    const max = Math.max(0, ...months.flatMap((m) => SERIES.map(([k]) => m[k])));
    const { top, step } = niceTop(max);
    const H = 180, axis = 34, barW = 12, gap = 2, padT = 10;
    const groupW = Math.max(52, Math.min(120, (width - axis - 6) / months.length));
    const W = axis + months.length * groupW + 6;
    const y = (v) => padT + H - (v / top) * H;
    const bar = (x, v, color) => {
      if (!v) return "";
      const yt = y(v), h = padT + H - yt, r = Math.min(4, h);
      return `<path d="M${x} ${padT + H} V${yt + r} Q${x} ${yt} ${x + r} ${yt} H${x + barW - r} Q${x + barW} ${yt} ${x + barW} ${yt + r} V${padT + H} Z" fill="${color}"/>`;
    };
    const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
    const groups = months.map((m, i) => {
      const gx = axis + i * groupW, x0 = gx + (groupW - (barW * 3 + gap * 2)) / 2;
      const tip = `${monthLong(m.key)}|${SERIES.map(([k, en, fil]) => `${L(en, fil)}: ${m[k]}`).join("|")}`;
      return `<g class="viz__group" tabindex="0" role="img" data-tip="${esc(tip)}" aria-label="${esc(tip.replace(/\|/g, ". "))}">
        <rect class="viz__hit" x="${gx}" y="0" width="${groupW}" height="${padT + H + 26}"/>
        ${SERIES.map(([k, , , c], j) => bar(x0 + j * (barW + gap), m[k], c)).join("")}
        <text class="viz__x" x="${gx + groupW / 2}" y="${padT + H + 18}" text-anchor="middle">${esc(monthShort(m.key))}${m.key.endsWith("-01") || i === 0 ? ` ’${m.key.slice(2, 4)}` : ""}</text>
      </g>`;
    }).join("");
    return `<svg class="viz__svg" viewBox="0 0 ${W} ${padT + H + 26}" width="${W}" height="${padT + H + 26}" role="group" aria-label="${esc(L("Lost reports, found items and returns per month", "Ulat ng nawala, napulot at naibalik bawat buwan"))}">
      ${ticks.map((v) => `<line class="viz__grid ${v === 0 ? "is-base" : ""}" x1="${axis}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}"/><text class="viz__y" x="${axis - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
      ${groups}
    </svg>`;
  }
  function drawCharts() {
    $$(".viz__scroll[data-months]").forEach((box) => {
      const width = box.clientWidth;
      if (!width || Number(box.dataset.drawn) === width) return;
      box.dataset.drawn = width;
      const tip = '<div class="viz__tip" role="status" hidden></div>';
      box.innerHTML = chartSvg(JSON.parse(box.dataset.months), width) + tip;
      box.scrollLeft = box.scrollWidth; // newest month in view on small screens
    });
  }
  window.addEventListener("resize", () => requestAnimationFrame(drawCharts));
  function monthlyChart(months, chartId) {
    return `<div class="viz" id="${chartId}" data-no-tr>
      <ul class="viz__legend">${SERIES.map(([, en, fil, c]) => `<li><span class="viz__key" style="background:${c}"></span>${esc(L(en, fil))}</li>`).join("")}</ul>
      <div class="viz__scroll" data-months="${esc(JSON.stringify(months))}"></div>
      <details class="table-toggle"><summary>${esc(L("Show as a table", "Ipakita bilang talaan"))}</summary>
        <div class="table-wrap"><table><thead><tr><th scope="col">${esc(L("Month", "Buwan"))}</th>${SERIES.map(([, en, fil]) => `<th scope="col">${esc(L(en, fil))}</th>`).join("")}</tr></thead>
        <tbody>${months.slice().reverse().map((m) => `<tr><th scope="row">${esc(monthLong(m.key))}</th>${SERIES.map(([k]) => `<td>${m[k]}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      </details>
    </div>`;
  }
  /* One tooltip per chart, shown on hover or keyboard focus of a month */
  function showTip(g) {
    const viz = g.closest(".viz"), tip = $(".viz__tip", viz), [title, ...rows] = g.dataset.tip.split("|");
    tip.innerHTML = `<strong>${esc(title)}</strong>${rows.map((r, i) => `<span><i style="background:${SERIES[i][3]}"></i>${esc(r)}</span>`).join("")}`;
    tip.hidden = false;
    const box = $(".viz__scroll", viz).getBoundingClientRect(), r = g.querySelector(".viz__hit").getBoundingClientRect();
    const left = Math.min(Math.max(r.left - box.left + $(".viz__scroll", viz).scrollLeft + r.width / 2 - tip.offsetWidth / 2, 0), $(".viz__scroll", viz).scrollWidth - tip.offsetWidth);
    tip.style.left = `${left}px`;
    $$(".viz__group", viz).forEach((x) => x.classList.toggle("is-on", x === g));
  }
  function hideTip(viz) { const tip = $(".viz__tip", viz); if (tip) tip.hidden = true; $$(".viz__group", viz).forEach((x) => x.classList.remove("is-on")); }
  document.addEventListener("pointerover", (e) => { const g = e.target.closest && e.target.closest(".viz__group"); if (g) showTip(g); });
  document.addEventListener("pointerout", (e) => { const v = e.target.closest && e.target.closest(".viz"); if (v && !v.contains(e.relatedTarget)) hideTip(v); });
  document.addEventListener("focusin", (e) => { const g = e.target.closest && e.target.closest(".viz__group"); if (g) showTip(g); });
  document.addEventListener("focusout", (e) => { const v = e.target.closest && e.target.closest(".viz"); if (v && !v.contains(e.relatedTarget)) hideTip(v); });

  const peso = (n) => "₱" + Number(n || 0).toLocaleString("en-PH");

  function itemCard(item, match) {
    return `<article class="item-card">
      <div class="item-card__top">
        ${thumb(item)}
        <span class="chip-when" title="Found ${esc(fmtDate(item.date))}">${icon("i-cal")}<span class="sr-only">Found </span>${esc(/\d{4}$/.test(relDay(item.date)) ? new Date(item.date + "T00:00:00").toLocaleDateString(uiLocale(), { month: "short", day: "numeric" }) : relDay(item.date))}</span>
      </div>
      <div class="item-body">
        <h3>${esc(item.title)}</h3>
        ${itemFacts(item)}
        ${match ? `<p class="match-tag ${match.score >= 75 ? "is-strong" : ""}">${icon("i-spark")} ${match.score}% match · ${esc(match.strength)}</p>
          <p class="match-why">${esc(match.reasons.join(" · "))}</p>` : ""}
        <p class="meta">${icon("i-pin")}<span><span class="sr-only">Found at </span>${item.branch ? `${esc(shortBranch(item.branch))} · ` : ""}${esc(item.location)}${item.floor && item.floor !== "I'm not sure" ? `, ${esc(item.floor)}` : ""}</span></p>
        <div class="item-card__foot">
          ${statusBadge("found", item.status)}
          <button type="button" class="btn btn--primary btn--sm btn--block" data-view-item="${esc(item.id)}">
            See details<span class="sr-only"> for ${esc(item.title)}</span> ${icon("i-arrow")}
          </button>
        </div>
      </div>
    </article>`;
  }

  function pageHead(title, lead, back) {
    return `<div class="page-head"><div class="container">
      ${back ? `<a class="back-link" href="${back.href}">${icon("i-back")} ${esc(back.label)}</a>` : ""}
      <h1>${title}</h1>
      ${lead ? `<p>${lead}</p>` : ""}
    </div></div>`;
  }

  function deskPanel() {
    return `<div class="panel">
      <h2>Lost &amp; Found <em>Office</em></h2>
      <p class="muted">Visit us or call — our staff will gladly help you.</p>
      <ul class="info-list">
        <li>${icon("i-pin")}<div><strong>Where</strong><span>${esc(LIBRARY.deskLocation)}</span></div></li>
        <li>${icon("i-clock")}<div><strong>Open</strong><span>${esc(LIBRARY.hours)}<br />${esc(LIBRARY.hoursNote)}</span></div></li>
        <li>${icon("i-call")}<div><strong>Call</strong><a href="${LIBRARY.phoneHref}">${esc(LIBRARY.phone)}</a></div></li>
      </ul>
      <div class="btn-row">
        <a class="btn btn--outline" href="#/contact">Directions &amp; map ${icon("i-arrow")}</a>
      </div>
    </div>`;
  }

  /* Progress tracker using the doc's status steps, with dates from history */
  function timeline(kind, rec) {
    const flow = [...FLOWS[kind]];
    if (!flow.includes(rec.status)) flow.push(rec.status); // e.g. closed / rejected / disposed
    const idx = flow.indexOf(rec.status);
    const when = (st) => { const h = (rec.history || []).filter((x) => x.status === st).pop(); return h ? fmtDate(h.at) : ""; };
    return `<ol class="timeline" aria-label="Progress">
      ${flow.map((st, i) => {
        const state = i < idx ? "done" : i === idx ? "current" : "todo";
        return `<li class="timeline__step is-${state}" ${i === idx ? 'aria-current="step"' : ""}>
          <span class="timeline__dot" aria-hidden="true">${i < idx || (i === idx && i === flow.length - 1) ? icon("i-check") : ""}</span>
          <span class="timeline__text"><strong>${esc(STATUS[kind][st].label)}</strong>
          ${state !== "todo" && when(st) ? `<span class="muted">${esc(when(st))}</span>` : ""}
          ${state === "current" ? `<span class="muted">${esc(STATUS[kind][st].help)}</span>` : ""}
          <span class="sr-only">${state === "done" ? "(done)" : state === "current" ? "(current step)" : "(not yet)"}</span></span>
        </li>`;
      }).join("")}
    </ol>`;
  }

  function notifList(list, { markable } = {}) {
    if (!list.length) return `<p class="muted">No updates yet. We'll post updates here${markable ? "" : " and contact you"} as soon as something changes.</p>`;
    // Shown in the visitor's language when the update has its values saved
    const fil = typeof I18N !== "undefined" && I18N.lang === "fil";
    const words = (n) => (fil && n.vars && MESSAGES_FIL[n.type] ? MESSAGES_FIL[n.type](n.vars) : n);
    return `<ul class="notif-list">${list.map((n) => `
      <li class="notif ${n.read ? "" : "is-unread"}">
        <span class="notif__icon">${icon("i-bell")}</span>
        <div><p class="notif__title" data-no-tr>${esc(words(n).title)} ${n.read ? "" : `<span class="new-pill">${isFil() ? "Bago" : "New"}</span>`}</p>
        <p data-no-tr>${esc(words(n).body)}</p>
        <p class="muted notif__meta">${esc(fmtDateTime(n.at))} · Ref ${esc(n.ref)}${n.delivery && (n.delivery.email === "sent" || n.delivery.sms === "sent")
          ? ` · Also sent by ${[n.delivery.email === "sent" ? "email" : "", n.delivery.sms === "sent" ? "text message" : ""].filter(Boolean).join(" and ")}` : ""}</p></div>
      </li>`).join("")}</ul>`;
  }

  /* ---------------- Dialog ---------------- */
  const dialog = $("#dialog");
  function openDialog(html, onOpen) {
    $("#dialogBody").innerHTML = html;
    if (!dialog.open) dialog.showModal();
    $$("[data-close]", dialog).forEach((b) => b.addEventListener("click", () => dialog.close()));
    onOpen && onOpen($("#dialogBody"));
    ($("[data-close]", dialog) || dialog).focus();
  }
  const closeDialog = () => dialog.open && dialog.close();
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  function showItem(id) {
    const item = LF.db.byId("found", id);
    if (!item) return;
    const c = cat(item.category);
    openDialog(`
      <button type="button" class="btn btn--outline btn--sm dialog__close" data-close>${icon("i-x")} Close</button>
      <h2 id="dialogTitle">${esc(item.title)}</h2>
      ${thumb(item, false)}
      ${photoVisible(item) && photosOf(item).length > 1 ? `<p class="muted" style="margin:.75rem 0 .25rem">All ${photosOf(item).length} photos (press a photo to make it larger):</p>${photoStrip(photosOf(item), "Photo of " + item.title)}` : ""}
      ${statusBadge("found", item.status)}
      <dl class="review-list" style="margin-top:1rem">
        <dt>Type of item</dt><dd>${esc(c.name)}</dd>
        ${item.brand ? `<dt>Brand</dt><dd>${esc(item.brand)}</dd>` : ""}
        ${item.color ? `<dt>Color</dt><dd>${esc(item.color)}</dd>` : ""}
        <dt>Date found</dt><dd>${esc(fmtDate(item.date))}</dd>
        ${item.branch ? `<dt>Library</dt><dd>${esc(item.branch)}</dd>` : ""}
        <dt>Where found</dt><dd>${esc(item.location)}${item.floor ? ` — ${esc(item.floor)}` : ""}</dd>
        <dt>Kept at</dt><dd>${esc(LF.keptAt(item))}${item.transfer ? ` <span class="flag">Being moved to ${esc(item.transfer.to)}</span>` : ""}</dd>
        <dt>Notes</dt><dd>${esc(item.description || "—")}</dd>
        <dt>Item number</dt><dd><strong>${esc(item.id)}</strong></dd>
        <dt>Kept until</dt><dd>${esc(fmtDate(LF.heldUntil(item)))}${LF.daysLeft(item) <= LIBRARY.remindDaysBefore ? ` <span class="flag">${LF.daysLeft(item) < 0 ? "Past the holding period" : LF.daysLeft(item) === 0 ? "Last day" : `Only ${LF.daysLeft(item)} ${LF.daysLeft(item) === 1 ? "day" : "days"} left`}</span>` : ""}</dd>
      </dl>
      <div class="alert alert--info">${icon("i-shield")}<p>To protect the real owner, some details about this item are kept private. When you claim it, we will ask you a few questions only the owner can answer.</p></div>
      ${["recorded", "possible-owner", "claimed"].includes(item.status) ? `<div class="btn-row">
        <a class="btn btn--primary btn--lg" href="#/claim-item/${encodeURIComponent(item.id)}" data-close>This is mine — start my claim ${icon("i-arrow")}</a>
        <button type="button" class="btn btn--outline btn--lg" data-close>Keep looking</button>
      </div>` : item.status === "found" ? `<p class="hint">${icon("i-info")} The finder is still bringing this item to the office. You can start a claim once the office has recorded it.</p>` : ""}`);
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-view-item]");
    if (b) showItem(b.dataset.viewItem);
  });

  /* ==========================================================================
     PAGES
     ========================================================================== */

  /* ---------------- Home ---------------- */
  function pageHome() {
    const items = LF.publicFound();
    const st = LF.stats();
    main.innerHTML = `
    <section class="hero" aria-labelledby="heroTitle">
      <div class="hero__media"><img src="${assetUrl("assets/qcpl-hero.jpg")}" alt="" /></div>
      <div class="container">
        <div class="hero__inner">
          <p class="eyebrow">Lost &amp; Found · ${esc(LIBRARY.libraryName)}</p>
          <h1 id="heroTitle">Lost something at the library? We'll help you find it.</h1>
          <p class="hero__lead">Search the items turned in at the ${esc(LIBRARY.libraryName)}, or report what you lost and we'll look for a match.</p>
          <form class="hero-search" role="search" id="heroSearch">
            ${icon("i-search")}
            <label for="heroQ" class="sr-only">Search found items</label>
            <input id="heroQ" name="q" type="search" placeholder="Search found items, e.g. umbrella, wallet, QCitizen ID" autocomplete="off" />
            <button class="btn btn--primary" type="submit">Search</button>
          </form>
          <div class="btn-row">
            <a class="btn btn--light" href="#/report-lost">${icon("i-doc")} Report a lost item</a>
            <a class="btn btn--light" href="#/report-found">${icon("i-hand")} Report a found item</a>
          </div>
        </div>
      </div>
    </section>

    <section class="quick" aria-label="What would you like to do?">
      <div class="container">
        <div class="quick__grid">
          <a class="quick-card" href="#/report-lost">
            <span class="badge-ic badge-ic--blue">${icon("i-doc")}</span>
            <span><strong>I lost something</strong><span class="desc">Tell us what you lost. It takes about 3 minutes.</span></span>
          </a>
          <a class="quick-card" href="#/report-found">
            <span class="badge-ic badge-ic--blue">${icon("i-hand")}</span>
            <span><strong>I found something</strong><span class="desc">Thank you! Let us know so we can find the owner.</span></span>
          </a>
          <a class="quick-card" href="#/status">
            <span class="badge-ic badge-ic--blue">${icon("i-status")}</span>
            <span><strong>Check my report</strong><span class="desc">Use your reference number to see updates.</span></span>
          </a>
        </div>
      </div>
    </section>

    <section class="section analytics" aria-labelledby="statsTitle">
      <div class="container">
        <div class="section__head">
          <div><p class="kicker">Our results</p><h2 id="statsTitle">Items returned and reports each month</h2><p>Numbers for the ${esc(LIBRARY.libraryName)}. No details of any item are shown.</p></div>
        </div>
        ${statTiles()}
        <div class="card viz-card">${monthlyChart(LF.monthlyTotals(12), "homeChart")}</div>
      </div>
    </section>

    <section class="section" style="padding-top:1rem" aria-labelledby="catTitle">
      <div class="container">
        <div class="section__head">
          <div><p class="kicker">Browse</p><h2 id="catTitle">What are you <em>looking</em> for?</h2><p>Choose the kind of item you are looking for.</p></div>
          <a class="link-arrow" href="#/browse">See all found items ${icon("i-arrow")}</a>
        </div>
        <div class="cat-grid">
          ${CATEGORIES.map((c) => {
            const n = items.filter((i) => i.category === c.id).length;
            return `<a class="cat-card" href="#/browse?cat=${c.id}">
              <span class="badge-ic badge-ic--${c.tone}">${icon(c.icon)}</span>
              <strong>${esc(c.name)}</strong>
              <span class="desc">${esc(c.hint)}</span>
              <span class="count">${n} ${n === 1 ? "item" : "items"} waiting</span>
              ${icon("i-chev", "ic chev")}
            </a>`;
          }).join("")}
        </div>
      </div>
    </section>

    <section class="section section--tint" aria-labelledby="lostTitle">
      <div class="container">
        <div class="section__head">
          <div><p class="kicker">Lost item reports</p><h2 id="lostTitle">People are looking for their belongings</h2><p>To keep belongings safe, we only show how many reports there are and when they were made.</p></div>
          <a class="link-arrow" href="#/lost-items">See all lost item reports ${icon("i-arrow")}</a>
        </div>
        ${lostSummary(7)}
      </div>
    </section>

    ${wallSection()}

    <section class="section" aria-labelledby="howTitle">
      <div class="container">
        <div class="section__head">
          <div><p class="kicker">Four steps</p><h2 id="howTitle">How it <em>works</em></h2><p>From your report to getting your item back — all in one place.</p></div>
          <a class="link-arrow" href="#/claim">What to bring when claiming ${icon("i-arrow")}</a>
        </div>
        ${stepsList()}
        <div class="features">
          <div class="feature">${icon("i-spark")}<div><h3>Smart matching</h3><p>We compare your report with every found item — type, brand, color, place and date — and tell you when something looks like yours.</p></div></div>
          <div class="feature">${icon("i-shield")}<div><h3>Your item stays safe</h3><p>Some details of each found item are kept private. Only the real owner can answer our questions about them.</p></div></div>
          <div class="feature">${icon("i-bell")}<div><h3>Updates for you</h3><p>Follow every step — from "Searching" to "Returned" — with your reference number. The office also calls or texts you.</p></div></div>
        </div>
      </div>
    </section>

    <section class="section" style="padding-top:0" aria-label="Report an item and visit the office">
      <div class="container cta-split">
        <div class="cta-dark">
          <h2>Lost an <em>item?</em></h2>
          <p>Send us a report and we will keep an eye out for it. The more details you give, the easier it is for us to find it.</p>
          <div class="btn-row">
            <a class="btn btn--light btn--lg" href="#/report-lost">${icon("i-doc")} Report a lost item</a>
            <a class="btn btn--ghost-light btn--lg" href="#/report-found">${icon("i-hand")} Report a found item</a>
          </div>
        </div>
        ${deskPanel()}
      </div>
    </section>`;

    $("#heroSearch").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $("#heroQ").value.trim();
      location.hash = "#/browse" + (q ? "?q=" + encodeURIComponent(q) : "");
    });

  }

  function stepsList() {
    const steps = [
      ["Report", "Tell us about the item you lost or found — online or at the office."],
      ["Match", "Smart matching and the office staff compare reports with items turned in."],
      ["Verify", "You answer a few questions so we know the item is really yours."],
      ["Claim", "Bring a valid ID to the Lost & Found Desk and get your item back."],
    ];
    return `<ol class="steps">${steps.map(([t, d], i) => `
      <li class="step"><span class="step__num" aria-hidden="true">${i + 1}</span>
        <div><h3><span class="sr-only">Step ${i + 1}: </span>${t}</h3><p>${d}</p></div></li>`).join("")}</ol>`;
  }

  /* ---------------- Finder recognition ---------------- */
  function wallSection() {
    const wall = LF.wallOfHonesty(6);
    if (!wall.length) return "";
    return `<section class="section wall" aria-labelledby="wallTitle">
      <div class="container">
        <div class="section__head">
          <div><p class="kicker">Thank you</p><h2 id="wallTitle">Wall of <em>Honesty</em></h2><p>Thank you to these honest QCitizens who turned in what they found. Every item below is back with its owner.</p></div>
          <a class="link-arrow" href="#/report-found">Found something? Report it ${icon("i-arrow")}</a>
        </div>
        <ul class="wall__grid">${wall.map((w) => {
          const b = [...BADGES].reverse().find((x) => w.count >= x.min);
          return `<li class="wall-card">
            <span class="wall-card__icon">${icon("i-heart")}</span>
            <div>
              <p class="wall-card__name">${esc(w.name)}</p>
              <p>Most recently returned a <strong>${esc(w.item.toLowerCase())}</strong> found at the ${esc(w.location)}${w.count > 1 ? ` — <strong>${w.count} items</strong> returned in all` : ""}</p>
              <p class="muted wall-card__meta">${esc(fmtDate(w.at))}${b ? ` · <span class="badge-chip">${icon(b.icon)} ${esc(b.name)}</span>` : ""}</p>
            </div>
          </li>`;
        }).join("")}</ul>
        <p class="muted" style="margin:1rem 0 0;font-size:.92rem">Names are shown only with the finder's permission, using first name and last initial.</p>
      </div>
    </section>`;
  }

  /* Badge progress for a finder */
  function honestyCard(h, { compact } = {}) {
    const next = h.next;
    const pct = next ? Math.round((h.count / next.min) * 100) : 100;
    return `<div class="honesty ${compact ? "honesty--compact" : ""}">
      <div class="honesty__head">
        <span class="honesty__medal ${h.badge ? "" : "is-empty"}">${icon(h.badge ? h.badge.icon : "i-award")}</span>
        <div>
          <p class="honesty__title">${h.badge ? esc(h.badge.name) : "No badge yet"}</p>
          <p class="muted" style="margin:0">${h.count} ${h.count === 1 ? "item" : "items"} returned to ${h.count === 1 ? "its owner" : "their owners"} thanks to you</p>
        </div>
      </div>
      ${next ? `<div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${next.min}" aria-valuenow="${h.count}" aria-label="Progress to the ${esc(next.name)} badge">
          <span style="width:${pct}%"></span></div>
        <p class="muted" style="margin:.4rem 0 0">${next.min - h.count} more to earn <strong>${esc(next.name)}</strong></p>`
        : `<p style="margin:.6rem 0 0">You've earned every badge. The whole QCPL community thanks you!</p>`}
      ${compact ? "" : `<ul class="badge-row">${BADGES.map((b) => `<li class="${h.count >= b.min ? "is-earned" : ""}">
          ${icon(b.icon)}<span><strong>${esc(b.name)}</strong><span class="muted">${esc(b.desc)}</span>
          <span class="sr-only">${h.count >= b.min ? "(earned)" : "(not yet earned)"}</span></span></li>`).join("")}</ul>`}
    </div>`;
  }

  /* Shown on a returned found-item report */
  function recognitionBlock(f) {
    if (!LF.isRecognizable(f)) return "";
    const h = LF.honestyFor({ userId: f.userId, phone: f.finderPhone });
    return `<div class="recognition">
      <h3>${icon("i-award")} Thank you for your honesty!</h3>
      <p>The owner has their item back because of you.</p>
      ${f.thankNote ? `<blockquote class="thank-note"><p>"${esc(f.thankNote)}"</p><footer>— Lost &amp; Found Office</footer></blockquote>` : ""}
      ${honestyCard(h, { compact: true })}
      <a class="btn btn--accent btn--lg" href="#/certificate/${encodeURIComponent(f.id)}" style="margin-top:1rem">${icon("i-award")} View &amp; print my certificate</a>
    </div>`;
  }

  function pageCertificate(id) {
    const f = LF.db.byId("found", id);
    if (!LF.canViewCertificate(f)) {
      main.innerHTML = `${pageHead("Certificate of Honesty", "To protect your privacy, please open your certificate from your report.")}
        <section class="section"><div class="container"><div class="btn-row">
          <a class="btn btn--primary btn--lg" href="#/status?ref=${encodeURIComponent(id)}">${icon("i-status")} Check my report</a>
          <a class="btn btn--outline btn--lg" href="#/signin">${icon("i-user")} Sign in</a></div></div></section>`;
      return;
    }
    const h = LF.honestyFor({ userId: f.userId, phone: f.finderPhone });
    main.innerHTML = `
      <section class="section"><div class="container">
        <div class="btn-row no-print" style="margin-bottom:1.25rem">
          <button type="button" class="btn btn--primary btn--lg" data-print>${icon("i-print")} Print certificate</button>
          <a class="btn btn--outline btn--lg" href="${LF.currentStaff() ? "#/staff/returned" : LF.currentUser() ? "#/my" : "#/status?ref=" + encodeURIComponent(f.id)}">${icon("i-back")} Back</a>
        </div>
        <article class="certificate" aria-labelledby="certTitle">
          <div class="certificate__inner">
            <p class="certificate__org">Quezon City Public Library · ${esc(LIBRARY.libraryName)} · Lost &amp; Found</p>
            <h1 id="certTitle" tabindex="-1">Certificate of Honesty</h1>
            <p class="certificate__lead">This certificate is proudly presented to</p>
            <p class="certificate__name">${esc(f.finderName)}</p>
            ${isFil()
              ? `<p class="certificate__body" data-no-tr>dahil napulot at isinauli niya ang <strong>${esc(f.title.toLowerCase())}</strong> sa ${esc(I18N.t(f.location))}, ${esc(placeFil(f.branch || LIBRARY.libraryName))},
                  noong ${esc(fmtDate(f.date))}, na ligtas na naibalik sa tunay na may-ari noong ${esc(fmtDate(f.release.at))}.</p>
                <p class="certificate__body" data-no-tr>Dahil sa iyong katapatan, mas gumaganda ang Quezon City Public Library para sa bawat QCitizen. Maraming salamat po!</p>`
              : `<p class="certificate__body">for finding and turning in a <strong>${esc(f.title.toLowerCase())}</strong> at the ${esc(f.location)}, ${esc(f.branch || LIBRARY.libraryName)},
                  on ${esc(fmtDate(f.date))}, which was safely returned to its rightful owner on ${esc(fmtDate(f.release.at))}.</p>
                <p class="certificate__body">Your honesty makes the Quezon City Public Library a better place for every QCitizen. Thank you very much!</p>`}
            ${h.badge ? `<p class="certificate__badge">${icon(h.badge.icon)} ${esc(h.badge.name)} · ${h.count} ${h.count === 1 ? "item" : "items"} returned</p>` : ""}
            <div class="certificate__foot">
              <div><span class="certificate__line"></span>Lost &amp; Found Administrator</div>
              <div><span class="certificate__line"></span>Library Administration</div>
            </div>
            <p class="certificate__no">Certificate no. HF-${esc(f.id)}</p>
          </div>
        </article>
      </div></section>`;
    $("#certTitle").focus();
  }

  /* ---------------- Certificate of Contribution (monthly) ---------------- */
  function pageContribution(id) {
    const c = LF.db.byId("contribs", id);
    if (!LF.canViewContribution(c)) {
      main.innerHTML = `${pageHead("Certificate of Contribution", "To protect your privacy, please open your certificate from My reports, or check one of your reports first.")}
        <section class="section"><div class="container"><div class="btn-row">
          <a class="btn btn--primary btn--lg" href="#/status">${icon("i-status")} Check my report</a>
          <a class="btn btn--outline btn--lg" href="#/signin">${icon("i-user")} Sign in</a></div></div></section>`;
      return;
    }
    const nL = c.lostIds.length, nF = c.foundIds.length;
    const deeds = isFil()
      ? [nF ? `pagtulong na maibalik ang <strong>${nF} napulot na gamit</strong> sa tunay na may-ari` : "", nL ? `pag-uulat ng <strong>${nL} nawalang gamit</strong> sa sistemang ito` : ""].filter(Boolean).join(" at ")
      : [nF ? `helping return <strong>${nF} found ${nF === 1 ? "item" : "items"}</strong> to ${nF === 1 ? "its rightful owner" : "their rightful owners"}` : "",
         nL ? `reporting <strong>${nL} lost ${nL === 1 ? "item" : "items"}</strong> through the system` : ""].filter(Boolean).join(" and ");
    main.innerHTML = `
      <section class="section"><div class="container">
        <div class="btn-row no-print" style="margin-bottom:1.25rem">
          <button type="button" class="btn btn--primary btn--lg" data-print>${icon("i-print")} Print certificate</button>
          <a class="btn btn--outline btn--lg" href="${LF.currentStaff() ? "#/staff/recognition?m=" + encodeURIComponent(c.month) : LF.currentUser() ? "#/my" : "#/status"}">${icon("i-back")} Back</a>
        </div>
        <article class="certificate" aria-labelledby="certTitle">
          <div class="certificate__inner">
            <p class="certificate__org">Quezon City Public Library · ${esc(LIBRARY.libraryName)} · Lost &amp; Found</p>
            <h1 id="certTitle" tabindex="-1">Certificate of Contribution</h1>
            <p class="certificate__lead">This certificate of recognition is presented to</p>
            <p class="certificate__name">${esc(c.name)}</p>
            ${isFil()
              ? `<p class="certificate__body" data-no-tr>dahil sa aktibong pakikiambag sa Nawala at Napulot noong <strong>${esc(LF.monthName(c.month))}</strong> sa pamamagitan ng ${deeds}.</p>
                <p class="certificate__body" data-no-tr>Dahil sa iyong pakikiambag, nakakabalik sa may-ari ang mga nawawalang gamit. Maraming salamat po!</p>`
              : `<p class="certificate__body">for actively contributing to the Lost &amp; Found community in <strong>${esc(LF.monthName(c.month))}</strong> by ${deeds}.</p>
                <p class="certificate__body">Your contribution helps lost belongings find their way home. Thank you very much!</p>`}
            <div class="certificate__foot">
              <div><span class="certificate__line"></span>Lost &amp; Found Administrator</div>
              <div><span class="certificate__line"></span>Library Administration</div>
            </div>
            <p class="certificate__no">Certificate no. ${esc(c.id)} · Issued ${esc(fmtDate(c.issuedAt))}</p>
          </div>
        </article>
      </div></section>`;
    $("#certTitle").focus();
  }
  const contributionLinks = (list) => list.map((c) =>
    `<li><a href="#/contribution/${encodeURIComponent(c.id)}">${icon("i-award")} Certificate of Contribution — ${esc(LF.monthName(c.month))}</a></li>`).join("");

  /* ---------------- Lost item reports (counts only) ----------------
     What people lost is never listed, so nobody can use it to claim something
     that isn't theirs. Only how many reports are open and the day they were made. */
  function lostSummary(days) {
    const t = LF.totals(), rows = LF.lostReportsByDate(days);
    const dateLabel = (d) => new Date(d + "T00:00:00").toLocaleDateString(uiLocale(), { weekday: "short", month: "long", day: "numeric" });
    const most = Math.max(1, ...rows.map((r) => r.count));
    return `<div class="lost-sum" data-no-tr>
      <ul class="stats stats--lost">
        <li class="stat"><span class="stat__label">${esc(L("Open lost reports", "Bukas na ulat ng nawala"))}</span><strong class="stat__value">${t.openLost}</strong><span class="stat__note">${esc(L("still being looked for", "hinahanap pa"))}</span></li>
      </ul>
      <div class="card">
        <h3>${esc(L(`Reports in the last ${days} days`, `Mga ulat sa nakaraang ${days} araw`))}</h3>
        ${rows.length ? `<table class="by-date"><thead><tr><th scope="col">${esc(L("Date reported", "Petsa ng ulat"))}</th><th scope="col">${esc(L("Reports", "Bilang ng ulat"))}</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><th scope="row">${esc(dateLabel(r.date))}</th><td><span class="by-date__bar" style="width:${Math.max(6, (r.count / most) * 100)}%"></span><strong>${r.count}</strong> ${esc(L(r.count === 1 ? "report" : "reports", "ulat"))}</td></tr>`).join("")}</tbody></table>`
          : `<p class="muted">${esc(L(`No lost items were reported in the last ${days} days.`, `Walang iniulat na nawala sa nakaraang ${days} araw.`))}</p>`}
      </div>
      <div class="lost-sum__cta">
        <p>${esc(L("Found something? Report it — we'll check it against every lost report.", "May napulot ka? Iulat ito — itutugma namin ito sa bawat ulat ng nawala."))}</p>
        <div class="btn-row"><a class="btn btn--primary" href="#/report-found">${icon("i-hand")} ${esc(L("Report a found item", "Mag-ulat ng napulot"))}</a>
          <a class="btn btn--outline" href="#/report-lost">${icon("i-doc")} ${esc(L("Report a lost item", "Mag-ulat ng nawala"))}</a></div>
      </div>
    </div>`;
  }
  function pageLostItems() {
    main.innerHTML = `
      ${pageHead("Lost item reports", `How many lost items were reported at the <strong>${esc(LIBRARY.libraryName)}</strong>, and when. To keep belongings safe, we don't show what was lost.`)}
      <section class="section" style="padding-top:1.75rem">
        <div class="container">
          ${lostSummary(30)}
        </div>
      </section>`;
  }

  /* ---------------- Browse ---------------- */
  function pageBrowse(query) {
    const q0 = query.get("q") || "";
    const cat0 = query.get("cat") || "";
    main.innerHTML = `
      ${pageHead("<em>Found</em> items", `These items were turned in at the <strong>${esc(LIBRARY.libraryName)}</strong>. If you see something that is yours, open it and start your claim.`)}
      <section class="section" style="padding-top:1.75rem">
        <div class="container">
          <form class="filters" id="filters" role="search" aria-label="Search and filter found items">
            <div class="field">
              <label for="fq">Search by word</label>
              <input class="input" id="fq" name="q" type="search" value="${esc(q0)}" placeholder="e.g. umbrella, black, Samsung" autocomplete="off" />
            </div>
            <div class="field">
              <label for="fcat">Type of item</label>
              <select class="select" id="fcat" name="cat">
                <option value="">All types</option>
                ${CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === cat0 ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="floc">Which library</label>
              <select class="select" id="floc" name="loc">
                <option value="">All libraries here</option>
                ${LIBRARY.branches.map((l) => `<option>${esc(l)}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="fwhen">When it was found</label>
              <select class="select" id="fwhen" name="when">
                <option value="">Any time</option>
                <option value="3">Last 3 days</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
              </select>
            </div>
          </form>
          <div class="results-bar">
            <p id="resultCount" aria-live="polite"></p>
            <button type="button" class="btn btn--outline btn--sm" id="clearFilters">${icon("i-x")} Clear search</button>
          </div>
          <div id="results"></div>
          <div class="alert alert--info" style="margin-top:2rem">${icon("i-info")}
            <div><p><strong>Can't find your item?</strong> It may not have been turned in yet. Send us a report — our smart matching will keep checking new items for you.</p>
            <p><a class="btn btn--primary" href="#/report-lost">Report a lost item ${icon("i-arrow")}</a></p></div>
          </div>
        </div>
      </section>`;

    const form = $("#filters");
    const PAGE = 48;
    let shown = PAGE;
    $("#results").addEventListener("click", (e) => { if (e.target.closest("#moreItems")) { shown += PAGE; render(true); } });
    const render = (keep) => {
      if (keep !== true) shown = PAGE;
      const q = $("#fq").value.trim().toLowerCase();
      const c = $("#fcat").value;
      const l = $("#floc").value;
      const w = Number($("#fwhen").value || 0);
      const cutoff = w ? daysAgo(w) : "";
      const words = q.split(/\s+/).filter(Boolean);
      const list = LF.publicFound().filter((i) => {
        if (c && i.category !== c) return false;
        if (l && i.branch !== l) return false;
        if (cutoff && i.date < cutoff) return false;
        if (words.length) {
          const hay = [i.title, i.description, i.brand, i.color, i.branch, i.location, i.floor, cat(i.category).name].join(" ").toLowerCase();
          return words.every((wd) => LF.synonymsOf(wd).some((s) => hay.includes(s))); // "payong" also finds "umbrella"
        }
        return true;
      });
      $("#resultCount").textContent = list.length === 0 ? (LF.publicFound().length ? "No items match your search." : "No found items have been turned in yet.") : `Showing ${Math.min(shown, list.length)} of ${list.length} found ${list.length === 1 ? "item" : "items"}`;
      $("#results").innerHTML = list.length
        ? `<div class="item-grid">${list.slice(0, shown).map((i) => itemCard(i)).join("")}</div>${list.length > shown ? `<p style="text-align:center;margin-top:1.5rem"><button type="button" class="btn btn--outline btn--lg" id="moreItems">Show more items</button></p>` : ""}`
        : `<div class="empty">${icon("i-search")}<h2 style="font-size:1.4rem;margin-top:.5rem">Nothing found yet</h2>
           <p>Try a simpler word (for example "phone" instead of "iPhone 14"), or choose "All types".</p>
           <a class="btn btn--primary" href="#/report-lost">Report my lost item ${icon("i-arrow")}</a></div>`;
    };
    let t;
    form.addEventListener("input", () => { clearTimeout(t); t = setTimeout(render, 250); });
    form.addEventListener("change", render);
    form.addEventListener("submit", (e) => { e.preventDefault(); render(); });
    $("#clearFilters").addEventListener("click", () => { form.reset(); $("#fq").value = ""; $("#fcat").value = ""; render(); $("#fq").focus(); });
    render();
  }

  /* ==========================================================================
     FORM WIZARD — step-by-step forms with clear errors
     ========================================================================== */
  function fieldError(name, msg) {
    return `<p class="error-msg" id="${name}-err">${icon("i-info")}<span><span class="sr-only">Error: </span>${esc(msg)}</span></p>`;
  }

  /* Leaving a half-filled form asks first, so typed answers aren't lost by accident */
  let wizDirty = false;
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a || !wizDirty || !$("#wizForm") || a.target === "_blank") return;
    if (!confirm(isFil() ? "Aalis sa form na ito? Mawawala ang mga sagot na na-type mo." : "Leave this form? The answers you typed will be lost.")) { e.preventDefault(); e.stopImmediatePropagation(); }
    else wizDirty = false;
  }, true);
  window.addEventListener("beforeunload", (e) => { if (wizDirty && $("#wizForm")) { e.preventDefault(); e.returnValue = ""; } });

  function runWizard({ root, steps, state, submitLabel, onSubmit }) {
    let current = 0;
    const startedAt = Date.now();
    let botTrap = false; // remembered on every step, because each step redraws the form
    wizDirty = false;

    function draw(errors = {}) {
      const step = steps[current];
      const errKeys = Object.keys(errors);
      root.innerHTML = `
        <ol class="progress" aria-label="Form progress">
          ${steps.map((s, i) => `<li class="${i < current ? "done" : ""}" ${i === current ? 'aria-current="step"' : ""}>
            <span class="n" aria-hidden="true">${i < current ? "✓" : i + 1}</span>
            <span><span class="sr-only">Step ${i + 1} of ${steps.length}: </span>${esc(s.short)}${i < current ? '<span class="sr-only"> (done)</span>' : ""}</span></li>`).join("")}
        </ol>
        ${errKeys.length ? `<div class="alert alert--error" role="alert" id="errSummary" tabindex="-1">${icon("i-info")}
          <div><p><strong>Please check ${errKeys.length === 1 ? "this item" : `these ${errKeys.length} items`}:</strong></p>
          <ul>${errKeys.map((k) => `<li><a href="#f-${k}" data-jump="${k}">${esc(errors[k])}</a></li>`).join("")}</ul></div></div>` : ""}
        <form novalidate id="wizForm">
          <div class="hp" aria-hidden="true" data-no-tr><label for="f-lfhp">Leave this empty</label><input id="f-lfhp" name="lfhp" tabindex="-1" autocomplete="off" data-lpignore="true" data-1p-ignore /></div>
          <fieldset class="fieldset">
            <legend>${esc(step.title)}</legend>
            <p class="hint" style="margin-top:-.75rem">Step ${current + 1} of ${steps.length}. ${step.hint || ""}</p>
            ${step.render(state, errors)}
          </fieldset>
          <div class="form-nav">
            ${current > 0 ? `<button type="button" class="btn btn--outline btn--lg" id="wizBack">${icon("i-back")} Back</button>` : "<span></span>"}
            <button type="submit" class="btn ${current === steps.length - 1 ? "btn--accent" : "btn--primary"} btn--lg">
              ${current === steps.length - 1 ? `${icon("i-check")} ${esc(submitLabel)}` : `Next: ${esc(steps[current + 1].short)} ${icon("i-arrow")}`}
            </button>
          </div>
        </form>`;

      const form = $("#wizForm", root);
      form.addEventListener("input", () => (wizDirty = true), { once: true });
      step.afterRender && step.afterRender(form, state);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (form.dataset.sending) return;
        if (form.lfhp && form.lfhp.value) botTrap = true;
        collect(form);
        const errs = step.validate ? step.validate(state) : {};
        if (Object.keys(errs).length) {
          draw(errs);
          $("#errSummary", root).focus();
          return;
        }
        if (current < steps.length - 1) { current++; draw(); focusTop(); }
        else {
          // Bots fill the hidden box, or finish all steps in a few seconds
          if (botTrap || (form.lfhp && form.lfhp.value) || state.lfhp || Date.now() - startedAt < 4000) {
            $("#saveErr", form)?.remove();
            form.insertAdjacentHTML("afterbegin", `<div class="alert alert--error" role="alert" tabindex="-1" id="saveErr">${icon("i-info")}<p><strong>Your report was not sent.</strong> Please check your answers and press the button again.</p></div>`);
            $("#saveErr", form).focus();
            return;
          }
          wizDirty = false;
          const btn = form.querySelector('button[type="submit"]');
          form.dataset.sending = "1"; btn.disabled = true; btn.setAttribute("aria-busy", "true");
          try { await onSubmit(state); }
          catch (err) {
            console.error(err);
            delete form.dataset.sending; btn.disabled = false; btn.removeAttribute("aria-busy");
            wizDirty = true;
            $("#saveErr", form)?.remove();
            form.insertAdjacentHTML("afterbegin", `<div class="alert alert--error" role="alert" tabindex="-1" id="saveErr">${icon("i-info")}<p><strong>Your report was not sent.</strong> ${esc(err.message)}</p></div>`);
            $("#saveErr", form).focus();
          }
        }
      });
      const back = $("#wizBack", root);
      back && back.addEventListener("click", () => { collect(form); current--; draw(); focusTop(); });
      $$("[data-jump]", root).forEach((a) => a.addEventListener("click", (e) => {
        e.preventDefault();
        const el = $(`#f-${a.dataset.jump}`, root) || $(`[name="${a.dataset.jump}"]`, root);
        el && el.focus();
      }));
      $$("[data-goto]", root).forEach((b) => b.addEventListener("click", () => { current = Number(b.dataset.goto); draw(); focusTop(); }));
    }

    function collect(form) {
      const fd = new FormData(form);
      $$("input, select, textarea", form).forEach((el) => {
        if (!el.name || el.type === "file") return;
        if (el.type === "checkbox") state[el.name] = el.checked;
        else if (el.type === "radio") { if (el.checked) state[el.name] = el.value; }
        else state[el.name] = (fd.get(el.name) || "").toString().trim();
      });
    }

    function focusTop() {
      const legend = $("legend", root);
      root.scrollIntoView({ block: "start" });
      window.scrollBy(0, -110);
      if (legend) { legend.setAttribute("tabindex", "-1"); legend.focus(); }
      announce(`Step ${current + 1} of ${steps.length}: ${steps[current].title}`);
    }

    draw();
  }

  /* Reusable field builders */
  function F(name, label, control, errors, { hint, optional } = {}) {
    const err = errors[name];
    const described = [hint ? name + "-hint" : "", err ? name + "-err" : ""].join(" ").trim();
    return `<div class="field ${err ? "has-error" : ""}">
      <label for="f-${name}">${esc(label)} ${optional ? '<span class="opt">(optional)</span>' : ""}</label>
      ${hint ? `<p class="hint" id="${name}-hint">${hint}</p>` : ""}
      ${err ? fieldError(name, err) : ""}
      ${control.replace("<CTRL", `id="f-${name}" name="${name}" ${described ? `aria-describedby="${described}"` : ""} ${err ? 'aria-invalid="true"' : ""}`)}
    </div>`;
  }
  const inputCtl = (type, value, extra = "") => `<input class="input" type="${type}" <CTRL value="${esc(value || "")}" ${extra} />`;
  const selectCtl = (opts, value, placeholder) =>
    `<select class="select" <CTRL>${placeholder ? `<option value="">${esc(placeholder)}</option>` : ""}${opts.map((o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  const textareaCtl = (value, extra = "") => `<textarea class="textarea" <CTRL ${extra}>${esc(value || "")}</textarea>`;

  function categoryPicker(state, errors, legend) {
    const err = errors.category;
    return `<div class="field ${err ? "has-error" : ""}" role="radiogroup" aria-labelledby="catLbl" ${err ? 'aria-describedby="category-err"' : ""}>
      <span class="label" id="catLbl">${esc(legend)}</span>
      ${err ? fieldError("category", err) : ""}
      <div class="choice-grid">
        ${CATEGORIES.map((c, i) => `<div class="choice">
          <input type="radio" name="category" value="${c.id}" id="${i === 0 ? "f-category" : "cat-" + c.id}" ${state.category === c.id ? "checked" : ""} />
          <label for="${i === 0 ? "f-category" : "cat-" + c.id}">${icon(c.icon)}${esc(c.name)}</label>
        </div>`).join("")}
      </div>
    </div>`;
  }

  function pillGroup(name, label, options, value, errors, hint) {
    const err = errors[name];
    return `<div class="field ${err ? "has-error" : ""}" role="radiogroup" aria-labelledby="${name}-lbl">
      <span class="label" id="${name}-lbl">${esc(label)}</span>
      ${hint ? `<p class="hint">${hint}</p>` : ""}
      ${err ? fieldError(name, err) : ""}
      <div class="radio-row">
        ${options.map((o, i) => `<div class="pill"><input type="radio" name="${name}" value="${esc(o)}" id="${i === 0 ? "f-" + name : name + "-" + i}" ${value === o ? "checked" : ""} /><label for="${i === 0 ? "f-" + name : name + "-" + i}">${esc(o)}</label></div>`).join("")}
      </div>
    </div>`;
  }

  function dateField(name, label, value, errors) {
    return `${F(name, label, inputCtl("date", value || todayISO(), `max="${todayISO()}"`), errors, { hint: "Tap the box to pick a date, or use the quick buttons below." })}
      <div class="btn-row" style="margin-top:-.6rem">
        <button type="button" class="btn btn--outline btn--sm" data-setdate="${name}" data-days="0">Today</button>
        <button type="button" class="btn btn--outline btn--sm" data-setdate="${name}" data-days="1">Yesterday</button>
        <button type="button" class="btn btn--outline btn--sm" data-setdate="${name}" data-days="2">2 days ago</button>
      </div>`;
  }
  function wireDateButtons(form) {
    $$("[data-setdate]", form).forEach((b) => b.addEventListener("click", () => {
      const inp = $(`[name="${b.dataset.setdate}"]`, form);
      inp.value = daysAgo(Number(b.dataset.days));
      announce(`Date set to ${fmtDate(inp.value)}`);
    }));
  }

  /* Photo picker (resized in the browser to keep storage small).
     When a photo is added, PhotoAI looks at it (on this device only) and fills
     in the type, name, color and description. Filled answers are tagged and
     stay fully editable; an answer the person typed themselves is never replaced. */
  /* photoRef = { list: [all photos], data: the first (main) photo }.
     Any number of photos can be added. The main photo is the one shown on the
     item card and the one PhotoAI looks at. */
  function photoField(photoRef, label) {
    return `<div class="field photo-first">
      <span class="label">${esc(label)} <span class="opt">(optional)</span></span>
      <p class="hint">Add a photo first and we'll fill in some answers for you. You can add up to 8 photos, and change anything afterwards.</p>
      <div class="photo-drop">
        <ul class="photo-list" id="photoList" aria-label="Photos you added"></ul>
        <label class="btn btn--outline" for="f-photo">${icon("i-camera")} <span id="photoBtnText">Take or add photos</span></label>
        <input type="file" id="f-photo" accept="image/*" multiple class="sr-only" />
      </div>
      <p class="hint" id="photoCount" role="status" aria-live="polite" style="margin:.5rem 0 0"></p>
      <div id="photoAI" class="photo-ai" role="status" aria-live="polite"></div>
    </div>`;
  }
  /* All photos of a record (older records have only one, in "photo") */
  const photosOf = (rec) => (rec.photos && rec.photos.length ? rec.photos : rec.photo ? [rec.photo] : []);
  const photoStrip = (list, alt) => (list = (list || []).filter(safePhoto)).length ? `<div class="photo-strip">${list.map((u, i) => `<button type="button" class="photo-zoom" data-zoom aria-label="Make photo ${i + 1} larger or smaller"><img src="${u}" alt="${esc(alt)} ${i + 1} of ${list.length}" /></button>`).join("")}</div>` : "";
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-zoom]"); if (b) b.classList.toggle("is-large"); });

  const AUTO_FIELDS = ["category", "itemName", "brand", "color", "description", "uniqueDetails", "privateDetails"];

  /* Show "Filled from your photo" under auto-filled answers, and stop
     treating an answer as automatic once the person edits it. */
  function wireAuto(form, state) {
    state._auto = state._auto || {};
    const paint = () => {
      $$(".auto-tag", form).forEach((t) => t.remove());
      $$(".field.is-auto", form).forEach((f) => f.classList.remove("is-auto"));
      Object.keys(state._auto).forEach((key) => {
        const el = $(`[name="${key}"]`, form);
        const field = el && el.closest(".field");
        if (!field) return;
        field.classList.add("is-auto");
        field.insertAdjacentHTML("beforeend", `<p class="auto-tag">${icon("i-spark")} Filled from your photo. Please check it.</p>`);
      });
    };
    const onEdit = (e) => { if (e.target.name && state._auto[e.target.name]) { delete state._auto[e.target.name]; paint(); } };
    form.addEventListener("input", onEdit);
    form.addEventListener("change", onEdit);
    paint();
    return paint;
  }

  function wirePhoto(form, photoRef, state, kind = "lost") {
    const inp = $("#f-photo", form);
    const listEl = $("#photoList", form);
    const countEl = $("#photoCount", form);
    const box = $("#photoAI", form);
    photoRef.list = photoRef.list || [];
    const paintPhotos = (note = "") => {
      const n = photoRef.list.length;
      photoRef.data = photoRef.list[0] || null;
      listEl.innerHTML = photoRef.list.map((u, i) => `<li>
        <img src="${u}" alt="Photo ${i + 1} of ${n}" />
        ${i === 0 && n > 1 ? '<span class="photo-main">Main</span>' : ""}
        <button type="button" class="photo-x" data-rm="${i}" aria-label="Remove photo ${i + 1}">${icon("i-x")}</button></li>`).join("");
      listEl.hidden = !n;
      $("#photoBtnText", form).textContent = n ? "Add more photos" : "Take or add photos";
      countEl.textContent = note || (n > 1 ? `${n} photos added. The first one is the main photo shown on the item.` : "");
    };
    /* Photos are kept in this browser until the site has a server, so check there is room before adding one */
    const roomFor = (url) => {
      const key = "qcpllf_probe";
      try { localStorage.setItem(key, photoRef.list.join("") + url + url.slice(0, 20000)); localStorage.removeItem(key); return true; }
      catch { try { localStorage.removeItem(key); } catch {} return false; }
    };
    const paint = wireAuto(form, state);
    const catName = (id) => cat(id).name;

    const field = (key) => $(`[name="${key}"]`, form); // answers on a later step have no field here — they are kept in state
    const current = (key) => key === "category" ? (($('[name="category"]:checked', form) || {}).value || "") : field(key) ? field(key).value.trim() : (state[key] || "");
    const setValue = (key, value) => {
      if (key === "category") { const r = $(`[name="category"][value="${value}"]`, form); if (r) r.checked = true; }
      else if (field(key)) field(key).value = value;
      state[key] = value;
      state._auto[key] = true;
    };
    // Fill only empty answers (or ones we filled earlier) unless the person picked a suggestion
    const fill = (values, force = []) => {
      const done = [];
      AUTO_FIELDS.forEach((key) => {
        if (!values[key]) return;
        if (force.includes(key) || state._auto[key] || !current(key)) { setValue(key, values[key]); done.push(key); }
      });
      paint();
      return done;
    };
    const clearAuto = () => {
      Object.keys(state._auto).forEach((key) => {
        if (key === "category") $$('[name="category"]', form).forEach((r) => (r.checked = false));
        else if (field(key)) field(key).value = "";
        state[key] = "";
      });
      state._auto = {};
      paint();
    };

    const show = (info) => {
      state._photoInfo = info;
      const fil = isFil(), T = (en, tl) => (fil ? tl : en), cw = (c) => esc(PhotoAI.colorWord(c));
      if (!info) { box.innerHTML = ""; return; }
      if (info.loading) { box.innerHTML = `<p class="photo-ai__busy" data-no-tr><span class="spinner" aria-hidden="true"></span> ${T("Looking at your photo… this takes a few seconds.", "Tinitingnan ang litrato mo… ilang segundo lang ito.")}</p>`; return; }
      // Only offer other suggestions that had a real chance of being right
      const others = info.guesses.filter((g) => g.name !== info.itemName && g.score >= 0.04).slice(0, 3);
      const chips = others.length ? `<p class="photo-ai__alt">${info.recognized ? T("Not right? Tap what it is:", "Mali? Pindutin kung ano ito:") : T("Is it one of these? Tap to fill it in:", "Isa ba ito sa mga ito? Pindutin para mapunan:")}</p>
        <div class="btn-row">${others.map((g) => `<button type="button" class="btn btn--outline btn--sm" data-guess="${esc(g.name)}|${g.category}">${esc(g.name)}</button>`).join("")}</div>` : "";
      const colorText = !info.color ? "" : info.color === "Multi-colored" ? T("with many colors", "iba't iba ang kulay")
        : `${T("mostly", "karamihan ay")} <strong>${cw(info.color)}</strong>${info.secondColor ? ` ${T("and", "at")} <strong>${cw(info.secondColor)}</strong>` : ""}`;
      const sure = info.level === "high" ? T("We're fairly sure this is", "Halos sigurado kami na ito ay") : T("This looks like", "Mukhang ito ay");
      const n = info.photoCount || 1;
      const filled = info.online ? T(" (including the brand and details read from the photo)", " (kasama ang tatak at mga detalyeng nabasa sa litrato)")
        : info.brand ? T(` (the brand ${esc(info.brand)} was read from the photo)`, ` (nabasa sa litrato ang tatak na ${esc(info.brand)})`) : "";
      box.innerHTML = info.recognized
        ? `<div class="photo-ai__result" data-no-tr>${icon("i-spark")}<div>
            <p><strong>${sure}: ${esc(info.itemName)}</strong> (${esc(T(catName(info.category), I18N.t ? I18N.t(catName(info.category)) : catName(info.category)))})${colorText ? `, ${colorText}` : ""}.</p>
            <p>${T("We filled in the answers below for you", "Sinagutan na namin ang ilang tanong sa ibaba")}${filled}. ${T("Please check them and change anything that is wrong.", "Pakisuri at baguhin ang mali.")}</p>
            ${n > 1 ? `<p class="photo-ai__note">${T(`We looked at all ${n} photos.`, `Tiningnan namin ang lahat ng ${n} litrato.`)}</p>` : ""}${info.learned ? `<p class="photo-ai__note">${icon("i-check")} ${T("Similar to items reported here before.", "Kahawig ng mga gamit na naiulat na rito dati.")}</p>` : ""}${chips}</div></div>`
        : `<div class="photo-ai__result photo-ai__result--unsure" data-no-tr>${icon("i-info")}<div>
            <p><strong>${T("We couldn't tell what the item is from this photo.", "Hindi namin matukoy kung ano ang gamit mula sa litratong ito.")}</strong>${info.color && info.color !== "Other" ? T(` We filled in the color (${cw(info.color)}).`, ` Pinunan namin ang kulay (${cw(info.color)}).`) : ""}</p>
            <p>${info.modelFailed ? T("Please choose the type and name below.", "Piliin ang uri at pangalan sa ibaba.") : T("Please choose the type and name below, or try a closer photo with the item in the middle.", "Piliin ang uri at pangalan sa ibaba, o subukan ang mas malapit na litrato na nasa gitna ang gamit.")}</p>${chips}</div></div>`;
      $$("[data-guess]", box).forEach((b) => b.addEventListener("click", () => {
        const [name, category] = b.dataset.guess.split("|");
        fill({ category, itemName: name, description: PhotoAI.describe(name, current("color"), info.secondColor) }, ["category", "itemName"]);
        show({ ...info, recognized: true, itemName: name, category, guesses: info.guesses });
        announce(T(`Filled in: ${name}`, `Napunan: ${name}`));
      }));
    };

    /* Look at all the photos (the first is the main one) and fill in the answers */
    let lookToken = 0;
    const analyze = async () => {
      const token = ++lookToken, list = photoRef.list.slice();
      if (!list.length) { show(null); return; }
      show({ loading: true });
      try {
        const info = await PhotoAI.analyze(list, { kind });
        if (token !== lookToken) return;                 // photos were added or removed meanwhile
        info.photoCount = Math.min(list.length, 4);
        clearAuto();                                     // drop answers that came from an earlier photo
        fill(info);
        show(info);
        announce(isFil()
          ? (info.recognized ? `Mukhang ${info.itemName} ito, kulay ${PhotoAI.colorWord(info.color)}. Napunan na ang mga sagot. Pakisuri.` : "Hindi namin matukoy ang gamit. Pakisagutan ang mga tanong.")
          : (info.recognized ? `This looks like ${info.itemName}, ${info.color}. Answers were filled in. Please check them.` : "We could not tell what the item is. Please fill in the answers."));
      } catch {
        show(null);
      }
    };

    inp.addEventListener("change", async () => {
      const files = [...inp.files];
      if (!files.length) return;
      let added = 0, full = false, bad = 0, tooMany = false;
      for (const file of files) {
        if (photoRef.list.length >= MAX_PHOTOS) { tooMany = true; break; }
        const url = await resizeImage(file, 640);
        if (!url) { bad++; continue; }
        if (!roomFor(url)) { full = true; break; }
        photoRef.list.push(url);
        added++;
      }
      inp.value = ""; // so the same file can be picked again
      paintPhotos(full ? `This device has no more room for photos, so ${added ? "only " + added : "none"} of the ${files.length} ${files.length === 1 ? "photo was" : "photos were"} added. Remove a photo to add a different one.`
        : tooMany ? `You can add up to ${MAX_PHOTOS} photos. Remove a photo to add a different one.`
        : bad ? `${bad === 1 ? "One photo" : bad + " photos"} could not be read. Please use a JPG or PNG picture.` : "");
      announce(full ? "No more room for photos on this device" : `${added} ${added === 1 ? "photo" : "photos"} added. ${photoRef.list.length} in total.`);
      if (added) analyze();                              // every photo helps, so look again whenever one is added
    });
    listEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-rm]");
      if (!b) return;
      const i = Number(b.dataset.rm);
      photoRef.list.splice(i, 1);
      paintPhotos();
      announce(`Photo removed. ${photoRef.list.length} left.`);
      if (i === 0) clearAuto();
      analyze();
      (listEl.querySelector("[data-rm]") || $('label[for="f-photo"]', form)).focus();
    });
    paintPhotos();
    if (state._photoInfo && !state._photoInfo.loading && photoRef.data) show(state._photoInfo); // coming back to this step
    // Start loading the photo helper as soon as someone goes to add a photo (it is ready sooner)
    $('label[for="f-photo"]', form).addEventListener("pointerdown", () => PhotoAI.preload(), { once: true });
    // Tell people before they add a photo if it will be sent to the online AI service
    PhotoAI.online().catch(() => false).then((on) => {
      if (on && form.isConnected) $(".photo-drop", form).insertAdjacentHTML("afterend", `<p class="hint">${icon("i-info")} Your photo will also be sent to our online AI service (Claude) so it can read brands and text.</p>`);
    });
  }
  const MAX_PHOTOS = 8;
  /* Resolves with a small JPEG, or null if the file can't be read as a picture (e.g. HEIC, damaged file) */
  function resizeImage(file, max) {
    return new Promise((resolve) => {
      const looksLikePhoto = /^image\//.test(file.type || "") || (!file.type && /\.(jpe?g|png|webp|gif)$/i.test(file.name || ""));
      if (!looksLikePhoto || file.size > 40 * 1024 * 1024) return resolve(null);
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => resolve(null);
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.75));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function consentField(state, errors) {
    const err = errors.consent;
    return `<div class="field ${err ? "has-error" : ""}">
      ${err ? fieldError("consent", err) : ""}
      <label class="checkline" for="f-consent" style="font-weight:400">
        <input type="checkbox" id="f-consent" name="consent" ${state.consent ? "checked" : ""} ${err ? 'aria-invalid="true" aria-describedby="consent-err"' : ""} />
        <span>I agree that Quezon City Public Library may use my details only to help return this item, following the Data Privacy Act of 2012. <a href="#/privacy" target="_blank" rel="noopener">Read the Privacy Policy</a>.</span>
      </label>
    </div>`;
  }

  // Philippine mobile numbers only (09XX XXX XXXX or +63 9XX XXX XXXX): updates and codes are sent by text
  const validPhone = (p) => /^(09\d{9}|639\d{9})$/.test(digits(p));
  const validEmail = (e) => !e || (e.length <= 120 && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/.test(e));

  function contactValidate(s) {
    const e = {};
    if (!s.name) e.name = "Please type your full name.";
    if (!s.phone) e.phone = "Please type a phone number we can call.";
    else if (!validPhone(s.phone)) e.phone = "Please type a mobile number that starts with 09, e.g. 0917 123 4567.";
    if (!validEmail(s.email)) e.email = "The email address doesn't look right. Example: juan@email.com";
    if (!s.consent) e.consent = "Please tick the box to agree before sending.";
    return e;
  }

  function contactFields(state, errors, extra = "") {
    const user = LF.currentUser();
    return `
      ${user ? `<div class="alert alert--info">${icon("i-user")}<p>You are signed in as <strong>${esc(user.name)}</strong>. We filled in your details — you can still change them.</p></div>`
        : `<p class="hint">Have an account? <a href="#/signin">Sign in</a> to keep all your reports in one place. You don't need one to continue.</p>`}
      ${F("name", "Your full name", inputCtl("text", state.name, 'autocomplete="name"'), errors)}
      ${pillGroup("role", "I am a", USER_ROLES, state.role || USER_ROLES[0], errors)}
      ${F("memberId", "QCitizen ID or library card number", inputCtl("text", state.memberId, 'autocomplete="off"'), errors, { optional: true, hint: "Helps the office confirm who you are." })}
      <div class="grid-2">
        ${F("phone", "Mobile or phone number", inputCtl("tel", state.phone, 'autocomplete="tel" inputmode="tel"'), errors, { hint: "Example: 0917 123 4567" })}
        ${F("email", "Email address", inputCtl("email", state.email, 'autocomplete="email"'), errors, { optional: true })}
      </div>
      ${extra}
      ${consentField(state, errors)}`;
  }
  function prefillContact(state) {
    const u = LF.currentUser();
    if (u) Object.assign(state, { name: u.name, phone: u.phone, email: u.email, role: u.role || USER_ROLES[0], memberId: u.memberId || "" });
    return state;
  }

  function reviewBlock(rows, stepIndex, title) {
    return `<div class="card" style="padding:1.25rem;margin-bottom:1rem">
      <div style="display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap">
        <h3 style="margin:0">${esc(title)}</h3>
        <button type="button" class="btn btn--outline btn--sm" data-goto="${stepIndex}">Change<span class="sr-only"> ${esc(title)}</span></button>
      </div>
      <dl class="review-list" style="margin-top:1rem">${rows.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    </div>`;
  }

  function whatStep(s, e, placeholder, photo, photoLabel) {
    return `
      ${photoField(photo, photoLabel)}
      ${categoryPicker(s, e, "Type of item")}
      ${F("itemName", "Short name of the item", inputCtl("text", s.itemName, `placeholder="${placeholder}"`), e)}
      <div class="grid-2">
        ${F("brand", "Brand", inputCtl("text", s.brand, 'placeholder="e.g. Samsung, Casio, Hydro Flask" autocomplete="off"'), e, { optional: true })}
        ${F("color", "Main color", selectCtl(COLORS, s.color, "Choose a color"), e, { optional: true })}
      </div>`;
  }
  const whatValidate = (s) => {
    const e = {};
    if (!s.category) e.category = "Please choose the type of item.";
    if (!s.itemName) e.itemName = "Please type a short name for the item.";
    return e;
  };
  function whereFields(s, e, dateName, dateLabel) {
    return `
      <div class="library-note">${icon("i-pin")}<p>This report is for the <strong>${esc(LIBRARY.libraryName)}</strong> only.
        ${libraryLocked() ? "" : `Wrong library? <a href="#/library">Change library</a>`}</p></div>
      ${dateField(dateName, dateLabel, s[dateName], e)}
      ${LIBRARY.branches.length > 1 ? F("branch", "Which library?", selectCtl(LIBRARY.branches, s.branch, "Choose a library"), e) : ""}
      <div class="grid-2">
        ${F("location", "Where in the library?", selectCtl(LOCATIONS, s.location, "Choose a place"), e)}
        ${F("floor", "Which floor?", selectCtl(FLOORS, s.floor, "Choose a floor"), e, { optional: true })}
      </div>
      ${F("locationDetail", "Exact spot", inputCtl("text", s.locationDetail, 'placeholder="e.g. Table near the window; or beside the baggage counter"'), e, { optional: true })}`;
  }
  function whereValidate(s, dateName) {
    const e = {};
    if (!s[dateName]) e[dateName] = "Please choose a date.";
    else if (s[dateName] > todayISO()) e[dateName] = "The date can't be in the future.";
    if (LIBRARY.branches.length > 1 && !s.branch) e.branch = "Please choose the library.";
    if (!s.location) e.location = "Please choose a place, or pick \"I'm not sure\".";
    return e;
  }

  function successPage({ title, ref, lead, steps, extra = "" }) {
    main.innerHTML = `
      <section class="section">
        <div class="container">
          <div class="success">
            <div class="success__icon">${icon("i-check")}</div>
            <h1 tabindex="-1" id="successTitle">${esc(title)}</h1>
            <p style="font-size:1.1rem">${lead}</p>
            <div class="ticket">
              <div class="ticket__qr" role="img" aria-label="QR code of your reference number">${qrSvg(ref)}</div>
              <div>
                <p class="ticket__label">Your reference number</p>
                <p class="ticket__ref">${esc(ref)}</p>
                <p class="muted" style="margin:0">Take a photo of this screen or write the number down. At the office, show the QR code and staff will scan it.</p>
              </div>
            </div>
            <div class="next-steps card"><h2 style="font-size:1.4rem">What happens next</h2><ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol></div>
            ${extra}
            <div class="btn-row" style="justify-content:center;margin-top:1.5rem">
              <button type="button" class="btn btn--outline btn--lg" data-print>${icon("i-print")} Print this page</button>
              <a class="btn btn--primary btn--lg" href="#/status?ref=${encodeURIComponent(ref)}">${icon("i-status")} Check status</a>
              <a class="btn btn--outline btn--lg" href="#/">Back to home</a>
            </div>
          </div>
        </div>
      </section>`;
    window.scrollTo(0, 0);
    $("#successTitle").focus();
    renderAccountLink();
    announce(`${title}. Your reference number is ${ref.split("").join(" ")}`);
  }

  function matchesBlock(matches, heading) {
    if (!matches.length) return "";
    return `<div class="card" style="margin-top:1.5rem;text-align:left">
      <h2 style="font-size:1.5rem">${heading}</h2>
      <p class="muted">Our smart matching compared your report with the items at our office. Please take a look — if one is yours, open it and start your claim.</p>
      <div class="item-grid">${matches.map((m) => itemCard(m.item, m)).join("")}</div></div>`;
  }

  /* ---------------- Report LOST ---------------- */
  function pageReportLost() {
    main.innerHTML = `
      ${pageHead("Report a <em>lost</em> item", "Answer a few simple questions. We'll check our found items and contact you. Fields marked (optional) can be skipped.")}
      <section class="section" style="padding-top:1.75rem"><div class="container form-wrap">
        <div class="card" id="wiz"></div>
        <aside class="aside-card" aria-label="Tips">
          <h2>Helpful tips</h2>
          <ul>
            <li>Mention the <strong>brand, color and size</strong>.</li>
            <li>Describe anything special: stickers, scratches, a keychain, a name inside.</li>
            <li>Not sure where you lost it? Choose <strong>"I'm not sure"</strong> — that's okay.</li>
            <li>Prefer to talk to someone? Visit the office or call <a href="${LIBRARY.phoneHref}">${esc(LIBRARY.phone)}</a>.</li>
          </ul>
        </aside>
      </div></section>`;

    const state = prefillContact({ dateLost: todayISO(), contactPref: "Call me" });
    const photo = { data: null };
    runWizard({
      root: $("#wiz"),
      state,
      submitLabel: "Send my report",
      steps: [
        { short: "What", title: "What did you lose?", hint: "Add a photo if you have one, or just pick the type of item and give it a short name.",
          render: (s, e) => whatStep(s, e, "e.g. Black Casio calculator", photo, "Do you have a photo of the item (or a similar one)?"),
          afterRender: (form, s) => wirePhoto(form, photo, s, "lost"), validate: whatValidate },
        { short: "Describe", title: "Describe your item", hint: "This step is optional, but details help us find it faster.",
          render: (s, e) => `
            ${F("description", "What does it look like?", textareaCtl(s.description, 'placeholder="e.g. Small brown wallet, folds in two, a bit worn"'), e, { optional: true })}
            ${F("uniqueDetails", "Special marks or details", textareaCtl(s.uniqueDetails, 'placeholder="e.g. Red keychain, sticker on the back, my name on a card inside"'), e, { optional: true, hint: "Things that make it different from other items like it." })}`,
          afterRender: (form, s) => wireAuto(form, s) },
        { short: "Where & when", title: "Where and when did you lose it?", hint: "Your best guess is fine.",
          render: (s, e) => `${whereFields(s, e, "dateLost", "Date you lost it")}
            ${pillGroup("timeOfDay", "About what time?", ["Morning", "Afternoon", "Evening", "Not sure"], s.timeOfDay, e)}`,
          afterRender: wireDateButtons, validate: (s) => whereValidate(s, "dateLost") },
        { short: "Your details", title: "How can we reach you?", hint: "We only use this to contact you about your item.",
          render: (s, e) => contactFields(s, e, `
            ${pillGroup("contactPref", "How should we contact you?", ["Call me", "Send a text message", "Send an email"], s.contactPref, e)}
            <label class="checkline" for="f-assist" style="font-weight:400">
              <input type="checkbox" id="f-assist" name="assist" ${s.assist ? "checked" : ""} />
              <span>I am a person with disability (PWD) or need extra assistance at the office.</span>
            </label>`),
          validate: (s) => {
            const e = contactValidate(s);
            if (s.contactPref === "Send an email" && !s.email) e.email = "Please type your email, or choose \"Call me\".";
            return e;
          } },
        { short: "Check & send", title: "Please check your report", hint: "If something is wrong, press \"Change\".",
          render: (s) => `
            ${reviewBlock([["Type of item", cat(s.category).name], ["Item", s.itemName], ["Brand", s.brand], ["Color", s.color]], 0, "What you lost")}
            ${reviewBlock([["Looks like", s.description], ["Special marks", s.uniqueDetails], ["Photos", photo.list && photo.list.length ? `${photo.list.length} added` : ""]], 1, "Description")}
            ${reviewBlock([["Date", fmtDate(s.dateLost)], ["Time", s.timeOfDay], ["Library", s.branch], ["Place", s.location], ["Floor", s.floor], ["Exact spot", s.locationDetail]], 2, "Where and when")}
            ${reviewBlock([["Name", s.name], ["I am a", s.role], ["QCitizen ID / card no.", s.memberId], ["Phone", s.phone], ["Email", s.email], ["Contact by", s.contactPref], ["Assistance", s.assist ? "Yes, please assist me" : ""]], 3, "Your details")}` },
      ],
      onSubmit: async (s) => {
        const rec = await LF.createLost({
          category: s.category, itemName: s.itemName, brand: s.brand, color: s.color, description: s.description, uniqueDetails: s.uniqueDetails,
          photo: photo.data, photos: photo.list || [], dateLost: s.dateLost, timeOfDay: s.timeOfDay, branch: s.branch || LIBRARY.branches[0], location: s.location, floor: s.floor, locationDetail: s.locationDetail,
          name: s.name, phone: s.phone, email: s.email, role: s.role, memberId: s.memberId, contactPref: s.contactPref, assist: !!s.assist,
        });
        // The photo helper remembers the final answer on this device, so similar photos are recognized better next time
        if ((photo.list || []).length) PhotoAI.learn({ photos: photo.list, category: s.category, itemName: s.itemName, kind: "lost", staff: !!LF.currentStaff() });
        const matches = LF.matchesForLost(rec);
        const how = s.contactPref === "Send an email" ? "email" : s.contactPref === "Send a text message" ? "text" : "call";
        successPage({
          title: "Thank you — your report was sent",
          ref: rec.id,
          lead: `We have your report for <strong>${esc(s.itemName)}</strong>. Our smart matching will keep checking every new item turned in.`,
          steps: [
            "Every new found item is compared with your report automatically, and our staff check it too.",
            `If we find a possible match, we will ${how} you at ${esc(s.phone)}. You can also see updates with your reference number.`,
            `Bring a <strong>valid ID</strong> and this reference number to the ${esc(LIBRARY.deskLocation)}.`,
            `We keep found items for ${LIBRARY.holdDays} days.`,
          ],
          extra: matchesBlock(matches, `We found ${matches.length} ${matches.length === 1 ? "item" : "items"} that might be yours`),
        });
      },
    });
  }

  /* ---------------- Report FOUND ---------------- */
  function pageReportFound(r) {
    const staff = LF.currentStaff();
    main.innerHTML = `
      ${pageHead(staff ? "Log a found item" : "Report a found item", staff ? "Staff entry — the item will be recorded at the office right away." : "Thank you for helping! Tell us what you found so we can return it to its owner.", staff ? { href: "#/staff/found", label: "Back to staff page" } : null)}
      <section class="section" style="padding-top:1.75rem"><div class="container form-wrap">
        <div class="card" id="wiz"></div>
        <aside class="aside-card" aria-label="Good to know">
          <h2>Good to know</h2>
          <ul>
            <li>You may also hand the item to any <strong>librarian, guard or library staff</strong>.</li>
            <li>Please don't post photos of IDs or cards online.</li>
            <li>For money, IDs or gadgets, bring the item to the office as soon as you can.</li>
          </ul>
        </aside>
      </div></section>`;

    const state = staff ? { dateFound: todayISO(), name: staff.name, phone: "", handover: "Already at the office" } : prefillContact({ dateFound: todayISO() });
    const photo = { data: null };
    const handoverOpts = ["I will bring it to the office", "I gave it to a librarian, guard or staff", "Please send someone to get it"];
    runWizard({
      root: $("#wiz"),
      state,
      submitLabel: staff ? "Record item" : "Send report",
      steps: [
        { short: "What", title: "What did you find?", hint: "Add a photo if you can, or just pick the type of item and give it a short name.",
          render: (s, e) => whatStep(s, e, "e.g. Blue umbrella", photo, "Can you take a photo of the item?"),
          afterRender: (form, s) => wirePhoto(form, photo, s, "found"), validate: whatValidate },
        { short: "Describe", title: "Describe the item",
          render: (s, e) => `
            ${F("description", "Short description (shown to the public)", textareaCtl(s.description, 'placeholder="e.g. Small folding umbrella"'), e, { optional: true, hint: "Keep it general. Please don't include ID numbers, card numbers or money amounts." })}
            <div class="private-box">
              ${F("privateDetails", "Private details (only our staff will see this)", textareaCtl(s.privateDetails, 'placeholder="e.g. Initials JP carved on the handle; lock screen shows a dog"'), e, { optional: true, hint: `${icon("i-shield")} These details stay hidden. We use them to check that the person claiming the item is the real owner.` })}
            </div>`,
          afterRender: (form, s) => wireAuto(form, s) },
        { short: "Where & when", title: "Where and when did you find it?",
          render: (s, e) => `${whereFields(s, e, "dateFound", "Date you found it")}
            ${staff ? "" : pillGroup("handover", "Where is the item now?", handoverOpts, s.handover, e)}`,
          afterRender: wireDateButtons,
          validate: (s) => { const e = whereValidate(s, "dateFound"); if (!s.handover) e.handover = "Please tell us where the item is now."; return e; } },
        { short: staff ? "Finder" : "Your details", title: staff ? "Who turned it in?" : "Your contact details", hint: staff ? "Name of the guard, staff or visitor who found it." : "In case we need to ask you about the item.",
          render: (s, e) => {
            const thanks = `<label class="checkline" for="f-publicThanks" style="font-weight:400">
              <input type="checkbox" id="f-publicThanks" name="publicThanks" ${s.publicThanks ? "checked" : ""} />
              <span>${staff ? "The finder agreed to be thanked" : "You may thank me"} on the <strong>Wall of Honesty</strong> (first name and last initial only).</span></label>`;
            return staff
              ? `${F("name", "Finder's name", inputCtl("text", s.name), e)}${F("phone", "Finder's phone", inputCtl("tel", s.phone), e, { optional: true, hint: "Needed for the finder's certificate and badges." })}${thanks}
                <label class="checkline" for="f-staffFinder" style="font-weight:400"><input type="checkbox" id="f-staffFinder" name="staffFinder" ${s.staffFinder ? "checked" : ""} />
                <span>The finder is library staff on duty.</span></label>`
              : contactFields(s, e, `<div class="alert alert--info">${icon("i-award")}<p>When the owner gets the item back, you'll receive a <strong>Certificate of Honesty</strong> and can earn badges.</p></div>${thanks}`);
          },
          validate: (s) => staff ? (s.name ? {} : { name: "Please type the finder's name." }) : contactValidate(s) },
        { short: "Check & send", title: "Please check the report",
          render: (s) => `
            ${photoStrip(photo.list || [], "Your photo of the item")}
            ${reviewBlock([["Type of item", cat(s.category).name], ["Item", s.itemName], ["Brand", s.brand], ["Color", s.color]], 0, "What was found")}
            ${reviewBlock([["Public description", s.description], ["Private details", s.privateDetails ? "Added (hidden from the public)" : ""]], 1, "Description")}
            ${reviewBlock([["Date", fmtDate(s.dateFound)], ["Library", s.branch], ["Place", s.location], ["Floor", s.floor], ["Exact spot", s.locationDetail], ["Item is now", s.handover]], 2, "Where and when")}
            ${reviewBlock([["Name", s.name], ["I am a", s.role], ["QCitizen ID / card no.", s.memberId], ["Phone", s.phone], ["Email", s.email], ["Wall of Honesty", s.publicThanks ? "Yes, you may thank me publicly" : "No, keep my name private"]], 3, staff ? "Finder" : "Your details")}` },
      ],
      onSubmit: async (s) => {
        const rec = await LF.createFound({
          title: s.itemName, category: s.category, brand: s.brand, color: s.color, description: s.description, privateDetails: s.privateDetails,
          date: s.dateFound, branch: s.branch || LIBRARY.branches[0], location: s.location, floor: s.floor, locationDetail: s.locationDetail, handover: s.handover, photo: photo.data, photos: photo.list || [],
          finderName: s.name, finderPhone: s.phone, finderEmail: s.email, finderRole: s.staffFinder ? "Library staff" : s.role, finderMemberId: s.memberId, publicThanks: !!s.publicThanks,
        });
        if ((photo.list || []).length) PhotoAI.learn({ photos: photo.list, category: s.category, itemName: s.itemName, kind: "found", staff: !!LF.currentStaff() });
        if (staff) { announce("Item recorded"); return go("#/staff/found"); }
        const action = s.handover === handoverOpts[0]
          ? `Please bring the item to the front desk of ${esc(s.branch || LIBRARY.branches[0])}, or to the <strong>${esc(LIBRARY.deskLocation)}</strong>. Show this reference number.`
          : s.handover === handoverOpts[2]
            ? `Please stay where you are if you can. Our staff will call you at ${esc(s.phone)}. For faster help, call <a href="${LIBRARY.phoneHref}">${esc(LIBRARY.phone)}</a>.`
            : "Thank you! They will turn it over to the Lost &amp; Found Office.";
        const owners = LF.matchesForFound(rec).length;
        successPage({
          title: "Thank you for your kindness!",
          ref: rec.id,
          lead: `Your report for <strong>${esc(s.itemName)}</strong> was sent to our Lost &amp; Found team.${owners ? " Good news — someone has reported losing a similar item." : ""}`,
          steps: [
            action,
            "Once the office receives it, the item appears in the Found Items list and is matched with lost reports.",
            "The owner must answer our questions and show a valid ID before the item is released. We'll let you know when it's returned.",
            "Once it's returned, check this report to get your <strong>Certificate of Honesty</strong> and badge.",
          ],
        });
      },
    });
  }

  /* ---------------- Claim a specific item (ownership verification) ---------------- */
  function pageClaimItem(id) {
    const item = LF.db.byId("found", id);
    if (!item || !PUBLIC_FOUND.includes(item.status)) return pageNotFound();
    const c = cat(item.category);
    main.innerHTML = `
      ${pageHead(`Claim: ${esc(item.title)}`, "Please answer a few questions about your item. Our staff compare your answers with details we kept private.", { href: "#/browse", label: "Back to found items" })}
      <section class="section" style="padding-top:1.75rem"><div class="container form-wrap">
        <div class="card" id="wiz"></div>
        <aside class="aside-card" aria-label="The item you are claiming">
          <h2>You are claiming</h2>
          ${thumb(item)}
          <p style="margin-top:.75rem"><strong>${esc(item.title)}</strong><br />
          <span class="muted">Found ${esc(fmtDate(item.date))}<br />${esc(item.location)}${item.floor ? `, ${esc(item.floor)}` : ""}</span></p>
          <p class="muted" style="margin:0">Item number: <strong>${esc(item.id)}</strong></p>
        </aside>
      </div></section>`;

    const state = prefillContact({ dateLost: item.date });
    runWizard({
      root: $("#wiz"),
      state,
      submitLabel: "Send my claim",
      steps: [
        { short: "Questions", title: "Why is this item yours?", hint: "Answer in your own words. It's okay if you don't remember everything.",
          render: (s, e) => `
            ${F("general", "Describe the item in detail", textareaCtl(s.general, 'placeholder="Brand, color, size, what it looks like…"'), e)}
            ${F("specific", c.question, textareaCtl(s.specific), e)}
            ${dateField("dateLost", "When did you lose it?", s.dateLost, e)}
            ${F("lostRef", "Did you already send a lost report? Type its reference number", inputCtl("text", s.lostRef, 'placeholder="e.g. L-SB-261005-1234" autocapitalize="characters"'), e, { optional: true })}`,
          afterRender: wireDateButtons,
          validate: (s) => {
            const e = {};
            if (!s.general || s.general.length < 10) e.general = "Please describe the item in at least one sentence.";
            if (!s.specific) e.specific = "Please answer this question — write \"I don't remember\" if you're not sure.";
            if (!s.dateLost) e.dateLost = "Please choose a date.";
          else if (s.dateLost > todayISO()) e.dateLost = "The date can't be in the future.";
            return e;
          } },
        { short: "Your details", title: "How can we reach you?", render: (s, e) => contactFields(s, e), validate: contactValidate },
        { short: "Check & send", title: "Please check your claim",
          render: (s) => `
            ${reviewBlock([["Description", s.general], [c.question, s.specific], ["Date lost", fmtDate(s.dateLost)], ["Lost report", s.lostRef]], 0, "Your answers")}
            ${reviewBlock([["Name", s.name], ["I am a", s.role], ["QCitizen ID / card no.", s.memberId], ["Phone", s.phone], ["Email", s.email]], 1, "Your details")}` },
      ],
      onSubmit: async (s) => {
        const rec = await LF.createClaim({ itemId: item.id, general: s.general, specific: s.specific, dateLost: s.dateLost, lostRef: s.lostRef, name: s.name, phone: s.phone, email: s.email, role: s.role, memberId: s.memberId });
        successPage({
          title: "Your claim was sent",
          ref: rec.id,
          lead: `We received your claim for <strong>${esc(item.title)}</strong>.`,
          steps: [
            "Our staff will compare your answers with the private details of the item.",
            `We will call you at ${esc(s.phone)} — usually within 1 working day. You can also check your status online.`,
            `If approved, bring a <strong>valid ID</strong> (QCitizen ID, library card or any government ID) and this reference number to ${esc(LIBRARY.deskLocation)}.`,
            "If someone else will pick it up for you, they need an authorization letter, a copy of your valid ID and their own ID.",
          ],
        });
      },
    });
  }

  /* ---------------- Check status ---------------- */
  function pageStatus(query) {
    const ref0 = query.get("ref") || "";
    main.innerHTML = `
      ${pageHead("Check my <em>report</em>", "Type the reference number you received, plus the last 4 digits of the phone number you gave us.")}
      <section class="section" style="padding-top:1.75rem"><div class="container form-wrap">
        <div>
          <form class="card" id="statusForm" novalidate>
            <div id="statusErr"></div>
            <div class="fieldset">
              <div class="field">
                <label for="sref">Reference number</label>
                <p class="hint" id="sref-hint">It looks like this: L-${LIBRARY.code}-261005-1234</p>
                <input class="input mono" id="sref" name="ref" value="${esc(ref0)}" autocomplete="off" autocapitalize="characters" aria-describedby="sref-hint" />
              </div>
              <div class="field">
                <label for="sphone">Last 4 digits of your phone number</label>
                <input class="input" id="sphone" name="phone" inputmode="numeric" maxlength="4" autocomplete="off" style="max-width:10rem" />
              </div>
            </div>
            <div class="form-nav"><span></span><button class="btn btn--primary btn--lg" type="submit">${icon("i-search")} Check status</button></div>
          </form>
          <div id="statusResult" style="margin-top:1.5rem" tabindex="-1"></div>
        </div>
        <aside class="aside-card">
          <h2>Lost your reference number?</h2>
          <p>No problem. Call us at <a href="${LIBRARY.phoneHref}"><strong>${esc(LIBRARY.phone)}</strong></a> or visit the office with a valid ID. We can look it up by your name.</p>
          <p style="margin:0">Or <a href="#/signin">sign in</a> to see all your reports at once.</p>
        </aside>
      </div></section>`;

    const form = $("#statusForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ref = $("#sref").value.trim();
      const last4 = digits($("#sphone").value);
      const errs = [];
      if (!ref) errs.push(["sref", "Please type your reference number."]);
      if (last4.length !== 4) errs.push(["sphone", "Please type exactly 4 numbers."]);
      $$(".field", form).forEach((f) => f.classList.remove("has-error"));
      if (errs.length) {
        $("#statusErr").innerHTML = `<div class="alert alert--error" role="alert">${icon("i-info")}<ul style="margin:0">${errs.map(([id, m]) => `<li><a href="#${id}" data-focus="${id}">${m}</a></li>`).join("")}</ul></div>`;
        $$("[data-focus]", form).forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); $("#" + a.dataset.focus).focus(); }));
        errs.forEach(([id]) => $("#" + id).closest(".field").classList.add("has-error"));
        $("#" + errs[0][0]).focus();
        return;
      }
      $("#statusErr").innerHTML = "";
      const out = $("#statusResult");
      // The check is done by the rules (on the server when there is one): 5 wrong checks in a row → wait 5 minutes
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      let hit = null, err = null;
      try { const r = await LF.checkStatus(ref, last4); hit = r && LF.findRef(r.id); } catch (e2) { err = e2; } finally { btn.disabled = false; }
      if (err && !/couldn't find that report/i.test(err.message)) { out.innerHTML = `<div class="alert alert--error" role="alert">${icon("i-clock")}<p>${esc(err.message)}</p></div>`; out.focus(); return; }
      if (!hit) {
        out.innerHTML = `<div class="alert alert--warn" role="alert">${icon("i-info")}<div>
          <p><strong>We couldn't find that report at the ${esc(LIBRARY.libraryName)}.</strong></p>
          <p>Please check the reference number and phone digits and try again. Letters and numbers must match exactly. A report made at another library can only be checked there. You can also call <a href="${LIBRARY.phoneHref}">${esc(LIBRARY.phone)}</a>.</p></div></div>`;
        out.focus();
        return;
      }
      out.innerHTML = caseCard(hit.kind, hit.item, { showUpdates: true });
      const notes = LF.notificationsFor({ ref: hit.item.id });
      if (notes.some((n) => !n.read)) LF.markRead(notes.map((n) => n.id)).catch(() => {});
      out.focus();
    });
    if (ref0) $("#sphone").focus();
  }

  /* Smart Matches on a lost report: the found items most like it, each with a
     percentage and the two reports side by side. Worked out automatically every
     time the report is opened, so new found items appear without anyone doing
     anything. A match is a suggestion only — the office still verifies ownership. */
  function smartMatches(lost) {
    const ms = LF.matchesForLost(lost).slice(0, 5);
    const head = `<h3 class="smart-h">${icon("i-spark")} Smart Matches</h3>`;
    if (!ms.length) return `${head}<div class="smart-empty">
      <p><strong>No potential matches found yet.</strong></p>
      <p class="muted">Your report is compared with every found item automatically, and again each time a new item is reported. You can also <a href="#/browse?cat=${lost.category}">look through the found items</a> yourself.</p></div>`;
    return `${head}
      <p class="muted">Your report was compared with every found item. ${ms.length === 1 ? "This is the closest one" : `These are the ${ms.length} closest`}. A match is only a suggestion: the office will still check that the item is yours before it is released.</p>
      <ul class="smart-list">${ms.map((m) => matchCompare(m)).join("")}</ul>
      <p class="hint smart-key"><strong>90% and up</strong> high potential match · <strong>75–89%</strong> strong possible match · <strong>50–74%</strong> possible match, needs checking · below 50% is not shown</p>`;
  }
  function matchCompare(m) {
    const f = m.item;
    const tone = m.score >= 90 ? "high" : m.score >= 75 ? "strong" : "possible";
    const show = (p, v) => !v ? "—" : p.key === "category" ? cat(v).name : p.key === "date" ? fmtDate(v) : v;
    const result = (p) => p.sim >= 0.99 ? '<span class="cmp cmp--same">Same</span>' : p.sim > 0 ? '<span class="cmp cmp--near">Similar</span>' : '<span class="cmp cmp--diff">Different</span>';
    const claimable = PUBLIC_FOUND.includes(f.status);
    return `<li class="smart-match smart-match--${tone}">
      <div class="smart-match__head">
        <div class="smart-score" aria-label="${m.score} percent match"><strong>${m.score}%</strong><span>Match</span></div>
        <div><p class="smart-match__title">${esc(f.title)}</p><p class="smart-match__label">${esc(m.strength)}</p>
          <p class="muted mono" style="margin:0;font-size:.8rem">${esc(f.id)}</p></div>
      </div>
      <div class="table-wrap"><table class="cmp-table">
        <thead><tr><th scope="col">Detail</th><th scope="col">Your lost report</th><th scope="col">Found item</th><th scope="col">Result</th></tr></thead>
        <tbody>${m.parts.map((p) => `<tr><th scope="row">${esc(p.label)}</th><td>${esc(show(p, p.lost))}</td><td>${esc(show(p, p.found))}</td><td>${result(p)}</td></tr>`).join("")}</tbody>
      </table></div>
      <div class="btn-row">
        ${claimable ? `<a class="btn btn--primary" href="#/claim-item/${encodeURIComponent(f.id)}">This is mine — start my claim ${icon("i-arrow")}</a>` : ""}
        <button type="button" class="btn btn--outline" data-view-item="${esc(f.id)}">See the found item<span class="sr-only"> ${esc(f.title)}</span></button>
      </div>
      ${claimable ? "" : `<p class="hint" style="margin:.6rem 0 0">${icon("i-info")} The finder is still bringing this item to the office. You can start a claim once the office has recorded it.</p>`}
    </li>`;
  }

  /* One case (lost report / claim / found report) with its progress */
  function caseCard(kind, rec, { showUpdates } = {}) {
    const title = kind === "lost" ? rec.itemName : kind === "claims" ? rec.itemTitle : rec.title;
    const kindLabel = { lost: "Lost item report", claims: "Claim", found: "Found item report" }[kind];
    let body = "";
    if (kind === "lost" && ["reported", "searching", "possible-match"].includes(rec.status)) body = smartMatches(rec);
    if (rec.status === "ready" || rec.status === "approved" || rec.status === "verified") {
      body = `<div class="alert alert--info">${icon("i-check")}<p><strong>Good news!</strong> Please bring a valid ID and this reference number to ${esc(LIBRARY.deskLocation)}, ${esc(LIBRARY.hours)}.</p></div>`;
    }
    if (rec.status === "rejected" && rec.reviewNote) body = `<p><strong>Reason:</strong> ${esc(rec.reviewNote)}</p>`;
    if (kind === "found" && rec.status === "returned") body = recognitionBlock(rec);
    // On "My reports" the claim card carries the feedback form, so the lost report doesn't repeat it
    const hasClaimCard = kind === "lost" && !showUpdates && feedbackRef(kind, rec) !== rec.id;
    if (kind !== "found" && rec.status === "returned" && !hasClaimCard) body += feedbackBlock(kind, rec);
    // The owner can add details or close an open lost report; an approved claim gets a pick-up booking
    if (kind === "lost" && LF.OPEN_LOST.includes(rec.status) && LF.canManage(rec) && !LF.currentStaff()) {
      body += `<div class="case-actions">
        <button type="button" class="btn btn--outline btn--sm" data-own-edit="${esc(rec.id)}">${icon("i-doc-plus")} Add details or photos</button>
        <button type="button" class="btn btn--outline btn--sm" data-own-close="${esc(rec.id)}">${icon("i-check")} I got it back — close my report</button>
      </div>`;
    }
    if (kind === "claims" && rec.status === "approved" && LF.canManage(rec)) body += pickupBlock(rec);
    const contribs = kind === "claims" ? [] : LF.contributionsForRef(rec.id);
    if (contribs.length && showUpdates) body += `<h3 style="margin-top:1.25rem">Certificates</h3><ul class="cert-list">${contributionLinks(contribs)}</ul>`;
    const updates = showUpdates ? LF.notificationsFor({ ref: rec.id }) : [];
    return `<article class="card case-card" data-case="${kind}|${esc(rec.id)}|${showUpdates ? 1 : 0}">
      <p class="muted" style="margin:0">${esc(kindLabel)} · <strong class="mono">${esc(rec.id)}</strong> · sent ${esc(fmtDate(rec.createdAt))}</p>
      <h2 style="margin:.25rem 0 .75rem">${esc(title)}</h2>
      ${statusBadge(kind, rec.status)}
      ${timeline(kind, rec)}
      ${body}
      ${showUpdates ? `<h3 style="margin-top:1.25rem">Updates</h3>${notifList(updates)}` : ""}
    </article>`;
  }

  /* Pick-up booking on an approved claim */
  function pickupBlock(c) {
    const f = LF.db.byId("found", c.itemId);
    const moving = f && f.transfer;
    const place = LF.keptAt(f);
    if (c.pickup) return `<div class="pickup pickup--booked">
      <h3>${icon("i-cal")} Your pick-up time</h3>
      <p class="pickup__when">${esc(LF.pickupLabel(c.pickup))}</p>
      <p class="muted">At <strong>${esc(c.pickup.place || place)}</strong> — bring a valid ID and this reference number.</p>
      ${moving ? `<p class="hint">${icon("i-info")} The item is being moved to ${esc(moving.to)}. We'll tell you when it arrives.</p>` : ""}
      <div class="btn-row"><button type="button" class="btn btn--outline btn--sm" data-pickup-change="${esc(c.id)}">Change time</button>
        <button type="button" class="btn btn--outline btn--sm" data-pickup-cancel="${esc(c.id)}">Cancel</button></div>
    </div>`;
    const days = LF.pickupSlots(c.id);
    const label = (t) => new Date(`2000-01-01T${t}:00`).toLocaleTimeString(uiLocale(), { hour: "numeric", minute: "2-digit" });
    return `<div class="pickup">
      <h3>${icon("i-cal")} Book your pick-up time</h3>
      <p class="muted">Your item is kept at <strong>${esc(moving ? moving.to : place)}</strong>${moving ? " (on its way there)" : ""}. Choose a time so the staff can have it ready.</p>
      ${days.length ? `<p class="pickup__step">1. Choose a day</p>
        <div class="pickup__days">${days.map((d, i) => { const dt = new Date(d.date + "T00:00:00"); return `<button type="button" class="day-chip" data-pickup-day="${d.date}" aria-pressed="${i === 0}">
          <span>${esc(dt.toLocaleDateString(uiLocale(), { weekday: "short" }))}</span><strong>${dt.getDate()}</strong><span>${esc(dt.toLocaleDateString(uiLocale(), { month: "short" }))}</span></button>`; }).join("")}</div>
        <p class="pickup__step">2. Choose a time</p>
        ${days.map((d, i) => `<div class="pickup__slots" data-day="${d.date}" role="group" aria-label="${esc(new Date(d.date + "T00:00:00").toLocaleDateString(uiLocale(), { weekday: "long", month: "long", day: "numeric" }))}" ${i === 0 ? "" : "hidden"}>
          ${d.slots.map((s) => `<button type="button" class="slot" data-pickup="${esc(c.id)}|${d.date}|${s.time}" ${s.left <= 0 ? "disabled" : ""}>${label(s.time)}${s.left <= 0 ? '<span class="sr-only"> (full)</span>' : ""}</button>`).join("")}</div>`).join("")}`
        : `<p>No pick-up times are open in the next few days. Please call <a href="${LIBRARY.phoneHref}">${esc(LIBRARY.phone)}</a>.</p>`}
      <p class="hint">Times follow the main library's regular hours. You can also come during office hours without booking.</p>
    </div>`;
  }

  /* Owner actions on a report card */
  function redrawCase(kind, id) {
    const card = document.querySelector(`[data-case^="${kind}|${CSS.escape(id)}|"]`);
    const rec = LF.db.byId(kind, id);
    if (card && rec) card.outerHTML = caseCard(kind, rec, { showUpdates: card.dataset.case.endsWith("|1") });
    renderAccountLink();
  }
  function ownerEditDialog(id) {
    const l = LF.db.byId("lost", id);
    const added = [];
    openDialog(`
      <button type="button" class="btn btn--outline btn--sm dialog__close" data-close>${icon("i-x")} Close</button>
      <h2 id="dialogTitle">Add details to your report</h2>
      <p class="muted">${esc(l.itemName)} · <span class="mono">${esc(l.id)}</span>. New details are compared with the found items again right away.</p>
      <form id="ownEdit" class="stack-form">
        <div class="grid-2">
          <div class="field"><label for="oe-brand">Brand</label><input class="input" id="oe-brand" name="brand" value="${esc(l.brand || "")}" /></div>
          <div class="field"><label for="oe-color">Main color</label><select class="select" id="oe-color" name="color"><option value="">Not sure</option>${COLORS.map((c) => `<option ${c === l.color ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label for="oe-desc">What does it look like?</label><textarea class="textarea" id="oe-desc" name="description">${esc(l.description || "")}</textarea></div>
        <div class="field"><label for="oe-marks">Special marks or details</label><textarea class="textarea" id="oe-marks" name="uniqueDetails">${esc(l.uniqueDetails || "")}</textarea></div>
        <div class="field"><label for="oe-spot">Exact spot</label><input class="input" id="oe-spot" name="locationDetail" value="${esc(l.locationDetail || "")}" /></div>
        <div class="field"><label for="oe-photos">Add photos</label><input class="input" type="file" id="oe-photos" accept="image/*" multiple />
          <p class="hint" id="oe-count">${UI.photosOf(l).length} photo(s) already on your report.</p></div>
        <div id="oe-err"></div>
        <div class="btn-row"><button type="submit" class="btn btn--primary">${icon("i-check")} Save changes</button><button type="button" class="btn btn--outline" data-close>Cancel</button></div>
      </form>`, (root) => {
      $("#oe-photos", root).addEventListener("change", async (e) => {
        let bad = 0;
        for (const file of e.target.files) {
          if (UI.photosOf(l).length + added.length >= MAX_PHOTOS) break;
          const url = await resizeImage(file, 640);
          if (url) added.push(url); else bad++;
        }
        e.target.value = "";
        $("#oe-count", root).textContent = `${UI.photosOf(l).length} photo(s) on your report + ${added.length} new.`
          + (UI.photosOf(l).length + added.length >= MAX_PHOTOS ? ` You can have up to ${MAX_PHOTOS} photos.` : "")
          + (bad ? ` ${bad === 1 ? "One photo" : bad + " photos"} could not be read. Please use a JPG or PNG picture.` : "");
      });
      $("#ownEdit", root).addEventListener("submit", async (e) => {
        e.preventDefault();
        const fm = e.target;
        try {
          await LF.updateLostByOwner(id, { brand: fm.brand.value.trim(), color: fm.color.value, description: fm.description.value.trim(), uniqueDetails: fm.uniqueDetails.value.trim(), locationDetail: fm.locationDetail.value.trim() }, added);
          closeDialog(); redrawCase("lost", id); announce("Your report was updated");
        } catch (err) { $("#oe-err", root).innerHTML = `<div class="alert alert--error" role="alert">${icon("i-info")}<p>${esc(err.message)}</p></div>`; }
      });
    });
  }
  function ownerCloseDialog(id) {
    const l = LF.db.byId("lost", id);
    const reasons = ["I found it myself", "Someone returned it to me directly", "I no longer need it", "I reported it by mistake"];
    openDialog(`
      <button type="button" class="btn btn--outline btn--sm dialog__close" data-close>${icon("i-x")} Close</button>
      <h2 id="dialogTitle">Close your report?</h2>
      <p>We'll stop looking for <strong>${esc(l.itemName)}</strong>. This can't be undone online.</p>
      <form id="ownClose"><fieldset class="fieldset"><legend class="sr-only">Why are you closing it?</legend>
        ${reasons.map((r, i) => `<label class="checkline" style="font-weight:400"><input type="radio" name="reason" value="${esc(r)}" ${i === 0 ? "checked" : ""} /><span>${esc(r)}</span></label>`).join("")}
      </fieldset>
      <div class="btn-row" style="margin-top:1rem"><button type="submit" class="btn btn--primary">${icon("i-check")} Yes, close my report</button><button type="button" class="btn btn--outline" data-close>Keep it open</button></div></form>`, (root) => {
      $("#ownClose", root).addEventListener("submit", async (e) => {
        e.preventDefault();
        try { await LF.closeLostByOwner(id, e.target.reason.value); closeDialog(); redrawCase("lost", id); announce("Your report was closed. We're glad you have it back!"); }
        catch (err) { alert(err.message); }
      });
    });
  }
  document.addEventListener("click", async (e) => {
    const day = e.target.closest("[data-pickup-day]");
    if (day) {
      const box = day.closest(".pickup");
      $$("[data-pickup-day]", box).forEach((b) => b.setAttribute("aria-pressed", String(b === day)));
      $$("[data-day]", box).forEach((g) => (g.hidden = g.dataset.day !== day.dataset.pickupDay));
      return;
    }
    const t = e.target.closest("[data-own-edit],[data-own-close],[data-pickup],[data-pickup-cancel],[data-pickup-change]");
    if (!t) return;
    if (t.dataset.ownEdit) return ownerEditDialog(t.dataset.ownEdit);
    if (t.dataset.ownClose) return ownerCloseDialog(t.dataset.ownClose);
    try {
      if (t.dataset.pickup) { const [id, date, time] = t.dataset.pickup.split("|"); t.disabled = true; const c = await LF.bookPickup(id, date, time); redrawCase("claims", id); announce(`Pick-up booked: ${LF.pickupLabel(c.pickup)}`); }
      if (t.dataset.pickupCancel) { if (!confirm("Cancel your pick-up time?")) return; await LF.cancelPickup(t.dataset.pickupCancel); redrawCase("claims", t.dataset.pickupCancel); announce("Pick-up time cancelled"); }
      if (t.dataset.pickupChange) { const c = LF.db.byId("claims", t.dataset.pickupChange); const card = t.closest(".case-card"); $(".pickup", card).outerHTML = pickupBlock({ ...c, pickup: null }); announce("Choose a new time"); }
    } catch (err) { t.disabled = false; alert(err.message); }
  });

  /* Short feedback form shown to the owner once their item is returned.
     One answer per case: a lost report and its claim share the same feedback. */
  function feedbackRef(kind, rec) {
    if (kind === "claims") return rec.id;
    const claim = LF.db.all("claims").find((c) => c.lostId === rec.id && c.status === "returned");
    return claim ? claim.id : rec.id;
  }
  function feedbackBlock(kind, rec) {
    const ref = feedbackRef(kind, rec);
    const done = LF.feedbackFor(ref);
    if (done) return `<div class="feedback feedback--done">${icon("i-check")}<p><strong>Thank you for your feedback.</strong> You rated the process ${done.ease}/5 for ease and ${done.satisfaction}/5 overall.</p></div>`;
    const scale = (name, low, high) => `<div class="rating" role="radiogroup" aria-label="${name === "ease" ? "How easy was it" : "How satisfied are you"}, 1 to 5">
      <span class="rating__end">${low}</span>
      ${[1, 2, 3, 4, 5].map((n) => `<span class="pill"><input type="radio" name="${name}" value="${n}" id="fb-${esc(ref)}-${name}-${n}" required /><label for="fb-${esc(ref)}-${name}-${n}">${n}</label></span>`).join("")}
      <span class="rating__end">${high}</span></div>`;
    return `<form class="feedback" data-feedback="${esc(ref)}">
      <h3>How did it go?</h3>
      <p class="muted">Two quick questions. Your answers help the office improve the Lost &amp; Found service.</p>
      <p class="label">1. How easy was it to report and claim your item?</p>${scale("ease", "Hard", "Very easy")}
      <p class="label">2. How satisfied are you with the service?</p>${scale("satisfaction", "Not satisfied", "Very satisfied")}
      <div class="field"><label for="fb-${esc(ref)}-c">Anything we can do better? <span class="opt">(optional)</span></label>
        <textarea class="textarea" id="fb-${esc(ref)}-c" name="comment" style="min-height:4.5rem" maxlength="500"></textarea></div>
      <p class="error-msg" hidden>${icon("i-info")}<span>Please choose a number for both questions.</span></p>
      <button type="submit" class="btn btn--primary">Send feedback</button>
    </form>`;
  }
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-feedback]");
    if (!form) return;
    e.preventDefault();
    const fd = new FormData(form);
    if (!fd.get("ease") || !fd.get("satisfaction")) { form.querySelector(".error-msg").hidden = false; return; }
    try { await LF.addFeedback({ ref: form.dataset.feedback, ease: fd.get("ease"), satisfaction: fd.get("satisfaction"), comment: String(fd.get("comment") || "").slice(0, 500) }); }
    catch (err) { const m = form.querySelector(".error-msg"); m.textContent = err.message; m.hidden = false; return; }
    form.outerHTML = `<div class="feedback feedback--done">${icon("i-check")}<p><strong>Thank you for your feedback!</strong></p></div>`;
    announce("Thank you for your feedback");
  });

  /* ---------------- Accounts ---------------- */
  /* Errors show in the form's own .auth-err box (or #authErr on older pages) */
  function showAuthErrors(list, form) {
    const box = form ? form.querySelector(".auth-err") : $("#authErr");
    $$(".field, .checkline", form || $("#authForm")).forEach((f) => f.classList.remove("has-error"));
    if (!list.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="alert alert--error" role="alert" tabindex="-1">${icon("i-info")}<ul style="margin:0">${list.map(([id, m]) => `<li>${id ? `<a href="#${id}" data-focus="${id}">${esc(m)}</a>` : esc(m)}</li>`).join("")}</ul></div>`;
    $$("[data-focus]", box).forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); $("#" + a.dataset.focus).focus(); }));
    list.forEach(([id]) => { const fld = id && $("#" + id) && $("#" + id).closest(".field, .checkline"); fld && fld.classList.add("has-error"); });
    (list[0][0] ? $("#" + list[0][0]) : box.querySelector(".alert")).focus?.();
    announce(list.map((x) => x[1]).join(". "));
  }
  const pwField = (id, label, hint, auto) => `<div class="field">
      <label for="${id}">${label}</label>${hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ""}
      <div class="pw-wrap"><input class="input" id="${id}" type="password" autocomplete="${auto}" ${hint ? `aria-describedby="${id}-hint"` : ""} />
      <button type="button" class="btn btn--outline btn--sm" data-showpw="${id}" aria-pressed="false">Show</button></div></div>`;
  function wireShowPw() {
    $$("[data-showpw]").forEach((b) => b.addEventListener("click", () => {
      const inp = $("#" + b.dataset.showpw);
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      b.textContent = show ? "Hide" : "Show";
      b.setAttribute("aria-pressed", String(show));
    }));
  }

  /* ---------------- Sign in / create an account ----------------
     One card holds both forms. A blue QCPL panel covers the form that isn't in
     use; pressing "Create an account" or "Sign in" sweeps the panel across the
     card to the other side. On phones the panel becomes a banner on top. */
  const authField = (id, label, input, ic, hint) => `<div class="field auth-field">
      <label for="${id}">${label}</label>${hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ""}
      <div class="auth-input">${icon(ic)}${input}</div></div>`;
  const authPw = (id, label, auto, hint) => authField(id, label,
    `<input class="input" id="${id}" type="password" autocomplete="${auto}" ${hint ? `aria-describedby="${id}-hint"` : ""} />
     <button type="button" class="auth-eye" data-showpw="${id}" aria-pressed="false">Show</button>`, "i-shield", hint);

  function pageAuth(mode, query) {
    if (LF.currentStaff()) return go("#/staff/dashboard");
    if (LF.currentUser()) return go("#/my");
    const next = (query && query.get("next")) || "";
    main.innerHTML = `
      <section class="auth-stage">
        <div class="container">
          <div class="auth ${mode === "up" ? "is-up" : ""}" id="auth">
            <form class="auth__form auth__form--in" id="authForm" novalidate aria-labelledby="inTitle">
              <p class="auth__kicker">QCPL Lost &amp; Found</p>
              <h1 id="inTitle">Sign in</h1>
              <p class="auth__lead">Welcome back! Sign in to see your reports, claims and updates.</p>
              <div class="auth-err"></div>
              ${authField("aId", `<span id="aIdLabel">Email or mobile number</span>`, `<input class="input" id="aId" autocomplete="username" autocapitalize="none" />`, "i-user")}
              ${authPw("aPw", "Password", "current-password")}
              <p id="forgotWrap" class="auth__forgot"><a href="#/forgot">Forgot your password?</a></p>
              <button class="btn btn--primary btn--lg btn--block" type="submit">Sign in ${icon("i-arrow")}</button>
              <p class="auth__note">No account? You can still <a href="#/report-lost">report an item</a> and <a href="#/status">check it with your reference number</a>.</p>
            </form>

            <form class="auth__form auth__form--up" id="regForm" novalidate aria-labelledby="upTitle">
              <p class="auth__kicker">QCPL Lost &amp; Found</p>
              <h1 id="upTitle">Create an account</h1>
              <p class="auth__lead" data-no-tr>${isFil() ? `Para sa <strong>${esc(LIBRARY.libraryName)}</strong>. Pangalan at mobile number lang ang kailangan.` : `For the <strong>${esc(LIBRARY.libraryName)}</strong>. You only need your name and mobile number.`}</p>
              <div class="auth-err"></div>
              <div class="hp" aria-hidden="true" data-no-tr><label for="rLfhp">Leave this empty</label><input id="rLfhp" tabindex="-1" autocomplete="off" data-lpignore="true" data-1p-ignore /></div>
              ${authField("rName", "Full name", `<input class="input" id="rName" autocomplete="name" />`, "i-user")}
              <div class="grid-2">
                ${authField("rPhone", "Mobile number", `<input class="input" id="rPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0917 123 4567" />`, "i-call")}
                ${authField("rEmail", `Email <span class="opt">(optional)</span>`, `<input class="input" id="rEmail" type="email" autocomplete="email" />`, "i-mail")}
              </div>
              <div class="field auth-field"><label for="rRole">I am a</label><div class="auth-input">${icon("i-id")}<select class="select" id="rRole">${USER_ROLES.map((r) => `<option>${r}</option>`).join("")}</select></div></div>
              ${authField("rMemberId", `QCitizen ID or library card number <span class="opt">(optional)</span>`, `<input class="input" id="rMemberId" autocomplete="off" />`, "i-id")}
              <div class="grid-2">
                ${authPw("rPw", "Create a password", "new-password", "At least 8 letters or numbers.")}
                ${authPw("rPw2", "Type the password again", "new-password")}
              </div>
              <label class="checkline" for="rOk" style="font-weight:400"><input type="checkbox" id="rOk" /><span>I agree that my details will be used only for Lost &amp; Found services, following the Data Privacy Act of 2012. <a href="#/privacy" target="_blank" rel="noopener">Read the Privacy Policy</a>.</span></label>
              <button class="btn btn--primary btn--lg btn--block" type="submit">${icon("i-check")} Create account</button>
            </form>

            <div class="auth__panel">
              <div class="auth__panel-copy auth__panel-copy--in">
                <p class="auth__brand">Quezon City Public Library</p>
                <h2>Welcome back!</h2>
                <p>New here? Create a free account to keep all your reports, claims and updates in one place.</p>
                <button type="button" class="btn btn--light" data-auth="up">Create an account ${icon("i-arrow")}</button>
              </div>
              <div class="auth__panel-copy auth__panel-copy--up">
                <p class="auth__brand">Quezon City Public Library</p>
                <h2>Hello, QCitizen!</h2>
                <p>Already have an account? Sign in to see your reports and updates.</p>
                <button type="button" class="btn btn--light" data-auth="in">${icon("i-back")} Sign in</button>
              </div>
            </div>
          </div>
        </div>
      </section>`;

    const auth = $("#auth"), inForm = $("#authForm"), upForm = $("#regForm");
    if (query && query.get && query.get("idle")) $(".auth-err", inForm).innerHTML = `<div class="alert alert--info" role="status">${icon("i-clock")}<p>You were signed out because the page was not used for a while. Please sign in again.</p></div>`;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The form under the panel can't be reached by keyboard or screen reader
    const paintInert = () => { const up = auth.classList.contains("is-up"); inForm.inert = up; upForm.inert = !up; };
    paintInert();
    const setMode = (m) => {
      const up = m === "up";
      if (auth.classList.contains("is-up") === up) return;
      history.replaceState(null, "", up ? "#/register" : "#/signin");
      document.title = `${up ? "Create an Account" : "Sign In"} — Quezon City Public Library`;
      auth.classList.add("is-sweeping");
      setTimeout(() => {
        auth.classList.toggle("is-up", up);
        auth.classList.remove("is-sweeping");
        paintInert();
        (up ? $("#rName") : $("#aId")).focus({ preventScroll: true });
        announce(up ? "Create an account" : "Sign in");
      }, reduce ? 0 : 420);
    };
    $$("[data-auth]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.auth)));
    $$("[data-showpw]").forEach((b) => b.addEventListener("click", () => {
      const inp = $("#" + b.dataset.showpw), show = inp.type === "password";
      inp.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; b.setAttribute("aria-pressed", String(show));
    }));

    // Sign in
    inForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = $("#aId").value.trim(), pw = $("#aPw").value;
      const errs = [];
      if (!id) errs.push(["aId", "Please type your email or mobile number."]);
      if (!pw) errs.push(["aPw", "Please type your password."]);
      if (errs.length) return showAuthErrors(errs, inForm);
      try {
        // Users only: administrators sign in on their own page (/admin)
        await LF.signIn("user", id, pw);
        renderAccountLink();
        renderLibraryShell();
        announce(`Signed in. You are using the ${LIBRARY.libraryName}.`);
        go(next && !next.startsWith("#/staff") ? next : "#/my");
      } catch (err) {
        if (err.code === "needs-verify") return go("#/verify"); // account made but the code was never typed
        showAuthErrors([["", err.message]], inForm); $("#aPw").value = "";
      }
    });

    // Create an account
    const shownAt = Date.now();
    upForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      // Bots fill the hidden box or send the form within a second or two
      if ($("#rLfhp").value || Date.now() - shownAt < 2500) return showAuthErrors([["", "Please check your answers and press Create account again."]], upForm);
      const name = $("#rName").value.trim(), phone = $("#rPhone").value.trim(), email = $("#rEmail").value.trim();
      const memberId = $("#rMemberId").value.trim();
      const pw = $("#rPw").value, pw2 = $("#rPw2").value;
      const errs = [];
      if (!name) errs.push(["rName", "Please type your full name."]);
      if (!validPhone(phone)) errs.push(["rPhone", "Please type a valid mobile number, e.g. 0917 123 4567."]);
      if (!validEmail(email)) errs.push(["rEmail", "The email address doesn't look right."]);
      if (pw.length < 8) errs.push(["rPw", "The password needs at least 8 characters."]);
      else if (pw !== pw2) errs.push(["rPw2", "The two passwords are not the same."]);
      if (!$("#rOk").checked) errs.push(["rOk", "Please tick the box to agree."]);
      if (errs.length) return showAuthErrors(errs, upForm);
      try {
        await LF.register({ name, phone, email, password: pw, role: $("#rRole").value, memberId });
        if (ORG.signupCode) { announce("Account created. We are sending you a 6-digit code."); return go("#/verify"); }
        renderAccountLink(); renderLibraryShell(); announce("Account created. You are signed in."); go("#/my");
      }
      catch (err) { showAuthErrors([["", err.message]], upForm); }
    });
  }
  const pageSignin = (query) => pageAuth("in", query);
  const pageRegister = (query) => pageAuth("up", query);

  function pageMy() {
    if (LF.currentStaff()) return go("#/staff/dashboard"); // administrators use the admin area
    const user = LF.currentUser();
    if (!user) return go("#/signin?next=" + encodeURIComponent("#/my"));
    const recs = LF.recordsForPerson({ userId: user.id, phone: myPhone(user) });
    const notes = LF.notificationsFor({ userId: user.id, phone: myPhone(user) });
    const unread = notes.filter((n) => !n.read);
    const myContribs = LF.contributionsFor({ userId: user.id, phone: myPhone(user) });
    const thisMonth = toISODate(new Date()).slice(0, 7);
    const monthLost = recs.lost.filter((l) => l.createdAt.slice(0, 7) === thisMonth && l.status !== "closed").length;
    const monthFound = recs.found.filter((f) => LF.isRecognizable(f) && f.release && f.release.at.slice(0, 7) === thisMonth).length;
    const section = (title, kind, list, empty) => `
      <section class="section" style="padding-top:0"><div class="container">
        <h2>${title} <span class="muted" style="font-size:1rem;font-family:var(--font-body)">(${list.length})</span></h2>
        ${list.length ? `<div class="case-list">${list.map((r) => caseCard(kind, r)).join("")}</div>` : `<p class="muted">${empty}</p>`}
      </div></section>`;
    main.innerHTML = `
      ${pageHead(`Hello, ${esc(user.name.split(" ")[0])}`, `This page shows only your own reports, claims and updates at the ${esc(LIBRARY.libraryName)}.`)}
      <section class="section" style="padding-bottom:1.5rem"><div class="container">
        <div class="alert ${user.verified ? "alert--info" : "alert--warn"}">${icon(user.verified ? "i-shield" : "i-info")}
          <p>${user.verified
            ? `<strong>Verified QCPL account.</strong> ${esc(user.role || USER_ROLES[0])}${user.memberId ? " · No. " + esc(user.memberId) : ""}`
            : `<strong>Account not yet verified.</strong> Show a valid ID at the ${esc(LIBRARY.deskLocation)} once, and the office will verify your account. You can still report and claim in the meantime.`}</p></div>
        <div class="btn-row" style="margin-bottom:1.5rem">
          <a class="btn btn--primary" href="#/report-lost">${icon("i-doc")} Report a lost item</a>
          <a class="btn btn--outline" href="#/report-found">${icon("i-hand")} Report a found item</a>
          <a class="btn btn--outline" href="#/account">${icon("i-user")} Account settings</a>
          <button type="button" class="btn btn--outline" id="signOut">Sign out</button>
        </div>
        ${user.mustChange ? `<div class="alert alert--warn" style="margin-bottom:1.5rem">${icon("i-shield")}<p><strong>You signed in with a temporary password.</strong> Please <a href="#/account">choose your own password</a> now.</p></div>` : ""}
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
            <h2 style="margin:0">Updates ${unread.length ? `<span class="count-badge">${unread.length} new</span>` : ""}</h2>
            ${unread.length ? `<button type="button" class="btn btn--outline btn--sm" id="markAll">Mark all as read</button>` : ""}
          </div>
          ${notifList(notes.slice(0, 12), { markable: true })}
        </div>
      </div></section>
      <section class="section" style="padding-top:0"><div class="container">
        <div class="card">
          <h2 style="margin-bottom:1rem">My honesty record</h2>
          ${honestyCard(LF.honestyFor({ userId: user.id, phone: myPhone(user) }))}
          ${recs.found.some(LF.isRecognizable) ? `<h3 style="margin-top:1.25rem">My certificates</h3><ul class="cert-list">${recs.found.filter(LF.isRecognizable).map((f) =>
            `<li><a href="#/certificate/${encodeURIComponent(f.id)}">${icon("i-award")} ${esc(f.title)} — returned ${esc(fmtDate(f.release ? f.release.at : f.updatedAt))}</a></li>`).join("")}</ul>` : ""}
          <h3 style="margin-top:1.25rem">Monthly Certificates of Contribution</h3>
          ${myContribs.length ? `<ul class="cert-list">${contributionLinks(myContribs)}</ul>`
            : `<p class="muted">Each month, the library gives a Certificate of Contribution to people with at least ${CONTRIB_MIN} lost reports of their own, or at least ${CONTRIB_MIN} found items returned to their owners. This month so far: <strong>${monthLost} lost ${monthLost === 1 ? "report" : "reports"}</strong> and <strong>${monthFound} found ${monthFound === 1 ? "item" : "items"} returned</strong>.</p>`}
        </div>
      </div></section>
      ${section("My lost items", "lost", recs.lost, "You have no lost item reports.")}
      ${section("My claims", "claims", recs.claims, "You have not claimed any items.")}
      ${section("Items I found", "found", recs.found, "You have not reported any found items. Thank you in advance for your honesty!")}`;
    $("#signOut").addEventListener("click", async () => { try { await LF.signOut(); } catch (err) { return alert(err.message); } renderAccountLink(); renderLibraryShell(); announce("Signed out"); go("#/"); });
    const ma = $("#markAll");
    ma && ma.addEventListener("click", async () => { try { await LF.markRead(unread.map((n) => n.id)); } catch (err) { return alert(err.message); } renderAccountLink(); pageMy(); announce("All updates marked as read"); });
  }

  /* ---------------- 6-digit code screens ----------------
     Used after creating an account (#/verify) and for a forgotten password (#/forgot).
     The person types the code in six boxes (typing moves to the next box; pasting
     fills all), then sees "Verifying…" with a progress ring while it is checked.
     DEMO: on this computer only (localhost or the offline file) with no email or
     SMS set up, the code is shown on screen so the flow can be tried; never on a
     real website. */
  const isDemoHost = () => location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const maskContact = (s) => {
    const t = String(s || "").trim();
    if (t.includes("@")) { const [u, d] = t.split("@"); return `${u.slice(0, 1)}${"•".repeat(Math.max(2, u.length - 1))}@${d}`; }
    const dgt = t.replace(/\D/g, "");
    return dgt.length >= 8 ? `${dgt.slice(0, 4)} ••• ${dgt.slice(-4)}` : t;
  };
  const otpCodeStep = (title, mins) => `
            <form class="otp-step" data-step="code" hidden novalidate>
              <h1>${title}</h1>
              <p class="auth__lead" data-no-tr>${isFil() ? `Nagpadala kami ng code na may 6 na numero sa <strong class="otpTo"></strong>. Gagana ito nang ${mins} minuto.` : `We sent a 6-digit code to <strong class="otpTo"></strong>. It works for ${mins} minutes.`}</p>
              <div class="otp" role="group" aria-label="${isFil() ? "Code na may 6 na numero" : "6-digit code"}" data-no-tr>
                ${[0, 1, 2, 3, 4, 5].map((i) => `<input class="otp__box" inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="${isFil() ? `Numero ${i + 1} sa 6` : `Digit ${i + 1} of 6`}" ${i === 0 ? 'autocomplete="one-time-code"' : 'autocomplete="off"'} />`).join("")}
              </div>
              <p class="otp__msg" role="alert"></p>
              <p class="otp__demo" hidden data-no-tr></p>
              <p class="otp__resend">Didn't get it? <button type="button" class="linklike otp__again" disabled>Send again</button> <span class="otp__wait"></span></p>
            </form>
            <div class="otp-step" data-step="verify" hidden role="status" aria-live="polite">
              <h1>Verifying…</h1>
              <p class="auth__lead">Checking your code.</p>
              <div class="ring" aria-hidden="true">
                <svg viewBox="0 0 120 120"><circle class="ring__track" cx="60" cy="60" r="52"/><circle class="ring__bar" cx="60" cy="60" r="52"/></svg>
                <span class="ring__num">0</span>
              </div>
            </div>`;
  /* Wires the code screen inside `card`.
     send(): asks for a code → { sent, demoCode?, to? }   check(code): resolves if right, throws if wrong
     onOk(code): runs after the ring when the code is right   onNoChannel(r): codes can't be sent */
  function wireOtp(card, { send, check, onOk, onNoChannel }) {
    const boxes = $$(".otp__box", card), reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const msg = $(".otp__msg", card), row = $(".otp", card);
    let timer = null;
    const show = (step) => {
      $$(".otp-step", card).forEach((s) => (s.hidden = s.dataset.step !== step));
      card.dataset.at = step;
      const cur = $(`.otp-step[data-step="${step}"]`, card), first = cur && $("input, a.btn", cur);
      first && first.focus({ preventScroll: true });
    };
    const clear = () => boxes.forEach((b) => { b.value = ""; b.classList.remove("is-filled"); });
    // Wait before "Send again"
    const startWait = (sec = 60) => {
      clearInterval(timer);
      const btn = $(".otp__again", card), out = $(".otp__wait", card);
      let left = sec; btn.disabled = true; out.textContent = `(${left}s)`;
      timer = setInterval(() => {
        if (!card.isConnected) return clearInterval(timer);
        left--; out.textContent = left > 0 ? `(${left}s)` : "";
        if (left <= 0) { clearInterval(timer); btn.disabled = false; }
      }, 1000);
    };
    const sendCode = async (opts) => {
      let r;
      try { r = await send(opts); }
      catch (err) { r = { sent: false, reason: "error", message: err.message }; }
      if (!r.sent && r.reason !== "no-channel") {
        // The text or email could not be sent: say so instead of waiting for a code that never comes
        show("code"); clear();
        $('.otp-step[data-step="code"] .auth__lead', card).hidden = true; // "We sent a code…" would not be true
        msg.textContent = r.reason === "too-many" ? "Too many codes were sent. Please wait an hour, or visit the Lost & Found desk with a valid ID."
          : r.message || "We couldn't send the code right now. Please check your internet and press Send again.";
        startWait(r.reason === "too-many" ? 3600 : 30);
        return;
      }
      if (!r.sent) { clearInterval(timer); return onNoChannel(r); }
      $('.otp-step[data-step="code"] .auth__lead', card).hidden = false;
      $(".otpTo", card).textContent = maskContact(r.to);
      const demo = $(".otp__demo", card);
      demo.hidden = !r.demoCode;
      if (r.demoCode) demo.innerHTML = isFil()
        ? `<strong>Demo sa computer na ito lang:</strong> ang code ay <span class="mono">${esc(r.demoCode)}</span>. Sa totoong website, ipinapadala ito sa text o email.`
        : `<strong>Demo on this computer only:</strong> the code is <span class="mono">${esc(r.demoCode)}</span>. On the real website it is sent by text or email.`;
      clear(); msg.textContent = "";
      show("code"); boxes[0].focus();
      startWait(r.wait || 60);
    };
    $(".otp__again", card).addEventListener("click", () => sendCode({ fresh: true }));

    const filled = () => { boxes.forEach((b) => b.classList.toggle("is-filled", !!b.value)); return boxes.map((b) => b.value).join(""); };
    const tryCode = async () => {
      const code = filled();
      if (code.length !== 6) return;
      show("verify");
      const bar = $(".ring__bar", card), num = $(".ring__num", card), C = 2 * Math.PI * 52;
      bar.style.strokeDasharray = C;
      const result = check(code).then(() => true, (err) => err);
      const t0 = performance.now(), dur = reduce ? 0 : 1300;
      await new Promise((done) => {
        const tick = (t) => {
          const p = dur ? Math.min(1, (t - t0) / dur) : 1, eased = 1 - (1 - p) ** 3;
          bar.style.strokeDashoffset = C * (1 - eased);
          num.textContent = Math.round(eased * 100);
          p < 1 ? requestAnimationFrame(tick) : done();
        };
        requestAnimationFrame(tick);
      });
      const ok = await result;
      if (ok === true) { clearInterval(timer); return onOk(code); }
      show("code");
      row.classList.remove("is-wrong"); void row.offsetWidth; row.classList.add("is-wrong");
      msg.textContent = ok.message || "The code is not correct.";
      clear(); boxes[0].focus();
    };
    boxes.forEach((b, i) => {
      b.addEventListener("input", () => {
        b.value = b.value.replace(/\D/g, "").slice(-1);
        if (b.value && i < 5) boxes[i + 1].focus();
        msg.textContent = ""; row.classList.remove("is-wrong");
        if (filled().length === 6) tryCode();
      });
      b.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !b.value && i > 0) { boxes[i - 1].focus(); boxes[i - 1].value = ""; filled(); e.preventDefault(); }
        if (e.key === "ArrowLeft" && i > 0) boxes[i - 1].focus();
        if (e.key === "ArrowRight" && i < 5) boxes[i + 1].focus();
      });
      b.addEventListener("paste", (e) => {
        const digits = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
        if (!digits) return;
        e.preventDefault();
        boxes.forEach((x, j) => (x.value = digits[j] || ""));
        filled();
        boxes[Math.min(digits.length, 5)].focus();
        if (digits.length === 6) tryCode();
      });
      b.addEventListener("focus", () => b.select());
    });
    return { show, sendCode };
  }
  const wirePwToggles = (root) => $$("[data-showpw]", root).forEach((b) => b.addEventListener("click", () => {
    const inp = $("#" + b.dataset.showpw), s = inp.type === "password";
    inp.type = s ? "text" : "password"; b.textContent = s ? "Hide" : "Show"; b.setAttribute("aria-pressed", String(s));
  }));

  /* ---------------- New account: confirm the mobile number ----------------
     Right after "Create account", a 6-digit code is sent automatically to the
     person's mobile number (and email, if given). The account works only after
     the code is typed here. */
  function pageVerify() {
    if (LF.currentStaff()) return go("#/staff/dashboard");
    if (!ORG.signupCode) return go(LF.currentUser() ? "#/my" : "#/signin"); // codes are off for now
    const p = LF.pendingVerification();
    if (!p) return go(LF.currentUser() ? "#/my" : "#/signin");
    main.innerHTML = `
      <section class="auth-stage">
        <div class="container">
          <div class="otp-card" id="otpCard">
            <div class="otp-card__badge" aria-hidden="true">${icon("i-call")}</div>
            <div class="otp-step" data-step="sending">
              <h1>Sending your code…</h1>
              <p class="auth__lead">One moment.</p>
            </div>
            ${otpCodeStep("Confirm your mobile number", 10)}
            <div class="otp-step" data-step="desk" hidden>
              <h1>Codes can't be sent right now</h1>
              <p class="auth__lead">Your account was made, but it needs to be turned on. Please visit the ${esc(LIBRARY.deskLocation)} with a valid ID, or call <a href="${LIBRARY.phoneHref}">${esc(LIBRARY.phone)}</a>. The staff will turn it on for you.</p>
            </div>
            <div class="otp-step" data-step="done" hidden>
              <div class="otp-done" aria-hidden="true">${icon("i-check")}</div>
              <h1>Your account is ready!</h1>
              <p class="auth__lead">Your mobile number is confirmed. You can now report items and follow your claims.</p>
              <a class="btn btn--primary btn--lg btn--block" href="#/my">Go to my page ${icon("i-arrow")}</a>
            </div>
            <p class="otp-card__back"><a href="#/signin" id="vfBack">${icon("i-back")} Back to sign in</a></p>
          </div>
        </div>
      </section>`;
    const card = $("#otpCard");
    $("#vfBack").addEventListener("click", () => { LF.cancelSignup().catch(() => {}); });
    const otp = wireOtp(card, {
      send: async (opts = {}) => ({ ...(await LF.sendSignupCode({ demo: isDemoHost(), fresh: !!opts.fresh })), to: p.phone }),
      check: (code) => LF.confirmSignupCode(code),
      onOk: () => { renderAccountLink(); renderLibraryShell(); otp.show("done"); announce("Your account is ready"); },
      onNoChannel: () => otp.show("desk"),
    });
    otp.sendCode();
  }

  /* ---------------- Forgot password ----------------
     1. Type the email or mobile number → a 6-digit code is sent.
     2. Type the code (six boxes, "Verifying…" ring).
     3. Choose a new password.
     Without email or SMS set up, the page points the person to the desk. */
  function pageForgot() {
    if (LF.currentUser()) return go("#/account");
    main.innerHTML = `
      <section class="auth-stage">
        <div class="container">
          <div class="otp-card" id="otpCard">
            <div class="otp-card__badge" aria-hidden="true">${icon("i-shield")}</div>

            <form class="otp-step" data-step="ask" novalidate>
              <h1>Forgot your password?</h1>
              <p class="auth__lead">Type the email or mobile number on your account. We'll send you a 6-digit code.</p>
              <div class="auth-err"></div>
              ${authField("fpId", "Email or mobile number", `<input class="input" id="fpId" autocomplete="username" />`, "i-user")}
              <button class="btn btn--primary btn--lg btn--block" type="submit">Send me a code ${icon("i-arrow")}</button>
            </form>
            ${otpCodeStep("Enter the code", 15)}
            <form class="otp-step" data-step="new" hidden novalidate>
              <h1>Choose a new password</h1>
              <p class="auth__lead">Your code is correct. Make a new password you can remember.</p>
              <div class="auth-err"></div>
              ${authPw("fpPw", "New password", "new-password", "At least 8 letters or numbers.")}
              ${authPw("fpPw2", "Type the new password again", "new-password")}
              <button class="btn btn--primary btn--lg btn--block" type="submit">${icon("i-check")} Save my new password</button>
            </form>

            <div class="otp-step" data-step="done" hidden>
              <div class="otp-done" aria-hidden="true">${icon("i-check")}</div>
              <h1>Password changed</h1>
              <p class="auth__lead">You can now sign in with your new password.</p>
              <a class="btn btn--primary btn--lg btn--block" href="#/signin">Sign in ${icon("i-arrow")}</a>
            </div>

            <div class="otp-step" data-step="desk" hidden>
              <h1>Codes can't be sent right now</h1>
              <p class="auth__lead">Please visit the ${esc(LIBRARY.deskLocation)} with a valid ID, or call <a href="${LIBRARY.phoneHref}">${esc(LIBRARY.phone)}</a>. The staff will give you a temporary password, and you can choose a new one after you sign in.</p>
            </div>

            <p class="otp-card__back"><a href="#/signin">${icon("i-back")} Back to sign in</a></p>
          </div>
        </div>
      </section>`;

    const card = $("#otpCard");
    let who = "", code = "";
    wirePwToggles(card);
    const otp = wireOtp(card, {
      send: async () => ({ ...(await LF.requestPasswordReset(who, { demo: isDemoHost() })), to: who }),
      check: (c) => LF.verifyResetCode(who, c),
      onOk: (c) => { code = c; otp.show("new"); },
      onNoChannel: () => otp.show("desk"),
    });
    $('[data-step="ask"]', card).addEventListener("submit", async (e) => {
      e.preventDefault();
      who = $("#fpId").value.trim();
      if (!who) return showAuthErrors([["fpId", "Please type your email or mobile number."]], e.target);
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      try { await otp.sendCode(); } finally { btn.disabled = false; }
    });
    $('[data-step="new"]', card).addEventListener("submit", async (e) => {
      e.preventDefault();
      const pw = $("#fpPw").value, pw2 = $("#fpPw2").value;
      if (pw.length < 8) return showAuthErrors([["fpPw", "The new password needs at least 8 characters."]], e.target);
      if (pw !== pw2) return showAuthErrors([["fpPw2", "The two passwords are not the same."]], e.target);
      try { await LF.resetPassword(who, code, pw); otp.show("done"); announce("Password changed. Please sign in."); }
      catch (err) { showAuthErrors([["", err.message]], e.target); }
    });
  }

  /* ---------------- Account settings ---------------- */
  function pageAccount() {
    if (LF.currentStaff()) return go("#/staff/dashboard");
    const user = LF.currentUser();
    if (!user) return go("#/signin?next=" + encodeURIComponent("#/account"));
    main.innerHTML = `
      ${pageHead("Account settings", "Change your details or password, or delete your account.", { href: "#/my", label: "Back to my reports" })}
      <section class="section"><div class="container" style="max-width:46rem;display:grid;gap:1.25rem">
        ${user.mustChange ? `<div class="alert alert--warn">${icon("i-shield")}<p><strong>Please choose your own password.</strong> You signed in with a temporary one.</p></div>` : ""}
        <form class="card" id="accForm" novalidate>
          <h2>Your details</h2>
          <div class="field"><label for="acName">Full name</label><input class="input" id="acName" value="${esc(user.name)}" autocomplete="name" /></div>
          <div class="grid-2">
            <div class="field"><label for="acPhone">Mobile number</label><input class="input" id="acPhone" type="tel" value="${esc(user.phone)}" autocomplete="tel" /></div>
            <div class="field"><label for="acEmail">Email <span class="opt">(optional)</span></label><input class="input" id="acEmail" type="email" value="${esc(user.email || "")}" autocomplete="email" /></div>
          </div>
          <div class="field"><label for="acMember">QCitizen ID or library card number <span class="opt">(optional)</span></label><input class="input" id="acMember" value="${esc(user.memberId || "")}" /></div>
          <h3 style="margin-top:1rem">Change password <span class="opt">(optional)</span></h3>
          ${pwField("acNew", "New password", "Leave empty to keep your password. At least 8 letters or numbers.", "new-password")}
          <h3 style="margin-top:1rem">Confirm it's you</h3>
          ${pwField("acCur", "Your current password", "Needed to save any change.", "current-password")}
          <div id="acMsg" role="status"></div>
          <button class="btn btn--primary btn--lg" type="submit">${icon("i-check")} Save changes</button>
        </form>
        <form class="card danger-zone" id="delForm">
          <h2>Delete my account</h2>
          <p>Your sign-in and saved details are erased. Reports you already sent stay on file until they are closed, because the library may need to return an item to you. To have those erased too, ask the desk — see the <a href="#/privacy">Privacy Policy</a>.</p>
          ${pwField("delPw", "Type your password to confirm", "", "current-password")}
          <div id="delMsg" role="status"></div>
          <button class="btn btn--outline btn--lg danger" type="submit">Delete my account</button>
        </form>
      </div></section>`;
    wireShowPw();
    const msg = (el, ok, text) => (el.innerHTML = `<div class="alert ${ok ? "alert--info" : "alert--error"}" role="alert">${icon(ok ? "i-check" : "i-info")}<p>${esc(text)}</p></div>`);
    $("#accForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const phone = $("#acPhone").value.trim(), email = $("#acEmail").value.trim();
      if (!$("#acName").value.trim()) return msg($("#acMsg"), false, "Please type your full name.");
      if (!validPhone(phone)) return msg($("#acMsg"), false, "Please type a valid mobile number, e.g. 0917 123 4567.");
      if (!validEmail(email)) return msg($("#acMsg"), false, "The email address doesn't look right.");
      try {
        const u = await LF.updateAccount({ name: $("#acName").value, email, memberId: $("#acMember").value, phone, currentPassword: $("#acCur").value, newPassword: $("#acNew").value });
        $("#acCur").value = ""; $("#acNew").value = "";
        if (u.needsVerify) { renderAccountLink(); announce("Please confirm your new mobile number"); return go("#/verify"); }
        msg($("#acMsg"), true, "Saved. Your changes are in place."); renderAccountLink(); announce("Account updated");
      } catch (err) { msg($("#acMsg"), false, err.message); }
    });
    $("#delForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!confirm("Delete your account? This can't be undone.")) return;
      try { await LF.deleteAccount($("#delPw").value); renderAccountLink(); announce("Your account was deleted"); go("#/"); }
      catch (err) { msg($("#delMsg"), false, err.message); }
    });
  }

  /* ---------------- Privacy Policy ----------------
     Built from ORG.privacy (js/data.js), so the periods shown are the ones the
     site really uses (the server erases older information every night). */
  function pagePrivacy() {
    const P = ORG.privacy || {};
    const S = (title, body) => `<section class="policy__sec"><h2>${title}</h2>${body}</section>`;
    const span = (d) => { d = Number(d) || 0; return d % 365 === 0 ? `${d / 365} ${d / 365 === 1 ? "year" : "years"}` : d % 30 === 0 ? `${d / 30} months` : `${d} days`; };
    const dpo = P.dpoName || P.dpoEmail
      ? `${P.dpoName ? `<strong>${esc(P.dpoName)}</strong>` : "The Data Protection Officer"}${P.dpoEmail ? ` · <a href="mailto:${esc(P.dpoEmail)}">${esc(P.dpoEmail)}</a>` : ""}`
      : `The Data Protection Officer of the Quezon City Public Library <span class="muted">(name and email to be added before launch; until then, write to the Lost &amp; Found desk and mark it "Data Privacy")</span>`;
    main.innerHTML = `
      ${pageHead("Privacy Policy", "How the QCPL Lost &amp; Found handles your personal information.")}
      <section class="section"><div class="container policy">
        ${P.approved ? "" : `<p class="policy__note">${icon("i-info")} <span>Draft for approval by the Quezon City Public Library and its Data Protection Officer.</span></p>`}
        ${S("Who we are", `<p>The Lost &amp; Found service of the <strong>Quezon City Public Library (QCPL)</strong>, ${esc(LIBRARIES[0].address)}, and its district libraries. QCPL decides how your information is used (it is the "personal information controller"). We follow the <strong>Data Privacy Act of 2012 (Republic Act No. 10173)</strong>, its Implementing Rules, and the rules of the National Privacy Commission (NPC).</p>`)}
        ${S("What we collect", `<ul>
          <li><strong>Contact details:</strong> your name, mobile number, and, if you give them, your email and QCitizen ID or library card number.</li>
          <li><strong>Item details:</strong> what was lost or found, where and when, descriptions, special marks and photos.</li>
          <li><strong>Claim and release records:</strong> your answers when claiming, the type of ID shown and its last 4 characters (never the whole ID number), and who released the item.</li>
          <li><strong>Account details,</strong> if you create an account. Your password is stored only as a scrambled code that nobody can read, not even our staff.</li>
          <li><strong>Feedback</strong> you choose to give.</li>
          <li><strong>Technical details:</strong> one cookie that keeps you signed in (it is deleted when you sign out, or after 12 hours), and your network address, used for a short time to stop abuse such as too many wrong passwords. We do <strong>not</strong> use advertising or tracking cookies, or analytics services.</li></ul>
          <p>We do <strong>not</strong> collect your location. The "Find the library nearest to me" button uses your device's location only on your device, only when you press it, and it is never saved or sent.</p>
          <p>Please don't type ID numbers, bank card numbers or passwords into descriptions. If you are under 18, please ask a parent, guardian or librarian to help you.</p>`)}
        ${S("Why we use it", `<ul><li>To find and return lost items, and to contact you about your report or claim.</li>
          <li>To check that the person claiming an item is its real owner.</li>
          <li>To recognize finders (Certificate of Honesty, badges, and, only if you agree, the Wall of Honesty, which shows your first name and last initial).</li>
          <li>To prepare reports for the library, which show numbers only, never names.</li>
          <li>To keep the service safe (for example, stopping people who try to guess passwords or claim items that aren't theirs).</li></ul>
          <p>We use your information because you agree to it when you send a report, make a claim or create an account, and because it is needed for the library's public service (Data Privacy Act, Section 12). We never sell it, and never use it for advertising.</p>`)}
        ${S("Who can see it", `<ul><li><strong>You:</strong> your own reports, claims and updates.</li>
          <li><strong>Lost &amp; Found staff</strong> of the library you used, for their work only. Each staff member has their own account, and every action is recorded.</li>
          <li><strong>The public</strong> sees only general details of found items (type, color, brand, library, date, and a photo unless the item is an ID, wallet or phone). Never your name, contact details, special marks or private details. Lost items are never listed publicly.</li>
          <li><strong>Service providers</strong> who send our email and text messages: they receive only your email address or mobile number and the message, and may not use them for anything else.</li>
          <li id="ppVision" hidden><strong>Online photo reading:</strong> when you add a photo to a report, it may be sent to <strong>Anthropic</strong> (a company in the United States) so its AI can describe the item and fill in the form. This means the photo is processed outside the Philippines. Only the photo is sent, not your name or contact details. Please don't add photos that show IDs, cards or faces.</li>
          <li><strong>The photo helper</strong> on your device looks at photos on your own phone or computer. To recognize items better over time, the device keeps a small "fingerprint" of each photo (a list of numbers, not the picture) with the type of item. No names or personal details are kept.</li>
          <li id="ppCloud" hidden><strong>Where it is stored:</strong> our database and photos are kept by <strong>Supabase</strong> (a company in the United States) in its <strong id="ppRegion">cloud</strong> data centre, which may be outside the Philippines. It is locked so that only this website's server can read it, sent over encrypted connections, and Supabase may not use it for anything else.</li>
          <li>We share information with the police or other authorities only when the law requires it.</li></ul>`)}
        ${S("How long we keep it", `<ul>
          <li>Found items are kept for ${LIBRARY.holdDays} days. After that, unclaimed items are donated or disposed of, and IDs and documents are returned to the office that issued them.</li>
          <li>Reports, claims and release records: <strong>${span(P.closedRecordsDays || 365)}</strong> after they are closed or the item is returned. Then your name, contact details, descriptions, photos and answers are <strong>erased automatically</strong>. Only the type of item, place and dates remain, for the library's statistics.</li>
          <li>Updates we sent you: <strong>${span(P.notificationsDays || 365)}</strong>. Feedback comments: <strong>${span(P.closedRecordsDays || 365)}</strong> (the scores stay, without your words).</li>
          <li>Accounts: until you delete yours in <a href="#/account">Account settings</a>, or <strong>${span(P.inactiveAccountsDays || 730)}</strong> after your last sign-in.</li>
          <li>The staff activity log: <strong>${span(P.activityLogDays || 730)}</strong>.</li>
          <li>Backups are locked with a key only the library has, and each copy is kept for at most <strong>${span(P.backupDays || 60)}</strong>. Information erased above disappears from the backups as the old copies are replaced.</li></ul>`)}
        ${S("Your rights", `<p>Under the Data Privacy Act you may:</p>
          <ul><li><strong>be informed</strong> about how your information is used (this page);</li>
          <li><strong>see</strong> the information we have about you, and get a copy of it;</li>
          <li><strong>correct</strong> it if it is wrong;</li>
          <li><strong>erase</strong> it or <strong>block</strong> its use, or withdraw your consent, unless we must keep it for an open claim or by law;</li>
          <li><strong>object</strong> to how it is used;</li>
          <li>be <strong>paid damages</strong> if it was used unlawfully; and</li>
          <li><strong>complain</strong> to the National Privacy Commission (<a href="https://privacy.gov.ph" target="_blank" rel="noopener">privacy.gov.ph</a>).</li></ul>
          <p>You can change your details and delete your account yourself in <a href="#/account">Account settings</a>, and add details to or close an open report from <a href="#/status">Check Status</a>. For anything else, ask the Lost &amp; Found desk or our Data Protection Officer (below). Please bring a valid ID so we can make sure it's you. We answer within 15 working days.</p>`)}
        ${S("How we protect it", `<ul><li>Only staff with their own account can see personal details. Administrators sign in on a separate page, and every staff action is recorded.</li>
          <li>Passwords are stored as scrambled codes, and sign-ins lock after several wrong tries.</li>
          <li>Some details of found items are kept private, so only the real owner can describe them.</li>
          <li>Backups are encrypted, and the website sends information over secure (HTTPS) connections.</li>
          <li>If there is ever a breach that puts your information at risk, we will tell the National Privacy Commission and the people affected within 72 hours of finding out, as the law requires.</li></ul>`)}
        ${S("Changes to this policy", `<p>If we change how we use your information, we will update this page. Big changes will also be announced at the libraries.</p>`)}
        ${S("Contact", `<p>Lost &amp; Found desk: ${esc(LIBRARY.deskLocation)} · <a href="${LIBRARY.phoneHref}">${esc(LIBRARY.phone)}</a> · <a href="mailto:${esc(LIBRARY.email)}">${esc(LIBRARY.email)}</a><br />Data Protection Officer: ${dpo}</p>`)}
      </div></section>`;
    // Online photo reading is mentioned only when this site really uses it
    try { PhotoAI.online().then((on) => { const li = $("#ppVision"); if (li && on) li.hidden = false; }).catch(() => {}); } catch {}
    // Where the database is kept (shown when it is in Supabase)
    if (/^https?:$/.test(location.protocol)) fetch("/api/health", { cache: "no-store" }).then((r) => r.json()).then((h) => {
      const li = $("#ppCloud"); if (!li || h.database !== "supabase") return;
      if (h.region) $("#ppRegion").textContent = h.region; li.hidden = false;
    }).catch(() => {});
  }

  /* ---------------- How to claim ---------------- */
  function pageClaim() {
    main.innerHTML = `
      ${pageHead("How to <em>claim</em> your item", "Here is everything you need to know before visiting the Lost &amp; Found Office.")}
      <section class="section"><div class="container">
        <h2>The 4 steps</h2>
        ${stepsList()}
      </div></section>
      <section class="section section--tint"><div class="container cta-split">
        <div class="panel">
          <h2>What to bring</h2>
          <ul class="req-list">
            <li>${icon("i-id")}<div><strong>A valid ID</strong><br /><span class="muted">Your QCitizen ID, QCPL library card, school ID, or any government ID</span></div></li>
            <li>${icon("i-doc")}<div><strong>Your reference number</strong><br /><span class="muted">From your report or claim. It's okay if you lost it — we can look you up.</span></div></li>
            <li>${icon("i-shield")}<div><strong>Proof it's yours</strong><br /><span class="muted">Answer our questions about the item, or show a receipt, photo, or unlock the phone in front of staff.</span></div></li>
          </ul>
        </div>
        <div class="panel">
          <h2>Someone picking up for you?</h2>
          <p>A family member or friend may claim for you. They should bring:</p>
          <ul class="req-list">
            <li>${icon("i-doc")}<span>A signed <strong>authorization letter</strong> from you</span></li>
            <li>${icon("i-id")}<span>A <strong>photocopy of your valid ID</strong> with your signature</span></li>
            <li>${icon("i-id")}<span><strong>Their own valid ID</strong></span></li>
          </ul>
        </div>
      </div></section>
      <section class="section"><div class="container" style="max-width:52rem">
        <h2>Common questions</h2>
        <div class="faq">
          ${[
            ["How does smart matching work?", "When you report a lost item, we compare it with every found item — the type, name, brand, color, place, date and description. If several details are alike, we tell you it's a possible match. Our staff always make the final check before anything is released."],
            ["Why are some details of found items hidden?", "To protect you. If every detail were shown, someone could pretend an item is theirs. We keep a few details private and ask the person claiming to describe them."],
            ["How long do you keep found items?", `We keep items for ${LIBRARY.holdDays} days. After that, unclaimed items may be donated or disposed of according to library policy. IDs and documents are turned over to the issuing office.`],
            ["Is there a fee to claim my item?", "No. Claiming your item is free."],
            ["I found and turned in an item. Is there any recognition?", "Yes — thank you! When the owner gets the item back, you can view and print a <strong>Certificate of Honesty</strong> from your report (use your reference number, or see <strong>My reports</strong> if you have an account). You also earn badges: <strong>Good Samaritan</strong> (1 item), <strong>Honest Hero</strong> (3 items) and <strong>QCPL Honesty Champion</strong> (5 items). If you allow it, your first name and last initial appear on our <strong>Wall of Honesty</strong>."],
            ["Can I offer a reward for my lost item?", "No. The library is a government office, so it does not take part in rewards or any payment between owners and finders. Please don't offer or ask for money for a lost item. Finders are thanked with a <strong>Certificate of Honesty</strong>, badges and the <strong>Wall of Honesty</strong> instead."],
            ["What is the monthly Certificate of Contribution?", `Each month the library recognizes people who actively use the Lost &amp; Found: those with at least ${CONTRIB_MIN} lost reports of their own that month, or at least ${CONTRIB_MIN} found items that were returned to their owners. The administrator checks the reports first, then issues the certificate. You can open and print it from <strong>My reports</strong> or from your report.`],
            ["Do I need an account?", "No. You can report and claim without an account — just keep your reference number. An account simply keeps all your reports and updates in one place."],
            ["I don't use the internet much. Can I report in person?", `Yes. Visit the office at ${esc(LIBRARY.deskLocation)}, or call ${esc(LIBRARY.phone)}. Our staff will fill out the report for you.`],
            ["Is there help for PWDs or anyone who needs assistance?", "Yes. Tick the assistance box in your report or tell the office staff. You get priority service, and a staff member can accompany you to where you lost your item."],
            ["I think I left something inside a library book I returned.", "Report it here and tell the librarian at the circulation desk the title of the book and the date you returned it. Things found inside returned books are turned over to the Lost & Found Desk."],
            ["I lost a book I borrowed from the library. Do I report it here?", "No. This page is for personal belongings. For a lost or damaged library book, please talk to the librarian at the circulation desk."],
            ["Which library do I pick up my item from?", "Found items are kept at the library where they were turned in. Each found item shows its library, and the office will tell you where to go when your claim is approved."],
            ["Who can use this system?", "Everyone who visits the QCPL Main Library or any of its branches: library members, students, researchers, visitors and staff."],
          ].map(([q, a]) => `<details><summary>${q}</summary><div><p>${a}</p></div></details>`).join("")}
        </div>
        <div class="btn-row" style="margin-top:2rem">
          <a class="btn btn--primary btn--lg" href="#/browse">${icon("i-search")} Look for my item</a>
          <a class="btn btn--outline btn--lg" href="#/report-lost">${icon("i-doc")} Report a lost item</a>
        </div>
      </div></section>`;
  }

  /* ---------------- Contact / Visit ---------------- */
  function pageContact() {
    main.innerHTML = `
      ${pageHead("Visit the <em>Lost &amp; Found</em> Office", "Our friendly staff are ready to help you in person or by phone.")}
      <section class="section"><div class="container cta-split">
        <div class="panel">
          <ul class="info-list" style="gap:1.4rem">
            <li>${icon("i-pin")}<div><strong>Location</strong><span>${esc(LIBRARY.deskLocation)}<br />${esc(LIBRARY.address)}</span></div></li>
            <li>${icon("i-info")}<div><strong>How to get there</strong><span>${esc(LIBRARY.deskLandmark)}</span></div></li>
            <li>${icon("i-clock")}<div><strong>Opening hours</strong><span>${esc(LIBRARY.hours)}<br />${esc(LIBRARY.hoursNote)}</span></div></li>
            <li>${icon("i-call")}<div><strong>Phone</strong><a href="${LIBRARY.phoneHref}">${esc(LIBRARY.phone)}</a></div></li>
            <li>${icon("i-mail")}<div><strong>Email</strong><a href="mailto:${esc(LIBRARY.email)}" style="font-size:1rem;word-break:break-all">${esc(LIBRARY.email)}</a></div></li>
          </ul>
          <div class="btn-row">
            <a class="btn btn--primary btn--lg" href="${LIBRARY.phoneHref}">${icon("i-call")} Call the office</a>
            <a class="btn btn--outline btn--lg" href="${LIBRARY.mapsUrl}" target="_blank" rel="noopener">${icon("i-pin")} Get directions<span class="sr-only"> (opens Google Maps in a new tab)</span></a>
          </div>
        </div>
        <div>
          ${navigator.onLine
            ? /* The map is centered on the library, so our own pin in the middle marks the exact spot.
                 The whole map is one link: pressing it opens the place in Google Maps. */
              `<div class="map-wrap">
                <iframe class="map-frame" title="Map showing Quezon City Public Library" src="${LIBRARY.mapsEmbed}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" tabindex="-1" aria-hidden="true"></iframe>
                <a class="map-link" href="${LIBRARY.mapsPlace}" target="_blank" rel="noopener">
                  <span class="map-pin" aria-hidden="true"><svg viewBox="0 0 32 42"><path d="M16 1C7.7 1 1 7.7 1 16c0 10.5 13 24 15 25 2-1 15-14.5 15-25C31 7.7 24.3 1 16 1z"/><circle cx="16" cy="16" r="6"/></svg></span>
                  <span class="map-pin__label">${esc(LIBRARY.deskLocation.split(", ").pop())}</span>
                  <span class="map-link__open">${icon("i-pin")} Open in Google Maps<span class="sr-only"> (opens in a new tab)</span></span>
                </a>
              </div>`
            : `<div class="map-frame map-offline">${icon("i-pin")}<p><strong>The map needs an internet connection.</strong><br />${esc(LIBRARY.address)}</p></div>`}
          <p class="muted" style="margin-top:.75rem">Need assistance? Senior citizens, PWDs and anyone who needs help can ask any librarian or guard.</p>
        </div>
      </div></section>`;
  }

  function pageNotFound() {
    main.innerHTML = `${pageHead("Page not found", "Sorry, we couldn't find that page.")}
      <section class="section"><div class="container"><a class="btn btn--primary btn--lg" href="#/">${icon("i-back")} Go to the home page</a></div></section>`;
  }

  /* ---------------- Library portals ----------------
     Each library is a separate system. People choose their library first (or open
     a direct link such as #/portal/main); the choice is remembered on the device. */
  /* Is a portal's main library open right now (Philippine time, regular hours)? */
  function openStatus(id) {
    const h = OPEN_HOURS[id];
    if (!h) return null;
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    const day = get("weekday"), now = (Number(get("hour")) % 24) + Number(get("minute")) / 60;
    const span = day === "Sun" ? null : day === "Sat" ? h.sat : h.wk;
    const clock = (n) => `${n % 12 || 12} ${n < 12 ? "AM" : "PM"}`;
    if (span && now >= span[0] && now < span[1]) return { open: true, text: `Open · until ${clock(span[1])}` };
    const later = span && now < span[0];
    return { open: false, text: later ? `Opens ${clock(span[0])}` : "Closed now" };
  }

  /* Falling library call numbers (Dewey decimal) behind the hub — the library's
     own version of "falling code". Stops by itself when the page changes. */
  function deweyRain(canvas) {
    const ctx = canvas.getContext("2d");
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const CODES = ["000.1", "028.7", "158.1", "220.5", "306.4", "370.1", "398.2", "500.2", "510", "599.8", "621.3", "641.5", "741.5", "780.9", "808.8", "823.9", "899.21", "959.9", "004.6", "920.0", "331.1", "025.3", "420.7"];
    let cols = [], w = 0, h = 0, last = 0;
    const rgb = getComputedStyle(canvas).getPropertyValue("--hub-rain").trim() || "37, 99, 235";
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gap = w < 700 ? 38 : 54;
      cols = Array.from({ length: Math.ceil(w / gap) }, (_, i) => ({
        x: i * gap + 10 + Math.random() * 14, y: Math.random() * h * 1.4 - h * 0.4,
        v: 10 + Math.random() * 22, a: 0.06 + Math.random() * 0.12,
        text: (CODES[(Math.random() * CODES.length) | 0] + " " + CODES[(Math.random() * CODES.length) | 0]).split(""),
      }));
    };
    const draw = (t) => {
      if (!canvas.isConnected) return;                                   // left the page
      requestAnimationFrame(draw);
      if (document.hidden) { last = t; return; }
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      ctx.clearRect(0, 0, w, h);
      ctx.font = '600 11px "Cascadia Mono", Consolas, monospace';
      ctx.textAlign = "center";
      cols.forEach((c) => {
        if (!still) c.y += c.v * dt;
        if (c.y - c.text.length * 15 > h) { c.y = -20; c.v = 10 + Math.random() * 22; }
        c.text.forEach((ch, i) => {
          const y = c.y - i * 15;
          if (y < -15 || y > h + 15 || ch === " ") return;
          ctx.fillStyle = `rgba(${rgb}, ${(i === 0 ? c.a * 3 : c.a * (1 - i / c.text.length))})`;
          ctx.fillText(ch, c.x, y);
        });
      });
    };
    resize();
    // One listener per visit, removed as soon as this page is left
    const onResize = () => (canvas.isConnected ? resize() : window.removeEventListener("resize", onResize));
    window.addEventListener("resize", onResize);
    requestAnimationFrame(draw);
  }

  /* Library chooser: the Main Library photo in the middle of a live "hub",
     with the seven portals around it. */
  const HUB_SPOTS = { main: [500, 64], d1: [178, 150], d2: [822, 150], d3: [102, 352], d4: [898, 352], d5: [222, 566], d6: [778, 566] };
  function pageLibrary(query) {
    const next = (query && query.get("next")) || "#/";
    const locked = libraryLocked();
    const current = LF.selectedLibraryId();
    const C = [500, 330];
    const totalBranches = LIBRARIES.reduce((a, c) => a + c.branches.length, 0);
    const nodes = LIBRARIES.map((c, i) => {
      const [x, y] = HUB_SPOTS[c.id] || [500, 64];
      const st = openStatus(c.id);
      const side = x < 400 ? "l" : x > 600 ? "r" : y < C[1] ? "t" : "b";
      const disabled = locked && c.id !== activeLibrary().id;
      const label = c.id === "main" ? "Main Library" : c.shortName;
      return { c, i, x, y, st, side, disabled, label, isCurrent: c.id === current };
    });
    const along = (n, f) => [C[0] + (n.x - C[0]) * f, C[1] + (n.y - C[1]) * f];

    main.innerHTML = `
      <section class="hub" aria-labelledby="hubHeading">
        <canvas class="hub__rain" aria-hidden="true"></canvas>
        <div class="hub__rings" aria-hidden="true"></div>
        <div class="container hub__inner">
          <header class="hub__head">
            <p class="hub__eyebrow"><span class="hub__live" aria-hidden="true"></span> <span class="hub__eyebrow-long">Quezon City Public Library · </span>Lost &amp; Found network</p>
            <h1 id="hubHeading">Where did you lose or find it?</h1>
            <p class="hub__lead">${locked
              ? `You are signed in at the <strong>${esc(LIBRARY.libraryName)}</strong>. Sign out first to choose another library.`
              : `The Main Library and each district have their own Lost &amp; Found. Choose the library where it happened &mdash; we'll remember it on this device.`}</p>
            ${locked ? "" : `<div class="hub__near">
              <button type="button" class="hub__near-btn" id="nearBtn">${icon("i-locate")} Find the library nearest to me</button>
              <p class="hub__near-msg" id="nearMsg" role="status" aria-live="polite"></p>
            </div>`}
          </header>
          ${needLibraryNote && !locked ? `<div class="hub__alert" role="alert" id="pickFirst" tabindex="-1">${icon("i-info")}<p><strong>Please choose a library first.</strong> The menu opens after you choose one below.</p></div>` : ""}

          <div class="hub__stage">
            <svg class="hub__lines" viewBox="0 0 1000 660" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <defs>
                <radialGradient id="hubPulse"><stop offset="0" stop-color="#bfdbfe"/><stop offset="1" stop-color="#3b82f6" stop-opacity="0"/></radialGradient>
              </defs>
              ${nodes.map((n) => { const [mx, my] = along(n, 0.8); const p = `M${C[0]} ${C[1]} L${n.x} ${n.y}`; return `<g class="hub-link ${n.disabled ? "is-off" : ""}" data-link="${n.c.id}">
                <path class="hub-link__base" d="${p}"/>
                <path class="hub-link__flow" d="${p}" style="animation-delay:${-n.i * 0.35}s"/>
                <circle class="hub-link__dot" cx="${mx}" cy="${my}" r="3.2"/>
                ${n.disabled ? "" : `<circle class="hub-link__pulse" r="7" fill="url(#hubPulse)"><animateMotion dur="${2.6 + (n.i % 3) * 0.5}s" begin="${n.i * 0.45}s" repeatCount="indefinite" path="M${n.x} ${n.y} L${C[0]} ${C[1]}"/></circle>`}
              </g>`; }).join("")}
            </svg>

            <div class="hub-core" aria-hidden="true">
              <div class="hub-core__glow"></div>
              <div class="hub-core__ring hub-core__ring--a"></div>
              <div class="hub-core__ring hub-core__ring--b"></div>
              <div class="hub-core__ring hub-core__ring--c"></div>
              <div class="hub-core__disc">
                <img class="hub-core__photo" src="${assetUrl("assets/qcpl-hero.jpg")}" alt="" />
                <div class="hub-core__tint"></div>
                <div class="hub-core__grid"></div>
                <div class="hub-core__sweep"></div>
                <div class="hub-core__readout">
                  <span class="hub-core__kicker" id="hubKicker">7 Lost &amp; Found desks</span>
                  <strong class="hub-core__title" id="hubTitle">Quezon City<br>Public Library</strong>
                  <span class="hub-core__sub" id="hubSub">${totalBranches} libraries across the city</span>
                </div>
              </div>
            </div>

            <ul class="hub__nodes" role="list">
              ${nodes.map((n) => `<li class="hub-node hub-node--${n.side} ${n.isCurrent ? "is-current" : ""} ${n.disabled ? "is-off" : ""}" style="left:${n.x / 10}%;top:${(n.y / 6.6).toFixed(3)}%">
                ${n.disabled
                  ? `<div class="hub-node__card" aria-disabled="true">`
                  : `<button type="button" class="hub-node__card" data-library-pick="${n.c.id}" data-hub="${n.c.id}"
                      aria-label="${esc(`${n.isCurrent ? "Continue with" : "Choose"} the ${n.c.libraryName}. ${n.c.branches.length} ${n.c.branches.length === 1 ? "library" : "libraries"}. ${n.st ? n.st.text : ""}`)}">`}
                  <span class="hub-node__dot ${n.st && n.st.open ? "is-open" : ""}" aria-hidden="true"></span>
                  <span class="hub-node__name">${esc(n.label)}${n.isCurrent ? ' <span class="hub-node__tag">Current</span>' : ""}</span>
                  <span class="hub-node__meta">${n.c.branches.length} ${n.c.branches.length === 1 ? "library" : "libraries"}</span>
                  ${n.st ? `<span class="hub-node__status ${n.st.open ? "is-open" : ""}">${esc(n.st.text)}</span>` : ""}
                  ${n.disabled ? `<span class="hub-node__meta">Signed in elsewhere</span></div>` : `<span class="hub-node__go" aria-hidden="true">${icon("i-arrow")}</span></button>`}
              </li>`).join("")}
            </ul>
          </div>

          <footer class="hub__foot">
            <span><span class="hub-dot hub-dot--open" aria-hidden="true"></span> Open now</span>
            <span><span class="hub-dot" aria-hidden="true"></span> Closed now</span>
            <span class="hub__foot-note">Based on each main library's regular hours (Philippine time). Holidays are not counted.</span>
          </footer>
        </div>
      </section>`;

    deweyRain($(".hub__rain"));
    // Pointing at a portal lights up its line and shows its details in the middle
    const kicker = $("#hubKicker"), title = $("#hubTitle"), sub = $("#hubSub");
    const idle = [kicker.textContent, title.innerHTML, sub.textContent];
    const focusHub = (id) => {
      $$(".hub-link").forEach((g) => g.classList.toggle("is-hot", g.dataset.link === id));
      $(".hub").classList.toggle("has-hot", !!id);
      const n = nodes.find((x) => x.c.id === id);
      if (!n) { [kicker.textContent, title.innerHTML, sub.textContent] = idle; return; }
      kicker.textContent = n.st ? n.st.text : n.c.code;
      if (isFil()) {
        title.textContent = placeFil(n.c.libraryName);
        sub.textContent = n.c.branches.map((b) => placeFil(shortBranch(b))).slice(0, 3).join(" · ") + (n.c.branches.length > 3 ? ` at ${n.c.branches.length - 3} pa` : "");
      } else {
        title.innerHTML = esc(n.c.libraryName).replace(/ (Libraries|Library)$/, "<br>$1");
        sub.textContent = n.c.branches.map(shortBranch).slice(0, 3).join(" · ") + (n.c.branches.length > 3 ? ` +${n.c.branches.length - 3} more` : "");
      }
    };
    $$("[data-hub]").forEach((b) => {
      b.addEventListener("mouseenter", () => focusHub(b.dataset.hub));
      b.addEventListener("focus", () => focusHub(b.dataset.hub));
      b.addEventListener("mouseleave", () => focusHub(null));
      b.addEventListener("blur", () => focusHub(null));
    });

    /* "Find the library nearest to me": the phone's location (asked only when the
       button is pressed, never stored or sent anywhere) against each portal's main library */
    const nearBtn = $("#nearBtn"), nearMsg = $("#nearMsg");
    nearBtn && nearBtn.addEventListener("click", () => {
      if (!navigator.geolocation) { nearMsg.textContent = "This browser can't share your location. Please choose from the list."; return; }
      nearBtn.disabled = true;
      nearBtn.classList.add("is-busy");
      nearMsg.textContent = "Finding where you are…";
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude: la, longitude: lo } = pos.coords;
        const rad = (d) => (d * Math.PI) / 180;
        const km = (a, b) => { const dLa = rad(b[0] - a[0]), dLo = rad(b[1] - a[1]); const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLo / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
        const ranked = LIBRARIES.map((c) => { const m = /query=(-?[\d.]+),(-?[\d.]+)/.exec(c.mapsPlace || ""); return m ? { c, d: km([la, lo], [Number(m[1]), Number(m[2])]) } : null; })
          .filter(Boolean).sort((a, b) => a.d - b.d);
        nearBtn.disabled = false; nearBtn.classList.remove("is-busy");
        if (!ranked.length) { nearMsg.textContent = "Please choose from the list."; return; }
        const best = ranked[0], dist = best.d < 1 ? `${Math.round(best.d * 1000)} m` : `${best.d.toFixed(1)} km`;
        $$(".hub-node").forEach((li) => { li.classList.remove("is-nearest"); const tag = $(".hub-node__near", li); tag && tag.remove(); });
        const card = $(`[data-hub="${best.c.id}"]`);
        if (card) {
          card.closest(".hub-node").classList.add("is-nearest");
          $(".hub-node__name", card).insertAdjacentHTML("afterend", `<span class="hub-node__near">${icon("i-locate")} Nearest · ${dist}</span>`);
          focusHub(best.c.id);
          card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
        }
        nearMsg.textContent = best.d > 40
          ? `You seem to be outside Quezon City. The closest is ${best.c.libraryName}, about ${dist} away.`
          : `Closest to you: ${best.c.libraryName}, about ${dist} away (to its main library).`;
      }, (err) => {
        nearBtn.disabled = false; nearBtn.classList.remove("is-busy");
        nearMsg.textContent = err.code === 1 ? "Location is turned off for this site. You can still choose from the list." : "We couldn't find your location. Please choose from the list.";
      }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
    });

    if (needLibraryNote && $("#pickFirst")) { window.scrollTo(0, 0); $("#pickFirst").focus({ preventScroll: true }); }
    needLibraryNote = false;
    $$("[data-library-pick]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try { await LF.setLibrary(b.dataset.libraryPick); } catch (err) { b.disabled = false; return alert(err.message); }
      renderLibraryShell();
      announce(`${LIBRARY.libraryName} chosen`);
      go(next.startsWith("#/library") || next.startsWith("#/portal") ? "#/" : next);
    }));
  }

  /* ---------------- Router ---------------- */
  const NO_LIBRARY_NEEDED = ["library", "portal", "signin", "staff", "privacy", "forgot", "verify"];
  const ROUTES = {
    library:         { title: "Choose Your Library", render: (r) => pageLibrary(r.query) },
    portal:         { title: "Library", render: async (r) => { if (!libraryLocked() && LIBRARIES.some((c) => c.id === r.param)) { try { await LF.setLibrary(r.param); } catch (err) { return pageOffline(err); } } renderLibraryShell(); go("#/"); } },
    home:           { title: "QCPL Lost & Found", render: pageHome },
    browse:         { title: "Found Items", render: (r) => pageBrowse(r.query) },
    "report-lost":  { title: "Report a Lost Item", render: pageReportLost },
    "report-found": { title: "Report a Found Item", render: pageReportFound },
    "claim-item":   { title: "Claim an Item", render: (r) => pageClaimItem(decodeURIComponent(r.param || "")), nav: "browse" },
    status:         { title: "Check My Report", render: (r) => pageStatus(r.query) },
    claim:          { title: "How to Claim", render: pageClaim },
    contact:        { title: "Visit the Office", render: pageContact },
    signin:         { title: "Sign In", render: (r) => pageSignin(r.query) },
    register:       { title: "Create an Account", render: (r) => pageRegister(r.query), nav: "signin" },
    my:             { title: "My Reports", render: pageMy },
    certificate:    { title: "Certificate of Honesty", render: (r) => pageCertificate(decodeURIComponent(r.param || "")) },
    contribution:   { title: "Certificate of Contribution", render: (r) => pageContribution(decodeURIComponent(r.param || "")) },
    "lost-items":   { title: "Lost Items", render: pageLostItems },
    forgot:         { title: "Forgot Password", render: pageForgot, nav: "signin" },
    verify:         { title: "Confirm Your Mobile Number", render: pageVerify, nav: "signin" },
    account:        { title: "Account Settings", render: pageAccount, nav: "my" },
    privacy:        { title: "Privacy Policy", render: pagePrivacy },
    ...(window.LF_ROUTES || {}),
  };

  /* Phone "Report" button: a sheet slides up with the two kinds of report */
  const sheet = $("#reportSheet"), sheetBtn = $("#tabReport");
  function openReportSheet() {
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add("is-open"));
    sheetBtn.setAttribute("aria-expanded", "true");
    $(".report-option", sheet).focus();
  }
  function closeReportSheet(returnFocus = true) {
    if (sheet.hidden) return;
    sheet.classList.remove("is-open");
    sheetBtn.setAttribute("aria-expanded", "false");
    setTimeout(() => { if (!sheet.classList.contains("is-open")) sheet.hidden = true; }, 220);
    if (returnFocus) sheetBtn.focus();
  }
  sheetBtn.addEventListener("click", () => (sheet.hidden ? openReportSheet() : closeReportSheet()));
  sheet.addEventListener("click", (e) => { if (e.target === sheet || e.target.closest("[data-sheet-close]")) closeReportSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) closeReportSheet(); });

  // Print buttons (no inline onclick, so a strict Content-Security-Policy can block inline scripts)
  document.addEventListener("click", (e) => { if (e.target.closest("[data-print]")) window.print(); });

  // Activity keeps a signed-in person signed in; after 30 idle minutes (staff: 20) they are signed out,
  // which matters on shared library computers
  let lastTouch = 0;
  const touch = () => { if (Date.now() - lastTouch > 15000) { lastTouch = Date.now(); LF.touchSession(); } };
  ["click", "keydown"].forEach((t) => document.addEventListener(t, touch, { passive: true }));
  setInterval(() => {
    LF.currentUser(); LF.currentStaff(); // these sign out an idle session
    if (LF.takeIdleSignout()) { renderAccountLink(); renderLibraryShell(); go(location.hash.startsWith("#/staff") ? "#/staff?idle=1" : "#/signin?idle=1"); announce("You were signed out because the page was not used for a while."); }
  }, 30000);

  // Every text box has a length limit (the data layer cuts long text too)
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (el.matches?.("input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=date]):not([type=time]):not([maxlength]), textarea:not([maxlength])"))
      el.maxLength = el.tagName === "TEXTAREA" ? 1000 : el.type === "email" ? 120 : el.type === "tel" ? 20 : el.type === "password" ? 128 : 120;
  });

  // A second press of a submit button within a moment is ignored (no double reports or accounts)
  document.addEventListener("submit", (e) => {
    const f = e.target;
    if (f.closest("#wiz")) return; // the step-by-step forms move on with each press
    if (f.dataset.busyUntil && Date.now() < +f.dataset.busyUntil) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    f.dataset.busyUntil = Date.now() + 1500;
  }, true);

  let firstLoad = true;
  let needLibraryNote = false; // someone pressed a menu link before choosing a library
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a || LF.selectedLibraryId() || libraryLocked()) return;
    const name = a.getAttribute("href").slice(2).split(/[/?]/)[0] || "home";
    if (NO_LIBRARY_NEEDED.includes(name)) return;
    needLibraryNote = true;
    if (location.hash === a.getAttribute("href") || (!location.hash && a.getAttribute("href") === "#/")) { e.preventDefault(); route(); } // same address: the page would not redraw by itself
  });
  function route() {
    let r = parseHash();
    // First visit: choose a library before anything else
    if (!LF.selectedLibraryId() && !libraryLocked() && !NO_LIBRARY_NEEDED.includes(r.name)) {
      r = { name: "library", param: null, parts: ["library"], query: new URLSearchParams("next=" + encodeURIComponent(location.hash || "#/")) };
    }
    const def = ROUTES[r.name];
    stopReading();
    closeDialog();
    closeMenu();
    document.body.classList.toggle("is-staff", r.name === "staff");
    document.body.classList.remove("is-admin-signin"); // set again by the admin sign-in page
    LF.housekeeping();
    renderAccountLink();
    renderLibraryShell();
    if (def) def.render(r); else pageNotFound();
    const navKey = def ? def.nav || r.name : "";
    $$("[data-nav]").forEach((a) => (a.dataset.nav === navKey ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    // Phone tab bar: only once a library is chosen, and not in the administrator area
    const showTabs = (!!LF.selectedLibraryId() || libraryLocked()) && r.name !== "staff" && r.name !== "library";
    $("#tabbar").hidden = !showTabs;
    document.body.classList.toggle("has-tabbar", showTabs);
    $$("[data-tab]").forEach((a) => (a.dataset.tab === navKey ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    $("#tabReport").classList.toggle("is-current", ["report-lost", "report-found"].includes(navKey));
    closeReportSheet(false);
    fitHeader();
    drawCharts();
    document.title = `${def ? def.title : "Page not found"} — Quezon City Public Library`;
    if (!firstLoad && !$("#successTitle")) {
      window.scrollTo(0, 0);
      main.focus({ preventScroll: true });
      announce(def ? def.title + " page" : "Page not found");
    }
    firstLoad = false;
  }

  /* Helpers shared with the staff pages (js/admin.js) */
  window.UI = {
    $, $$, main, esc, icon, cat, fmtDate, fmtDateTime, relDay, statusBadge, announce, pageHead, thumb, timeline,
    openDialog, closeDialog, go, route, notifList, digits, renderLibraryShell, renderAccountLink, qrSvg, itemCard, peso, photosOf, photoStrip, statTiles, monthlyChart, drawCharts, todayISO,
  };

  /* Header: on wide screens the menu sits beside the name. If the words don't
     fit on one line (longer Filipino labels, larger text), the menu moves to its
     own row instead of pushing the page wider than the screen. */
  const header = $(".site-header"), headerRow = $(".site-header__inner");
  function fitHeader() {
    header.classList.remove("header--stacked");
    if (headerRow.scrollWidth > headerRow.clientWidth + 1) header.classList.add("header--stacked");
    fitHelpbar();
  }
  /* Help bar: keep it on one line. If it would wrap, first shorten "Need help? Call
     the office:" to just the number, then show the tool buttons as icons only. */
  const helpbar = $(".helpbar"), helpRow = $(".helpbar__inner");
  const wraps = () => { const kids = [...helpRow.children].filter((k) => !k.hidden && k.offsetParent); return kids.some((k) => Math.abs(k.offsetTop - kids[0].offsetTop) > 8); };
  function fitHelpbar() {
    helpbar.classList.remove("helpbar--short", "helpbar--icons");
    if (window.innerWidth <= 640) return; // phones have their own compact bar
    if (wraps()) helpbar.classList.add("helpbar--short");
    if (wraps()) helpbar.classList.add("helpbar--icons");
  }
  window.addEventListener("resize", fitHeader);
  document.fonts && document.fonts.ready.then(fitHeader);
  new MutationObserver(() => requestAnimationFrame(fitHeader)).observe($("#primaryNav"), { childList: true, subtree: true, characterData: true });
  new MutationObserver(() => requestAnimationFrame(fitHeader)).observe($("#accountLink"), { childList: true, subtree: true, characterData: true });

  /* Records are saved in the browser. If the browser refuses (some do for a file
     opened from the computer, or in private mode), say so instead of failing quietly. */
  (function checkStorage() {
    try { localStorage.setItem("qcpllf_probe", "1"); localStorage.removeItem("qcpllf_probe"); }
    catch {
      document.querySelector(".site-header").insertAdjacentHTML("beforebegin", `<div class="storage-warn" role="alert"><div class="container">${icon("i-info")}
        <p><strong>This browser is not letting the page save anything.</strong> You can look around, but reports will be lost when you close the page. Open the file in Chrome or Edge (not in private or incognito mode), or start the site with "Start QCPL Lost and Found.bat".</p></div></div>`);
    }
  })();

  /* ---------------- Start ---------------- */
  fillLibraryDetails();
  $("#year").textContent = new Date().getFullYear();
  applyPrefs();
  /* No connection to the server: a clear message and a retry button (the loading screen stays until then) */
  function pageOffline(err) {
    main.innerHTML = `${pageHead(isFil() ? "Hindi maabot ang server" : "Can't reach the server", esc(err && err.message ? err.message : ""))}
      <section class="section"><div class="container"><p>${isFil() ? "Tingnan ang iyong internet, saka subukan ulit. Puwede ka ring tumawag sa" : "Please check your internet, then try again. You can also call"} <a href="${LIBRARY.phoneHref}">${esc(LIBRARY.phone)}</a>.</p>
      <button type="button" class="btn btn--primary btn--lg" id="retryLoad">${icon("i-arrow")} ${isFil() ? "Subukan ulit" : "Try again"}</button></div></section>`;
    $("#retryLoad").addEventListener("click", () => location.reload());
  }
  LF.ready.then(() => {
    window.addEventListener("hashchange", route);
    route();
  }, pageOffline);
})();
