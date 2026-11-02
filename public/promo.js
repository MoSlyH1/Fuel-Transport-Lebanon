/* =====================================================================
   promo.js — the "Get full access" gate.

   • The first time a visitor opens the main link (/), a 30-second clock
     starts. When it runs out the ad appears and cannot be closed.
   • Refreshing does NOT restart the clock. The moment the page loads the
     ad is shown if 30 s have passed since the first visit, otherwise it
     appears when the remaining time is up.
   • Clearing the browser data starts a fresh 30 seconds — so the visitor
     never gets more than 30 s of use before the ad.
   • On a full-access link (any path listed in vercel.json "rewrites")
     the ad never shows.

   The full-access links themselves are NOT in this file — they live only
   in vercel.json, so nobody can find them by reading the page's code.
   ===================================================================== */
(function () {
  "use strict";

  // ---- the only setting ----
  var FIRST_DELAY_MS = 30 * 1000;      // 30 seconds after the first visit

  var path = location.pathname.replace(/\/+$/, "") || "/";
  var fullAccess = path !== "/" && path !== "/index.html";

  if (fullAccess) {
    document.documentElement.classList.add("full-access");
    return;
  }

  var ad = document.getElementById("promo");
  if (!ad) return;
  var card = ad.querySelector(".promo-card");
  var shown = false;

  // ---- remember WHEN the visitor first arrived (localStorage, cookie as backup) ----
  var KEY = "promo.start";
  function readStart() {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}
    if (!v) {
      var m = document.cookie.match(/(?:^|; )promo_start=(\d+)/);
      if (m) v = m[1];
    }
    return Number(v) || 0;
  }
  function saveStart(t) {
    try { localStorage.setItem(KEY, String(t)); } catch (e) {}
    try { document.cookie = "promo_start=" + t + "; max-age=31536000; path=/; SameSite=Lax"; } catch (e) {}
  }

  var now = Date.now();
  var start = readStart();
  if (!start || start > now) {          // first visit (or a clock that went backwards)
    start = now;
    saveStart(start);
  }

  function show() {
    shown = true;
    ad.hidden = false;
    document.body.classList.add("promo-open");
    if (card) card.focus();
  }

  // if someone hides the ad again (e.g. by editing the page), put it back
  new MutationObserver(function () {
    if (shown && ad.hidden) ad.hidden = false;
  }).observe(ad, { attributes: true, attributeFilter: ["hidden"] });

  // keep keyboard focus inside the ad once it is showing
  document.addEventListener("focusin", function (e) {
    if (shown && !ad.contains(e.target) && card) card.focus();
  });

  var wait = start + FIRST_DELAY_MS - now;
  if (wait <= 0) show();                 // time already used up → show straight away
  else setTimeout(show, wait);
})();