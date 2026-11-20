// Photo helper: full pipeline, learning, privacy filters, speed.
const out = {};
const ok = (name, cond, extra) => { out[name] = cond ? "PASS" : "FAIL" + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 300) : ""); };
await PhotoAI.forget();
const draw = (fn, w = 640, h = 480) => { const c = document.createElement("canvas"); c.width = w; c.height = h; fn(c.getContext("2d"), w, h); return c.toDataURL("image/jpeg", 0.88); };
// A "tumbler": tall rounded cylinder, two-tone, on a wood table
const tumbler = (bg, body, cap) => draw((g, w, h) => {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const gr = g.createLinearGradient(260, 0, 380, 0); gr.addColorStop(0, body); gr.addColorStop(0.35, "#ffffff55"); gr.addColorStop(0.5, body); gr.addColorStop(1, "#00000066");
  g.fillStyle = body; g.beginPath(); g.roundRect(260, 120, 120, 300, 30); g.fill(); g.fillStyle = gr; g.beginPath(); g.roundRect(260, 120, 120, 300, 30); g.fill();
  g.fillStyle = cap; g.beginPath(); g.roundRect(255, 80, 130, 60, 14); g.fill();
});
const t0 = performance.now();
const a1 = await PhotoAI.analyze(tumbler("#a9794a", "#1565c0", "#111111"), { kind: "found" });
const first = Math.round(performance.now() - t0);
ok("analyze runs (model + 5 views + fingerprint)", !a1.modelFailed && typeof a1.color === "string", a1);
ok("blue item on wood → Blue", a1.color === "Blue", a1.color);
out.firstLookMs = first;
const t1 = performance.now();
await PhotoAI.analyze(tumbler("#a9794a", "#1565c0", "#111111"), { kind: "found" });
out.secondLookMs = Math.round(performance.now() - t1);
// Several photos at once
const t2 = performance.now();
const many = await PhotoAI.analyze([tumbler("#a9794a", "#1565c0", "#111111"), tumbler("#eeeeee", "#1565c0", "#111111"), tumbler("#3a3d44", "#1565c0", "#111111"), tumbler("#9b9d9f", "#1565c0", "#111111")], { kind: "found" });
out.fourPhotosMs = Math.round(performance.now() - t2);
const t3 = performance.now();
await PhotoAI.analyze([tumbler("#a9794a", "#c62828", "#111111"), tumbler("#eeeeee", "#c62828", "#111111"), tumbler("#3a3d44", "#c62828", "#111111"), tumbler("#9b9d9f", "#c62828", "#111111")], { kind: "found" });
out.fourPhotosAgainMs = Math.round(performance.now() - t3);
out.backend = tf.getBackend();
ok("4 photos analyzed together", !many.modelFailed && many.color === "Blue", many);

// Learning: staff confirm "Aquaflask tumbler" (others). A new photo of the same kind of item should get that answer.
const photoA = tumbler("#a9794a", "#2e7d32", "#111111");
const before = await PhotoAI.analyze(photoA, { kind: "found" });
const learned = await PhotoAI.learn({ photos: [photoA], category: "others", itemName: "Green Aquaflask tumbler", kind: "found", staff: true });
ok("learn stores the confirmed answer", learned === true && (await PhotoAI.memoryCount()) === 1);
const photoB = tumbler("#b08050", "#388e3c", "#1a1a1a"); // similar item, slightly different light and table
const after = await PhotoAI.analyze(photoB, { kind: "found" });
ok("a similar new photo gets the learned answer", after.category === "others" && /Aquaflask/i.test(after.itemName || "") && after.learned, { before: [before.category, before.itemName], after: [after.category, after.itemName, after.learned, after.confidence] });
const unrelated = await PhotoAI.analyze(draw((g, w, h) => { g.fillStyle = "#f2f1ee"; g.fillRect(0, 0, w, h); g.fillStyle = "#c62828"; g.fillRect(120, 200, 400, 90); g.fillStyle = "#333"; g.fillRect(140, 215, 360, 10); }), { kind: "found" });
ok("a very different photo is not forced to the learned answer", !/Aquaflask/i.test(unrelated.itemName || ""), [unrelated.category, unrelated.itemName]);

// Privacy: typed names with a person's name or numbers are never remembered
ok("safeName keeps ordinary item words", PhotoAI._test.safeName("Blue aquaflask tumbler") === "Blue aquaflask tumbler");
ok("safeName drops a person's name", PhotoAI._test.safeName("Juan's blue tumbler") === "");
ok("safeName drops numbers", PhotoAI._test.safeName("ID 2024-1234") === "");
ok("long numbers keep only the last 4", PhotoAI._test.maskNumbers("ID NO 1234 5678 9012 and 09171234567") === "ID NO ••••9012 and ••••4567", PhotoAI._test.maskNumbers("ID NO 1234 5678 9012 and 09171234567"));

// Two colors
const two = await PhotoAI.analyze(draw((g, w, h) => { g.fillStyle = "#eeeeee"; g.fillRect(0, 0, w, h); g.fillStyle = "#111111"; g.beginPath(); g.roundRect(170, 110, 300, 140, 20); g.fill(); g.fillStyle = "#c62828"; g.beginPath(); g.roundRect(170, 250, 300, 140, 20); g.fill(); }), { kind: "lost" });
ok("black + red item → two colors", ["Black", "Red"].includes(two.color) && ["Black", "Red"].includes(two.secondColor) && two.color !== two.secondColor, [two.color, two.secondColor, two.description]);
ok("description names both colors", /and/.test(PhotoAI.describe("Backpack", "Black", "Red")) && PhotoAI.describe("Backpack", "Black", "Red") === "Black and red backpack.");
// Coverage of the model's labels
out.labelsMapped = window.IMAGENET_LABELS ? window.IMAGENET_LABELS.filter((l) => /./.test(l)).length : 0;
await PhotoAI.forget();
return out;
