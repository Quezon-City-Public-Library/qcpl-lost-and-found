ORG.signupCode = true;
const W = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const ok = (name, cond, extra) => { out[name] = cond ? "PASS" : "FAIL" + (extra ? " — " + JSON.stringify(extra) : ""); };
const tryErr = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const tryErrA = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
Object.keys(localStorage).forEach((k) => k.startsWith("qcpllf_") && k !== "qcpllf_clean_v1" && localStorage.removeItem(k));
sessionStorage.clear();
await LF.setLibrary("main");
const md = await (await fetch("/README.md", { cache: "no-store" })).text();
const pw = (/`mainadmin` \| `([^`]+)`/.exec(md) || [])[1];
const today = toISODate(new Date());

// 5. Synonyms in matching and search
ok("synonym match payong=umbrella", (LF.score({ category: "others", itemName: "Itim na payong", color: "Black", dateLost: today, branch: "QCPL Main Library", location: "Reading Area" },
  { category: "others", title: "Black umbrella", color: "Black", date: today, branch: "QCPL Main Library", location: "Reading Area" }) || {}).score >= 75);
ok("synonymsOf cellphone", LF.synonymsOf("cellphone").includes("phone"));

// 2. Owner self-service
const L = await LF.createLost({ category: "others", itemName: "Blue umbrella", color: "Blue", description: "", uniqueDetails: "", dateLost: today, branch: "QCPL Main Library", location: "Reading Area", name: "Olivia Owner", phone: "09181112222", contactPref: "Call me", publicPost: true });
ok("owner blocked before status check", !!await tryErr(() => LF.updateLostByOwner(L.id, { brand: "Fibrella" })));
LF.unlockCertificate(L.id); // what the Check Status page does after the phone digits match
const upd = await LF.updateLostByOwner(L.id, { brand: "Fibrella", uniqueDetails: "Initials OO on the handle" }, ["data:image/jpeg;base64,AAAA"]);
ok("owner adds details + photo", upd.brand === "Fibrella" && upd.photos.length === 1);
location.hash = "#/status?ref=" + L.id; await W(600);
document.querySelector("#sphone").value = "2222"; document.querySelector("#sphone").closest("form").requestSubmit(); await W(600);
ok("status page shows owner buttons", !!document.querySelector("[data-own-edit]") && !!document.querySelector("[data-own-close]"));
await LF.closeLostByOwner(L.id, "I found it myself");
ok("owner closes report", LF.db.byId("lost", L.id).status === "closed");

// 4. Pick-up booking
const F = await LF.createFound({ title: "Black wallet", category: "wallets", color: "Black", description: "leather", privateDetails: "Two IDs", date: today, branch: "QCPL Main Library", location: "Entrance / Lobby", handover: "I will bring it to the office", finderName: "Felix Finder", finderPhone: "09175556666" });
await LF.signIn("admin", "mainadmin", pw);
await LF.setStatus("found", F.id, "recorded");
const C = await LF.createClaim({ itemId: F.id, name: "Ana Cruz", phone: "09171112222", general: "black leather wallet", specific: "two IDs", dateLost: today });
await LF.setClaimStatus(C.id, "approved");
await LF.signOut();
LF.unlockCertificate(C.id);
const slots = LF.pickupSlots(C.id);
ok("pickup slots offered", slots.length > 0 && slots[0].slots.length > 0, slots.length);
const s0 = slots[0].slots[0];
const booked = await LF.bookPickup(C.id, slots[0].date, s0.time);
ok("pickup booked", !!booked.pickup && LF.pickupsOn(slots[0].date).length === 1);
await LF.cancelPickup(C.id);
ok("pickup cancelled", !LF.db.byId("claims", C.id).pickup);
await LF.bookPickup(C.id, slots[0].date, s0.time);

// 7, 8. Storage, transfer, correction (staff)
await LF.signIn("admin", "mainadmin", pw);
await LF.setStorage(F.id, "Shelf B · Bin 3");
ok("storage saved", LF.db.byId("found", F.id).storage === "Shelf B · Bin 3");
await LF.startTransfer(F.id, "Book Nook – WalterMart North EDSA", "owner works nearby");
ok("transfer started", !!LF.db.byId("found", F.id).transfer);
await LF.receiveTransfer(F.id);
const f2 = LF.db.byId("found", F.id);
ok("transfer received", f2.keptAt === "Book Nook – WalterMart North EDSA" && !f2.transfer && LF.db.byId("claims", C.id).pickup.place === f2.keptAt);
await LF.updateRecord("found", F.id, { title: "Black leather wallet", brand: "Coach" });
ok("record corrected + logged", LF.db.byId("found", F.id).title === "Black leather wallet" && (LF.db.byId("found", F.id).edits || []).length === 1);

// 9. Staff accounts and roles
await LF.createStaff({ username: "juan.desk", name: "Juan Dela Cruz", role: "Desk staff", password: "deskpass123" });
await LF.signOut();
await LF.signIn("admin", "juan.desk", "deskpass123");
ok("desk staff can sign in", LF.currentStaff() && LF.currentStaff().level === "desk");
ok("desk staff not supervisor", !LF.isSupervisor());
ok("desk staff cannot clear records", !!await tryErr(() => LF.clearLibraryRecords()));
ok("desk staff cannot create staff", !!(await tryErrA(() => LF.createStaff({ username: "x.y", name: "X", role: "Desk staff", password: "abcdefgh1" }))));
await LF.changeStaffPassword("deskpass123", "newdeskpass1");
await LF.signOut();
ok("desk staff new password works", !(await tryErrA(() => LF.signIn("admin", "juan.desk", "newdeskpass1"))));
location.hash = "#/staff/dashboard"; await W(700);
ok("desk staff has no Staff tab", ![...document.querySelectorAll(".staff-nav a")].some((a) => a.getAttribute("href") === "#/staff/staff"));
ok("dashboard shows today's pickups", /Today's pick-ups/.test(document.querySelector("#staffMain").textContent));
await LF.signOut();

// 3. Forgot password / account settings
const user = await LF.register({ name: "Carla Santos", phone: "09175550000", email: "carla@example.com", password: "carlapass1", role: USER_ROLES[0], memberId: "" }); await LF.confirmSignupCode((await LF.sendSignupCode({ demo: true })).demoCode);
await LF.signOut();
const r = await LF.requestPasswordReset("09175550000");
ok("reset without email/SMS sends to desk", r.sent === false && r.reason === "no-channel");
await LF.signIn("admin", "mainadmin", pw);
const temp = await LF.adminResetUserPassword(user.id);
await LF.signOut();
await LF.signIn("user", "09175550000", temp);
ok("temporary password works + must change", LF.currentUser() && LF.currentUser().mustChange === true);
const updAcc = await LF.updateAccount({ name: "Carla M. Santos", email: "carla@example.com", memberId: "QC-123", phone: "09175550001", currentPassword: temp, newPassword: "carlanew22" });
ok("new phone needs a code first", updAcc.needsVerify === true && !LF.currentUser() && (await tryErrA(() => LF.signIn("user", "09175550001", "carlanew22"))));
await LF.confirmSignupCode((await LF.sendSignupCode({ demo: true })).demoCode);
await LF.signOut();
ok("new phone + password sign in", !(await tryErrA(() => LF.signIn("user", "09175550001", "carlanew22"))) && LF.currentUser().name === "Carla M. Santos");
await LF.deleteAccount("carlanew22");
ok("account deleted", !LF.db.raw("users").some((u) => u.id === user.id) && !LF.currentUser());

// 11. No rewards: an amount sent anyway is dropped, and nothing is set on return
await LF.signIn("admin", "mainadmin", pw);
const L2 = await LF.createLost({ category: "keys", itemName: "House keys", color: "Silver", dateLost: today, branch: "QCPL Main Library", location: "Restrooms", name: "Rita Reward", phone: "09180000001", contactPref: "Call me", bounty: 300, publicPost: true });
const F2 = await LF.createFound({ title: "House keys", category: "keys", color: "Silver", date: today, branch: "QCPL Main Library", location: "Restrooms", handover: "Already at the office", finderName: "Guard Gil", finderPhone: "09180000002", finderRole: "Library staff" });
await LF.setStatus("found", F2.id, "recorded");
await LF.signOut();
const C2 = await LF.createClaim({ itemId: F2.id, name: "Rita Reward", phone: "09180000001", general: "silver keys", specific: "", dateLost: today, lostRef: L2.id });
await LF.signIn("admin", "mainadmin", pw);
await LF.setClaimStatus(C2.id, "approved");
await LF.recordReturn(C2.id, { releasedTo: "Rita Reward", idType: "QCitizen ID", idLast4: "1111", notes: "", thankNote: "" });
ok("no reward saved or set", !("bounty" in LF.db.byId("lost", L2.id)) && !("bountyStatus" in LF.db.byId("lost", L2.id)) && typeof LF.completeBounty === "undefined");

// UI pages render
for (const h of ["#/staff/staff", "#/staff/tag?id=" + F.id]) { location.hash = h; await W(600); }
ok("tag page has QR", !!document.querySelector(".item-tag__qr svg"));
await LF.signOut();
location.hash = "#/reward-rules"; await W(500); ok("reward rules page is gone", !/Reward rules/i.test(document.querySelector("h1") ? document.querySelector("h1").textContent : ""));
location.hash = "#/report-lost"; await W(900); ok("no reward box on the lost form", !document.querySelector(".reward-box") && !/reward/i.test(document.querySelector("#main").innerText));
ok("no reward link in the footer", !/Reward rules/i.test(document.querySelector("footer") ? document.querySelector("footer").innerText : ""));
for (const h of ["#/forgot", "#/privacy"]) { location.hash = h; await W(500); ok("page " + h, document.querySelector("h1") && document.querySelector("h1").textContent.length > 3); }
window.__F = F.id; window.__C = C.id;
return out;
