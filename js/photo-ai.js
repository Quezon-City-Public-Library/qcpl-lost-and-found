/* ==========================================================================
   QCPL Lost & Found — Quezon City Public Library
   Photo helper: looks at the photos of an item and suggests the type of item,
   a short name, the main color(s), a description and (where the browser can
   read text) the brand and any printed text.

   Everything runs in the visitor's own browser (TensorFlow.js + MobileNet v2,
   stored in assets/ai/). Photos are never uploaded, and it works without
   internet. The model is only loaded when a photo is first added.

   How it gets accurate without a database:
     1. Finds the item in the photo (separates it from the table or floor behind it)
        and looks at it 5 ways: the item cut out, its mirror image, the whole photo,
        the middle, and a close-up. The answers are averaged.
     2. All of a report's photos are looked at, not only the first.
     3. All 1,000 things the model knows are mapped to our item types.
     4. Colors are measured on the item only (not the background), corrected for
        warm or cool room light, and named the way people see them (OKLab).
     5. It learns on this device: when a report is sent or staff correct a record,
        the photo's "fingerprint" and the right answer are remembered (IndexedDB,
        this browser only). New photos that look like a remembered one get that answer.
   ========================================================================== */
window.PhotoAI = (function () {
  "use strict";

  /* What the model's labels mean for us: [pattern, category, friendly name, weight].
     Weight < 1 marks look-alikes (e.g. keys are often seen as "padlock" or "can opener"). */
  const RULES = [
    // Phones & gadgets
    [/^cellular telephone/, "phones", "Mobile phone", 1],
    [/^hand-held computer/, "phones", "Mobile phone", 0.9],
    [/^iPod/, "phones", "Mobile phone", 0.9],
    [/^dial telephone|^pay-phone/, "phones", "Mobile phone", 0.5],
    [/^web site/, "phones", "Mobile phone", 0.45],            // a phone or tablet screen often looks like a "web site"
    [/^remote control/, "phones", "Mobile phone", 0.6],
    [/^notebook, notebook computer|^laptop/, "phones", "Laptop", 1],
    [/^desktop computer|^monitor|^screen|^television/, "phones", "Tablet", 0.7],
    [/^modem|^hard disc/, "phones", "Power bank", 0.6],
    [/^power drill/, "phones", "Power bank", 0.35],
    [/computer mouse/, "phones", "Computer mouse", 1],
    [/^joystick/, "phones", "Game controller", 0.9],
    [/^loudspeaker|^radio,|^tape player|^cassette player|^CD player/, "phones", "Speaker / music player", 0.9],
    [/^reflex camera|^Polaroid camera|^lens cap/, "phones", "Camera", 1],
    [/^microphone/, "phones", "Microphone", 1],
    [/^stethoscope/, "phones", "Earphones / headphones", 0.7],  // wired earphones are often seen as a stethoscope
    [/^computer keyboard|^space bar|^typewriter keyboard/, "phones", "Keyboard", 0.9],
    [/^plug|^switch, electric switch|^electric fan/, "phones", "Charger / small fan", 0.6],
    [/^torch|^spotlight/, "phones", "Flashlight", 0.7],
    // Wallets, IDs & documents
    [/^wallet/, "wallets", "Wallet", 1],
    [/^envelope/, "wallets", "Envelope / documents", 0.9],
    [/^packet/, "wallets", "Card holder", 0.6],
    [/^menu|^crossword puzzle/, "wallets", "Papers / documents", 0.55],
    // Bags
    [/^backpack/, "bags", "Backpack", 1],
    [/^purse/, "bags", "Handbag", 1],
    [/^mailbag/, "bags", "Sling bag", 1],
    [/^plastic bag/, "bags", "Plastic bag", 1],
    [/^pencil box/, "bags", "Pouch", 0.9],
    [/^holster/, "bags", "Pouch", 0.5],
    [/^sleeping bag|^hamper/, "bags", "Bag", 0.5],
    [/^shopping basket|^carton|^crate/, "bags", "Paper bag / box", 0.7],
    // Keys (ImageNet has no "key" class — these are what keys usually look like to it)
    [/^padlock|^combination lock/, "keys", "Keys", 0.9],
    [/^chain,|^chain$/, "keys", "Keychain", 0.8],
    [/^can opener|^corkscrew|^screwdriver|^safety pin|^nail$|^screw|^hook, claw|^whistle|^letter opener|^carpenter's kit/, "keys", "Keys", 0.6],
    // Accessories (eyeglasses, watches, jewelry, caps)
    [/^sunglass/, "accessories", "Eyeglasses", 1],
    [/^loupe/, "accessories", "Eyeglasses", 0.7],
    [/^digital watch|^stopwatch/, "accessories", "Wristwatch", 1],
    [/^analog clock|^wall clock|^digital clock/, "accessories", "Wristwatch", 0.6],
    [/^necklace|^chain mail/, "accessories", "Necklace", 0.9],
    [/^bow tie|^Windsor tie|^bolo tie/, "accessories", "Necktie", 1],
    [/^hair slide/, "accessories", "Hair clip", 0.9],
    [/^lipstick|^face powder|^perfume|^lotion|^sunscreen|^hair spray/, "accessories", "Makeup / toiletry", 0.9],
    [/^buckle/, "accessories", "Belt", 0.9],
    [/^thimble/, "accessories", "Ring", 0.4],
    [/^cowboy hat|^sombrero|^bonnet|^bathing cap|^shower cap/, "accessories", "Cap / hat", 1],
    [/^mortarboard/, "accessories", "Cap / hat", 0.6],
    [/^wig/, "accessories", "Hair accessory", 0.5],
    // Books, notebooks, calculators, pens
    [/^book jacket|^comic book/, "books", "Book", 1],
    [/^binder/, "books", "Binder / notebook", 0.9],
    [/^ballpoint|^fountain pen|^quill/, "books", "Pen", 1],
    [/^pencil sharpener|^rubber eraser/, "books", "Pencil case items", 0.8],
    [/^rule, ruler|^slide rule/, "books", "Ruler", 0.8],
    [/^abacus/, "books", "Calculator", 0.6],
    // Other items
    [/^umbrella/, "others", "Umbrella", 1],
    [/^water bottle|^water jug|^pop bottle|^cocktail shaker/, "others", "Water bottle / tumbler", 1],
    [/^wine bottle|^beer bottle|^whiskey jug/, "others", "Bottle", 0.7],
    [/^coffee mug|^cup$|^beer glass|^goblet|^pitcher/, "others", "Cup / tumbler", 0.9],
    [/^pill bottle/, "others", "Medicine bottle", 1],
    [/^Band Aid|^syringe/, "others", "Medicine / first aid", 0.6],
    [/^sweatshirt|^jersey|^cardigan|^trench coat|^fur coat|^poncho|^cloak|^suit|^jean|^stole|^pajama|^kimono|^military uniform|^academic gown|^apron|^miniskirt|^sarong|^swimming trunks|^bikini|^maillot|^velvet|^wool/, "others", "Jacket / clothing", 0.9],
    [/^lab coat/, "others", "White coat / jacket", 0.8],
    [/^running shoe|^sandal|^Loafer|^clog|^cowboy boot/, "others", "Shoes", 1],
    [/^mitten|^sock|^Christmas stocking|^diaper|^bib/, "others", "Clothing item", 0.8],
    [/^teddy|^jigsaw puzzle/, "others", "Toy", 0.9],
    [/^tennis ball|^volleyball|^basketball|^soccer ball|^rugby ball|^golf ball|^ping-pong ball|^baseball/, "others", "Ball", 0.9],
    [/^racket/, "others", "Racket", 0.9],
    [/^crutch/, "others", "Cane / crutch", 1],
    [/^mask|^gasmask|^oxygen mask|^ski mask/, "others", "Face mask", 0.8],
    [/^crash helmet|^football helmet/, "others", "Helmet", 1],
    [/^handkerchief|^bath towel|^dishrag|^paper towel|^toilet tissue/, "others", "Handkerchief / towel", 0.8],
    [/^lighter/, "others", "Lighter", 0.9],
    [/^tray|^plate$|^soup bowl|^mixing bowl|^lunch/, "others", "Lunch box / food container", 0.5],
    [/^piggy bank/, "others", "Coin bank", 0.9],
  ];
  /* Words that may be remembered from what people typed (anything else, like a person's name, is never stored) */
  const SAFE_WORDS = new Set(("phone mobile cellphone smartphone iphone samsung oppo vivo xiaomi realme huawei infinix tecno nokia android tablet ipad laptop " +
    "charger cable power bank powerbank earphones earphone earbuds headphones headset airpods speaker mouse keyboard camera flash drive usb calculator " +
    "wallet coin purse id card cards license atm bank student school library qcitizen umid passport document documents papers envelope folder " +
    "bag backpack sling tote handbag pouch case pencil plastic paper box lunch keys key keychain lanyard ring necklace bracelet earrings watch eyeglasses " +
    "glasses sunglasses cap hat umbrella tumbler bottle water jug flask aquaflask hydro mug cup jacket hoodie sweater shirt uniform shoes slippers sandals " +
    "towel handkerchief face mask notebook book books binder pen pens ruler toy ball helmet medicine fan flashlight small big black white gray grey silver " +
    "gold brown beige red pink orange yellow green blue purple navy dark light leather fabric metal folding foldable with and of " +
    // Filipino
    "payong pitaka susi relo kuwintas kwintas singsing pulseras sapatos tsinelas libro aklat kuwaderno kwaderno ballpen bolpen lapis bote baso tasa tuwalya " +
    "panyo bimpo sinturon kurbata ipit laruan bola kamera gamot alkansiya supot plastik kahon damit dyaket sumbrero salamin mata lalagyan baunan sobre " +
    "papel dokumento mga ng sa na at itim puti abo pilak kayumanggi krema pula pulang rosas kahel dilaw ginto berde asul lila maliit malaki bentilador " +
    "selpon telepono tungkod saklay lisensiya pasaporte").split(" "));

  /* Names in Filipino (used when the visitor chose Filipino). Matching treats both languages alike (SYNONYMS in data.js). */
  const NAME_FIL = {
    "Mobile phone": "Cellphone", "Laptop": "Laptop", "Tablet": "Tablet", "Power bank": "Power bank", "Computer mouse": "Mouse ng computer",
    "Game controller": "Controller ng laro", "Speaker / music player": "Speaker / music player", "Camera": "Kamera", "Microphone": "Mikropono",
    "Earphones / headphones": "Earphones / headphones", "Keyboard": "Keyboard", "Charger / small fan": "Charger / maliit na bentilador", "Flashlight": "Flashlight",
    "Wallet": "Pitaka", "Envelope / documents": "Sobre / mga dokumento", "Card holder": "Lalagyan ng card", "Papers / documents": "Mga papel / dokumento",
    "Backpack": "Backpack", "Handbag": "Handbag", "Sling bag": "Sling bag", "Plastic bag": "Plastik na supot", "Pouch": "Pouch", "Bag": "Bag",
    "Paper bag / box": "Paper bag / kahon", "Keys": "Susi", "Keychain": "Keychain", "Eyeglasses": "Salamin sa mata", "Wristwatch": "Relo",
    "Necklace": "Kuwintas", "Necktie": "Kurbata", "Hair clip": "Ipit sa buhok", "Makeup / toiletry": "Makeup / gamit sa katawan", "Belt": "Sinturon",
    "Ring": "Singsing", "Cap / hat": "Sumbrero / cap", "Hair accessory": "Gamit sa buhok", "Book": "Libro", "Binder / notebook": "Binder / kuwaderno",
    "Pen": "Ballpen", "Pencil case items": "Gamit sa pagsusulat", "Ruler": "Ruler", "Calculator": "Calculator", "Umbrella": "Payong",
    "Water bottle / tumbler": "Tumbler / bote ng tubig", "Bottle": "Bote", "Cup / tumbler": "Baso / tumbler", "Medicine bottle": "Bote ng gamot",
    "Medicine / first aid": "Gamot / first aid", "Jacket / clothing": "Jacket / damit", "White coat / jacket": "Puting coat / jacket", "Shoes": "Sapatos",
    "Clothing item": "Damit", "Toy": "Laruan", "Ball": "Bola", "Racket": "Raketa", "Cane / crutch": "Tungkod / saklay", "Face mask": "Face mask",
    "Helmet": "Helmet", "Handkerchief / towel": "Panyo / tuwalya", "Lighter": "Lighter", "Lunch box / food container": "Baunan / lalagyan ng pagkain",
    "Coin bank": "Alkansiya", "QCitizen ID": "QCitizen ID", "School ID": "ID sa paaralan", "Driver's license": "Lisensiya sa pagmamaneho",
    "Passport": "Pasaporte", "Government ID": "ID ng gobyerno", "Bank / ATM card": "Bank / ATM card", "Library card": "Library card", "ID card": "ID card",
  };
  const COLOR_FIL = { Black: "Itim", White: "Puti", Gray: "Abo", Silver: "Pilak", Brown: "Kayumanggi", Beige: "Krema", Red: "Pula", Pink: "Rosas",
    Orange: "Kahel", Yellow: "Dilaw", Gold: "Ginto", Green: "Berde", Blue: "Asul", Purple: "Lila" };
  const isFil = () => typeof I18N !== "undefined" && I18N.lang === "fil" && !document.body.classList.contains("is-staff");
  const shown = (name) => (isFil() && NAME_FIL[name]) || name;

  /* ---------------- Loading (lazy, offline-friendly) ---------------- */
  // In the single-file build the scripts are embedded as text blocks.
  function loadScript(path) {
    // The AI library sets a global "regeneratorRuntime"; if it doesn't exist yet the library falls back to
    // building code from text, which the site's security policy (CSP) blocks. Creating it first avoids that.
    if (!("regeneratorRuntime" in window)) window.regeneratorRuntime = undefined;
    return new Promise((resolve, reject) => {
      const embedded = document.querySelector(`script[type="text/plain"][data-asset="${path}"]`);
      const s = document.createElement("script");
      s.src = embedded ? URL.createObjectURL(new Blob([embedded.textContent], { type: "text/javascript" })) : path;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load " + path));
      document.head.appendChild(s);
    });
  }

  const POOL = "module_apply_default/MobilenetV2/Logits/AvgPool"; // the photo's "fingerprint" (1,280 numbers)
  let modelPromise = null, ruleOf = null;
  function loadModel() {
    if (!modelPromise) {
      modelPromise = (async () => {
        await loadScript("assets/ai/tf.min.js");
        await Promise.all([loadScript("assets/ai/mobilenet-model.js"), loadScript("assets/ai/imagenet-labels.js")]);
        const { json, weights } = window.MOBILENET_MODEL;
        const bin = atob(weights);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const model = await tf.loadGraphModel(tf.io.fromMemory({
          modelTopology: json.modelTopology, format: json.format, generatedBy: json.generatedBy, convertedBy: json.convertedBy,
          signature: json.signature, userDefinedMetadata: json.userDefinedMetadata,
          weightSpecs: json.weightsManifest[0].weights, weightData: bytes.buffer,
        }));
        window.MOBILENET_MODEL = null; // free the big text copy
        // Which of our rules each of the 1,000 labels belongs to (worked out once)
        ruleOf = window.IMAGENET_LABELS.map((label) => RULES.find(([re]) => re.test(label)) || null);
        // Warm up for the two batch sizes used (5 views of the main photo, 2 of each other photo),
        // so the first real photo isn't slowed by the graphics card preparing itself
        for (const n of [5, 2]) {
          try {
            const z = tf.zeros([n, 224, 224, 3]);
            const r = model.execute(z, [model.outputs[0].name, POOL]);
            (Array.isArray(r) ? r : [r]).forEach((t) => t && t.dispose()); z.dispose();
          } catch {}
        }
        return model;
      })().catch((err) => { modelPromise = null; throw err; });
    }
    return modelPromise;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read the photo"));
      img.src = src;
    });
  }
  const canvasOf = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const ctx2d = (c) => c.getContext("2d", { willReadFrequently: true });
  /* Draws part of the photo (sx, sy, side × side, may go past the edges) into a square, filling outside with `fill` */
  function squareView(img, sx, sy, side, size, fill, flip = false) {
    const c = canvasOf(size, size), g = ctx2d(c);
    g.fillStyle = fill; g.fillRect(0, 0, size, size);
    if (flip) { g.translate(size, 0); g.scale(-1, 1); }
    const k = size / side;
    g.drawImage(img, -sx * k, -sy * k, img.width * k, img.height * k);
    return c;
  }

  /* ---------------- Color science (OKLab: distances match what people see) ---------------- */
  const lin = (u) => { u /= 255; return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; };
  const LIN = Array.from({ length: 256 }, (_, i) => lin(i));
  function oklab(r, g, b) {
    const R = LIN[r], G = LIN[g], B = LIN[b];
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  const hex = (h) => oklab(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
  /* Several examples of each color name (light, dark, muted), as people name them */
  const PALETTE = Object.entries({
    Brown: ["#6b4423", "#8b5a2b", "#4a3020", "#a0522d", "#5d4037", "#7b5b3a", "#3e2a1e"],
    Beige: ["#d8c3a5", "#e8d8b8", "#c8b08a", "#d2b48c", "#efe3cc", "#bfa98a"],
    Red: ["#c62828", "#e53935", "#8b1a1a", "#b71c1c", "#d32f2f", "#a31515", "#7f1d1d"],
    Pink: ["#f48fb1", "#f8bbd0", "#e91e63", "#ec407a", "#f06292", "#ffc0cb", "#d81b60", "#e8a0b4"],
    Orange: ["#f57c00", "#ff9800", "#e65100", "#fb8c00", "#ffa726", "#ef6c00"],
    Yellow: ["#fdd835", "#ffeb3b", "#f9a825", "#fbc02d", "#fff176", "#ffe082", "#e6c200"],
    Green: ["#2e7d32", "#43a047", "#1b5e20", "#81c784", "#556b2f", "#66bb6a", "#00796b", "#9ccc65", "#004d40", "#6b8e23"],
    Blue: ["#1565c0", "#1e88e5", "#0d47a1", "#90caf9", "#1a237e", "#283593", "#42a5f5", "#0288d1", "#64b5f6", "#00838f", "#26c6da", "#3f51b5"],
    Purple: ["#6a1b9a", "#8e24aa", "#b39ddb", "#7b1fa2", "#9575cd", "#4a148c", "#ab47bc", "#ce93d8"],
    Gold: ["#c9a227", "#b8860b", "#d4af37"],
  }).flatMap(([name, list]) => list.map((h) => ({ name, lab: hex(h) })));
  const chroma = ([, a, b]) => Math.hypot(a, b);
  function nameLab(lab) {
    const [L] = lab, C = chroma(lab);
    // Grays (no real color): named by lightness. Dark colors carry less chroma, so the limit follows lightness.
    if (C < 0.014 + 0.026 * L) return L < 0.36 ? "Black" : L > 0.84 ? "White" : "Gray";
    if (L < 0.22) return "Black";
    let best = null, bd = Infinity;
    for (const p of PALETTE) {
      const d = (lab[0] - p.lab[0]) ** 2 * 0.6 + (lab[1] - p.lab[1]) ** 2 + (lab[2] - p.lab[2]) ** 2; // hue matters more than light/dark
      if (d < bd) { bd = d; best = p.name; }
    }
    if (best === "Gold") best = "Yellow"; // "Gold" is only used for metal items (see below)
    return best;
  }
  /* Small weighted k-means in OKLab */
  function kmeans(pts, w, k, iters = 10) {
    const n = pts.length / 3;
    if (!n) return [];
    const cent = [];
    // Start from spread-out points (deterministic: heaviest point, then farthest ones)
    let first = 0; for (let i = 1; i < n; i++) if (w[i] > w[first]) first = i;
    cent.push([pts[first * 3], pts[first * 3 + 1], pts[first * 3 + 2]]);
    const dmin = new Float32Array(n).fill(Infinity);
    while (cent.length < k) {
      const c = cent[cent.length - 1]; let far = -1, fd = -1;
      for (let i = 0; i < n; i++) {
        const d = (pts[i * 3] - c[0]) ** 2 + (pts[i * 3 + 1] - c[1]) ** 2 + (pts[i * 3 + 2] - c[2]) ** 2;
        if (d < dmin[i]) dmin[i] = d;
        if (dmin[i] * w[i] > fd) { fd = dmin[i] * w[i]; far = i; }
      }
      if (far < 0 || fd <= 1e-6) break;
      cent.push([pts[far * 3], pts[far * 3 + 1], pts[far * 3 + 2]]);
    }
    const assign = new Int32Array(n);
    for (let it = 0; it < iters; it++) {
      const sum = cent.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < n; i++) {
        let bi = 0, bd = Infinity;
        for (let j = 0; j < cent.length; j++) { const c = cent[j]; const d = (pts[i * 3] - c[0]) ** 2 + (pts[i * 3 + 1] - c[1]) ** 2 + (pts[i * 3 + 2] - c[2]) ** 2; if (d < bd) { bd = d; bi = j; } }
        assign[i] = bi; const s = sum[bi]; s[0] += pts[i * 3] * w[i]; s[1] += pts[i * 3 + 1] * w[i]; s[2] += pts[i * 3 + 2] * w[i]; s[3] += w[i];
      }
      sum.forEach((s, j) => { if (s[3] > 0) cent[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    }
    const weight = cent.map(() => 0);
    for (let i = 0; i < n; i++) weight[assign[i]] += w[i];
    return cent.map((c, j) => ({ lab: c, w: weight[j], j })).filter((c) => c.w > 0).sort((a, b) => b.w - a.w).map((c) => ({ ...c, assign }));
  }

  /* ---------------- Where is the item? (separate it from the background) ---------------- */
  function findItem(img) {
    const M = 96, scale = M / Math.max(img.width, img.height);
    const W = Math.max(8, Math.round(img.width * scale)), H = Math.max(8, Math.round(img.height * scale));
    const c = canvasOf(W, H); ctx2d(c).drawImage(img, 0, 0, W, H);
    const px = ctx2d(c).getImageData(0, 0, W, H).data;
    const n = W * H, lab = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const o = oklab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); lab[i * 3] = o[0]; lab[i * 3 + 1] = o[1]; lab[i * 3 + 2] = o[2]; }
    // The background is what the edges of the photo show
    const ring = Math.max(2, Math.round(Math.min(W, H) * 0.06));
    const bpts = [], bw = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < ring || y < ring || x >= W - ring || y >= H - ring) { const i = y * W + x; bpts.push(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]); bw.push(1); }
    const bg = kmeans(Float32Array.from(bpts), Float32Array.from(bw), 3, 8).filter((b) => b.w >= bw.length * 0.12);
    const distBg = (i) => Math.min(...bg.map((b) => Math.sqrt((lab[i * 3] - b.lab[0]) ** 2 + (lab[i * 3 + 1] - b.lab[1]) ** 2 + (lab[i * 3 + 2] - b.lab[2]) ** 2)));
    // How much the background itself varies (wood grain, carpet) sets how different the item must be
    const bdist = []; for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (x < ring || y < ring || x >= W - ring || y >= H - ring) bdist.push(distBg(y * W + x));
    bdist.sort((a, b) => a - b);
    const thr = Math.max(0.06, (bdist[Math.floor(bdist.length * 0.8)] || 0) * 1.6);
    const fg = new Float32Array(n);
    let count = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, d = distBg(i);
      const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2;
      const center = Math.exp(-(dx * dx + dy * dy) * 1.2);
      fg[i] = d > thr ? Math.min(1, (d - thr) / thr + 0.5) * (0.35 + 0.65 * center) : 0;
      if (fg[i] > 0.15) count++;
    }
    // Box around the item (trimming stray specks), or the middle 80% if the item can't be told apart
    let box;
    const share = count / n;
    if (share > 0.03 && share < 0.9) {
      const xs = [], ys = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fg[y * W + x] > 0.15) { xs.push(x); ys.push(y); }
      xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
      const q = (a, p) => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))];
      box = { x0: q(xs, 0.02), x1: q(xs, 0.98) + 1, y0: q(ys, 0.02), y1: q(ys, 0.98) + 1 };
    } else {
      box = { x0: W * 0.1, x1: W * 0.9, y0: H * 0.1, y1: H * 0.9 };
      for (let i = 0; i < n; i++) { const x = i % W, y = (i / W) | 0; const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2; fg[i] = Math.exp(-(dx * dx + dy * dy) * 2.2); }
    }
    const bgMain = bg[0] ? bg[0].lab : [0.9, 0, 0];
    // Average color of the edges, used to fill around a cut-out so no hard border is added
    let r = 0, g = 0, b = 0, m = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < ring || y < ring || x >= W - ring || y >= H - ring) { const i = (y * W + x) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; m++; }
    const bgRgb = m ? `rgb(${Math.round(r / m)},${Math.round(g / m)},${Math.round(b / m)})` : "rgb(200,200,200)";
    return { W, H, lab, fg, box, share, bgLab: bgMain, bgList: bg, bgRgb, scale };
  }

  /* ---------------- Main color(s) of the item ---------------- */
  const COLOR_ORDER = ["Black", "White", "Gray", "Silver", "Brown", "Beige", "Red", "Pink", "Orange", "Yellow", "Gold", "Green", "Blue", "Purple"];
  function itemColors(seg) {
    const { W, H, lab, fg, box, bgLab } = seg;
    // Room light: if the background is a gray-ish surface, its tint is the light's tint — take most of it out.
    // (Shiny spots were tried as a guide too, but pale items like beige lost their real color, so they are not used.)
    const castA = chroma(bgLab) < 0.045 && bgLab[0] > 0.4 ? bgLab[1] * 0.75 : 0, castB = chroma(bgLab) < 0.045 && bgLab[0] > 0.4 ? bgLab[2] * 0.75 : 0;
    const pts = [], w = [];
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2, hw = Math.max(1, (box.x1 - box.x0) / 2), hh = Math.max(1, (box.y1 - box.y0) / 2);
    for (let y = Math.floor(box.y0); y < Math.ceil(box.y1); y++) for (let x = Math.floor(box.x0); x < Math.ceil(box.x1); x++) {
      const i = y * W + x; if (i < 0 || i >= W * H || fg[i] <= 0.05) continue;
      const L = lab[i * 3], a = lab[i * 3 + 1] - castA, b = lab[i * 3 + 2] - castB;
      // Shiny highlights (almost white, no color) say little about the item's color
      const glare = L > 0.94 && Math.hypot(a, b) < 0.03 ? 0.25 : 1;
      const dx = (x - cx) / hw, dy = (y - cy) / hh;
      pts.push(L, a, b); w.push(fg[i] * glare * (0.4 + 0.6 * Math.exp(-(dx * dx + dy * dy) * 1.1)));
    }
    if (pts.length < 9) return { main: "Other", second: "", shares: [] };
    const clusters = kmeans(Float32Array.from(pts), Float32Array.from(w), 5, 10);
    const total = clusters.reduce((s, c) => s + c.w, 0) || 1;
    const named = {};
    clusters.forEach((c) => { const nm = nameLab(c.lab); named[nm] = (named[nm] || 0) + c.w / total; });
    const shares = Object.entries(named).sort((a, b) => b[1] - a[1]);
    const neutral = (n) => ["Black", "Gray", "White"].includes(n);
    let [main, mainShare] = shares[0];
    // A dark item in shade looks partly gray, a white item partly gray: keep the stronger of the two
    const rest = shares.slice(1).filter(([nm, s]) => !(neutral(nm) && neutral(main) && s < 0.42));
    // A small colored part on a mostly black/white/gray item still counts if it is clearly visible
    const chromatic = rest.filter(([nm]) => !neutral(nm));
    if (neutral(main) && chromatic[0] && chromatic[0][1] >= 0.45) { const swap = chromatic[0]; rest.splice(rest.indexOf(swap), 1, [main, mainShare]); [main, mainShare] = swap; }
    const strong = rest.filter(([, s]) => s >= 0.22);
    const many = [main, ...strong.map(([nm]) => nm)].filter((nm, i, a) => a.indexOf(nm) === i && !neutral(nm));
    if (many.length >= 3) return { main: "Multi-colored", second: "", shares };
    const second = strong.length && strong[0][1] >= 0.26 ? strong[0][0] : "";
    return { main, second, shares };
  }

  /* ---------------- Read text (only in browsers that can: Chrome/Edge on Android, ChromeOS and Mac) ---------------- */
  const BRANDS = ["Samsung", "Apple", "iPhone", "iPad", "Oppo", "Vivo", "Xiaomi", "Redmi", "Realme", "Huawei", "Infinix", "Tecno", "Nokia", "Lenovo", "Asus", "Acer", "Dell", "HP",
    "JBL", "Sony", "Anker", "Baseus", "Romoss", "JanSport", "Herschel", "Nike", "Adidas", "Puma", "Under Armour", "Hawk", "Aquaflask", "Hydro Flask", "Tupperware", "Casio",
    "Seiko", "Swatch", "Timex", "Fossil", "Ray-Ban", "Oakley", "Uniqlo", "Penshoppe", "Bench", "Kipling", "Coach", "Michael Kors", "Logitech", "Kingston", "SanDisk", "Faber-Castell", "Pilot", "Panda"];
  const ID_WORDS = [
    [/QC\s*CITIZEN|QCITIZEN/i, "QCitizen ID"], [/STUDENT|UNIVERSITY|COLLEGE|SCHOOL|ACADEMY/i, "School ID"], [/DRIVER|LICEN[CS]E|LTO/i, "Driver's license"],
    [/PASSPORT/i, "Passport"], [/UMID|SSS|GSIS|PHILHEALTH|PAG-?IBIG|TIN\b|POSTAL|NATIONAL ID|PHILSYS|PHILIPPINE IDENTIFICATION/i, "Government ID"],
    [/VISA|MASTERCARD|DEBIT|CREDIT|BDO|BPI|LANDBANK|METROBANK|SECURITY BANK|UNIONBANK|RCBC|PNB|CHINABANK|GCASH|MAYA/i, "Bank / ATM card"],
    [/LIBRARY|QCPL|BORROWER/i, "Library card"], [/REPUBLIKA|REPUBLIC OF THE PHILIPPINES|PILIPINAS|IDENTIFICATION|\bID\s*NO/i, "ID card"],
  ];
  async function readText(img) {
    if (!("TextDetector" in window)) return [];
    try {
      const side = Math.min(1024, Math.max(img.width, img.height)), k = side / Math.max(img.width, img.height);
      const c = canvasOf(Math.round(img.width * k), Math.round(img.height * k)); ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
      const found = await new window.TextDetector().detect(c);
      return found.map((t) => String(t.rawValue || "").trim()).filter(Boolean).slice(0, 40);
    } catch { return []; }
  }
  // Long numbers (ID, card, phone) keep only their last 4 characters
  const maskNumbers = (s) => s.replace(/\d[\d\s-]{4,}\d/g, (m) => "••••" + m.replace(/\D/g, "").slice(-4));

  /* ---------------- On-device memory (learns from sent reports and staff corrections) ---------------- */
  const MEM_MAX = 400;
  let memCache = null;
  function memDb() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open("qcpllf-photo-memory", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("examples", { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  async function memAll() {
    if (memCache) return memCache;
    const db = await memDb();
    if (!db) return (memCache = []);
    memCache = await new Promise((resolve) => {
      try {
        const r = db.transaction("examples").objectStore("examples").getAll();
        r.onsuccess = () => resolve((r.result || []).map((e) => ({ ...e, emb: new Float32Array(e.emb) })));
        r.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
    return memCache;
  }
  async function memPut(example) {
    const list = await memAll();
    list.push(example);
    const db = await memDb();
    if (!db) return;
    try {
      const tx = db.transaction("examples", "readwrite"), st = tx.objectStore("examples");
      st.put({ ...example, emb: Array.from(example.emb) });
      // Keep the newest MEM_MAX examples
      list.sort((a, b) => a.at - b.at);
      while (list.length > MEM_MAX) st.delete(list.shift().id);
    } catch {}
  }
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  /* Remembered photos that look like this one → votes for their answers */
  async function recall(emb) {
    if (!emb) return { cats: {}, names: {}, best: 0 };
    const list = await memAll();
    const near = list.map((e) => ({ e, sim: dot(e.emb, emb) })).filter((x) => x.sim >= 0.72).sort((a, b) => b.sim - a.sim).slice(0, 7);
    const cats = {}, names = {};
    near.forEach(({ e, sim }) => {
      const v = ((sim - 0.72) / 0.28) ** 2 * e.w;
      cats[e.category] = (cats[e.category] || 0) + v;
      if (e.name) { const k = e.name + "|" + e.category; names[k] = (names[k] || 0) + v; }
    });
    return { cats, names, best: near[0] ? near[0].sim : 0 };
  }
  /* Keep a typed name only if every word is an ordinary item word (no personal names or numbers) */
  function safeName(name) {
    if (/\d/.test(String(name || ""))) return ""; // numbers can be an ID, card or phone number
    const words = String(name || "").toLowerCase().replace(/[^a-z\s/-]/g, " ").split(/[\s/-]+/).filter(Boolean);
    if (!words.length || words.length > 5 || !words.every((w) => SAFE_WORDS.has(w))) return "";
    return String(name).trim().replace(/\s+/g, " ").replace(/^./, (c) => c.toUpperCase()).slice(0, 40);
  }

  /* ---------------- Looking at photos ---------------- */
  const embCache = new Map(); // photo → fingerprint, so a sent report can be learned without looking again
  async function look(model, img, seg, views) {
    const { box, scale } = seg;
    const x0 = box.x0 / scale, x1 = box.x1 / scale, y0 = box.y0 / scale, y1 = box.y1 / scale;
    const side = Math.max(x1 - x0, y1 - y0) * 1.16, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const fill = seg.bgRgb;
    const full = Math.max(img.width, img.height), short = Math.min(img.width, img.height);
    const all = [
      [squareView(img, cx - side / 2, cy - side / 2, side, 224, fill), 1.5],           // the item cut out
      [squareView(img, cx - side / 2, cy - side / 2, side, 224, fill, true), 1.2],     // its mirror image
      [squareView(img, (img.width - full) / 2, (img.height - full) / 2, full, 224, fill), 1], // whole photo, nothing cut off
      [squareView(img, (img.width - short) / 2, (img.height - short) / 2, short, 224, fill), 0.9], // the middle
      [squareView(img, cx - side * 0.36, cy - side * 0.36, side * 0.72, 224, fill), 0.8], // close-up
    ].slice(0, views);
    let out;
    const input = tf.tidy(() => tf.stack(all.map(([c]) => tf.browser.fromPixels(c))).toFloat().div(255));
    try {
      out = model.execute(input, [model.outputs[0].name, POOL]);
    } catch {
      out = [model.predict(input), null];
    }
    input.dispose();
    const [logits, pool] = Array.isArray(out) ? out : [out, null];
    const probs = tf.tidy(() => tf.softmax(tf.slice(logits, [0, 1], [-1, 1000])));
    const p = await probs.array();
    let emb = null;
    if (pool) {
      const f = await pool.reshape([all.length, -1]).array();
      emb = new Float32Array(f[0].length);
      [0, 1].forEach((v) => { if (f[v]) for (let i = 0; i < emb.length; i++) emb[i] += f[v][i]; });
      const norm = Math.hypot(...emb) || 1;
      for (let i = 0; i < emb.length; i++) emb[i] /= norm;
      pool.dispose();
    }
    logits.dispose(); probs.dispose();
    const avg = new Float32Array(1000);
    const tw = all.reduce((s, [, w]) => s + w, 0);
    p.forEach((row, v) => { const w = all[v][1] / tw; for (let i = 0; i < 1000; i++) avg[i] += row[i] * w; });
    return { probs: avg, emb };
  }

  /* All 1,000 answers → our item names and types */
  function interpret(probs, memory) {
    const names = {}, cats = {};
    for (let i = 0; i < 1000; i++) {
      const rule = ruleOf && ruleOf[i];
      if (!rule || probs[i] < 0.002) continue;
      const [, category, name, weight] = rule;
      const s = probs[i] * weight;
      const g = (names[name + "|" + category] = names[name + "|" + category] || { name, category, score: 0 });
      g.score += s;
      cats[category] = (cats[category] || 0) + s;
    }
    // Blend in what this device has learned (strong when a remembered photo is very similar)
    const memTotal = Object.values(memory.cats).reduce((s, v) => s + v, 0);
    const beta = Math.min(0.75, memTotal / 1.5);
    if (beta > 0) {
      Object.keys(cats).forEach((c) => (cats[c] *= 1 - beta));
      Object.values(names).forEach((g) => (g.score *= 1 - beta));
      Object.entries(memory.cats).forEach(([c, v]) => (cats[c] = (cats[c] || 0) + (beta * v) / memTotal));
      Object.entries(memory.names).forEach(([k, v]) => {
        const [name, category] = k.split("|");
        const g = (names[k] = names[k] || { name, category, score: 0, learned: true });
        g.score += (beta * v) / memTotal; g.learned = true;
      });
      // The learned type also lifts the model's best name inside that type
    }
    const catRank = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const guesses = Object.values(names).sort((a, b) => b.score - a.score);
    const topCat = catRank[0];
    let best = guesses[0] || null;
    // When the type is clear but the name isn't, use the best name of that type
    if (topCat && best && best.category !== topCat[0] && topCat[1] > best.score * 1.6) best = guesses.find((g) => g.category === topCat[0]) || best;
    const sure = !!best && (best.score >= 0.3 || (topCat && topCat[0] === best.category && topCat[1] >= 0.45));
    return { guesses: guesses.slice(0, 5), best: sure ? best : null, catScore: topCat ? topCat[1] : 0, confidence: best ? Math.max(best.score, topCat && topCat[0] === best.category ? topCat[1] : 0) : 0 };
  }

  /* ---------------- Online reading (optional) ----------------
     When the site is served by server/server.mjs with an API key, the photo is
     also described by Claude, which can read brands and printed text. Names and
     numbers it reads go to the private/special-details answer, never the public one.
     Opened from a file or without the server, this is skipped automatically. */
  let onlineProbe = null;
  function online() {
    if (!ORG.visionEndpoint || !/^https?:$/.test(location.protocol)) return Promise.resolve(false);
    if (!onlineProbe) onlineProbe = fetch("/api/health").then((r) => (r.ok ? r.json() : {})).then((j) => !!j.vision).catch(() => false);
    return onlineProbe;
  }
  async function describeOnline(dataUrl, kind) {
    try {
      const csrf = (window.LF_REMOTE_STATE && window.LF_REMOTE_STATE.csrf) || "";
      const res = await fetch(ORG.visionEndpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF": csrf }, body: JSON.stringify({ image: dataUrl, kind }) });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }

  /* ---------------- Public ---------------- */
  const METAL = ["keys", "accessories"];
  /** Looks at one photo or a list of photos (the first is the main one).
   *  @returns {Promise<{category?,itemName?,brand?,color,secondColor,description,uniqueDetails?,privateDetails?,guesses,recognized,confidence,level,learned,modelFailed}>} */
  async function analyze(photos, { kind = "lost" } = {}) {
    const list = (Array.isArray(photos) ? photos : [photos]).filter(Boolean).slice(0, 4);
    const img = await loadImage(list[0]);
    const seg = findItem(img);
    let { main: color, second } = itemColors(seg);
    let result = { guesses: [], best: null, confidence: 0 }, modelFailed = false, learned = false, emb = null;
    try {
      const model = await loadModel();
      // Main photo: 5 views. Other photos: 2 views each. The main photo counts most.
      const looks = [await look(model, img, seg, 5)];
      for (const url of list.slice(1)) { try { const im = await loadImage(url); looks.push(await look(model, im, findItem(im), 2)); } catch {} }
      emb = looks[0].emb;
      if (emb) embCache.set(list[0], emb);
      const probs = new Float32Array(1000);
      const weights = looks.map((_, i) => (i === 0 ? 1.6 : 1)), tw = weights.reduce((a, b) => a + b, 0);
      looks.forEach((l, k) => { for (let i = 0; i < 1000; i++) probs[i] += (l.probs[i] * weights[k]) / tw; });
      const memory = await recall(emb);
      result = interpret(probs, memory);
      learned = !!(result.best && result.best.learned) || memory.best >= 0.88;
    } catch (err) { modelFailed = true; console.warn("Photo recognition unavailable:", err); }

    // Printed text: brand, kind of ID, and other text (kept private)
    const text = await readText(img);
    const joined = text.join(" ");
    let brand = "", idName = "";
    if (joined) {
      const b = BRANDS.find((x) => new RegExp(`\\b${x.replace(/[-\s]/g, "[-\\s]?")}\\b`, "i").test(joined));
      if (b) brand = b === "iPhone" || b === "iPad" ? "Apple" : b;
      const id = ID_WORDS.find(([re]) => re.test(joined));
      if (id) idName = id[1];
    }
    let best = result.best;
    if (idName) best = { name: idName, category: "wallets", score: 0.9 };
    // Metal items: gray is silver and yellow is gold
    if (best && METAL.includes(best.category)) { if (color === "Gray") color = "Silver"; if (color === "Yellow" && chroma(seg.bgLab) < 0.2) color = "Gold"; }
    const details = text.length ? `${isFil() ? "Nakasulat sa gamit" : "Text on the item"}: ${maskNumbers(text.join(" · ")).slice(0, 300)}` : "";

    if (await online()) {
      const r = await describeOnline(list[0], kind);
      if (r && r.recognized) {
        const d = r.identifyingDetails || details;
        return {
          category: CATEGORIES.some((c) => c.id === r.category) ? r.category : best ? best.category : undefined,
          itemName: r.itemName, brand: r.brand || brand, color: COLORS.includes(r.color) ? r.color : color, secondColor: second,
          description: r.description || "",
          uniqueDetails: kind === "lost" ? d : "", privateDetails: kind === "found" ? d : "",
          guesses: result.guesses, recognized: true, confidence: 0.95, level: "high", learned, modelFailed, online: true,
        };
      }
    }
    const confidence = idName ? 0.9 : result.confidence;
    return {
      category: best ? best.category : undefined,
      itemName: best ? shown(best.name) : undefined,
      brand,
      color, secondColor: second,
      description: best ? describe(shown(best.name), color, second) : "",
      uniqueDetails: kind === "lost" ? details : "", privateDetails: kind === "found" ? details : "",
      guesses: result.guesses.map((g) => ({ ...g, name: shown(g.name) })), recognized: !!best, confidence, level: confidence >= 0.55 ? "high" : "medium", learned, modelFailed,
    };
  }

  /* "Black and red backpack." / "Itim at pulang backpack." */
  const linker = (w) => (/[aeiou]$/i.test(w) ? w + "ng" : /n$/i.test(w) ? w + "g" : w + " na");
  function describe(name, color, second) {
    if (isFil()) {
      const n = String(name || "").toLowerCase();
      if (color === "Multi-colored") return `${n.replace(/^./, (x) => x.toUpperCase())} na iba't iba ang kulay.`;
      if (!color || color === "Other" || !COLOR_FIL[color]) return n.replace(/^./, (x) => x.toUpperCase()) + ".";
      const c1 = COLOR_FIL[color], c2 = second && second !== color && COLOR_FIL[second];
      return `${c2 ? `${c1} at ${linker(c2.toLowerCase())}` : linker(c1)} ${n}.`.replace(/^./, (x) => x.toUpperCase());
    }
    const c = color && !["Other", "Multi-colored"].includes(color) ? color + (second && second !== color ? " and " + second.toLowerCase() : "") + " " : color === "Multi-colored" ? "Multi-colored " : "";
    return `${c}${String(name || "").toLowerCase()}`.replace(/^./, (x) => x.toUpperCase()) + ".";
  }

  /** Remember the right answer for these photos (called when a report is sent, or staff correct it).
   *  Staff answers count most; a lost item's photo may show a similar item, so it counts least. */
  async function learn({ photos, category, itemName, kind = "found", staff = false }) {
    try {
      if (!category || !CATEGORIES.some((c) => c.id === category)) return false;
      const url = (photos || []).find(Boolean);
      if (!url) return false;
      let emb = embCache.get(url);
      if (!emb) {
        if (!modelPromise && !staff) return false; // don't load the model only to learn on a visitor's device
        const model = await loadModel();
        const img = await loadImage(url);
        emb = (await look(model, img, findItem(img), 2)).emb;
      }
      if (!emb) return false;
      const list = await memAll();
      // The same photo again (e.g. a correction): replace the old answer
      const same = list.find((e) => dot(e.emb, emb) > 0.995);
      const example = { id: same ? same.id : "M" + Date.now() + Math.floor(Math.random() * 1e4), emb, category, name: safeName(itemName), w: staff ? 1 : kind === "found" ? 0.7 : 0.5, at: Date.now() };
      if (same) list.splice(list.indexOf(same), 1);
      await memPut(example);
      return true;
    } catch { return false; }
  }
  const memoryCount = async () => (await memAll()).length;
  async function forget() { memCache = []; try { indexedDB.deleteDatabase("qcpllf-photo-memory"); } catch {} }

  const colorWord = (c) => (isFil() && COLOR_FIL[c] ? COLOR_FIL[c] : c === "Multi-colored" && isFil() ? "iba't ibang kulay" : String(c || "")).toLowerCase();
  return { analyze, describe, learn, colorWord, online, memoryCount, forget, preload: () => loadModel().catch(() => {}),
    _test: { itemColors, findItem, nameLab, oklab, safeName, interpret, maskNumbers } };
})();
