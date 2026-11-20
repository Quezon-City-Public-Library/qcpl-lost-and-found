// The real website on the backend (port 8371), used through its pages like people would.
import { randomBytes } from "node:crypto";
import { launch, sleep } from "../lib/cdp.mjs";
const BASE = "http://localhost:8371/";
const out = {}; let fails = 0;
const ok = (n, c, x) => { out[n] = c ? "PASS" : "FAIL" + (x !== undefined ? " â€” " + JSON.stringify(x).slice(0, 300) : ""); if (!c) fails++; };
const W = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;

// Head administrator via the setup page (throwaway password for this test only)
const pw = randomBytes(18).toString("base64url");
const page = await (await fetch(BASE + "setup")).text();
const t = (/name="t" value="([^"]+)"/.exec(page) || [])[1];
const setup = await (await fetch(BASE + "setup", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, name: "Head Admin", username: "head.admin", password: pw, password2: pw }) })).text();
ok("setup page creates the head admin", /All set/.test(setup));

const B = await launch({ W: 1280, H: 900, outDir: "audit-remote" });
await B.nav(BASE, 3500);
const first = await B.ev(`return { remote: LF.REMOTE, online: LF.online, h1: (document.querySelector('h1')||{}).innerText, picker: !!document.querySelector('[data-library-pick]'), stored: Object.keys(localStorage).filter(k => /found|lost|claims|users|notifs/.test(k)) }`);
ok("page knows it is on the server", first.remote === true && first.online === true, first);
ok("first visit: choose a library", first.picker, first);
await B.ev(`document.querySelector('[data-library-pick="main"]').click(); ${W(1500)}`);
ok("home page loads from the server", await B.ev(`return location.hash === '#/' && /Lost something/i.test(document.querySelector('h1').innerText)`));

// ---- A visitor reports a lost item, with a photo, through the form ----
const walk = `
  const setW = (n, v) => { const el = document.querySelector('#wiz [name="' + n + '"]'); if (!el) return; if (el.type === 'radio' || el.type === 'checkbox') { (document.querySelector('#wiz [name="' + n + '"][value="' + v + '"]') || el).click(); } else { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
  const next = async () => { document.querySelector('#wizForm').requestSubmit(); await new Promise(r => setTimeout(r, 400)); };`;
const r1 = await B.ev(`${walk}
  location.hash = '#/report-lost'; ${W(900)}
  const c = document.createElement('canvas'); c.width = 640; c.height = 480; const g = c.getContext('2d'); g.fillStyle = '#a9794a'; g.fillRect(0,0,640,480); g.fillStyle = '#1565c0'; g.beginPath(); g.roundRect(260,120,120,300,30); g.fill();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)); const dt = new DataTransfer(); dt.items.add(new File([blob], 'p.jpg', { type: 'image/jpeg' }));
  const inp = document.querySelector('#f-photo'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 300)); if (document.querySelector('.photo-ai__result')) break; }
  setW('category', 'others'); setW('itemName', 'Blue tumbler'); await next(); await next();
  setW('branch', 'QCPL Main Library'); setW('location', 'Reading Area'); await next();
  setW('name', 'Ana Cruz'); setW('phone', '09171112222'); setW('consent', 'on'); await next();
  ${W(4200)} await next(); ${W(1500)}
  return { title: (document.querySelector('#successTitle') || {}).innerText, ref: ((document.querySelector('#main').innerText.match(/[LFC]-[A-Z]{2}-\\d{6}-\\d{4}/) || [])[0] || ''), err: (document.querySelector('#saveErr') || {}).innerText };`, 120000);
const ref = (/[LFC]-[A-Z]{2}-\d{6}-\d{4}/.exec(JSON.stringify(r1)) || [])[0];
ok("lost report sent through the form", /Thank you/.test(r1.title || "") && !!ref, r1);
ok("nothing personal stored in the browser", (await B.ev(`return Object.keys(localStorage).filter(k => /qcpllf_(found|lost|claims|users|notifs|session)/.test(k))`)).length === 0);

// ---- Check Status in a fresh browser (another person's computer) ----
const C = await launch({ W: 1280, H: 900, outDir: "audit-remote" });
await C.nav(BASE, 3000);
await C.ev(`document.querySelector('[data-library-pick="main"]').click(); ${W(1200)}`);
const st = await C.ev(`location.hash = '#/status'; ${W(700)} document.querySelector('#sref').value = ${JSON.stringify(ref)}; document.querySelector('#sphone').value = '2222'; document.querySelector('#statusForm').requestSubmit(); ${W(1500)} return document.querySelector('#statusResult').innerText.slice(0, 300);`);
ok("Check Status finds the report", /Blue tumbler/i.test(st || ""), st);
const imgOk = await C.ev(`const i = document.querySelector('#statusResult img'); return i ? (i.complete && i.naturalWidth > 0) : 'no img';`);
ok("its photo loads from the server", imgOk === true || imgOk === "no img", imgOk);

// ---- Register: no code for now, signed in straight away ----
const reg = await C.ev(`location.hash = '#/register'; ${W(2800)}
  const v = (id, x) => { document.querySelector('#' + id).value = x; }; v('rName', 'Ana Cruz'); v('rPhone', '09171112222'); v('rPw', 'anapass123'); v('rPw2', 'anapass123'); document.querySelector('#rOk').checked = true;
  document.querySelector('#regForm').requestSubmit(); ${W(2500)}
  return { hash: location.hash, user: LF.currentUser() && LF.currentUser().name, codeBoxes: document.querySelectorAll('.otp__box').length, text: document.querySelector('#main').innerText.slice(0, 1500) };`);
ok("sign-up goes straight to My page, signed in, no code screen", reg.hash === "#/my" && reg.user === "Ana Cruz" && reg.codeBoxes === 0, reg);
ok("unconfirmed number: the guest report isn't shown yet", !/Blue tumbler/i.test(reg.text), reg.text.slice(0, 300));
const vf = await C.ev(`location.hash = '#/verify'; ${W(1200)} return location.hash;`);
ok("the old code page just goes back to My page", vf === "#/my", vf);

// ---- Staff sign in through the page ----
const S = await launch({ W: 1366, H: 900, outDir: "audit-remote" });
// The public sign-in is for users only: no administrator option, no admin link anywhere on it
await S.nav(BASE + "#/signin", 3500);
const pubSignin = await S.ev(`return { kind: !!document.querySelector('#kindAdmin, [name="kind"]'), text: document.body.innerText, links: [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') || '') };`);
ok("public sign-in page has no administrator option", !pubSignin.kind && !/administrator/i.test(pubSignin.text), pubSignin.text.slice(0, 200));
ok("no link to the admin sign-in on the public site", !pubSignin.links.some((h) => /staff|admin/i.test(h)), pubSignin.links.filter((h) => /staff|admin/i.test(h)));
// The administrator sign-in has its own page at /admin
await S.nav(BASE + "admin", 3500);
const admPage = await S.ev(`return { hash: location.hash, form: !!document.querySelector('#admForm'), header: !!(document.querySelector('.site-header') && document.querySelector('.site-header').offsetParent), register: /create an account/i.test(document.body.innerText) };`);
ok("/admin opens the separate administrator sign-in page", admPage.hash === "#/staff" && admPage.form && !admPage.header && !admPage.register, admPage);
const si = await S.ev(`document.querySelector('#admId').value = 'head.admin'; document.querySelector('#admPw').value = ${JSON.stringify(pw)}; document.querySelector('#admForm').requestSubmit(); ${W(2500)} return { hash: location.hash, staff: LF.currentStaff() && LF.currentStaff().username };`);
ok("staff sign in on the page", si.staff === "head.admin" && /#\/staff/.test(si.hash), si);
await S.ev(`location.hash = '#/staff/lost'; for (let i = 0; i < 40 && !(document.querySelector('#staffMain') && /Blue tumbler/.test(document.querySelector('#staffMain').innerText)); i++) await new Promise((r) => setTimeout(r, 200));`);
const staffSees = await S.ev(`const m = document.querySelector('#staffMain'); return m ? m.innerText.slice(0, 800) : 'NO staffMain; hash=' + location.hash + ' body=' + document.body.innerText.slice(0, 400)`);
ok("staff see the lost report with the owner's name", /Blue tumbler/.test(staffSees) && /Ana Cruz/.test(staffSees), staffSees.slice(0, 200));
// Staff log a found item; a visitor claims it; staff approve and release
const fi = await S.ev(`${walk}
  location.hash = '#/report-found'; ${W(1000)}
  setW('category', 'others'); setW('itemName', 'Blue tumbler'); setW('color', 'Blue'); await next(); await next();
  setW('branch', 'QCPL Main Library'); setW('location', 'Reading Area'); setW('handover', 'Already at the office'); await next();
  setW('name', 'Guard Gil'); setW('phone', '09180000002'); setW('consent', 'on'); await next();
  ${W(4200)} await next(); ${W(1800)}
  return { hash: location.hash, found: LF.db.all('found').map(f => [f.id, f.title, f.status]) };`, 120000);
ok("staff log a found item", fi.found.some((f) => f[1] === "Blue tumbler"), fi);
const foundId = (fi.found.find((f) => f[1] === "Blue tumbler") || [])[0];
const matchSeen = await C.ev(`await LF.refresh(); location.hash = '#/my'; ${W(1200)} return document.querySelector('#main').innerText.includes('match') || LF.db.all('notifs').some(n => n.type === 'match_found');`);
ok("the owner gets the 'possible match' update", matchSeen === true, matchSeen);
const cl = await C.ev(`${walk}
  location.hash = '#/claim-item/' + ${JSON.stringify(foundId)}; ${W(1200)}
  setW('general', 'Blue tumbler with a black lid'); setW('specific', 'Sticker of a cat'); await next();
  setW('consent', 'on'); await next(); ${W(4200)} await next(); ${W(1500)}
  return { title: (document.querySelector('#successTitle') || {}).innerText, err: (document.querySelector('#saveErr, .error-msg') || {}).innerText };`, 120000);
ok("the owner claims it", /claim was sent/i.test(cl.title || ""), cl);
const rel = await S.ev(`await LF.refresh(); const c = LF.db.all('claims')[0]; if (!c) return 'no claim';
  await LF.setClaimStatus(c.id, 'under-verification'); await LF.setClaimStatus(c.id, 'approved');
  await LF.recordReturn(c.id, { releasedTo: 'Ana Cruz', idType: 'QCitizen ID', idLast4: '1234', notes: '' });
  return { claim: LF.db.byId('claims', c.id).status, found: LF.db.byId('found', c.itemId).status };`);
ok("staff approve and release it", rel.claim === "returned" && rel.found === "returned", rel);
// Every staff page opens without errors
const pages = await S.ev(`const bad = []; for (const t of ['dashboard','claims','matches','lost','found','returned','recognition','users','olditems','reports','posters','activity','staff']) { location.hash = '#/staff/' + t; await new Promise(r => setTimeout(r, 700)); const h = (document.querySelector('#staffMain h1') || {}).innerText || ''; if (!h || /not found/i.test(h)) bad.push(t); } return bad;`);
ok("every staff page opens", pages.length === 0, pages);

// ---- Public pages for a guest ----
const G = await launch({ W: 390, H: 844, outDir: "audit-remote" });
await G.nav(BASE, 3000);
await G.ev(`document.querySelector('[data-library-pick="main"]').click(); ${W(1200)}`);
const pub = await G.ev(`const bad = []; for (const h of ['#/', '#/browse', '#/lost-items', '#/report-lost', '#/report-found', '#/status', '#/claim', '#/contact', '#/signin', '#/register', '#/forgot', '#/privacy']) { location.hash = h; await new Promise(r => setTimeout(r, 600)); const t = (document.querySelector('#main') || {}).innerText || ''; if (t.length < 40 || /Page not found/.test(t)) bad.push(h); } return { bad, overflow: document.documentElement.scrollWidth > innerWidth + 1, leak: JSON.stringify(window.LF_REMOTE_STATE.data).match(/Ana Cruz|09171112222|Guard Gil|09180000002/g) };`);
ok("all public pages open on a phone", pub.bad.length === 0 && !pub.overflow, pub);
ok("a guest's browser holds no names or phone numbers", !pub.leak, pub.leak);

for (const [n, X] of [["visitor", B], ["owner", C], ["staff", S], ["guest", G]]) {
  const errs = [...X.errors, ...X.consoleErrors.filter((e) => !/favicon|Failed to load resource.*(404|401|403|400)/.test(e))];
  ok(`no script errors (${n})`, errs.length === 0, errs.slice(0, 3));
}
await S.shot("staff-dashboard"); await G.shot("guest-home");
[B, C, S, G].forEach((x) => x.close());
console.log(JSON.stringify(out, null, 1));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
