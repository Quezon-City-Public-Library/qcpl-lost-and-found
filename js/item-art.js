/* ==========================================================================
   QCPL Lost & Found — item illustrations
   Draws a small picture of an item (wallet, key, phone, calculator…) in the
   item's own color, so people can picture it at a glance when there is no
   photo. The picture is chosen from the item's name, then its category.
   ========================================================================== */
window.ItemArt = (function () {
  "use strict";

  const COLOR_HEX = {
    Black: "#2b2f3a", White: "#f3f5f9", Gray: "#8b93a3", Brown: "#8a5a33", Beige: "#dcc7a3", Red: "#c8102e",
    Pink: "#ec7fa9", Orange: "#f08a24", Yellow: "#f2c230", Green: "#2f9e5b", Blue: "#2456c9", Purple: "#7b4fc4",
    Gold: "#d4a82a", Silver: "#b9c0cc", "Multi-colored": "#2456c9", Other: "#6b7a99",
  };
  const hex = (name) => COLOR_HEX[name] || COLOR_HEX.Other;

  // Mix a hex color toward white (amount > 0) or black (amount < 0)
  function shade(color, amount) {
    const n = parseInt(color.slice(1), 16);
    const mix = (c) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
    return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  /* Each drawing uses: C main color, D darker shade, L lighter shade,
     S silver (metal), K near-black, W white, H the card background (for holes). */
  const ART = {
    wallet: `<rect x="14" y="36" width="92" height="56" rx="10" fill="C" stroke="D" stroke-width="2"/>
      <path d="M14 50h92" stroke="D" stroke-width="2"/><path d="M22 84h62" stroke="L" stroke-width="2" stroke-dasharray="4 4"/>
      <rect x="74" y="54" width="34" height="20" rx="10" fill="D"/><circle cx="87" cy="64" r="4.5" fill="L"/>`,
    key: `<circle cx="20" cy="42" r="11" fill="none" stroke="S" stroke-width="4"/>
      <rect x="54" y="55" width="52" height="10" rx="3" fill="S"/><rect x="82" y="64" width="8" height="12" fill="S"/><rect x="95" y="64" width="8" height="9" fill="S"/>
      <circle cx="42" cy="60" r="21" fill="C" stroke="D" stroke-width="2"/><circle cx="36" cy="60" r="7" fill="H"/>`,
    phone: `<rect x="36" y="10" width="48" height="100" rx="10" fill="C" stroke="D" stroke-width="2"/>
      <rect x="41" y="18" width="38" height="80" rx="5" fill="K"/><path d="M41 60 79 26v-3a5 5 0 0 0-5-5H62z" fill="W" opacity=".12"/>
      <rect x="54" y="102" width="12" height="3" rx="1.5" fill="L"/><circle cx="60" cy="23" r="1.8" fill="L"/>`,
    tablet: `<rect x="22" y="14" width="76" height="92" rx="9" fill="C" stroke="D" stroke-width="2"/>
      <rect x="29" y="22" width="62" height="74" rx="4" fill="K"/><path d="M29 70 91 30v-4a4 4 0 0 0-4-4H62z" fill="W" opacity=".12"/><circle cx="60" cy="101" r="2.2" fill="L"/>`,
    laptop: `<rect x="24" y="24" width="72" height="50" rx="6" fill="C" stroke="D" stroke-width="2"/><rect x="30" y="30" width="60" height="38" rx="2" fill="K"/>
      <path d="M30 56 90 34v-2a2 2 0 0 0-2-2H62z" fill="W" opacity=".12"/><path d="M12 80h96l-6 12H18z" fill="D"/><rect x="50" y="83" width="20" height="3" rx="1.5" fill="L"/>`,
    tote: `<path d="M40 48C40 16 80 16 80 48" fill="none" stroke="D" stroke-width="6" stroke-linecap="round"/>
      <path d="M22 46h76l6 60H16z" fill="C" stroke="D" stroke-width="2" stroke-linejoin="round"/><path d="M30 60h60" stroke="L" stroke-width="2" stroke-dasharray="4 4"/>`,
    backpack: `<path d="M46 26c0-16 28-16 28 0" fill="none" stroke="D" stroke-width="6" stroke-linecap="round"/>
      <rect x="26" y="26" width="68" height="82" rx="20" fill="C" stroke="D" stroke-width="2"/>
      <rect x="37" y="64" width="46" height="32" rx="8" fill="D"/><path d="M37 74h46" stroke="L" stroke-width="2"/><path d="M40 42h40" stroke="L" stroke-width="3" stroke-linecap="round"/><rect x="57" y="70" width="6" height="9" rx="2" fill="L"/>`,
    idcard: `<path d="M46 4 58 40M74 4 62 40" stroke="C" stroke-width="5" stroke-linecap="round"/><rect x="54" y="36" width="12" height="8" rx="2" fill="S"/>
      <rect x="28" y="44" width="64" height="66" rx="7" fill="W" stroke="D" stroke-width="2"/><path d="M28 51a7 7 0 0 1 7-7h50a7 7 0 0 1 7 7v9H28z" fill="C"/>
      <circle cx="46" cy="78" r="9" fill="L"/><path d="M34 100c2-9 22-9 24 0z" fill="L"/><path d="M64 72h20M64 82h20M64 92h14" stroke="S" stroke-width="3" stroke-linecap="round"/>`,
    calculator: `<rect x="30" y="12" width="60" height="96" rx="9" fill="C" stroke="D" stroke-width="2"/><rect x="37" y="20" width="46" height="20" rx="3" fill="#cfe8d6"/>
      <path d="M62 34h16" stroke="K" stroke-width="2.5" stroke-linecap="round"/>
      <g fill="L"><rect x="37" y="48" width="9" height="8" rx="2"/><rect x="49.5" y="48" width="9" height="8" rx="2"/><rect x="62" y="48" width="9" height="8" rx="2"/>
      <rect x="37" y="61" width="9" height="8" rx="2"/><rect x="49.5" y="61" width="9" height="8" rx="2"/><rect x="62" y="61" width="9" height="8" rx="2"/>
      <rect x="37" y="74" width="9" height="8" rx="2"/><rect x="49.5" y="74" width="9" height="8" rx="2"/><rect x="62" y="74" width="9" height="8" rx="2"/>
      <rect x="37" y="87" width="21.5" height="8" rx="2"/><rect x="62" y="87" width="9" height="8" rx="2"/></g>
      <rect x="74.5" y="48" width="8.5" height="21" rx="2" fill="#f08a24"/><rect x="74.5" y="74" width="8.5" height="21" rx="2" fill="#c8102e"/>`,
    umbrella: `<rect x="58" y="58" width="4" height="40" fill="K"/><path d="M60 98c0 12-16 12-16 2" fill="none" stroke="K" stroke-width="4" stroke-linecap="round"/>
      <path d="M10 62a50 50 0 0 1 100 0c-8-9-17-9-25 0-8-9-17-9-25 0-8-9-17-9-25 0-8-9-17-9-25 0z" fill="C" stroke="D" stroke-width="2" stroke-linejoin="round"/>
      <path d="M60 12c-14 12-22 30-25 50M60 12c14 12 22 30 25 50M60 12v50" stroke="D" stroke-width="2" fill="none"/><circle cx="60" cy="11" r="3" fill="K"/>`,
    glasses: `<path d="M14 50 6 40M106 50l8-10" stroke="C" stroke-width="5" stroke-linecap="round"/><path d="M52 60c4-6 12-6 16 0" stroke="C" stroke-width="5" fill="none"/>
      <rect x="12" y="46" width="42" height="32" rx="14" fill="#cfe1ff" fill-opacity=".6" stroke="C" stroke-width="6"/>
      <rect x="66" y="46" width="42" height="32" rx="14" fill="#cfe1ff" fill-opacity=".6" stroke="C" stroke-width="6"/><path d="M22 58l8-6M76 58l8-6" stroke="W" stroke-width="3" stroke-linecap="round"/>`,
    flashdrive: `<rect x="82" y="48" width="26" height="24" rx="2" fill="S"/><rect x="92" y="54" width="6" height="5" fill="K" opacity=".5"/><rect x="92" y="62" width="6" height="5" fill="K" opacity=".5"/>
      <rect x="14" y="42" width="70" height="36" rx="9" fill="C" stroke="D" stroke-width="2"/><circle cx="26" cy="60" r="5" fill="H"/><rect x="40" y="54" width="32" height="12" rx="3" fill="W" opacity=".85"/>`,
    earphones: `<rect x="22" y="34" width="76" height="58" rx="22" fill="C" stroke="D" stroke-width="2"/><path d="M23 58h74" stroke="D" stroke-width="2"/>
      <circle cx="60" cy="72" r="3" fill="#2f9e5b"/><path d="M40 22c0 8 6 10 6 18M80 22c0 8-6 10-6 18" stroke="D" stroke-width="5" stroke-linecap="round" fill="none"/>
      <circle cx="40" cy="20" r="6" fill="C" stroke="D" stroke-width="2"/><circle cx="80" cy="20" r="6" fill="C" stroke="D" stroke-width="2"/>`,
    notebook: `<rect x="30" y="14" width="64" height="92" rx="6" fill="C" stroke="D" stroke-width="2"/><rect x="42" y="30" width="40" height="22" rx="3" fill="W"/>
      <path d="M48 38h28M48 45h18" stroke="S" stroke-width="3" stroke-linecap="round"/>
      <g stroke="K" stroke-width="3" stroke-linecap="round"><path d="M24 26h12M24 40h12M24 54h12M24 68h12M24 82h12M24 96h12"/></g>`,
    watch: `<rect x="47" y="6" width="26" height="108" rx="8" fill="D"/><circle cx="60" cy="60" r="27" fill="C" stroke="D" stroke-width="2"/><circle cx="60" cy="60" r="20" fill="W"/>
      <path d="M60 46v14l10 6" stroke="K" stroke-width="3" stroke-linecap="round" fill="none"/><rect x="86" y="56" width="6" height="8" rx="2" fill="D"/>`,
    tumbler: `<rect x="36" y="14" width="48" height="14" rx="5" fill="D"/><path d="M39 28h42l-5 80H44z" fill="C" stroke="D" stroke-width="2" stroke-linejoin="round"/>
      <path d="M47 38l3 60" stroke="L" stroke-width="5" stroke-linecap="round" opacity=".7"/><rect x="50" y="8" width="20" height="8" rx="3" fill="K"/>`,
    powerbank: `<rect x="30" y="16" width="60" height="92" rx="10" fill="C" stroke="D" stroke-width="2"/><path d="M64 40 50 64h10l-4 18 14-24H60z" fill="#f2c230"/>
      <g fill="L"><circle cx="48" cy="96" r="2.5"/><circle cx="56" cy="96" r="2.5"/><circle cx="64" cy="96" r="2.5"/><circle cx="72" cy="96" r="2.5" opacity=".4"/></g>`,
    clothing: `<path d="M42 16c6 8 30 8 36 0l26 14-10 22-12-6v58H38V46l-12 6-10-22z" fill="C" stroke="D" stroke-width="2" stroke-linejoin="round"/>
      <path d="M60 22v82" stroke="D" stroke-width="2"/><path d="M42 16c6 12 30 12 36 0" fill="none" stroke="D" stroke-width="2"/>`,
    necklace: `<path d="M24 20c0 50 72 50 72 0" fill="none" stroke="C" stroke-width="4" stroke-linecap="round" stroke-dasharray="1 7"/>
      <path d="M24 20c0 50 72 50 72 0" fill="none" stroke="D" stroke-width="1.5" opacity=".5"/><path d="M60 58l9 14-9 18-9-18z" fill="C" stroke="D" stroke-width="2" stroke-linejoin="round"/>`,
    helmet: `<path d="M16 72a44 44 0 0 1 88 0v10H16z" fill="C" stroke="D" stroke-width="2" stroke-linejoin="round"/><path d="M58 60h46v14H52z" fill="K" opacity=".85"/>
      <rect x="12" y="80" width="96" height="10" rx="5" fill="D"/><path d="M34 44c8-10 22-14 34-12" stroke="L" stroke-width="4" stroke-linecap="round" fill="none"/>`,
    book: `<path d="M22 20h66a8 8 0 0 1 8 8v72H30a8 8 0 0 1-8-8z" fill="C" stroke="D" stroke-width="2"/><path d="M22 92a8 8 0 0 1 8-8h66v16H30a8 8 0 0 1-8-8z" fill="W" stroke="D" stroke-width="2"/>
      <path d="M38 38h40M38 50h28" stroke="L" stroke-width="4" stroke-linecap="round"/>`,
    box: `<path d="M60 12 104 34v52L60 108 16 86V34z" fill="C" stroke="D" stroke-width="2" stroke-linejoin="round"/><path d="M16 34l44 22 44-22M60 56v52" stroke="D" stroke-width="2" fill="none"/>
      <path d="M38 23l44 22v14" stroke="L" stroke-width="5" fill="none"/>`,
  };

  // First match wins, so put the more specific words first
  const BY_NAME = [
    [/calculator/, "calculator"], [/flash ?drive|usb/, "flashdrive"], [/power ?bank/, "powerbank"],
    [/ear(phone|bud|pod)|headset|airpod/, "earphones"], [/laptop|notebook computer/, "laptop"], [/tablet|ipad/, "tablet"],
    [/\bid\b|lanyard|card holder|atm card/, "idcard"], [/wallet|purse|coin/, "wallet"],
    [/phone|smartphone|mobile/, "phone"], [/key/, "key"],
    [/back ?pack/, "backpack"], [/tote|bag|pouch|sling/, "tote"],
    [/umbrella/, "umbrella"], [/glass|spectacle|shades/, "glasses"], [/watch/, "watch"], [/necklace|bracelet|jewel|ring\b/, "necklace"],
    [/tumbler|bottle|flask|jug/, "tumbler"], [/helmet/, "helmet"],
    [/jacket|gown|uniform|shirt|hoodie|sweater|cloth/, "clothing"],
    [/notebook|module|binder|yellow pad/, "notebook"], [/book/, "book"],
  ];
  const BY_CATEGORY = { phones: "phone", wallets: "wallet", bags: "tote", keys: "key", books: "notebook", accessories: "glasses", others: "box" };

  function kind(item) {
    const name = String(item.title || item.itemName || "").toLowerCase();
    const hit = BY_NAME.find(([re]) => re.test(name));
    return hit ? hit[1] : BY_CATEGORY[item.category] || "box";
  }

  /** SVG picture of the item, in its own color. `bg` is the card background (used for cut-outs). */
  function svg(item, bg = "#eef1f8") {
    const c = hex(item.color);
    const light = item.color === "White" || item.color === "Beige";
    const tokens = { C: c, D: shade(c, light ? -0.22 : -0.3), L: shade(c, light ? -0.1 : 0.45), S: "#b9c0cc", K: "#232838", W: "#ffffff", H: bg };
    const body = ART[kind(item)].replace(/"(C|D|L|S|K|W|H)"/g, (_, k) => `"${tokens[k]}"`);
    return `<svg class="item-art" viewBox="0 0 120 120" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  return { svg, hex, kind };
})();
