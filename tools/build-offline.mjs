// Builds ONE self-contained HTML file (styles, scripts, fonts, images and the
// photo-recognition model embedded) that opens by double-click with no internet and no server.
// Usage: node tools/build-offline.mjs
import { readFile, writeFile, stat } from "node:fs/promises";

const OUT = "QCPL-Lost-and-Found-OFFLINE.html";
const b64 = async (path) => (await readFile(path)).toString("base64");
const swap = (html, find, replacement) => {
  if (!html.includes(find)) throw new Error(`Not found in index.html: ${find}`);
  return html.split(find).join(replacement);
};
// Keep inline scripts from ending early
const safeScript = (code) => code.replace(/<\/script/gi, "<\\/script");

let html = await readFile("index.html", "utf8");

// 1. Fonts → data URIs
let fonts = await readFile("css/fonts.css", "utf8");
for (const [, file] of fonts.matchAll(/url\("\.\.\/assets\/fonts\/([^"]+)"\)/g)) {
  fonts = fonts.replace(`url("../assets/fonts/${file}")`, `url(data:font/woff2;base64,${await b64(`assets/fonts/${file}`)}) format("woff2")`);
}
fonts = fonts.replace(/\)\s*format\('woff2'\)/g, ")"); // avoid a duplicate format() hint
html = swap(html, `<link rel="stylesheet" href="css/fonts.css" />`, `<style>\n${fonts}\n</style>`);

// 2. Styles
html = swap(html, `<link rel="stylesheet" href="css/styles.css" />`, `<style>\n${await readFile("css/styles.css", "utf8")}\n</style>`);

// 3. Images (favicon, hero photo), then the scripts
html = swap(html, `href="assets/qcpl-favicon.png"`, `href="data:image/png;base64,${await b64("assets/qcpl-favicon.png")}"`);
html = swap(html, `src="assets/qcpl-favicon.png"`, `src="data:image/png;base64,${await b64("assets/qcpl-favicon.png")}"`);
html = html.replace(/\s*<meta property="og:image"[^>]*>/, ""); // no web address in the offline file
const assets = {
  "assets/qcpl-hero.jpg": { type: "image/jpeg", b64: await b64("assets/qcpl-hero.jpg") },
};
let assetScript = `<script>window.OFFLINE_ASSETS = ${JSON.stringify(assets)};</script>`;

// Photo-recognition library + model: embedded as plain text (not run at page
// load). js/photo-ai.js turns them into scripts only when a photo is added.
for (const path of ["assets/ai/tf.min.js", "assets/ai/mobilenet-model.js", "assets/ai/imagenet-labels.js"]) {
  assetScript += `\n  <script type="text/plain" data-asset="${path}">${safeScript(await readFile(path, "utf8"))}</script>`;
}

// QR code library (MIT)
html = swap(html, `<script src="assets/vendor/qrcode.js"></script>`, `<script>\n${safeScript(await readFile("assets/vendor/qrcode.js", "utf8"))}\n</script>`);

let first = true;
for (const name of ["data", "i18n", "messages", "store", "remote", "item-art", "photo-ai", "xlsx", "admin-tools", "admin", "app"]) {
  const tag = `<script src="js/${name}.js"></script>`;
  const code = safeScript(await readFile(`js/${name}.js`, "utf8"));
  html = swap(html, tag, (first ? assetScript + "\n  " : "") + `<script>\n${code}\n</script>`);
  first = false;
}

await writeFile(OUT, html);
const { size } = await stat(OUT);
console.log(`Built ${OUT} (${(size / 1024 / 1024).toFixed(1)} MB)`);
