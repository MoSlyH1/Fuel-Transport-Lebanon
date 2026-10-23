/* =====================================================================
   app.js — vanilla JS. The server does the fuel maths; this file only
   draws the answer and multiplies days × rate as you type.
   Everything is built with textContent (no innerHTML).
   ===================================================================== */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("en-US");
  const fmt = (n) => nf.format(Math.round(n));
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const signed = (n) => (n < 0 ? "−" : "+") + fmt(Math.abs(n));

  /* ---------- dates ---------- */
  const part = (iso) => iso.split("-").map(Number);
  const dmy = (iso) => { const [y, m, d] = part(iso); return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`; };
  const dayLabel = (iso) => { const [y, m, d] = part(iso); return `${d} ${MON[m - 1]} ${y}`; };
  function rangeLabel(a, b) {
    if (!a || !b) return "";
    if (a === b) return dayLabel(a);
    const [y1, m1, d1] = part(a), [y2, m2, d2] = part(b);
    if (y1 === y2 && m1 === m2) return `${d1} – ${d2} ${MON[m1 - 1]} ${y1}`;
    if (y1 === y2) return `${d1} ${MON[m1 - 1]} – ${d2} ${MON[m2 - 1]} ${y1}`;
    return `${dayLabel(a)} – ${dayLabel(b)}`;
  }

  /* ---------- tiny DOM builder ---------- */
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

  /* ---------- state ---------- */
  const state = { month: null, days: 26, employees: 1, data: null, seq: 0, loadedAt: 0 };

  /* ---------- loading ---------- */
  async function load({ month = state.month, fresh = false } = {}) {
    const my = ++state.seq;
    const q = new URLSearchParams();
    if (month) q.set("month", month);
    if (fresh) q.set("t", String(Date.now())); // skip any CDN copy right after "Update"
    try {
      const res = await fetch(`/api/summary${q.toString() ? "?" + q : ""}`, { headers: { Accept: "application/json" } });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body && body.error) || `Server error (${res.status})`);
      if (my !== state.seq) return; // a newer request is on its way
      state.data = body;
      state.month = body.rate.month;
      state.loadedAt = Date.now();
      showError("");
      if (state.days == null && $("days").value === "") state.days = body.rule.defaultDays;
      render();
    } catch (e) {
      if (my !== state.seq) return;
      showError(e && e.message && !/failed to fetch|networkerror|load failed/i.test(e.message)
        ? e.message : "Couldn't reach the server. Check your connection and try again.");
    }
  }

  function showError(msg) {
    $("error").hidden = !msg;
    $("errorText").textContent = msg || "";
  }

  /* ---------- render ---------- */
  function render() {
    renderBadge();
    renderFuels();
    renderMonthSelect();
    renderRate();
    renderMonths();
    renderFooter();
  }

  function renderBadge() {
    const p = state.data.prices;
    const b = $("badge");
    const date = p.tableDate ? dmy(p.tableDate) : "—";
    b.className = "badge" + (p.live ? "" : " stale");
    $("badgeText").textContent = `${p.live ? "Live" : "Saved"} · IPT ${date}`;
    b.title = p.live ? "Prices were just read from IPT Group."
      : "IPT could not be reached just now — showing the last saved prices.";
  }

  function renderFuels() {
    const p = state.data.prices;
    $("pricesSub").textContent = p.tableDate ? `IPT Group · table of ${dmy(p.tableDate)}` : "";
    const grid = $("fuelGrid");
    clear(grid);
    for (const f of p.fuels) {
      const card = el("article", { class: "card fuel", "data-key": f.key });
      card.append(el("p", { class: "name", text: f.name }));
      card.append(el("p", { class: "price", text: f.price != null ? fmt(f.price) : "—" }));
      card.append(el("p", { class: "unit", text: f.price != null ? `L.L. ${f.unit}` : "not available" }));
      if (f.perLitre != null) card.append(el("p", { class: "litre mono", text: `≈ ${fmt(f.perLitre)} / litre` }));
      if (f.change) {
        const up = f.change > 0;
        card.append(el("span", {
          class: `chip ${up ? "up" : "down"}`,
          text: `${up ? "▲" : "▼"} ${fmt(Math.abs(f.change))}`,
          title: `${up ? "Up" : "Down"} ${fmt(Math.abs(f.change))} since the previous table`,
        }));
      }
      if (f.asOf && p.tableDate && f.asOf !== p.tableDate) {
        card.append(el("p", { class: "unit", text: `as of ${dmy(f.asOf)}` }));
      }
      grid.append(card);
    }
  }

  function renderMonthSelect() {
    const sel = $("month");
    const months = state.data.months.slice();
    if (!months.some((m) => m.month === state.month)) months.unshift({ month: state.month, label: state.data.rate.label, status: state.data.rate.status });
    const sig = months.map((m) => `${m.month}:${m.status}`).join("|");
    if (sel.dataset.sig !== sig) {
      clear(sel);
      for (const m of months) {
        const note = m.status === "partial" ? " · to date" : m.status === "future" ? " · estimate" : "";
        sel.append(el("option", { value: m.month, text: m.label + note }));
      }
      sel.dataset.sig = sig;
    }
    sel.value = state.month;
  }

  function renderRate() {
    const { rate: r, rule } = state.data;
    $("eyebrow").textContent = r.legacy ? "DAILY RATE · OLD TERMS (FIXED)" : r.mixed ? "DAILY RATE · OLD + FUEL-INDEXED" : "DAILY RATE · FUEL-INDEXED";
    $("rate").textContent = fmt(r.ratePerDay);

    if (r.legacy) {
      $("rateSub").textContent = `Before 22 October 2026 the rate was a fixed ${fmt(rule.legacyPerDay)} L.L. per day.`;
    } else {
      const suffix = r.status === "partial" ? " (to date)" : r.status === "future" ? " (estimate from the latest price)" : "";
      $("rateSub").textContent = r.mixed
        ? `${r.oldDays} days at ${fmt(rule.legacyPerDay)} + ${r.newDays} days at ${fmt(r.fuelRatePerDay)} (fuel average ${rangeLabel(r.averagedFrom, r.averagedTo)})${suffix}`
        : `${rule.litresPerDay} L/day at the average official fuel price · ${rangeLabel(r.averagedFrom, r.averagedTo)}${suffix}`;
    }

    // meter (the 500K–800K limits apply to the fuel rate)
    $("meter").hidden = r.legacy;
    $("minLabel").textContent = fmt(rule.minPerDay);
    $("maxLabel").textContent = fmt(rule.maxPerDay);
    const pct = Math.max(0, Math.min(100, (((r.fuelRatePerDay ?? r.ratePerDay) - rule.minPerDay) / (rule.maxPerDay - rule.minPerDay)) * 100));
    $("marker").style.left = `${pct}%`;
    const lim = $("limitText");
    lim.className = r.clamped ? "warn" : "";
    lim.textContent = r.clamped === "min" ? "at the minimum" : r.clamped === "max" ? "at the maximum" : "within limits";

    renderPayslip();
    renderHow();
  }

  function renderPayslip() {
    const r = state.data.rate;
    const days = state.days, emp = state.employees;
    const ok = days != null && emp != null;
    $("payLabel").textContent = emp > 1 && ok ? `For ${fmt(emp)} employees` : "On the payslip";
    if (!ok) { $("payLine").textContent = "—"; $("oldLine").textContent = "—"; return; }
    const total = days * r.ratePerDay * emp;
    const old = days * r.oldRatePerDay * emp;
    const lead = emp > 1 ? `${fmt(emp)} × ` : "";
    $("payLine").textContent = `${lead}${fmt(days)} × ${fmt(r.ratePerDay)} = ${fmt(total)} L.L.`;
    $("oldLine").textContent = r.legacy ? `${fmt(old)} L.L.` : `${fmt(old)} L.L. (${signed(total - old)} now)`;
  }

  function step(label, value, hint, final) {
    return el("div", { class: "step" + (final ? " final" : "") },
      el("span", { text: label }),
      el("span", { class: "mono" }, value, hint ? el("span", { class: "hint", text: hint }) : null));
  }

  function renderHow() {
    const { rate: r, rule } = state.data;
    const body = $("howBody");
    clear(body);
    if (r.legacy) {
      body.append(el("p", { class: "note", text: `Old terms: a fixed ${fmt(rule.legacyPerDay)} L.L. per day. No fuel averaging before 22 October 2026.` }));
      return;
    }
    const table = el("table", { class: "grid" },
      el("thead", {}, el("tr", {}, el("th", { text: "In force" }), el("th", { class: "num", text: "Days" }), el("th", { class: "num", text: `${rule.fuel} / ${rule.litresPerQuote} L` }))),
      el("tbody", {}, r.segments.map((s) => el("tr", {},
        el("td", { text: rangeLabel(s.from, s.to) }),
        el("td", { class: "num", text: String(s.days) }),
        el("td", { class: "num", text: fmt(s.unl95) })))));
    body.append(table);

    const steps = el("div", { class: "steps" },
      step(`Average price / ${rule.litresPerQuote} L over ${r.days} day${r.days === 1 ? "" : "s"}`, `${fmt(r.avgQuote20L)} L.L.`,
        `Σ price × days ÷ days = ${fmt(r.sumQuoteDays)} ÷ ${r.days}`),
      step("Average price / litre", `${fmt(r.avgPerLitre)} L.L.`, `÷ ${rule.litresPerQuote}`),
      step(`× ${rule.litresPerDay} litres`, `${fmt(r.rawPerDay)} L.L.`),
      step(`Fuel daily rate (rounded, ${fmt(rule.minPerDay / 1000)}K–${fmt(rule.maxPerDay / 1000)}K)`, `${fmt(r.fuelRatePerDay)} L.L.`,
        `rounded to the nearest ${fmt(rule.roundTo)}${r.rawPerDay === r.fuelRatePerDay ? "" : ` → ${fmt(r.roundedPerDay)}`}`, !r.mixed));
    if (r.mixed) {
      steps.append(step(`Month rate: ${r.oldDays} days × ${fmt(rule.legacyPerDay)} + ${r.newDays} days × ${fmt(r.fuelRatePerDay)}`,
        `${fmt(r.ratePerDay)} L.L.`, `÷ ${r.daysInMonth} days (fuel rule starts 22 Oct 2026)`, true));
    }
    body.append(steps);

    if (r.clamped) {
      body.append(el("p", { class: "note", text: r.clamped === "min"
        ? `${fmt(r.roundedPerDay)} is below the ${fmt(rule.minPerDay)} minimum, so ${fmt(rule.minPerDay)} is used.`
        : `${fmt(r.roundedPerDay)} is above the ${fmt(rule.maxPerDay)} maximum, so ${fmt(rule.maxPerDay)} is used.` }));
    }
    if (r.status === "partial") {
      body.append(el("p", { class: "note", text: "This month isn't over yet: the average covers the days up to today and updates itself whenever IPT publishes new prices." }));
    } else if (r.status === "future") {
      body.append(el("p", { class: "note", text: "No prices are published for this month yet. This is an estimate from the latest table and will update automatically." }));
    }
  }

  function renderMonths() {
    const { months, rule } = state.data;
    const days = state.days, emp = state.employees;
    const ok = days != null && emp != null;
    $("thTotal").textContent = ok ? `${days} days${emp > 1 ? ` × ${fmt(emp)}` : ""}` : "Total";
    const body = $("monthsBody");
    clear(body);
    for (const m of months.filter((x) => x.status !== "future")) {
      const sub = m.status === "partial" ? `${m.days} days · to date` : `full month · ${m.days} days`;
      const btn = el("button", { class: "month-btn", type: "button", "data-month": m.month },
        m.label, el("span", { class: "sub", text: sub }));
      const tag = m.clamped ? el("span", { class: "tag", text: m.clamped === "min" ? "min" : "max" }) : null;
      body.append(el("tr", { class: m.month === state.month ? "current" : "" },
        el("td", {}, btn),
        el("td", { class: "num", text: m.avgQuote20L != null ? fmt(m.avgQuote20L) : "—" }),
        el("td", { class: "num" }, fmt(m.ratePerDay), tag),
        el("td", { class: "num", text: ok ? fmt(m.ratePerDay * days * emp) : "—" })));
    }
    $("monthsSub").textContent = `Tap a month to see its calculation. Terms from ${state.data.months[0].label}: ${fmt(rule.minPerDay)}–${fmt(rule.maxPerDay)} L.L. per day.`;
  }

  function renderFooter() {
    const p = state.data.prices;
    $("srcLink").href = p.sourceUrl;
    $("checked").textContent = p.checkedAt
      ? `Last checked ${new Date(p.checkedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.`
      : "IPT hasn't been reached yet — showing saved prices.";
  }

  /* ---------- inputs ---------- */
  function readInt(input, min, max) {
    const v = input.value.trim();
    const n = Number(v);
    const ok = v !== "" && Number.isInteger(n) && n >= min && n <= max;
    input.setAttribute("aria-invalid", ok ? "false" : "true");
    return ok ? n : null;
  }
  $("days").addEventListener("input", () => {
    state.days = readInt($("days"), 0, 31);
    if (state.data) { renderPayslip(); renderMonths(); }
  });
  $("employees").addEventListener("input", () => {
    state.employees = readInt($("employees"), 1, 9999);
    if (state.data) { renderPayslip(); renderMonths(); }
  });
  $("controls").addEventListener("submit", (e) => e.preventDefault());
  $("month").addEventListener("change", (e) => load({ month: e.target.value }));
  $("monthsBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-month]");
    if (!b) return;
    load({ month: b.dataset.month });
    $("calc").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("retryBtn").addEventListener("click", () => load());

  /* ---------- "Update from IPT" ---------- */
  let resetTimer = null;
  $("updateBtn").addEventListener("click", async () => {
    const btn = $("updateBtn"), text = $("updateText");
    btn.disabled = true; btn.classList.add("spin"); text.textContent = "Checking IPT…";
    let msg = "Up to date";
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "failed");
      msg = body.status === "updated" ? "New prices recorded"
        : body.status === "failed" ? "IPT unreachable — saved prices"
        : "Already up to date";
      await load({ fresh: true });
    } catch { msg = "Couldn't update — try again"; }
    btn.disabled = false; btn.classList.remove("spin"); text.textContent = msg;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { text.textContent = "Update from IPT"; }, 3500);
  });

  // coming back to the tab after a while → pick up new prices
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.data && Date.now() - state.loadedAt > 10 * 60 * 1000) load();
  });

  load();
})();