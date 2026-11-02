/* =====================================================================
   promo.js — the "Get full access" ad.

   • On the main link (/) the ad pops up after FIRST_DELAY_MS and comes
     back every REPEAT_MS after it is closed.
   • On a full-access link (any path listed in vercel.json "rewrites")
     the ad never shows.

   The full-access links themselves are NOT in this file — they live only
   in vercel.json, so nobody can find them by reading the page's code.
   Any path that is not "/" or "/index.html" but still loads this page
   can only be one of those links (every other path is a 404).
   ===================================================================== */
(function () {
  "use strict";

  // ---- settings you can change ----
  var FIRST_DELAY_MS = 60 * 1000;      // first popup: 1 minute after opening
  var REPEAT_MS = 3 * 60 * 1000;       // shows again 3 minutes after closing (0 = never again)

  var path = location.pathname.replace(/\/+$/, "") || "/";
  var fullAccess = path !== "/" && path !== "/index.html";

  if (fullAccess) {
    document.documentElement.classList.add("full-access");
    return;
  }

  var ad = document.getElementById("promo");
  if (!ad) return;
  var closeBtn = document.getElementById("promoClose");
  var lastFocus = null;
  var timer = null;

  function open() {
    lastFocus = document.activeElement;
    ad.hidden = false;
    document.body.classList.add("promo-open");
    closeBtn.focus();
  }

  function close() {
    ad.hidden = true;
    document.body.classList.remove("promo-open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    if (REPEAT_MS > 0) schedule(REPEAT_MS);
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(open, ms);
  }

  closeBtn.addEventListener("click", close);
  ad.addEventListener("click", function (e) { if (e.target === ad) close(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !ad.hidden) close();
  });

  schedule(FIRST_DELAY_MS);
})();
