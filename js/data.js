/* ==========================================================================
   QCPL Lost & Found — Quezon City Public Library
   Configuration and reference lists. (No sample records — the site starts empty.)
   ========================================================================== */

/* ---- Details shared by every library ---- */
const ORG = {
  name: "Quezon City Public Library",
  short: "QCPL",
  website: "https://qcpl.quezoncity.gov.ph/",
  social: {
    facebook: "https://www.facebook.com/quezoncitypubliclibrary",
    youtube: "https://www.youtube.com/@qcpubliclibrary",
    instagram: "https://www.instagram.com/qcpubliclibrary",
    tiktok: "https://www.tiktok.com/@quezoncitypubliclibrary",
    twitter: "https://twitter.com/qcpubliclibrary",
  },
  holdDays: 30,        // how long unclaimed items are kept
  remindDaysBefore: 5, // owners with a possible match are reminded this many days before the limit

  /* Online photo reading (optional). When the site is opened through
     server/server.mjs with an API key set, photos are also described by Claude,
     which can read brands and text. Leave "" to use only the on-device model. */
  visionEndpoint: "/api/describe-item",

  /* 6-digit code when someone creates an account (or changes their mobile number).
     Off for now: accounts work right away. Turn on (true) once email or SMS sending
     is set up in server/.env. While a number isn't confirmed, the account sees only
     what it made itself, never reports found by matching the mobile number; the desk
     confirms the number when it checks a valid ID (Users → Verify). */
  signupCode: false,

  /* PRIVACY (Data Privacy Act of 2012). The Privacy Policy page is built from these.
     QCPL must confirm every value, name its Data Protection Officer, then set
     approved: true (the "draft" note on the page then disappears). */
  privacy: {
    approved: false,
    dpoName: "",          // e.g. "Juan dela Cruz, Data Protection Officer"
    dpoEmail: "",         // e.g. "dpo@qcpl.quezoncity.gov.ph"
    // How long personal information is kept. After this, it is erased automatically every night.
    closedRecordsDays: 365,     // reports, found items and claims: after they are closed or the item was returned / donated
    notificationsDays: 365,     // the updates sent to people
    activityLogDays: 730,       // the staff activity log (who did what)
    inactiveAccountsDays: 730,  // user accounts nobody has signed in to
    backupDays: 60,             // the longest any backup copy is kept (see BACKUP_COPY_KEEP)
  },
};

/* ---- THE LIBRARY PORTALS -------------------------------------------------
   The Main Library and each of the six districts has its own separate Lost &
   Found: its own reports, found items, matching, user accounts and
   administrator. Nothing is shared between portals. Inside a portal, every
   report says which branch it belongs to ("branches", the first one is where
   the Lost & Found desk is).

   Branch names, the Main Library address, phone, email and opening hours are
   from qcpl.quezoncity.gov.ph. TODO (confirm with QCPL): the exact desk
   location in each library, and each district's own phone number and street
   address — the Main Library's phone and email are used for now. */
const LIBRARIES = [
  { id: "main", code: "ML", libraryName: "QCPL Main Library", shortName: "Main Library", note: "City Hall Compound, Diliman · includes the Book Nook",
    address: "Gate 3, City Hall Compound, Diliman, Quezon City, 1100 Metro Manila",
    deskLocation: "Lost & Found Desk, Ground Floor Lobby, QCPL Main Library",
    deskLandmark: "Enter the Quezon City Hall Compound through Gate 3. The Main Library is the building with the wide front steps; ask the guard at the lobby for the Lost & Found Desk.",
    hours: "8:00 AM – 7:00 PM", hoursNote: "Monday to Friday · Saturday 8:00 AM – 4:00 PM",
    phone: "(02) 8922 4060", phoneHref: "tel:+63289224060", email: "qcplibrary@quezoncity.gov.ph",
    mapsUrl: "https://www.google.com/maps/dir/?api=1&destination=14.6474955,121.0506134", mapsPlace: "https://www.google.com/maps/search/?api=1&query=14.6474955,121.0506134",
    mapsEmbed: "https://maps.google.com/maps?q=14.6474955,121.0506134&z=17&output=embed",
    branches: ["QCPL Main Library", "Book Nook – WalterMart North EDSA"] },
  { id: "d1", code: "D1", libraryName: "District 1 Libraries", shortName: "District 1", note: "6 branches · Project 8 and Balingasa are under renovation",
    address: "Project 7 Branch, District 1, Quezon City",
    deskLocation: "Lost & Found Desk, Project 7 Branch",
    deskLandmark: "Ask the librarian at the front desk of the Project 7 Branch. Items found in other District 1 branches are kept at the branch where they were turned in.",
    hours: "9:00 AM – 6:00 PM", hoursNote: "Monday to Friday · Saturday 8:00 AM – 4:00 PM · other branches Monday to Friday, 8:00 AM – 5:00 PM",
    phone: "(02) 8922 4060", phoneHref: "tel:+63289224060", email: "qcplibrary@quezoncity.gov.ph",
    mapsUrl: "https://www.google.com/maps/dir/?api=1&destination=14.6535111,121.0247045", mapsPlace: "https://www.google.com/maps/search/?api=1&query=14.6535111,121.0247045",
    mapsEmbed: "https://maps.google.com/maps?q=14.6535111,121.0247045&z=17&output=embed",
    branches: ["Project 7 Branch","Masambong Branch","Nayong Kanluran Branch","Sto. Cristo Branch","District Library – Project 8 Branch (under renovation)","Balingasa Branch (under renovation)"] },
  { id: "d2", code: "D2", libraryName: "District 2 Libraries", shortName: "District 2", note: "4 branches",
    address: "District Library – Payatas Lupang Pangako Branch, District 2, Quezon City",
    deskLocation: "Lost & Found Desk, District Library – Payatas Lupang Pangako Branch",
    deskLandmark: "Ask the librarian at the front desk of the District Library – Payatas Lupang Pangako Branch. Items found in other District 2 branches are kept at the branch where they were turned in.",
    hours: "9:00 AM – 6:00 PM", hoursNote: "Monday to Friday · Saturday 8:00 AM – 4:00 PM · other branches Monday to Friday, 8:00 AM – 5:00 PM",
    phone: "(02) 8922 4060", phoneHref: "tel:+63289224060", email: "qcplibrary@quezoncity.gov.ph",
    mapsUrl: "https://www.google.com/maps/dir/?api=1&destination=14.7187708,121.1070459", mapsPlace: "https://www.google.com/maps/search/?api=1&query=14.7187708,121.1070459",
    mapsEmbed: "https://maps.google.com/maps?q=14.7187708,121.1070459&z=17&output=embed",
    branches: ["District Library – Payatas Lupang Pangako Branch","Bagong Silangan Branch","Holy Spirit Branch","MRB Commonwealth Branch"] },
  { id: "d3", code: "D3", libraryName: "District 3 Libraries", shortName: "District 3", note: "6 branches",
    address: "District Library – Greater Project 4 Branch, District 3, Quezon City",
    deskLocation: "Lost & Found Desk, District Library – Greater Project 4 Branch",
    deskLandmark: "Ask the librarian at the front desk of the District Library – Greater Project 4 Branch. Items found in other District 3 branches are kept at the branch where they were turned in.",
    hours: "9:00 AM – 6:00 PM", hoursNote: "Monday to Friday · Saturday 8:00 AM – 4:00 PM · other branches Monday to Friday, 8:00 AM – 5:00 PM",
    phone: "(02) 8922 4060", phoneHref: "tel:+63289224060", email: "qcplibrary@quezoncity.gov.ph",
    mapsUrl: "https://www.google.com/maps/dir/?api=1&destination=14.6229976,121.0680902", mapsPlace: "https://www.google.com/maps/search/?api=1&query=14.6229976,121.0680902",
    mapsEmbed: "https://maps.google.com/maps?q=14.6229976,121.0680902&z=17&output=embed",
    branches: ["District Library – Greater Project 4 Branch","Camp Aguinaldo Branch","Escopa 2 Branch","Libis Branch","Matandang Balara Branch","Milagrosa Branch"] },
  { id: "d4", code: "D4", libraryName: "District 4 Libraries", shortName: "District 4", note: "7 branches",
    address: "District Library – Roxas Branch, District 4, Quezon City",
    deskLocation: "Lost & Found Desk, District Library – Roxas Branch",
    deskLandmark: "Ask the librarian at the front desk of the District Library – Roxas Branch. Items found in other District 4 branches are kept at the branch where they were turned in.",
    hours: "9:00 AM – 6:00 PM", hoursNote: "Monday to Friday · Saturday 8:00 AM – 4:00 PM · other branches Monday to Friday, 8:00 AM – 5:00 PM",
    phone: "(02) 8922 4060", phoneHref: "tel:+63289224060", email: "qcplibrary@quezoncity.gov.ph",
    mapsUrl: "https://www.google.com/maps/dir/?api=1&destination=14.6283734,121.0206531", mapsPlace: "https://www.google.com/maps/search/?api=1&query=14.6283734,121.0206531",
    mapsEmbed: "https://maps.google.com/maps?q=14.6283734,121.0206531&z=17&output=embed",
    branches: ["District Library – Roxas Branch","Cubao Branch","Krus Na Ligas Branch","Pinagkaisahan Branch","San Isidro-Galas Branch","UP Pook Amorsolo Branch","UP Pook Dagohoy Branch"] },
  { id: "d5", code: "D5", libraryName: "District 5 Libraries", shortName: "District 5", note: "4 branches",
    address: "District Library – Lagro Branch, District 5, Quezon City",
    deskLocation: "Lost & Found Desk, District Library – Lagro Branch",
    deskLandmark: "Ask the librarian at the front desk of the District Library – Lagro Branch. Items found in other District 5 branches are kept at the branch where they were turned in.",
    hours: "9:00 AM – 6:00 PM", hoursNote: "Monday to Friday · Saturday 8:00 AM – 4:00 PM · other branches Monday to Friday, 8:00 AM – 5:00 PM",
    phone: "(02) 8922 4060", phoneHref: "tel:+63289224060", email: "qcplibrary@quezoncity.gov.ph",
    mapsUrl: "https://www.google.com/maps/dir/?api=1&destination=14.7263305,121.0665764", mapsPlace: "https://www.google.com/maps/search/?api=1&query=14.7263305,121.0665764",
    mapsEmbed: "https://maps.google.com/maps?q=14.7263305,121.0665764&z=17&output=embed",
    branches: ["District Library – Lagro Branch","North Fairview Branch","Sta. Lucia Branch","Pasong Putik Branch"] },
  { id: "d6", code: "D6", libraryName: "District 6 Libraries", shortName: "District 6", note: "6 branches",
    address: "District Library – Pasong Tamo Branch, District 6, Quezon City",
    deskLocation: "Lost & Found Desk, District Library – Pasong Tamo Branch",
    deskLandmark: "Ask the librarian at the front desk of the District Library – Pasong Tamo Branch. Items found in other District 6 branches are kept at the branch where they were turned in.",
    hours: "8:00 AM – 5:00 PM", hoursNote: "Monday to Friday · Villilia Digital Hub: Monday to Friday 9:00 AM – 6:00 PM, Saturday 8:00 AM – 4:00 PM",
    phone: "(02) 8922 4060", phoneHref: "tel:+63289224060", email: "qcplibrary@quezoncity.gov.ph",
    mapsUrl: "https://www.google.com/maps/dir/?api=1&destination=14.682032,121.0693249", mapsPlace: "https://www.google.com/maps/search/?api=1&query=14.682032,121.0693249",
    mapsEmbed: "https://maps.google.com/maps?q=14.682032,121.0693249&z=17&output=embed",
    branches: ["District Library – Pasong Tamo Branch","Casanova Branch (formerly Culiat)","Sagana Homes 1 Branch","Talipapa Branch","Tandang Sora Branch","Villilia Digital Hub"] },
];

/* Regular hours of each portal's main (hub) library, 24-hour clock, Philippine time.
   Used for the "Open now / Closed now" light on the library chooser. Holidays are not included. */
const OPEN_HOURS = {
  main: { wk: [8, 19], sat: [8, 16] },
  d1: { wk: [9, 18], sat: [8, 16] }, d2: { wk: [9, 18], sat: [8, 16] }, d3: { wk: [9, 18], sat: [8, 16] },
  d4: { wk: [9, 18], sat: [8, 16] }, d5: { wk: [9, 18], sat: [8, 16] },
  d6: { wk: [8, 17], sat: null },
};

/* Dates and times follow the language the visitor chose (see js/i18n.js) */
const uiLocale = () => (typeof I18N !== "undefined" && I18N.lang === "fil" ? "fil-PH" : "en-PH");

/* Which library portal is in use on this device */
const LIBRARY_KEY = "qcpllf_library";
const STAFF_SESSION_KEY = "qcpllf_staff";
let LIBRARY_MEMORY = null;   // the choice, kept here too in case the browser will not save it
let LIBRARY_OVERRIDE = null; // lets internal code work on one library's records at a time
function selectedLibraryId() {
  try { const v = localStorage.getItem(LIBRARY_KEY); return LIBRARIES.some((c) => c.id === v) ? v : LIBRARY_MEMORY; } catch { return LIBRARY_MEMORY; }
}
function setSelectedLibrary(id) {
  if (!LIBRARIES.some((c) => c.id === id)) return;
  LIBRARY_MEMORY = id;
  try { localStorage.setItem(LIBRARY_KEY, id); } catch {}
}
function staffLibraryId() {
  try { const s = JSON.parse(sessionStorage.getItem(STAFF_SESSION_KEY) || "null"); return s && s.library && s.library !== "all" ? s.library : null; } catch { return null; }
}
/* A library administrator is always inside their own portal; everyone else uses the chosen portal. */
function activeLibrary() {
  const id = LIBRARY_OVERRIDE || staffLibraryId() || selectedLibraryId() || LIBRARIES[0].id;
  return LIBRARIES.find((c) => c.id === id);
}
/* LIBRARY.x reads the current portal's detail, falling back to the shared one. */
const LIBRARY = new Proxy({}, { get: (_, key) => { const c = activeLibrary(); return key in c ? c[key] : ORG[key]; } });

/* ---- ACCOUNT TYPES ----------------------------------------------------
   1. ADMINISTRATOR — one per portal. Sees and manages everything that comes
      in for THEIR portal only. The QCPL administrator ("all") can switch
      between all seven portals.
   2. USER (library member or visitor) — belongs to one portal and sees only
      their own reports, claims, updates and certificates.
   DEMO ONLY: these checks run in the browser. Move sign-in to a server before launch.

   Administrator accounts. Password hash = SHA-256("lf-staff:" + password). See README. ---- */
const STAFF_ACCOUNTS = [
  { username: "admin", library: "all", name: "QCPL L&F Head Administrator", role: "QCPL Administrator",
    passHash: "6123ac2122b41b988f50af82f5d12ebaf8961a122795464e2945a13e91e847e0" },
  { username: "mainadmin", library: "main", name: "Main Library L&F Administrator", role: "Library Administrator",
    passHash: "46161543b707a39f6ab5324de0a34f5f115450e100135cbd878c75351096def2" },
  { username: "d1admin", library: "d1", name: "District 1 L&F Administrator", role: "District Administrator",
    passHash: "9b69185c183822208b4c6118bae8bf7780fa0b5d29f887686b42f8d05128aa98" },
  { username: "d2admin", library: "d2", name: "District 2 L&F Administrator", role: "District Administrator",
    passHash: "4aaed116370127714e8dfde8561e90fb061763640a36d2aed8a88a48f7a2ed55" },
  { username: "d3admin", library: "d3", name: "District 3 L&F Administrator", role: "District Administrator",
    passHash: "4a98ee7cfe1649d00bf45db12231940c9899a220b67ff4e1dbc3d6596543a59f" },
  { username: "d4admin", library: "d4", name: "District 4 L&F Administrator", role: "District Administrator",
    passHash: "30411ba7d97ecbc19e72186969fed089dca46655596387e715b3965b88523dc3" },
  { username: "d5admin", library: "d5", name: "District 5 L&F Administrator", role: "District Administrator",
    passHash: "424add0a49c19fabff15b922b1b4bed579ae598076d02f02f28e1a070b5dcd25" },
  { username: "d6admin", library: "d6", name: "District 6 L&F Administrator", role: "District Administrator",
    passHash: "5e236fc9385ac9b0e42f0c4d553c288c1bba73fd54dc4b5d697459feaca16265" },
  { username: "qcpladmin", library: "all", name: "QCPL L&F Administrator", role: "QCPL Administrator",
    passHash: "e5ed922bb0fc9e7ea52c745fc30b4e868d5c75622b25be45556a1adcc08ba833" },
];

const CATEGORIES = [
  { id: "phones",      name: "Phones & Gadgets", icon: "i-phone",   tone: "blue", hint: "Phones, laptops, tablets, earphones, chargers, flash drives",
    question: "Describe the case, lock-screen picture, or any cracks or stickers." },
  { id: "wallets",     name: "IDs & Wallets",    icon: "i-wallet",  tone: "blue", hint: "QCitizen IDs, library cards, school IDs, wallets, ATM cards",
    question: "What cards or IDs are inside? Whose name is on them?" },
  { id: "bags",        name: "Bags",             icon: "i-bag",     tone: "blue", hint: "Backpacks, tote bags, sling bags, laptop bags, pouches",
    question: "What was inside the bag? Any keychain, pin, name tag or damage?" },
  { id: "keys",        name: "Keys",             icon: "i-key",     tone: "blue", hint: "House keys, motorcycle keys, locker keys",
    question: "How many keys are there, and what does the keychain look like?" },
  { id: "books",       name: "Books & Study Materials", icon: "i-book", tone: "blue", hint: "Personal books, notebooks, reviewers, calculators, pens",
    question: "Is there a name or a note written on it? Describe any marks, tabs or highlights inside." },
  { id: "accessories", name: "Accessories",      icon: "i-glasses", tone: "blue", hint: "Eyeglasses, watches, jewelry, caps",
    question: "Any engraving, brand mark, case or special detail?" },
  { id: "others",      name: "Other Items",      icon: "i-box",     tone: "blue", hint: "Tumblers, umbrellas, jackets, lunch boxes, helmets",
    question: "Any marks, stickers, names or special details only you would know?" },
];

/* Standard places inside a library — choosing from a list (instead of typing)
   keeps names consistent and makes matching more accurate. */
const LOCATIONS = [
  "Entrance / Lobby",
  "Baggage Counter / Lockers",
  "Reading Area",
  "Children's Section",
  "Reference / Filipiniana Section",
  "Computer / Internet Area",
  "Study / Conference Room",
  "Circulation / Front Desk",
  "Restrooms",
  "Stairs, Elevator & Hallways",
  "Outside / Parking Area",
  "I'm not sure",
];

const FLOORS = ["Ground Floor", "2nd Floor", "3rd Floor", "Outdoor area", "I'm not sure"];

const COLORS = ["Black", "White", "Gray", "Brown", "Beige", "Red", "Pink", "Orange", "Yellow", "Green", "Blue", "Purple", "Gold", "Silver", "Multi-colored", "Other"];

const USER_ROLES = ["Library member", "Student / Researcher", "Visitor", "Library staff"];

const ID_TYPES = ["QCitizen ID", "QCPL Library Card", "School ID", "PhilSys National ID", "Driver's License", "Passport", "UMID / SSS ID", "Postal ID", "Voter's ID", "Senior Citizen / PWD ID", "Other valid ID"];

/* ---- Status steps (from the Lost & Found System proposal) ---- */
const FLOWS = {
  lost:   ["reported", "searching", "possible-match", "claim-submitted", "under-verification", "ready", "returned"],
  found:  ["found", "recorded", "possible-owner", "claimed", "verified", "returned"],
  claims: ["submitted", "under-verification", "approved", "returned"],
};

const STATUS = {
  lost: {
    "reported":           { label: "Reported",            tone: "amber", help: "We received your report." },
    "searching":          { label: "Searching",           tone: "amber", help: "We are checking every item turned in." },
    "possible-match":     { label: "Possible match",      tone: "green", help: "A found item looks like yours. Please take a look." },
    "claim-submitted":    { label: "Claim submitted",     tone: "amber", help: "We received your claim." },
    "under-verification": { label: "Under verification",  tone: "amber", help: "The office is checking your answers." },
    "ready":              { label: "Ready for pick-up",   tone: "green", help: "Bring a valid ID to the Lost & Found Office." },
    "returned":           { label: "Returned",            tone: "gray",  help: "The item was given back to you." },
    "closed":             { label: "Closed",              tone: "gray",  help: "This report is closed." },
  },
  found: {
    "found":              { label: "Found — on its way to the office", tone: "amber", help: "The finder is turning it over to the office." },
    "recorded":           { label: "Recorded at the office", tone: "green", help: "Safely kept at the Lost & Found Office." },
    "possible-owner":     { label: "Possible owner identified", tone: "green", help: "Someone reported losing a similar item." },
    "claimed":            { label: "Claimed — being checked", tone: "amber", help: "Someone has claimed this. The office is checking." },
    "verified":           { label: "Verified — ready for pick-up", tone: "green", help: "The owner has been confirmed." },
    "returned":           { label: "Returned to owner",   tone: "gray",  help: "Back with its owner." },
    "disposed":           { label: "Donated / disposed",  tone: "gray",  help: `Unclaimed after ${LIBRARY.holdDays} days.` },
  },
  claims: {
    "submitted":          { label: "Claim submitted",     tone: "amber", help: "We received your claim." },
    "under-verification": { label: "Under verification",  tone: "amber", help: "The office is checking your answers." },
    "approved":           { label: "Approved — ready for pick-up", tone: "green", help: "Bring a valid ID to the office." },
    "rejected":           { label: "Not approved",        tone: "gray",  help: "The details did not match." },
    "returned":           { label: "Returned",            tone: "gray",  help: "The item was given back." },
  },
};

/* ---- Finder recognition: badges earned for items returned to their owners ---- */
const BADGES = [
  { min: 1, name: "Good Samaritan",       icon: "i-hand",   desc: "Returned your first item to its owner" },
  { min: 3, name: "Honest Hero",          icon: "i-shield", desc: "Helped 3 people get their belongings back" },
  { min: 5, name: "QCPL Honesty Champion", icon: "i-award",  desc: "Helped 5 or more people — thank you!" },
];

/* ---- Monthly recognition ----
   (There are no rewards: the library is a government office and takes no part
   in payments between owners and finders.)
   CERTIFICATE OF CONTRIBUTION: each month, a person qualifies with at least
   CONTRIB_MIN lost reports of their own, or CONTRIB_MIN found items that were
   returned to their owners. The administrator checks and issues it. */
const CONTRIB_MIN = 2;

/* ---- Words that mean the same thing (English, Filipino and everyday words) ----
   Used by search and by smart matching, so "payong" finds "umbrella" and
   "cellphone" matches "phone". The first word of each group is the main one.
   Add more groups here; single words only. */
const SYNONYMS = [
  ["phone", "cellphone", "cellphones", "cell", "cp", "mobile", "smartphone", "selpon", "telepono", "iphone", "android"],
  ["umbrella", "payong", "umbrellas"],
  ["keys", "key", "susi", "keychain", "keyring"],
  ["wallet", "pitaka", "coin", "purse", "billfold"],
  ["bag", "bags", "backpack", "bagpack", "knapsack", "sling", "tote", "bayong"],
  ["eyeglasses", "glasses", "salamin", "specs", "spectacles", "sunglasses", "shades"],
  ["id", "ids", "identification", "card"],
  ["tumbler", "bottle", "jug", "flask", "lalagyan", "aquaflask", "hydroflask"],
  ["jacket", "dyaket", "hoodie", "sweater", "coat"],
  ["earphones", "earphone", "earbuds", "earpods", "headset", "headphones", "airpods"],
  ["charger", "charging", "adapter", "powerbank", "cable"],
  ["book", "books", "libro", "aklat", "novel"],
  ["notebook", "notebooks", "kuwaderno", "kwaderno", "notes", "journal"],
  ["money", "pera", "cash", "bills"],
  ["watch", "relo", "smartwatch"],
  ["ring", "singsing"],
  ["necklace", "kwintas", "kuwintas", "pendant"],
  ["bracelet", "pulseras"],
  ["shoes", "sapatos", "sneakers"],
  ["slippers", "tsinelas", "sandals"],
  ["cap", "hat", "sumbrero", "sombrero"],
  ["laptop", "notebookpc", "macbook", "chromebook"],
  ["tablet", "ipad"],
  ["calculator", "calcu"],
  ["pen", "ballpen", "bolpen", "pencil", "lapis"],
  ["lunchbox", "baunan", "lunch"],
  ["helmet", "helmets"],
  ["shirt", "damit", "tshirt", "blouse", "polo"],
  ["black", "itim"], ["white", "puti"], ["red", "pula"], ["blue", "asul", "bughaw"], ["green", "berde", "luntian"],
  ["yellow", "dilaw"], ["brown", "kayumanggi", "tsokolate"], ["gray", "grey", "abo", "kulay-abo"], ["pink", "rosas"],
  ["orange", "kahel"], ["purple", "lila", "ube", "violet"], ["silver", "pilak"], ["gold", "ginto"], ["beige", "krema", "cream", "khaki"],
  // Words the photo helper fills in (English and Filipino), so reports in either language still match
  ["documents", "document", "dokumento", "papers", "papel", "envelope", "sobre", "folder"],
  ["towel", "tuwalya", "handkerchief", "panyo", "bimpo"],
  ["belt", "sinturon"], ["necktie", "tie", "kurbata"], ["clip", "ipit", "hairclip", "headband"],
  ["camera", "kamera"], ["toy", "toys", "laruan"], ["ball", "bola"], ["cane", "tungkod", "crutch", "saklay"],
  ["medicine", "gamot", "meds", "vitamins"], ["fan", "bentilador", "minifan"], ["piggybank", "alkansiya", "alkansya"],
  ["license", "lisensiya", "lisensya"], ["passport", "pasaporte"], ["box", "kahon"], ["plastic", "supot", "plastik"],
  ["cup", "baso", "mug", "tasa"], ["mask", "facemask"], ["flashlight", "torch", "flashlite"], ["mouse"], ["controller", "joystick", "gamepad"],
];

/* Pick-up appointments: how many people may book the same hour at one library */
const PICKUP_SLOT_CAP = 4;
const PICKUP_DAYS_AHEAD = 7;

/* Staff roles. Supervisors (the built-in administrator accounts, or staff given
   this role) can also manage staff, issue certificates, dispose of items and
   clear records. Desk staff do the daily work. */
const STAFF_ROLES = ["Desk staff", "Supervisor"];

/* Items with these statuses appear in the public "Found items" list */
const PUBLIC_FOUND = ["recorded", "possible-owner", "claimed"];

/* ---- Date helpers ---- */
function daysAgo(n, hour) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  if (hour != null) { d.setHours(hour, (n * 17) % 60, 0, 0); return d.toISOString(); }
  return toISODate(d);
}
function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

