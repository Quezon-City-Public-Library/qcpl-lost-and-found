# QCPL Lost & Found — Quezon City Public Library

A website for the Lost & Found of the Quezon City Public Library (QCPL): the Main Library and the branch libraries in the six districts. Library members and visitors report lost or found belongings, the system suggests matches, and the library staff check claims and return items. It follows the look of qcpl.quezoncity.gov.ph.

## Run it

**With the backend (the real way):** double-click `Start QCPL Lost and Found.bat`. It starts the server and opens http://localhost:8360. Keep the black window open; close it to stop.

- **The very first time**, the page `/setup` opens: create the **head administrator** (name, username, a password of at least 12 characters). This page works only on the computer running the server, and only once. Then sign in at **http://localhost:8360/admin** and add the other staff accounts under **Staff accounts**.
- The database is created automatically (see "The backend" below).
- **Starts by itself:** `Start automatically with Windows.bat` turns this on or off. When on, the site starts in a small window (without opening a browser) every time someone signs in to Windows. It does not run before anyone signs in; for that, it would have to be installed as a Windows service (needs administrator rights).
- **If the server crashes**, the window starts it again after 10 seconds (up to 5 times). Starting the site again from another window, or adding an admin, closes the old window instead of restarting it.

**Without a server (demo / offline):** `npx http-server -p 8351 -c-1 .` and open http://localhost:8351, or open `index.html` or the offline file directly. Records are then kept in that browser only.

## Tests
Double-click `Run all tests.bat` (about 5 minutes), or run `node tests/run-all.mjs`. Add words to run only some: `node tests/run-all.mjs excel backups`.

- Every test uses a **throwaway database** (and its own backup folders), so the live site, its data and its backups are never touched. Ports used: 8371, 8373 and 8354 (the live site is on 8360).
- What is covered: the SQL tables and the upgrade from older databases; rules, accounts and security (sign-in lockouts, permissions, what each visitor receives); attack probes; the whole site through a real browser; encrypted backups, restore and the copy folder; the Backups page; the recovery passphrase; the Excel export; the add-admin tool; 300 visitors at once; and the offline version (features, security, sign-up without codes, the photo helper).
- Needs Microsoft Edge for the browser tests and Excel for the Excel test; without them those are skipped.
- Run the tests after every change to the site, before using it for real.

## Offline single-file version
`QCPL-Lost-and-Found-OFFLINE.html` is the whole site in one file, with the styles, scripts, fonts, hero photo and photo-recognition model built in. Double-click it to open it in Chrome or Edge. It needs no internet and no server. Only the Google Map on "Visit the Office" needs a connection.

After changing any file, rebuild it with:
```
node tools/build-offline.mjs
```

Records are saved in the browser that opens the file, so each computer keeps its own reports.

## Files
| File | Purpose |
|---|---|
| `js/data.js` | Details shared by all libraries (`ORG`), the seven library portals and their branches (`LIBRARIES`), administrator accounts, item types, places inside a library, status steps and badges |
| `js/messages.js` | The wording of every update (shared by the website and the server) |
| `js/store.js` | Storage, smart matching, claim workflow, notifications, accounts, recognition, activity log and statistics |
| `js/app.js` | Public pages and step-by-step forms |
| `js/admin.js` | Administrator area |
| `js/admin-tools.js` | Extra administrator pages: monthly reports, old items, posters |
| `server/server.mjs` | The server: serves the site's public files, the backend API, email and SMS, and the online photo reading (Claude) |
| `server/backend/` | The backend: database (`db.mjs`), rules engine (`engine.mjs`), passwords and sessions (`auth.mjs`), what each visitor may see (`projection.mjs`), photos (`photos.mjs`), the API (`api.mjs`) |
| `js/remote.js` | Connects the pages to the backend (when the page comes from the server) |
| `js/xlsx.js` | Builds the Excel workbook of all records (Reports page; server and offline) |
| `js/photo-ai.js` | Photo auto-fill (runs in the browser) |
| `js/item-art.js` | Illustrations of items (wallet, key, phone, calculator and more), drawn in the item's own color and used when there is no photo |
| `css/styles.css` | All styles. The QCPL colors are at the top (`--blue-*`, `--red-600`, `--gold-*`) |
| `assets/` | Hero photo, fonts and the recognition model |

## Branding
The look follows qcpl.quezoncity.gov.ph.

- **Colors**: white page, gray text (`#374151`, headings `#111827`), blue `#2563eb` for buttons and links, light blue `#dbeafe` pills, thin gray `#e5e7eb` borders, 8px corners, and a dark gray `#111827` footer. The tokens are at the top of `css/styles.css`; the "QCPL THEME" block in the same file sets the type and components.
- **Wordmark**: the QCPL site has no logo image. It writes "Quezon City Public Library" in the font Florentia with a small blue pill beside it. This site does the same, with "Lost & Found" in the pill. Florentia is a paid font and is not included, so the wordmark falls back to Avenir Next or Inter. To use Florentia, add the licensed font files and an `@font-face` rule in `css/fonts.css`.
- **Fonts and sizes**: Inter everywhere (bundled in `assets/fonts`). Page titles 30px bold, section headings 20px bold, sub-headings 16px semi-bold, menu and buttons 14px medium, body text 16px, small text 14px.
- **Hero**: `assets/qcpl-hero.jpg` (the Main Library photo, copied from `hero.jpeg`). To change it, replace that file.
- **Browser tab icon**: `assets/qcpl-favicon.png`, the "Aklatan ng Lungsod Quezon" emblem with a transparent background.

## Public pages
| Page | URL |
|---|---|
| Home | `#/` |
| Found items (search and filters) | `#/browse` |
| Report a lost item (5 steps, photo auto-fill) | `#/report-lost` |
| Report a found item (5 steps, private details only staff can see) | `#/report-found` |
| Claim an item (ownership questions based on the item type) | `#/claim-item/<id>` |
| Check status (reference number + last 4 digits of phone) | `#/status` |
| Sign in / create an account (optional) | `#/signin`, `#/register` |
| My reports, updates, badges and certificates | `#/my` |
| Certificate of Honesty for finders | `#/certificate/<found-id>` |
| How to claim, and FAQ | `#/claim` |
| Visit the office | `#/contact` |

Reports ask who the person is (Library member, Student / Researcher, Visitor or Library staff) and, optionally, their QCitizen ID or library card number. Every report also says which library (branch) it is about.

## Library portals
There are seven separate portals: the Main Library and one for each district. Each portal has its own reports, found items, matching, user accounts and administrator. Nothing is shared between portals.

| Portal | Direct link | Reference numbers | Branches |
|---|---|---|---|
| QCPL Main Library | `#/portal/main` | `L-ML-…`, `F-ML-…`, `C-ML-…` | Main Library, Book Nook (WalterMart North EDSA) |
| District 1 Libraries | `#/portal/d1` | `L-D1-…` | Project 7, Masambong, Nayong Kanluran, Sto. Cristo, Project 8 and Balingasa (both under renovation) |
| District 2 Libraries | `#/portal/d2` | `L-D2-…` | Payatas Lupang Pangako, Bagong Silangan, Holy Spirit, MRB Commonwealth |
| District 3 Libraries | `#/portal/d3` | `L-D3-…` | Greater Project 4, Camp Aguinaldo, Escopa 2, Libis, Matandang Balara, Milagrosa |
| District 4 Libraries | `#/portal/d4` | `L-D4-…` | Roxas, Cubao, Krus Na Ligas, Pinagkaisahan, San Isidro-Galas, UP Pook Amorsolo, UP Pook Dagohoy |
| District 5 Libraries | `#/portal/d5` | `L-D5-…` | Lagro, North Fairview, Sta. Lucia, Pasong Putik |
| District 6 Libraries | `#/portal/d6` | `L-D6-…` | Pasong Tamo, Casanova, Sagana Homes 1, Talipapa, Tandang Sora, Villilia Digital Hub |

- On the first visit, people choose a portal. The choice is remembered on that device and shown in the blue chip at the top.
- Inside a portal, the report forms ask "Which library?". The branch is shown on every found item, is a filter on the Found Items page, and counts in matching (same branch adds points, a different branch takes points away).
- Found items are kept at the branch where they were turned in.
- A signed-in user or a portal administrator stays inside their own portal.
- Portal details (address, phone, email, desk, hours, map, branches) are in `LIBRARIES` in `js/data.js`. Branch names, the Main Library address, phone, email and hours are from qcpl.quezoncity.gov.ph. **Placeholders to confirm with QCPL:** where the Lost & Found desk is in each library, and each district's own phone number and address (the Main Library phone and email are used for now). District 1's desk is set to the Project 7 Branch because the District Library in Project 8 is under renovation.

## Account types
Everyone signs in on one page (`#/signin`) and chooses the account type.

| | **User** (library member or visitor) | **Portal Administrator** | **QCPL Administrator** |
|---|---|---|---|
| Sees | Only their own reports, claims, updates and certificates, in their own library (`#/my`) | Everything that comes in for **their library** (`#/staff`) | Everything, one library at a time, with a library switcher |
| Created by | Self sign-up (`#/register`) in a library portal, confirmed with a 6-digit code | A supervisor, under **Staff accounts** | The `/setup` page (first start) |

- A user who opens the admin area sees "Administrators only". A guest is sent to the sign-in page.
- Admin-only actions also check the account in the code (`requireAdmin()` in `js/store.js`).
- Only one account is signed in at a time.
- Guests can still report an item and check it with their reference number. The public "Found items" list shows only general details.

**Demo administrator accounts — offline file only.** The accounts below exist only in the offline/demo version (they are in `js/data.js`, a public file). **They never work on the server**: the server ignores them, and real staff accounts are created with `/setup` and **Staff accounts**, with passwords stored using scrypt.

| Account | Username | Password |
|---|---|---|
| Head administrator (all portals) | `admin` | `QCPL-ADMIN-712088` |
| Main Library administrator | `mainadmin` | `QCPL-MAIN-971785` |
| District 1 administrator | `d1admin` | `QCPL-D1-162647` |
| District 2 administrator | `d2admin` | `QCPL-D2-587608` |
| District 3 administrator | `d3admin` | `QCPL-D3-183751` |
| District 4 administrator | `d4admin` | `QCPL-D4-533514` |
| District 5 administrator | `d5admin` | `QCPL-D5-448972` |
| District 6 administrator | `d6admin` | `QCPL-D6-102567` |
| QCPL administrator (all portals) | `qcpladmin` | `QCPL-QCPL-513261` |

To create a new administrator password hash, run:
`node -e "console.log(require('crypto').createHash('sha256').update('lf-staff:' + 'NEW-PASSWORD').digest('hex'))"`
Then paste the result into `STAFF_ACCOUNTS` in `js/data.js`.

## Administrator area (`#/staff`)
- **Signing in:** administrators have their **own sign-in page at `/admin`** (for example http://localhost:8360/admin, or the shortcut in `Links`). It stands on its own, without the public menus, and nothing on the public site links to it. The public **Sign in** page is for users only (members and visitors); it has no administrator option. A user's details don't work on the admin page, and an administrator's don't work on the user page.
- **Only from the library (optional):** `ADMIN_NETWORKS` in `server/.env` decides where administrators may sign in from. Empty = anywhere. `local` = only this computer and the library's own network (192.168.x.x, 10.x.x.x, 172.16-31.x.x). Or list addresses / starts of addresses, e.g. `local, 203.177.42.10, 112.198.` (ask the city IT office for each library's internet address). From anywhere else, administrator sign-in is refused, and an administrator session carried there loses its rights at once. Users can still use the site from anywhere. When the site is online behind a proxy, set `TRUST_PROXY=1` too.
- **Find a record**: type a reference number, or press "Scan QR code" to scan a ticket with the camera (shown only in browsers with a built-in QR reader, such as Chrome and Edge).
- **Dashboard**: totals, a "needs attention" list, recovery rate, a 6-month chart, most-lost item types and places, feedback scores and top honest finders.
- **Claims to verify**: the claimant's answers next to the item's private details, and whether their QCPL account is verified. Approve or reject, then record the return.
- **Smart matches**, **Lost reports**, **Found items**, **Returned**.
- **Users**: press "Verify" after checking a person's valid ID. Turn accounts on or off.
- **Old items**: items past the holding period. Donate, dispose, or keep 15 more days. Nothing is removed until the administrator decides.
- **Reports**: a monthly report for the library. Print it, save it as a PDF, or download it for Excel (CSV).
- **Posters & QR**: a printable library poster with a QR code that opens that library's portal.
- **Activity log**.

## Sign-up and verification
- Anyone can create a user account with a name, a mobile number and a password. An email address and a QCitizen ID or library card number are optional.
- People sign in with their email or mobile number.
- An account starts as "Not verified". The portal administrator marks it **Verified** after seeing a valid ID at the desk. The claim screen shows this.
- **6-digit code at sign-up: off for now.** A new account is signed in straight away. Until the mobile number is confirmed (by the desk marking the account Verified), the account sees only what it made while signed in. It never sees reports linked just by that mobile number, so nobody can use someone else's number to look at their reports. To turn the code back on once email or SMS sending is set up, change `signupCode: false` to `true` in `ORG` in `js/data.js`. The same switch covers the code for a changed mobile number. Password reset still uses a code; without email or SMS, passwords are reset at the desk.
- The QCPL website signs people in through QC E-Services (QCitizen ID). This site does not connect to it yet. The QCPL login link carries an application key and return addresses that the city registered for QCPL's own system, so a new site cannot reuse it. Connecting needs the Quezon City IT office to register this site in QC E-Services and give: an application key, the approved return address, and the list of details sent back after login (name, QCitizen ID number, mobile, email) with how to check they are genuine.

## QR codes
- Every reference ticket shows a QR code holding the reference number. It works offline.
- The library is `assets/vendor/qrcode.js` (qrcode-generator, MIT license).

## Feedback
After an item is returned, the owner is asked two questions (ease and satisfaction, 1 to 5) and an optional comment. Results appear on the dashboard and in the monthly report.

## Holding period
- Items are kept for `ORG.holdDays` (30) days.
- `ORG.remindDaysBefore` (5) days before the limit, people with a possible match or an open claim get a reminder. Each person is reminded once.
- After the limit, the item appears under **Old items** for the administrator to decide.

## The server (email, SMS and online photo reading)
The `server/` folder holds a small program that serves the website and adds three optional features. Each one turns on only when its settings are filled in. Without them the website still works and updates stay on the website.

**Start it:** double-click `Start QCPL Lost and Found.bat`, then use http://localhost:8360. Keep the black window open.

**Set up email and texts (easiest):** double-click `Set up email and text messages.bat`. It asks which service to use (Gmail, Brevo, another SMTP service, Semaphore for texts), with the steps for each, hides passwords and keys while you type, saves them in `server/.env`, sends a real test email/text, offers to turn the 6-digit sign-up code back on once messages work, and restarts the site. Run it again any time to change something; answers you keep are left as they are.

**Settings by hand:** the first start creates `server/.env`. Open it with Notepad, fill in what you want, save, and start again. Keep this file private; it holds passwords and keys.

**Test the settings:** double-click `Test email and text.bat`. It signs in to the mail service and sends one test email to `TEST_EMAIL`, checks the Semaphore key and credits (and sends one text if `TEST_PHONE` is filled in), and checks the Claude key. It says in plain words what is wrong, and never shows passwords or keys.

### Email updates
Every update a person gets on the website ("Report received", "We may have found your item", "Your claim is approved" and so on) is also sent to their email address, if they gave one.

- Works with any email account that allows SMTP sending. For Gmail: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER` = the Gmail address, `SMTP_PASS` = a 16-letter **App password** (Google Account > Security > 2-Step Verification > App passwords). The normal Gmail password does not work.
- A free Gmail account can send about 500 emails a day.
- If the Google account does not allow App passwords, use Brevo (brevo.com, free for about 300 emails a day): `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER` and `SMTP_PASS` from Brevo's "SMTP & API" page, and `MAIL_FROM` set to a sender address verified in Brevo. The steps are also written inside `server/.env`.

### Text (SMS) updates
Uses Semaphore (semaphore.co), a Philippine SMS provider. Put the API key in `SEMAPHORE_API_KEY`. Each text costs credits on that account.

- A text is sent when the person chose "Send a text message", or when they gave no email address.
- People who chose "Send an email" get email only.
- Only Philippine mobile numbers (09XXXXXXXXX) are sent to.

### How it stays safe
- The wording of every message is fixed in `js/messages.js`. The server only sends those messages. Values filled in (item names, notes) are cut to one short line, and **every kind of link is removed** (http://…, www.…, and bare addresses like bit.ly/x), so nobody can send a phishing link under the library's name. Codes must be exactly 6 digits and amounts must be numbers.
- The API only answers the website itself: the browser must say the request comes from an allowed address, and the server only answers to its own addresses (stops "DNS rebinding").
- Limits: 6 messages an hour to any one address or number, 30 an hour from any one visitor, and a **daily cap for the whole site**: `SMS_DAILY_LIMIT` (default 300), `EMAIL_DAILY_LIMIT` (1000), `PHOTO_DAILY_LIMIT` (300). These stop someone from using up the SMS credits or the Claude budget.
- **Only public files are ever served**: `index.html`, `robots.txt`, and the `css/`, `js/` and `assets/` folders. README, the password file, `server/.env`, `.bat` files and `tools/` can't be downloaded, including with tricks such as `README.md::$DATA`, short names like `CLAUDE~1`, or `..`.
- **Security headers** on every page: a strict Content-Security-Policy (no inline scripts), no framing (stops click-jacking), nosniff, a referrer policy and a permissions policy. HSTS is added when `SITE_URL` starts with https://.
- The server listens **only on this computer** (127.0.0.1). To put it online, run it behind a web server (Nginx, Caddy, IIS) and set `HOST`, `SITE_URL` (and `ALLOWED_HOSTS` for any other addresses). Set `TRUST_PROXY=1` behind a proxy so each visitor is counted separately.
- Slow or stuck connections are closed (10 s for headers, 60 s per request). Requests are size-checked before they are read (16 KB for messages, 1.5 MB for photos). Photos must really be JPEG, PNG or WebP (the first bytes are checked).
- Text files are sent compressed (about 4× smaller), which matters on slow mobile data.
- Messages are created only by the server, from its own records (there is no public "send a message" address), so nobody can use the library's sender name to text or email strangers.

### What has been tested
- Email: tested end to end against a local test mail server (not a real mailbox yet).
- SMS: not tested live. It needs a Semaphore account.
- Online photo reading: not tested live. It needs an Anthropic API key.
- The settings test (`Test email and text.bat`) was tested with a local mail server, a wrong mail password, and made-up Semaphore and Claude keys. Run it after filling in `server/.env` to do the live test.

### Online photo reading with Claude
The on-device photo helper can't read brands or text. With `ANTHROPIC_API_KEY` set, photos are also sent to Claude, which returns the type, name, brand, color, a public description, and private identifying details (names and numbers it reads go only to the private field).

- The API key stays on the server. The browser never sees it.
- When it is on, the report form tells people that their photo will be sent to the online AI service.
- Each visitor is limited to 20 photos an hour, and the whole site to `PHOTO_DAILY_LIMIT` a day. Each answer is capped at 2,048 tokens, with a 45-second timeout and one retry.
- It uses the model `claude-opus-5-5` at low effort, with Anthropic's default fallback if a request is declined. Each photo costs a small amount. Change `MODEL` in `server/server.mjs` to use a cheaper model.

## Smart item matching
Matching is automatic. Nobody creates a match by hand.

- **When it runs**: every time a lost or found report is sent, changed or given a new status, and again whenever a report is opened. A lost report is compared with every open found report in the same portal, including items the finder has not brought to the office yet.
- **What is compared** (`score()` in `js/store.js`): item name and model (35), brand (15), description and marks (15), place — library, area, floor (15), date (15), color (10) and type of item (10). Only details that both reports contain are counted. The result is a percentage.
- **Labels**: 90% and up "High potential match", 75–89% "Strong possible match", 50–74% "Possible match — needs checking". Below 50% is not shown.
- **Limits built in**: a different type of item is never a match; an item found before it was lost, or more than 60 days later, is never a match; the percentage never reaches 100; with nothing alike in the items themselves it stays below 50; a different library keeps it at 74 or less; with fewer than three item details to compare it cannot be "high".
- **Where people see it**: the **Smart Matches** section of a lost report (Check Status and My reports) lists the closest found items with the percentage and both reports side by side. If there are none it says "No potential matches found yet."
- **Private details**: the percentage people see never uses a found item's private details, so they cannot be guessed by watching the number. The administrator's Smart matches page includes them.
- **A match does not confirm ownership.** The person still has to make a claim and the office verifies it.

## Status steps
- Lost: Reported → Searching → Possible match → Claim submitted → Under verification → Ready for pick-up → Returned
- Found: Found → Recorded at the office → Possible owner identified → Claimed → Verified → Returned
- Claim: Submitted → Under verification → Approved → Returned (or Not approved)

## Photo auto-fill
When someone adds photos on the first step of a report, the site fills in the type of item, a short name, the main color (and a second color, e.g. "black and red"), and a description. It runs in the person's own browser (TensorFlow.js + MobileNet v2 in `assets/ai/`), so photos are not uploaded and it works offline. Everything is in `js/photo-ai.js`.

**How it works (no database needed)**
- **Finds the item** in the photo by telling it apart from the table or floor behind it, then looks at it 5 ways (the item cut out, its mirror image, the whole photo, the middle, a close-up) and averages the answers.
- **All photos count** (up to 4 are looked at; the first counts most). It looks again whenever a photo is added or removed.
- **All 1,000 things the model knows** are mapped to our item types (`RULES`), including look-alikes (keys often look like a padlock to it, wired earphones like a stethoscope). Caps and hats count as Accessories.
- **Colors** are measured on the item only, corrected for warm or cool room light when the background is gray-ish, and named the way people see them (OKLab color space). Metal items (keys, jewelry, watches) are called Silver or Gold.
- **Printed text**, in browsers that can read it (Chrome/Edge on Android, ChromeOS and Mac): brands (Samsung, Aquaflask, JanSport…) and kinds of ID (QCitizen ID, school ID, driver's license, bank card…). Other text goes only to the private field, and long numbers keep only their last 4 characters.
- **It learns on each device.** When a report with photos is sent, or staff correct a record's type or name, the photo's "fingerprint" (1,280 numbers, not the picture) is saved with the right answer in the browser's IndexedDB (up to 400). A new photo that looks like a remembered one gets that answer, and the box says "Similar to items reported here before". Staff corrections count most; a lost item's photo (which may show a similar item) counts least. A typed name is remembered only if it is made of ordinary item words, so personal names and numbers are never stored.
- **Says how sure it is**: "We're fairly sure this is…" or "This looks like…", and offers other likely answers to tap. When it can't tell (for example a photo of a room), it says so instead of guessing.
- **Both languages**: in Filipino the box, the item name and the description are in Filipino ("Itim at pulang backpack"). Matching treats both languages the same (`SYNONYMS`).
- **Speed**: the helper starts loading as soon as someone taps "Take or add photos". After it has loaded, one photo takes about 0.2 s and four photos about 0.4–0.6 s.

**Measured** (synthetic test photos: items of 12 colors with shading, shine and shadows, on white paper, a gray table, wood and dark carpet, in normal, warm and cool light — 912 photos): main color right **93%** (the old method: 59%); in normal light 99%. The remaining mistakes are mostly dark items on wood under colored light.

**Checking with real photos**: put photos in `photo-tests/<type>/` (phones, wallets, bags, keys, books, accessories, others) and, optionally, `photo-tests/colors/<Color>/`, build the offline file, then run `node tools/check-photo-ai.mjs`. It lists every photo, the score for type and color, and the most common mix-ups. Use the mix-ups to adjust `RULES`.

**Several photos.** A report can have up to 8 photos (pictures that can't be read, such as some iPhone HEIC files, are skipped with a message). The first one is the main photo: it is shown on the item card. All photos are saved in `photos` on the record (`photo` still holds the main one). Until the site has a server, photos are kept in the browser's own storage (about 5 MB for the whole site), so the picker stops adding photos and says so when that space runs out.

## Finder recognition
Finders get a printable Certificate of Honesty once the item is returned, earn badges (Good Samaritan, Honest Hero, QCPL Honesty Champion), and can opt in to the Wall of Honesty on the home page.

## No rewards
The reward (bounty) system was removed on 2026-10-22: the library is a government office and may not take part in transactions between owners and finders. Owners can't offer a reward, finders aren't told about one, staff have no Rewards page, and the Reward rules page and its links are gone. The FAQ now says rewards aren't offered. Finders are still thanked with the Certificate of Honesty, badges and the Wall of Honesty.

- Reward amounts saved on older reports stay in the database (`reward_php`, `reward_status` in `lost_reports`) as history, but the site no longer shows or uses them.
- Visitors no longer receive any lost report that isn't their own. Before, reports with a reward (or that the owner ticked "show on the public list") were sent to every visitor so finders could see the reward. The "show on the public list" tick box is gone too, because the Lost Items page only shows counts.

## Monthly Certificate of Contribution
Separate from the Certificate of Honesty (which is per returned item).

- A person qualifies in a month with at least `CONTRIB_MIN` (2) lost reports of their own, or at least 2 found items that were returned to their owners that month. People are matched by mobile number, so guests without an account are included.
- Nothing is issued automatically. On the administrator's **Certificates** page, choose the month, open each report to check it, then press "Issue certificate". Lost reports the administrator closed are not counted.
- The person gets an update, and can open and print the certificate from **My reports**, or after checking one of the reports it is based on.
- Certificates are normally issued after the month ends; the page also allows the current month.

## Accessibility
Text size switch, high-contrast mode, "Read page aloud", large touch targets, one question at a time with plain-language errors, and full keyboard and screen-reader support.

## No sample data
The site starts empty: no sample items, reports, claims, feedback or user accounts. The first time this version opens in a browser that still has the old samples, it removes them once.

The administrator dashboard has a "Clear all records for this library" button for testing. It asks you to type DELETE first.

## The backend
The server holds one shared database for all libraries, and it is the authority: browsers only **ask** for changes.

**How it works**
- **One set of rules.** The site's own rules (`js/data.js`, `js/messages.js`, `js/store.js`: matching, claims, codes, permissions) run **on the server** in a closed sandbox (`server/backend/engine.mjs`). The browser runs the same file only to show things. There is no second copy that could drift apart.
- **Actions.** Every change (a report, a claim, signing in, every staff button) is one request to `POST /api/v1/act`. Only the actions listed in `ACTIONS` in `server/backend/api.mjs` can be called, each with the role it needs (public, user, staff, supervisor); the rules check permissions again. Actions run one at a time; each is saved in one database transaction, or not at all.
- **What each visitor receives** (`projection.mjs`): staff — every record of their library; a signed-in user — their own reports, claims and updates; a visitor who used Check Status — that report; everyone — found items with general details only (no finder, no private details, no exact spot, no photos of IDs/wallets/phones). Other people's lost reports are never sent. Public numbers (totals, chart, Wall of Honesty) are worked out on the server. Nothing personal is stored in the visitor's browser.
- **Database:** a real SQL database (SQLite, built into Node 22.5+, nothing to install) with one table per kind of record — see "The SQL database" below. All queries use placeholders.

**Security**
- **Passwords:** scrypt (N=32768, r=8, p=1) with a random salt each, checked in constant time. Never sent to browsers.
- **Sessions:** a random 256-bit cookie (HttpOnly, SameSite=Strict, and `__Host-`/Secure on HTTPS); only its hash is stored. A new cookie at every sign-in or sign-out. Users are signed out after 30 idle minutes, staff after 20; every session ends 12 hours after last use.
- **Forged requests (CSRF):** every change needs the session's token in the `X-CSRF` header, a request from this site (Origin), and JSON.
- **Lockouts on the server:** 5 wrong passwords for an account → 5 minutes; 5 wrong Check Status tries from one address → 5 minutes; 30 sign-in attempts per address per 15 minutes; codes: 5 per hour, 8 wrong tries; at most 10 reports and 5 claims an hour per address; 240 requests a minute per address. Wrong-try counters are kept even when the action fails.
- **Codes** (sign-up, password reset) are made and checked on the server and stored only as hashes. **Messages** (email/SMS) are created only by the server; the old public `/api/notify` is gone.
- **Staff:** temporary passwords must be changed before anything else works; desk staff can't do supervisor actions; the demo accounts in `js/data.js` are switched off.
- **Photos** are checked (real JPEG/PNG/WebP, at most 600 KB, 8 per report), kept in the database, and served only to people allowed to see the report, with headers that stop them being treated as anything but an image.
- **First start:** `/setup` works only from the server computer and only until a head administrator exists.
- **Locked out / need another head administrator:** double-click `Add an admin account.bat` on the server computer. It stops the site, asks for a new username and name, shows a one-time temporary password in its own window (nowhere else), then starts the site again. The new account has to choose its own password at the first sign-in, and the activity log records that it was added. Existing accounts are not changed.

**Where the data is**
- The database is `qcpl.db` in `DATA_DIR`. If the project is inside OneDrive/Dropbox and `DATA_DIR` is empty, it goes to `%LOCALAPPDATA%\QCPL Lost and Found\data` (a synced folder can damage a live database). The server prints the path when it starts.
- **Backups and restore:** see "Encrypted backups and restore" below.
- Records from the old browser-only version are not copied over; the server starts empty.

### The SQL database
Every record has its own row in a real table, with a typed column for each everyday field (item name, phone, status, dates…) and indexes for the usual searches. Lists and nested details (status history, release, pick-up, edits, photo list) are kept in the `extra` column as JSON. The full layout is in `server/schema.sql` (made from `server/backend/schema.mjs`).

| Table | What's in it |
|---|---|
| `lost_reports` | Lost item reports (item, category, colour, where/when lost, owner contact, status) |
| `found_items` | Found items (item, public and private details, where found, finder, where it's kept, status) |
| `claims` | Claims on found items (claimant, the details they gave, staff note, status) |
| `users` | User accounts (password **hash** only) |
| `staff_accounts` | Staff accounts (password **hash** only) |
| `notifications` | Updates sent to people |
| `activity_log` | Who did what, and when |
| `feedback` | Ratings and comments |
| `contribution_certificates` | Monthly Certificates of Contribution |
| `photos`, `sessions`, `kv`, `meta` | Photos, sign-ins (hash only), security counters, database version |

**Ready-made views** (read-only reports): `v_open_lost_reports`, `v_items_at_office`, `v_claims_with_items` (each claim with its found item), `v_returned_items`, `v_status_history` (every status change as a row), `v_monthly_summary` (lost, found, claimed and returned per library per month), `v_users` and `v_staff` (accounts **without** password hashes — use these for looking).

**Looking at it with SQL**
1. Install the free **DB Browser for SQLite** (sqlitebrowser.org).
2. Open `qcpl.db` (the server prints where it is when it starts) using **Open Database Read Only**.
3. Go to **Execute SQL** and try, for example:
```sql
SELECT * FROM v_monthly_summary;
SELECT item_name, place, date_lost, phone FROM v_open_lost_reports WHERE category = 'phones';
SELECT status, COUNT(*) FROM found_items GROUP BY status;
SELECT * FROM v_status_history WHERE id = '…';
```
- **Only read.** Make every change through the website, so the rules, permissions and activity log apply. Changing rows by hand while the server runs can break things.
- The database file holds personal information: open it only on the server computer, and don't copy it around (use the encrypted backups).
- **Upgrading from the first backend version:** the first start moves every record from the old single `docs` table into these tables, in one step, after saving a full copy (`backups\qcpl-…-before-sql-upgrade.db`, encrypted straight away when encrypted backups are on). Older backups still restore; they're upgraded the same way on the next start.
- **Moving to PostgreSQL or MySQL later:** the tables and columns in `server/schema.sql` are plain SQL, so the same layout can be created there; only `server/backend/db.mjs` talks to the database.

### The database in Supabase (optional)
The data can live in **Supabase** (a cloud Postgres database) instead of only on this computer. Turn it on once with **`Move the database to Supabase.bat`**:
1. Make a Supabase project (supabase.com, free plan works). Choose the region closest to the Philippines (e.g. **Singapore**) and a strong database password.
2. Have ready: the **Project URL** (Project Settings → Data API), the **secret / service_role key** (Project Settings → API Keys — not the anon/publishable key), the **connection string** (green **Connect** button → **Session pooler**, with your password in place of `[YOUR-PASSWORD]`), and preferably the **SSL certificate** (Database Settings → SSL Configuration → Download).
3. Double-click `Move the database to Supabase.bat` and paste them in (secrets are hidden). It stops the site, makes a safety backup, creates the private tables and photo bucket, copies every record and photo, checks the counts match, saves the settings in `server/.env` and starts the site again.

**How it works**
- **Supabase holds the real data.** Every change is saved there first, in one transaction; if Supabase can't be reached, the change is refused with "please try again in a minute" and nothing is half-saved.
- The server keeps a **working copy** (`qcpl.db`) that is refreshed from Supabase at every start, so a new computer or host with an empty disk gets everything back. The rules, reports, Excel export and encrypted backups work exactly as before (before each backup, every photo is fetched so the backup is complete).
- **Photos** are in a private Storage bucket (`qcpl-photos`); their owners are in `qcpl.photos`.
- **Locked down:** everything is in a private schema `qcpl` that Supabase's public website API doesn't serve, row level security is on for every table, the public roles have no rights, and the views run with the caller's rights. Only the server, with the database password, can read the data. Never put the secret key or the connection string anywhere but `server/.env` (never in GitHub, the website files or chat).
- **One server at a time:** a server holds a "lease" in `qcpl.meta`; a second server using the same database refuses to start (a crashed server on the same computer is taken over at once).
- The server **won't start on an empty Supabase**, so it can never wipe the data with an empty copy. A restore (Backups page or `Restore a backup.bat`) is copied up to Supabase at the next start. `Add an admin account.bat` saves to Supabase too.
- In Supabase you can look at the data in **Table Editor** (choose schema `qcpl`) or run SQL with the same ready-made views (`qcpl.v_monthly_summary` etc.). Change records through the website only.
- **Free plan limits** (checked 2026-11-20): 500 MB database, 1 GB file storage, 5 GB transfer a month, **paused after 1 week without activity**, and **no automatic backups** (our encrypted backups still run). For a public service, the Pro plan avoids the pausing and adds daily backups.
- The Privacy Policy automatically says the data is kept by Supabase and in which region, once it is in use (`SUPABASE_REGION`).
- **To go back** to this computer only: remove the `SUPABASE_DB_URL` line from `server/.env` and restart; the working copy has everything up to the last change.

### Records in Excel
**Staff area → Reports → All records in Excel** (supervisors). One `.xlsx` workbook with a **Summary** sheet and a sheet each for **Lost reports, Found items, Claims, Users, Staff, Activity log, Feedback** and **Certificates** — header row frozen, filters on, real dates in Philippine time, money as numbers.
- A library supervisor gets their own library; the head office can choose one library or **All libraries**. Desk staff and visitors can't export, and neither can someone still on a temporary password.
- **Never in the file:** passwords or their hashes, codes, sessions, photos. Text is stored as text, so nothing in a cell is ever run as a formula.
- Every export is written in the activity log (who, when, which libraries).
- **The database stays the real store.** The workbook is a copy for reports, checking and sharing with management; editing it does not change the website. For keeping the data safe, use the encrypted backups below — an Excel file is not encrypted, so keep it where only authorized staff can open it and delete copies you no longer need (Data Privacy Act).
- See `Sample - QCPL Lost and Found records.xlsx` (made-up records) for what it looks like. Built by `js/xlsx.js` (no extra programs); in the offline version the same button makes the file in the browser.

### Encrypted backups and restore
**Turn them on first:** sign in as the head administrator at `/admin` → **Backups** → choose a **recovery passphrase** (at least 16 characters; a short sentence of 4+ words is best). **Write it on paper and keep it somewhere safe, away from the computer.** Without it no backup can be opened — by anyone. Older unencrypted backups are locked at the same moment. The passphrase must be different from your sign-in password. Then press **Print the recovery sheet**: one page with the key ID, where the backups are, how to restore, and blank lines to write the passphrase **by hand** (never type it into a file). Keep it in a locked place away from the computer, and print a new one whenever the passphrase changes.

**How they are protected (end-to-end):**
- The server makes a backup by itself every day (and 2 minutes after each start), keeping the newest 14 (`BACKUP_KEEP`), plus any made with **Back up now**. It can *make* backups but can't *open* them: it only holds a public key. The matching private key is locked with your passphrase (scrypt, then AES-256-GCM) and is never stored unlocked.
- Each backup is the whole database (records, accounts, photos) encrypted with AES-256-GCM using a new random key, which is locked with the public key (RSA-3072, OAEP-SHA256). The header is authenticated too, so changing **one byte** anywhere makes the file fail. Each backup also carries a SHA-256 of its contents, the database version and record counts, which are checked again.
- Each backup holds its own locked private key, so **a backup file + the passphrase is enough to restore everything on a new computer**, even if this one is lost.
- **A copy off this computer:** every encrypted backup is also copied to `OneDrive\QCPL Lost and Found backups` (which OneDrive keeps in the cloud), so a broken or stolen computer doesn't take the backups with it. Only encrypted backups are copied; nothing is copied until the recovery passphrase is set. The folder keeps the newest 60 (`BACKUP_COPY_KEEP`). `BACKUP_COPY_DIR` in `server/.env` picks another folder (another drive, USB or network share), or `off`. Backups made while the folder was unreachable are copied at the next start. The Backups page shows where the copies go. **Download** also saves a copy anywhere; it stays locked.

**On the Backups page** (head administrator only; every sensitive step asks for your password again, and 10 wrong passwords or passphrases in an hour means waiting an hour):
- **Test** opens a backup and checks it completely without changing anything — do this now and then to be sure your backups and passphrase work.
- **Restore…** needs the passphrase, your password and typing RESTORE. A safety backup of the current data is made first (kept 60 days, like uploaded backups), the backup is fully checked, then the site restarts with it. Everyone has to sign in again. The restore is written in the activity log.
- **Upload a backup file** to restore one kept elsewhere.

**Emergency restore** (nobody can sign in, or a new computer): drag the backup file onto `Restore a backup.bat` (or run `node server/restore.mjs "file.qcplbak"`), type the passphrase, then start the site. On a new computer this also sets up encrypted backups again with the same passphrase, and the staff accounts come back with the data.

**If the passphrase is lost:** backups already made can't be opened by anyone — that is what keeps them safe. The live site keeps working. On the Backups page, **I forgot the recovery passphrase** starts new backups with a new passphrase (a first one is made right away). Keep the passphrase written down in two safe places, and use **Change the recovery passphrase** if someone who knew it leaves.

**Tested** (fresh database each time): 53 security checks against the API (CSRF, other websites, session theft and fixation, other people's data and photos, staff-only and supervisor-only actions, temporary passwords, lockouts, password and session storage, fake photos, huge requests); 23 checks using the real pages (report with photo → Check Status on another computer → sign-up with code → staff log a found item → owner gets a match update → claim → staff approve and release; every page on a phone and as staff); restart; 46 backup-and-restore checks (encryption on, downloads unreadable, one changed byte or an edited header refused, wrong passphrase/password refused, restore with automatic restart, safety backup, sign-out of everyone, guessing limited, emergency restore onto a new computer); and load: 1,000 visitors (100 at a time) in 12 s with no errors.

**Settings** (`server/.env`): `PORT`, `HOST` (default 127.0.0.1 = this computer only), `SITE_URL`, `ALLOWED_HOSTS`, `TRUST_PROXY`, `DATA_DIR`, `BACKUP_DIR`, `BACKUP_KEEP`, daily message/photo limits, and `DEMO_CODES=1` (shows codes on screen when no email/SMS is set up — only for trying it on this computer).

## Keeping reports private, and the numbers we show
- The home page no longer lists recently found items or lost items. A list of what was lost made it easy for someone to claim an item that isn't theirs.
- **Lost Items** (`#/lost-items`) now shows only counts: how many lost reports are open, and how many were made on each day (last 30 days). The home page shows the same for the last 7 days. What was lost is never shown.
- **Analytics** on the home page and the administrator dashboard: items returned to their owners (with this month vs last month), lost reports, found items reported, the share of found items returned, and a 12-month chart of lost reports, found items and returns. Hover or tab to a month for its numbers; "Show as a table" lists every month. Counts only, no item details (`monthlyTotals`, `totals` and `lostReportsByDate` in `js/store.js`).
- The **Found Items** page still lists found items with general details, so owners can recognize theirs; claims are checked against the private details before anything is released.

## Filipino version
- The **Filipino** button in the top bar switches every public page to Filipino; the **English** button switches back. The choice is remembered on the device. The administrator area stays in English.
- **One language at a time.** In Filipino, everything is in Filipino: headings, buttons, hints, error messages, item types, places, statuses, dates (e.g. "Huwebes, Oktubre 15"), library and branch names ("Sangay ng Cubao", "Mga Aklatan ng Distrito 4"), certificates and updates. In English, nothing is in Filipino.
- **Plain words.** Simple, everyday Filipino. A few words that Filipinos use every day and that have no common Filipino word are kept: email, password, ID, account, code, QR code, website, internet, PWD, and app names. Proper names (Quezon City Public Library, QCitizen ID, Book Nook – WalterMart North EDSA, street addresses) and what people type themselves are not translated.
- **Updates, emails and texts** are written in both languages (`MESSAGES` and `MESSAGES_FIL` in `js/messages.js`). Each report remembers the language it was made in, and that person's emails and texts are sent in that language. On the website, updates show in the language the visitor has chosen.
- How it works: `js/i18n.js` holds the English → Filipino list (`FIL`) and patterns for sentences with names, numbers or places. Place names are turned into Filipino by `placeFil` in `js/messages.js`. Values sent with forms stay in English, so records and matching don't change.
- To fix or add a translation, edit `FIL` in `js/i18n.js`. While Filipino is on, `I18N.misses` (in the browser console) lists any text that was shown in English, so gaps are easy to find.
- Read aloud uses Filipino (`fil-PH`) when Filipino is on; whether a Filipino voice exists depends on the device.
- The English wording was also made plainer (for example "portal" is no longer used on the public pages).

## Reports people can change
- After checking an open lost report on **Check Status** (reference number + phone digits), or when signed in, the owner can **add details or photos** (matched again right away) or **close it** ("I got it back"). Every change is in the report's history and the activity log.

## Pick-up appointments
- When a claim is approved, the person can book a pick-up hour from their claim (Check Status or My reports): the next 6 open days, during the portal's main-library hours, with up to `PICKUP_SLOT_CAP` (4) bookings per hour. They can change or cancel it.
- Staff see **Today's pick-ups** on the dashboard and the booking in the claim.

## Accounts: forgot password and settings
- **Sign in / Create an account (`#/signin`, `#/register`):** one card with a blue QCPL panel. Pressing **Create an account** or **Sign in** on the panel sweeps it across the card to the other side (no page reload; the address changes to match). On phones the panel is a banner on top with one form below. The hidden form can't be reached by keyboard or screen reader. Motion is turned off for people who ask for less motion.
- **Confirm the mobile number (`#/verify`):** right after **Create account**, a random 6-digit code is sent automatically by text (and email, if given). The account works only after the code is typed in the six boxes (valid 10 minutes; **Send again** after 60 seconds; at most 5 codes an hour; 8 wrong tries in total, even across new codes). Signing in before that sends the person back to the code screen. Opening the page again within a minute does not send another text. If a code can't be sent, the screen says so. If the website has no email or SMS set up at all, the account stays off until the desk turns it on after checking a valid ID (**Verify** on the Users page).
- **Changing the mobile number** in Account settings also needs a new code before the new number is used.
- Only Philippine mobile numbers (09XX XXX XXXX) are accepted, because updates and codes are sent by text.
- **Forgot password:** with email or SMS set up, a 6-digit code is sent (valid 15 minutes; at most 5 codes an hour; 8 wrong tries in total). A wrong code and an account that doesn't exist get the same answer, so nobody can find out which numbers have accounts. The person types it into six boxes (typing jumps to the next box, pasting fills all six, Backspace goes back), can press **Send again** after 60 seconds, then sees a **Verifying…** ring before choosing a new password. Without email or SMS, the page tells the person to visit the desk; staff press **Reset password** on the Users page after checking a valid ID, and give the one-time temporary password in person. The person is asked to choose a new one.
- **Demo code:** only when the site runs on this computer (localhost or the offline file) and no email/SMS is set up, the code is shown on screen in a yellow "Demo on this computer only" box so the flow can be tried. On a real web address it is never shown.
- **Account settings** (`#/account`, from My reports): change name, mobile, email, ID number and password (current password required), or delete the account. Reports already sent stay until closed.
- With the backend, codes are made and checked on the server (see "The backend"). In the offline file they are checked in the browser.

## Safety and abuse protection
With the backend, these are enforced on the server (see "The backend"); in the offline file they work in the browser only.
- **Sign-in lockout:** 5 wrong passwords for the same account → wait 5 minutes (users and staff).
- **Check Status lockout:** 5 wrong reference/phone checks in a row → wait 5 minutes (stops guessing reference numbers).
- **Automatic sign-out on shared computers:** users after 30 minutes without use, staff after 20. The sign-in page says why. Signing out also forgets reports opened with Check Status.
- **Anti-spam:** at most 10 reports and 5 claims an hour from one device (staff are not limited), one open claim per person per item, and a hidden "bot trap" box plus a minimum time on the report, claim and sign-up forms.
- **Input limits:** every text box has a length limit, and the data layer cuts long text again. Only real photos (JPEG/PNG/WebP pictures) are saved, at most 8 per report.
- **Double presses** of a submit button are ignored for a moment (no double reports or accounts).
- **Private photos:** photos of IDs, wallets, cards and phones are never shown on public pages (they can show a name, number or face). The public sees an illustration; staff and the person who sent the report see the photo.
- **Temporary staff passwords** must be changed before the administrator area opens.
- **Desk staff** can't mark a found item "returned" by hand; it's done through the release form, which now requires the last 4 characters of the ID shown.
- **Full storage:** when the browser's storage is full, every save says so ("This device has no more room…") instead of pretending it worked.
- **Leaving a half-filled form** asks first, so answers aren't lost by accident.
- **Slow internet:** a loading screen appears right away (it was blank for about 16 seconds on slow mobile data), and the server compresses files.

## Speed with many records
Smart matching only compares a new report with the other side's list, and only within the same type of item, so adding a report takes about 25–60 ms even with 1,000–2,000 records. Match results and data reads are remembered until something changes. Found Items shows 48 cards at a time and Smart matches the 50 strongest, each with a "Show more" button. Measured with 1,000 lost + 1,000 found reports: Found Items 0.13 s, staff lists about 0.4 s, Smart matches 0.08 s, a staff status change 0.2 s, and the first dashboard view after a change about 2 s.

The browser's storage (about 5 MB) holds only a few thousand text-only records, or about 5 reports with large photos. That limit goes away with the backend.

## Search in everyday Filipino words
`SYNONYMS` in `js/data.js` lists words that mean the same thing (payong = umbrella, susi = keys, pitaka = wallet, cellphone = phone, kulay words, and more). Search and smart matching both use it. Add groups as needed.

## Staff tools
- **Correct details** on any lost report or found item (every change is kept with the staff name and the old value).
- **Shelf or bin** for each found item, and a **printable item tag** with the QR code, item number, where it's kept and the keep-until date.
- **Move to another library** within the portal: "Send" marks it in transit; "Mark as received" at the other library updates where it's kept, and anyone with an approved claim is told.
- **Staff accounts** (supervisors only): add accounts for desk staff, change roles, turn accounts off, reset passwords. Everyone can change their own password with **My password**.
  - *Supervisors* (the built-in administrator accounts, or staff given that role) can also issue certificates, dispose of old items and clear records.
  - *Desk staff* do the daily work and can't do those three things.

## Policy pages
- **Privacy Policy** (`#/privacy`) is linked in the footer and the consent box. It covers the Data Privacy Act of 2012 in full: who controls the data, what is collected (including the one sign-in cookie, and no trackers or analytics), why and on what legal basis, who sees what, service providers, online photo reading by Anthropic in the USA (shown only when that feature is on, as a cross-border transfer), how long each kind of information is kept, all data-subject rights and how to use them, security, breach notice to the NPC within 72 hours, and contacts.
- **It is built from `ORG.privacy` in `js/data.js`**, so the page always states the periods the site really uses. QCPL fills in `dpoName` and `dpoEmail` (the Data Protection Officer), confirms the periods, and sets `approved: true` (the "draft" note then disappears). It stays in English in the Filipino version.

## Keeping personal information only as long as needed
Every night (before the daily backup) the server erases what the Privacy Policy says is no longer needed. The periods are in `ORG.privacy` (`js/data.js`):
- **Closed reports, found items and claims** (returned, closed, donated/disposed, not approved), **365 days** after their last change: they keep only what the numbers need (type of item, colour, brand, library, place, dates, status). Names, phone numbers, emails, ID numbers, descriptions, special marks, photos, claim answers, release details and the names in their history are erased. Open reports are never touched.
- **Photos** that no report uses any more are deleted from the database.
- **Updates sent to people**: 365 days. **Certificates of Contribution**: 365 days. **Feedback comments**: 365 days (the scores stay).
- **Activity log**: 730 days. **User accounts** nobody signed in to for 730 days are deleted (each sign-in is now remembered).
- **Backups** follow: the newest 14 here and 60 in the copy folder, and safety/uploaded backups for 60 days, so erased information is gone from backups within about 60 days.
- Each clean-up is written in the activity log ("Privacy clean-up …"). The offline version does the same once a day in the browser.
- There are no rewards (see "No rewards" above).

## Before going live
**Must be done before launch:**
- **Host it properly:** a server that stays on, behind HTTPS with a real domain (e.g. Caddy or Nginx in front, or IIS on Windows). Set `SITE_URL` (https://…), `TRUST_PROXY=1`, keep `HOST=127.0.0.1` with the proxy on the same machine. Serve the site only through `server/server.mjs` — never upload the folder to a plain file host.
- **Set up email and/or SMS** with `Set up email and text messages.bat` (it sends a real test). Without them, passwords can only be reset at the desk and nobody is told when their item is found. Leave `DEMO_CODES` empty.
- **Privacy Policy:** QCPL names its Data Protection Officer and confirms the keeping periods in `ORG.privacy` (`js/data.js`), gets legal approval, and sets `approved: true`. Automatic deletion already follows those periods.
- **Turn on encrypted backups** (`/admin` → Backups → recovery passphrase), then print the recovery sheet. Until then backups are plain copies and none are copied off this computer. After that, each one is also copied to OneDrive (or the folder in `BACKUP_COPY_DIR`, e.g. the city's backup system).
- The demo administrator passwords below this README's "Account types" only open the offline file; they don't work on the server.

**Also needed:**
1. **Library details**: confirm each portal's Lost & Found desk location, phone number, address and hours in `LIBRARIES` in `js/data.js`. Several are placeholders (see "Library portals" above).
2. **Places inside a library**: check `LOCATIONS` and `FLOORS` against the real buildings. The same list is used for every library for now.
3. **Brand approval**: get QCPL's approval of the wordmark, colors and hero photo, and add the licensed Florentia font if they want an exact match.
