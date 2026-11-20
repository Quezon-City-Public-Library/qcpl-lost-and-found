/* ==========================================================================
   QCPL Lost & Found — notification messages
   Every update a person can receive, in one place, in English (MESSAGES) and
   Filipino (MESSAGES_FIL). Used by the website (shown under "Updates") and by
   server/server.mjs (sent by email and SMS in the person's own language).

   The server only sends these fixed messages. The values filled in (item
   names, notes) are cleaned and shortened there, so the service cannot be used
   to send arbitrary text.
   ========================================================================== */
(function (root) {
  "use strict";

  const MESSAGES = {
    lost_received:    (v) => ({ title: "Report received", body: `Thank you. We received your report for "${v.item}". We will tell you if we find it.` }),
    match_found:      (v) => ({ title: "We may have found your item", body: `A found item looks like your ${v.item}: "${v.found}". Please take a look and ask to claim it.` }),
    found_received:   (v) => ({ title: "Thank you for your report", body: `We received your report for "${v.item}". Thank you for helping a fellow QCitizen!` }),
    claim_received:   (v) => ({ title: "Claim received", body: `We received your claim for "${v.item}". The office will check your answers and contact you.` }),
    finder_claimed:   (v) => ({ title: "Someone claimed the item you found", body: `Someone has asked for the "${v.item}" you reported. Thank you for your kindness!` }),
    claim_checking:   (v) => ({ title: "Your claim is being checked", body: `Our staff are now checking your claim for "${v.item}".` }),
    claim_approved:   (v) => ({ title: "Good news — your claim is approved", body: `Your "${v.item}" is ready to pick up. Please bring a valid ID to the ${v.desk}.` }),
    claim_rejected:   (v) => ({ title: "Claim not approved", body: `We could not confirm that "${v.item}" is yours${v.note ? `: ${v.note}` : "."} Please call the office if you have questions.` }),
    item_returned:    (v) => ({ title: "Item returned", body: `"${v.item}" has been given back to you. Thank you for your patience!` }),
    finder_returned:  (v) => ({ title: "The owner got their item back — thank you!",
      body: `The "${v.item}" you found is back with its owner. Your Certificate of Honesty is ready — check your report (${v.ref}) to see and print it.` +
        (v.badge ? ` You now have the "${v.badge}" badge (${v.count} ${String(v.count) === "1" ? "item" : "items"} returned).` : "") +
        (v.note ? ` Message from our staff: "${v.note}"` : "") }),
    thank_note:       (v) => ({ title: "A thank-you message for you", body: `From the Lost & Found Office: "${v.note}"` }),
    report_closed:    (v) => ({ title: "Report closed", body: `Your report for "${v.item}" has been closed.${v.note ? " " + v.note : ""}` }),
    visit_office:     (v) => ({ title: "Please visit the Lost & Found Office", body: `Our staff think the "${v.item}" (item ${v.ref}) may be yours. Please ask to claim it online or visit the office with a valid ID.` }),
    claim_soon:       (v) => ({ title: "Reminder: please claim soon", body: `The "${v.item}" (item ${v.ref}) that may be yours will be kept only until ${v.until}. Please claim it at the Lost & Found Office before then.` }),
    contribution_certificate: (v) => ({ title: "You earned a Certificate of Contribution", body: `Thank you for helping the Lost & Found in ${v.month}. Your Certificate of Contribution is ready. Open My reports, or check this report, to see and print it.` }),
    verify_code:      (v) => ({ title: "Your QCPL account code", body: `Your QCPL Lost & Found account code is ${v.code}. Type it on the website to finish creating your account. It works for 10 minutes. Never share this code with anyone.` }),
    reset_code:       (v) => ({ title: "Your password reset code", body: `Your QCPL Lost & Found code is ${v.code}. It works for 15 minutes. If you did not ask for it, you can ignore this message.` }),
    pickup_booked:    (v) => ({ title: "Pick-up time booked", body: `Your pick-up for "${v.item}" is on ${v.when} at ${v.place}. Please bring a valid ID and your reference number.` }),
    pickup_cancelled: (v) => ({ title: "Pick-up time cancelled", body: `Your pick-up time for "${v.item}" was cancelled. You can book a new time from your claim.` }),
    item_moved:       (v) => ({ title: "Your item is being moved", body: `"${v.item}" is being moved to ${v.place} so you can pick it up there. We will tell you when it arrives.` }),
    account_verified: ()  => ({ title: "Your QCPL account is verified", body: "The Lost & Found Office has checked your ID. Your claims can now be handled faster." }),
  };

  /* Library and place names in Filipino ("Cubao Branch" → "Sangay ng Cubao") */
  function placeFil(s) {
    let t = String(s || "");
    if (!t) return t;
    t = t.replace(/QCPL Main Library/g, "Pangunahing Aklatan ng QCPL")
      .replace(/District Library – /g, "Aklatang Pandistrito – ")
      .replace(/District (\d) Libraries/g, "Mga Aklatan ng Distrito $1")
      .replace(/\bDistrict (\d)\b/g, "Distrito $1")
      .replace(/\bMain Library\b/g, "Pangunahing Aklatan")
      .replace(/Lost & Found Desk/g, "Mesa ng Nawala at Napulot")
      .replace(/Lost & Found Office/g, "Opisina ng Nawala at Napulot")
      .replace(/Lost & Found/g, "Nawala at Napulot")
      .replace(/Ground Floor Lobby/g, "Lobby sa Unang Palapag")
      .replace(/\(under renovation\)/g, "(inaayos)")
      .replace(/\(formerly ([^)]+)\)/g, "(dating $1)")
      .replace(/([A-Z][\w.'\- ]*?) Branch\b/g, "Sangay ng $1");
    return t;
  }
  const P = placeFil;

  const MESSAGES_FIL = {
    lost_received:    (v) => ({ title: "Natanggap ang ulat", body: `Salamat. Natanggap namin ang ulat mo tungkol sa "${v.item}". Sasabihan ka namin kapag nakita namin ito.` }),
    match_found:      (v) => ({ title: "Baka nakita na namin ang gamit mo", body: `May napulot na gamit na kamukha ng iyong ${v.item}: "${v.found}". Pakitingnan ito at humiling na makuha ito.` }),
    found_received:   (v) => ({ title: "Salamat sa iyong ulat", body: `Natanggap namin ang ulat mo tungkol sa "${v.item}". Salamat sa pagtulong sa kapwa QCitizen!` }),
    claim_received:   (v) => ({ title: "Natanggap ang iyong kahilingan", body: `Natanggap namin ang kahilingan mong makuha ang "${v.item}". Susuriin ng opisina ang mga sagot mo at tatawagan ka.` }),
    finder_claimed:   (v) => ({ title: "May humiling na makuha ang napulot mo", body: `May taong humiling na makuha ang "${v.item}" na iniulat mo. Salamat sa iyong kabutihan!` }),
    claim_checking:   (v) => ({ title: "Sinusuri ang iyong kahilingan", body: `Sinusuri na ng aming kawani ang kahilingan mong makuha ang "${v.item}".` }),
    claim_approved:   (v) => ({ title: "Magandang balita — aprubado ang kahilingan mo", body: `Puwede mo nang kunin ang iyong "${v.item}". Magdala ng balidong ID sa ${P(v.desk)}.` }),
    claim_rejected:   (v) => ({ title: "Hindi naaprubahan ang kahilingan", body: `Hindi namin natiyak na iyo ang "${v.item}"${v.note ? `: ${v.note}` : "."} Tumawag sa opisina kung may tanong ka.` }),
    item_returned:    (v) => ({ title: "Naibalik na ang gamit", body: `Naibalik na sa iyo ang "${v.item}". Salamat sa iyong paghihintay!` }),
    finder_returned:  (v) => ({ title: "Nabawi na ng may-ari ang gamit — salamat!",
      body: `Nasa may-ari na ang "${v.item}" na napulot mo. Handa na ang iyong Sertipiko ng Katapatan — tingnan ang iyong ulat (${v.ref}) para makita at mai-print ito.` +
        (v.badge ? ` Mayroon ka nang tsapang "${v.badge}" (${v.count} gamit ang naibalik).` : "") +
        (v.note ? ` Mensahe mula sa aming kawani: "${v.note}"` : "") }),
    thank_note:       (v) => ({ title: "Isang mensahe ng pasasalamat para sa iyo", body: `Mula sa Opisina ng Nawala at Napulot: "${v.note}"` }),
    report_closed:    (v) => ({ title: "Isinara ang ulat", body: `Isinara na ang ulat mo tungkol sa "${v.item}".${v.note ? " " + v.note : ""}` }),
    visit_office:     (v) => ({ title: "Pakibisita ang Opisina ng Nawala at Napulot", body: `Sa tingin ng aming kawani, baka iyo ang "${v.item}" (gamit ${v.ref}). Humiling na makuha ito sa website o pumunta sa opisina na may dalang balidong ID.` }),
    claim_soon:       (v) => ({ title: "Paalala: pakikuha agad", body: `Ang "${v.item}" (gamit ${v.ref}) na baka iyo ay itatago lang hanggang ${v.until}. Pakikuha ito sa Opisina ng Nawala at Napulot bago iyon.` }),
    contribution_certificate: (v) => ({ title: "Nakatanggap ka ng Sertipiko ng Pakikiambag", body: `Salamat sa pagtulong sa Nawala at Napulot noong ${v.month}. Handa na ang iyong Sertipiko ng Pakikiambag. Buksan ang Aking mga ulat, o tingnan ang ulat na ito, para makita at mai-print ito.` }),
    verify_code:      (v) => ({ title: "Ang code ng QCPL account mo", body: `Ang code ng QCPL Nawala at Napulot account mo ay ${v.code}. I-type ito sa website para matapos ang paggawa ng account. Gagana ito nang 10 minuto. Huwag itong ibigay kahit kanino.` }),
    reset_code:       (v) => ({ title: "Ang code para palitan ang password mo", body: `Ang code mo sa QCPL Nawala at Napulot ay ${v.code}. Gagana ito nang 15 minuto. Kung hindi ikaw ang humingi nito, huwag pansinin ang mensaheng ito.` }),
    pickup_booked:    (v) => ({ title: "Naitakda ang oras ng pagkuha", body: `Ang pagkuha mo ng "${v.item}" ay sa ${v.when} sa ${P(v.place)}. Magdala ng balidong ID at ng iyong numero ng reperensiya.` }),
    pickup_cancelled: (v) => ({ title: "Kinansela ang oras ng pagkuha", body: `Kinansela ang oras ng pagkuha mo ng "${v.item}". Puwede kang pumili ng bagong oras sa iyong kahilingan.` }),
    item_moved:       (v) => ({ title: "Inililipat ang iyong gamit", body: `Inililipat ang "${v.item}" sa ${P(v.place)} para doon mo ito makuha. Sasabihan ka namin kapag dumating na ito.` }),
    account_verified: ()  => ({ title: "Beripikado na ang iyong QCPL account", body: "Nasuri na ng Opisina ng Nawala at Napulot ang iyong ID. Mas mabilis na ngayong maaasikaso ang mga kahilingan mo." }),
  };

  /* The messages in the chosen language ("fil" or English) */
  const messagesFor = (lang) => (lang === "fil" ? MESSAGES_FIL : MESSAGES);

  const LIBRARY_NAMES = { main: "Main Library", d1: "District 1", d2: "District 2", d3: "District 3", d4: "District 4", d5: "District 5", d6: "District 6" };

  const api = { MESSAGES, MESSAGES_FIL, messagesFor, placeFil, LIBRARY_NAMES };
  if (typeof module !== "undefined" && module.exports) module.exports = api; // server
  else Object.assign(root, api);                                              // browser
})(typeof window !== "undefined" ? window : globalThis);
