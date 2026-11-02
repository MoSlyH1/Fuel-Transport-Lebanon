/* =====================================================================
   promo.js — the "Get full access" gate.

   • The first time a visitor opens the main link (/), a 30-second clock
     starts. When it runs out the ad appears and cannot be closed.
   • Every refresh, every new tab and every later visit uses that SAME
     clock. Once the 30 seconds are up (or the ad has been shown once),
     the ad shows the moment any page loads.
   • Tabs talk to each other: when the ad appears in one tab it appears in
     all the other open tabs too.
   • Clearing the browser data starts a fresh 30 seconds — so a visitor
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

  // ---- storage: localStorage first, cookie as backup ----
  var K_START = "promo.start";     // when the visitor first arrived
  var K_SHOWN = "promo.shown";     // "1" once the ad has been shown anywhere

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ck(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? m[1] : null;
  }
  function ckSet(name, v) {
    try { document.cookie = name + "=" + v + "; max-age=31536000; path=/; SameSite=Lax"; } catch (e) {}
  }
  function read(k) { return ls(k) || ck(k.replace(".", "_")); }
  function write(k, v) { lsSet(k, v); ckSet(k.replace(".", "_"), v); }

  // ---- other tabs ----
  var chan = null;
  try { chan = new BroadcastChannel("promo"); chan.onmessage = function () { show(); }; } catch (e) {}
  window.addEventListener("storage", function (e) {
    if (e.key === K_SHOWN && e.newValue === "1") show();
  });

  function show() {
    if (!shown) {
      shown = true;
      write(K_SHOWN, "1");
      try { if (chan) chan.postMessage("show"); } catch (e) {}
    }
    ad.hidden = false;
    document.body.classList.add("promo-open");
    if (card && document.activeElement !== card) card.focus();
  }

  // if someone hides the ad again (e.g. by editing the page), put it back
  new MutationObserver(function () {
    if (shown && ad.hidden) ad.hidden = false;
  }).observe(ad, { attributes: true, attributeFilter: ["hidden"] });

  // keep keyboard focus inside the ad once it is showing
  document.addEventListener("focusin", function (e) {
    if (shown && !ad.contains(e.target) && card) card.focus();
  });

  // ---- the clock ----
  var now = Date.now();
  var start = Number(read(K_START)) || 0;
  if (!start || start > now) {          // first visit (or a clock that went backwards)
    start = now;
    write(K_START, String(start));
  }

  function due() {
    return read(K_SHOWN) === "1" || Date.now() >= start + FIRST_DELAY_MS;
  }
  function check() { if (!shown && due()) show(); }

  check();                               // already due → show straight away
  if (!shown) {
    setInterval(check, 1000);            // not throttled-to-death like one long timeout
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);   // back/forward cache restores
  }
})();