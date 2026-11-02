/* =====================================================================
   promo.js — the "Get full access" gate.

   • On the main link (/) the ad appears FIRST_DELAY_MS (30 s) after the
     page opens. It cannot be closed and stays on screen.
   • Nothing is stored in the browser, so refreshing, clearing the cache
     or using a private window just starts the same 30 seconds again.
   • On a full-access link (any path listed in vercel.json "rewrites")
     the ad never shows.

   The full-access links themselves are NOT in this file — they live only
   in vercel.json, so nobody can find them by reading the page's code.
   ===================================================================== */
(function () {
  "use strict";

  // ---- the only setting ----
  var FIRST_DELAY_MS = 30 * 1000;      // 30 seconds after the page opens

  var path = location.pathname.replace(/\/+$/, "") || "/";
  var fullAccess = path !== "/" && path !== "/index.html";

  // clean up anything an earlier version stored
  try { localStorage.removeItem("promo.nextAt"); localStorage.removeItem("promo.open"); } catch (e) {}

  if (fullAccess) {
    document.documentElement.classList.add("full-access");
    return;
  }

  var ad = document.getElementById("promo");
  if (!ad) return;
  var card = ad.querySelector(".promo-card");
  var shown = false;

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

  setTimeout(show, FIRST_DELAY_MS);
})();