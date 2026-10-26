/* =====================================================================
   app.js — vanilla JS. The server does the fuel maths; this file only
   draws the dashboard and multiplies days × rate as you type.
   Everything is built with textContent / DOM nodes (no innerHTML).
   ===================================================================== */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("en-US");
  const fmt = (n) => nf.format(Math.round(n));
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const signed = (n) => (n < 0 ? "−" : "+") + fmt(Math.abs(n));
  const SVGNS = "http://www.w3.org/2000/svg";

  /* ---------- dates ---------- */
  const part = (iso) => iso.split("-").map(Number);
  const dayLabel = (iso) => { const [y, m, d] = part(iso); return `${d} ${MON[m - 1]} ${y}`; };
  const shortDay = (iso) => { const [, m, d] = part(iso); return `${d} ${MON[m - 1]}`; };
  function rangeLabel(a, b) {
    if (!a || !b) return "";
    if (a === b) return dayLabel(a);
    const [y1, m1, d1] = part(a), [y2, m2, d2] = part(b);
    if (y1 === y2 && m1 === m2) return `${d1} – ${d2} ${MON[m1 - 1]} ${y1}`;
    if (y1 === y2) return `${d1} ${MON[m1 - 1]} – ${d2} ${MON[m2 - 1]} ${y1}`;
    return `${dayLabel(a)} – ${dayLabel(b)}`;
  }
  const dateTime = (ts) => {
    const d = new Date(ts);
    return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  };

  /* ---------- tiny DOM builders ---------- */
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
  function svg(tag, attrs, ...kids) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  }
  const icon = (paths, cls) => svg("svg", { viewBox: "0 0 24 24", class: cls, "aria-hidden": "true" }, paths.map((d) => svg("path", { d })));
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

  const ICONS = {
    pump: ["M5 20V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V20M4 20h11M7 8h5v3H7zM14 10h2a1.5 1.5 0 0 1 1.5 1.5v4a1.25 1.25 0 0 0 2.5 0V9l-2.5-2.5"],
    drop: ["M12 3.5c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.5-6 5.5-10z"],
    flame: ["M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-1.5-2-1.5-3C7 10 6 12.5 6 15a6 6 0 0 0 6 6z"],
    down: ["M12 5v14M6 13l6 6 6-6"],
    up: ["M12 19V5M6 11l6-6 6 6"],
  };
  const FUEL_ICON = { unl95: "pump", unl98: "pump", diesel: "drop", lpg: "flame" };

  /* ---------- state ---------- */
  const state = { month: null, days: 26, daysOld: 18, daysNew: 8, employees: 1, data: null, seq: 0, loadedAt: 0, hover: null };

  // October 2026 is split: days before 22 Oct at 450,000 + days from 22 Oct at the fuel rate (500K–800K).
  const daysOf = (r) => (r.mixed ? (state.daysOld == null || state.daysNew == null ? null : state.daysOld + state.daysNew) : state.days);
  function lineFor(r, days) {
    if (r.mixed) {
      const total = state.daysOld * r.oldRatePerDay + state.daysNew * r.ratePerDay;
      const n = state.daysOld + state.daysNew;
      return { total, days: n, avg: n ? total / n : r.ratePerDay };
    }
    return { total: days * r.ratePerDay, days, avg: r.ratePerDay };
  }

  /* ---------- loading ---------- */
  async function load({ month = state.month, fresh = false } = {}) {
    const my = ++state.seq;
    const q = new URLSearchParams();
    if (month) q.set("month", month);
    if (fresh) q.set("t", String(Date.now()));
    try {
      const res = await fetch(`/api/summary${q.toString() ? "?" + q : ""}`, { headers: { Accept: "application/json" } });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body && body.error) || `Server error (${res.status})`);
      if (my !== state.seq) return;
      state.data = body;
      state.month = body.rate.month;
      state.loadedAt = Date.now();
      showError("");
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
    renderStatus();
    renderFuels();
    renderMonthSelects();
    renderRate();
    renderBreakdown();
    renderTotals();
    renderChart();
    renderUpdates();
    renderHistory();
    renderFooter();
  }

  function renderStatus() {
    const p = state.data.prices;
    const b = $("badge");
    b.className = "status" + (p.live ? "" : " stale");
    $("badgeText").textContent = p.checkedAt
      ? `Last updated: ${dateTime(p.checkedAt)}`
      : `Saved prices · IPT table ${p.tableDate ? dayLabel(p.tableDate) : "—"}`;
    b.title = p.live ? "Prices were just read from IPT Group."
      : "IPT could not be reached recently — showing the last saved prices.";
  }

  function renderFuels() {
    const p = state.data.prices;
    $("pricesSub").textContent = p.tableDate ? `${p.source} · official table in force from ${dayLabel(p.tableDate)}` : "";
    const grid = $("fuelGrid");
    clear(grid);
    for (const f of p.fuels) {
      const card = el("article", { class: "fuel", "data-key": f.key },
        el("div", { class: "fuel-top" },
          el("span", { class: "fuel-ico" }, icon(ICONS[FUEL_ICON[f.key]] || ICONS.pump)),
          el("span", { class: "fuel-name", text: f.name === "Gas (LPG)" ? "GAS (LPG)" : f.name.toUpperCase() })),
        el("p", { class: "fuel-price" }, f.price != null ? fmt(f.price) : "—", " ", el("small", { text: "L.L." })),
        el("p", { class: "fuel-unit", text: f.price != null ? f.unit : "not available" }),
        f.perLitre != null ? el("p", { class: "fuel-litre", text: `${fmt(f.perLitre)} L.L. / litre` }) : null);
      if (f.change) {
        const up = f.change > 0;
        card.append(el("p", { class: `fuel-change ${up ? "up" : "down"}`, title: "Change since the previous official table" },
          icon(up ? ICONS.up : ICONS.down), `${signed(f.change)} L.L.`));
      } else {
        card.append(el("p", { class: "fuel-change flat", text: f.change === 0 ? "No change" : "No previous table" }));
      }
      if (f.asOf) card.append(el("p", { class: "fuel-date", text: `Last update: ${dayLabel(f.asOf)}` }));
      grid.append(card);
    }
  }

  function renderMonthSelects() {
    const months = state.data.months.slice();
    if (!months.some((m) => m.month === state.month)) months.unshift({ month: state.month, label: state.data.rate.label, status: state.data.rate.status });
    const sig = months.map((m) => `${m.month}:${m.status}`).join("|");
    for (const sel of [$("month"), $("monthTile")]) {
      if (sel.dataset.sig !== sig) {
        clear(sel);
        for (const m of months) {
          const note = m.status === "partial" ? " · to date" : m.status === "future" ? " · estimate" : "";
          sel.append(el("option", { value: m.month, text: m.label + (sel.id === "month" ? note : "") }));
        }
        sel.dataset.sig = sig;
      }
      sel.value = state.month;
    }
  }

  function drow(label, value, hint, final) {
    return el("div", { class: "drow" + (final ? " final" : "") },
      el("span", {}, label, hint ? el("span", { class: "hint", text: hint }) : null),
      el("b", { text: value }));
  }

  function renderRate() {
    const { rate: r, rule } = state.data;
    $("fFuel").textContent = rule.fuel;
    $("fLitres").textContent = `${rule.litresPerDay} litres`;
    $("fRounding").textContent = `Nearest ${fmt(rule.roundTo)}`;
    $("fEffective").textContent = dayLabel(rule.newRuleStart);
    $("fMethod").textContent = r.legacy ? `Fixed (${fmt(rule.legacyPerDay)} L.L. / day)` : "Fuel-indexed (by official price)";

    $("eyebrow").textContent = r.legacy ? "Daily Transportation Allowance · old terms"
      : r.mixed ? `Daily Transportation Allowance · from ${shortDay(rule.newRuleStart)}` : "Daily Transportation Allowance";
    $("rate").textContent = fmt(r.ratePerDay);

    // limits meter (applies to the fuel rate)
    $("meter").hidden = r.legacy;
    $("minLabel").textContent = `Min ${fmt(rule.minPerDay)}`;
    $("maxLabel").textContent = `Max ${fmt(rule.maxPerDay)}`;
    const pct = Math.max(0, Math.min(100, (((r.fuelRatePerDay ?? r.ratePerDay) - rule.minPerDay) / (rule.maxPerDay - rule.minPerDay)) * 100));
    $("marker").style.left = `${pct}%`;
    const lim = $("limitText");
    lim.className = r.clamped ? "warn" : "";
    lim.textContent = r.clamped === "min" ? "at the minimum" : r.clamped === "max" ? "at the maximum" : "within limits";

    // calculation details
    const body = $("howBody");
    clear(body);
    const used = $("usedBox");
    clear(used);
    used.hidden = !!r.legacy;
    body.append(el("h4", { text: "Calculation Details" }));
    if (r.legacy) {
      body.append(drow("Old terms — fixed rate", `${fmt(rule.legacyPerDay)} L.L.`, null, true));
      body.append(el("p", { class: "note", text: `Before ${dayLabel(rule.newRuleStart)} the rate was a fixed ${fmt(rule.legacyPerDay)} L.L. per day.` }));
      $("rateSub").textContent = "No fuel averaging applies to this month.";
      return;
    }
    const adj = r.roundedPerDay - r.rawPerDay;
    body.append(
      drow(`Average price per litre (${rule.fuel})`, `${fmt(r.avgPerLitre)} L.L.`,
        `${fmt(r.avgQuote20L)} per ${rule.litresPerQuote} L ÷ ${rule.litresPerQuote}`),
      drow("Daily consumption", `${rule.litresPerDay} litres`),
      drow("Calculated daily amount", `${fmt(r.rawPerDay)} L.L.`),
      drow("Rounding adjustment", `${adj === 0 ? "0" : signed(adj)} L.L.`));
    if (r.clamped) {
      body.append(drow(r.clamped === "min" ? "Raised to the minimum" : "Capped at the maximum",
        `${signed(r.fuelRatePerDay - r.roundedPerDay)} L.L.`));
    }
    body.append(drow("Final daily rate", `${fmt(r.fuelRatePerDay)} L.L.`, null, true));
    if (r.segments && r.segments.length) {
      used.append(el("h4", { text: "Prices used for the average" }));
      used.append(el("table", { class: "segments" },
        el("thead", {}, el("tr", {}, el("th", { text: "Price in force" }), el("th", { class: "num", text: "Days" }), el("th", { class: "num", text: `${rule.fuel} / ${rule.litresPerQuote} L` }))),
        el("tbody", {}, r.segments.map((s) => el("tr", {},
          el("td", { text: rangeLabel(s.from, s.to) }),
          el("td", { class: "num", text: String(s.days) }),
          el("td", { class: "num", text: fmt(s.unl95) }))))));
    }
    if (r.status === "partial") {
      used.append(el("p", { class: "note", text: "This month isn't over yet: the average covers the days up to today and updates itself whenever IPT publishes new prices." }));
    } else if (r.status === "future") {
      used.append(el("p", { class: "note", text: "No prices are published for this month yet. This is an estimate from the latest table and will update automatically." }));
    }


    $("rateSub").textContent =
      `Calculated using the average official ${rule.fuel} price over ${rangeLabel(r.averagedFrom, r.averagedTo)} (${r.days} day${r.days === 1 ? "" : "s"}), ` +
      `multiplied by ${rule.litresPerDay} litres per day, then rounded to the nearest ${fmt(rule.roundTo)} L.L. and kept between ${fmt(rule.minPerDay)} and ${fmt(rule.maxPerDay)} L.L.`;
  }

  /* breakdown rows are rebuilt only when the month changes, so typing keeps focus */
  function dayInput(key, max, label) {
    const inp = el("input", { class: "day-input", type: "number", inputmode: "numeric", min: "0", max: String(max), step: "1", "data-key": key, "aria-label": label });
    inp.value = state[key] == null ? "" : String(state[key]);
    return inp;
  }
  function renderBreakdown() {
    const { rate: r, rule } = state.data;
    const sig = `${r.month}|${r.mixed}|${r.legacy}|${r.ratePerDay}`;
    const tb = $("breakBody");
    if (tb.dataset.sig === sig) return;
    tb.dataset.sig = sig;
    clear(tb);
    if (r.mixed) {
      const start = dayLabel(rule.newRuleStart);
      tb.append(
        el("tr", { "data-row": "old" },
          el("td", {}, `Before ${start}`, el("span", { class: "sub", text: `(${fmt(r.oldRatePerDay)} L.L.)` })),
          el("td", { class: "num" }, dayInput("daysOld", r.oldDays ?? 31, `Days worked before ${start}`)),
          el("td", { class: "num", text: `${fmt(r.oldRatePerDay)} L.L.` }),
          el("td", { class: "num", "data-total": "old" })),
        el("tr", { "data-row": "new" },
          el("td", {}, `From ${start}`, el("span", { class: "sub", text: `(${fmt(r.ratePerDay)} L.L.)` })),
          el("td", { class: "num" }, dayInput("daysNew", r.newDays ?? 31, `Days worked from ${start}`)),
          el("td", { class: "num", text: `${fmt(r.ratePerDay)} L.L.` }),
          el("td", { class: "num", "data-total": "new" })));
    } else {
      tb.append(el("tr", {},
        el("td", {}, r.label, el("span", { class: "sub", text: r.legacy ? "(old terms)" : r.status === "future" ? "(estimate)" : r.status === "partial" ? "(to date)" : "(full month)" })),
        el("td", { class: "num" }, dayInput("days", 31, "Days worked")),
        el("td", { class: "num", text: `${fmt(r.ratePerDay)} L.L.` }),
        el("td", { class: "num", "data-total": "one" })));
    }
  }

  /* everything that depends on days / employees */
  function renderTotals() {
    const r = state.data.rate;
    const emp = state.employees;
    const days = daysOf(r);
    const ok = days != null && emp != null;

    // working-days tile
    const dIn = $("days");
    dIn.readOnly = !!r.mixed;
    if (r.mixed) { dIn.value = days == null ? "" : String(days); dIn.title = "Edit the days in the Calculation Breakdown"; }
    else if (document.activeElement !== dIn) { dIn.value = state.days == null ? "" : String(state.days); dIn.removeAttribute("title"); }
    const ds = $("daysSub");
    clear(ds);
    ds.append(el("i", { class: "dot-sm" }),
      r.mixed ? `${state.daysOld ?? "–"} + ${state.daysNew ?? "–"} days` : days === state.data.rule.defaultDays ? "full month" : "days worked");

    // breakdown cells + inputs in sync
    for (const inp of document.querySelectorAll(".day-input")) {
      if (document.activeElement !== inp) inp.value = state[inp.dataset.key] == null ? "" : String(state[inp.dataset.key]);
    }
    const cell = (k) => document.querySelector(`[data-total="${k}"]`);
    if (r.mixed) {
      cell("old").textContent = state.daysOld == null ? "—" : `${fmt(state.daysOld * r.oldRatePerDay)} L.L.`;
      cell("new").textContent = state.daysNew == null ? "—" : `${fmt(state.daysNew * r.ratePerDay)} L.L.`;
    } else if (cell("one")) {
      cell("one").textContent = state.days == null ? "—" : `${fmt(state.days * r.ratePerDay)} L.L.`;
    }
    const L = ok ? lineFor(r, days) : null;
    $("breakDays").textContent = days == null ? "—" : String(days);
    $("breakTotal").textContent = L ? `${fmt(L.total)} L.L.` : "—";

    const total = L ? L.total * emp : null;
    const forWho = emp > 1 ? `(for ${fmt(emp)} employees)` : "(for 1 employee)";
    $("payTotal").textContent = total == null ? "—" : fmt(total);
    $("payFor").textContent = L && emp > 1 ? `${forWho} · ${fmt(L.total)} L.L. each` : forWho;
    $("budget").textContent = total == null ? "—" : fmt(total);
    $("budgetSub").textContent = forWho;

    const old = L ? L.days * r.oldRatePerDay * emp : null;
    $("oldLine").textContent = L == null ? "" : r.legacy
      ? `Old terms: ${fmt(state.data.rule.legacyPerDay)} L.L. per day.`
      : `Under the old terms (${fmt(r.oldRatePerDay)} / day) this would be ${fmt(old)} L.L. — ${signed(total - old)} L.L. now.`;

    renderMonths();
  }

  function renderMonths() {
    const { months, rule } = state.data;
    const days = state.days, emp = state.employees;
    const ok = days != null && emp != null;
    $("thTotal").textContent = ok ? `${days} days${emp > 1 ? ` × ${fmt(emp)}` : ""}` : "Total";
    const body = $("monthsBody");
    clear(body);
    for (const m of months.filter((x) => x.status !== "future")) {
      const sub = m.status === "partial" ? `${m.days} days averaged · to date` : `full month · ${m.days} days`;
      const btn = el("button", { class: "month-btn", type: "button", "data-month": m.month }, m.label, el("span", { class: "sub", text: sub }));
      const rowOk = ok && daysOf(m) != null;
      const mL = rowOk ? lineFor(m, days) : { total: 0, avg: m.ratePerDay };
      const mRate = m.mixed ? mL.avg : m.ratePerDay;
      const tag = m.clamped ? el("span", { class: "tag", text: m.clamped === "min" ? "min" : "max" }) : null;
      body.append(el("tr", { class: m.month === state.month ? "current" : "" },
        el("td", {}, btn),
        el("td", { class: "num", text: m.avgQuote20L != null ? fmt(m.avgQuote20L) : "—" }),
        el("td", { class: "num" }, fmt(mRate), tag),
        el("td", { class: "num", text: rowOk ? fmt(mL.total * emp) : "—" })));
    }
    $("monthsSub").textContent = `Select a month to see its calculation. From ${state.data.months[0].label}: ${fmt(rule.minPerDay)}–${fmt(rule.maxPerDay)} L.L. per day.`;
  }

  /* ---------- trend chart (UNL 95) ---------- */
  function trendPoints() {
    const h = (state.data.history || []).filter((t) => t.unl95 != null);
    return h.slice(-12);
  }
  function renderChart() {
    const box = $("chart");
    clear(box);
    delete box.dataset.n;
    const pts = trendPoints();
    if (pts.length < 2) { box.append(el("div", { class: "chart-empty", text: "Not enough price history yet." })); return; }

    const W = Math.max(220, box.clientWidth), H = box.clientHeight || 170;
    const pad = { l: 36, r: 10, t: 34, b: 22 };
    const vals = pts.map((p) => p.unl95);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const step = 100_000;
    lo = Math.floor((lo - step / 2) / step) * step;
    hi = Math.ceil((hi + step / 2) / step) * step;
    const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / (pts.length - 1);
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);

    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    const ticks = [lo, (lo + hi) / 2, hi];
    for (const t of ticks) {
      s.append(svg("line", { class: "gridline", x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t) }));
      s.append(svg("text", { class: "axis", x: pad.l - 6, y: y(t) + 3.5, "text-anchor": "end" }, `${(t / 1e6).toFixed(1)}M`));
    }
    const xl = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
    for (const i of xl) {
      s.append(svg("text", { class: "axis", x: x(i), y: H - 5, "text-anchor": i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle" }, shortDay(pts[i].date)));
    }
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.unl95).toFixed(1)}`).join(" ");
    s.append(svg("path", { class: "area", d: `${d} L${x(pts.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z` }));
    s.append(svg("path", { class: "line", d }));

    const active = state.hover == null ? pts.length - 1 : Math.min(state.hover, pts.length - 1);
    s.append(svg("line", { class: "guide", x1: x(active), x2: x(active), y1: y(pts[active].unl95), y2: H - pad.b }));
    pts.forEach((p, i) => s.append(svg("circle", { class: "pt" + (i === active ? " on" : ""), cx: x(i), cy: y(p.unl95), r: i === active ? 4.5 : 2.5 })));

    box.dataset.x0 = pad.l; box.dataset.step = (W - pad.l - pad.r) / (pts.length - 1); box.dataset.n = pts.length;
    box.append(s);

    const tip = el("div", { class: "tip" }, fmt(pts[active].unl95), el("span", { text: `${dayLabel(pts[active].date)} · per 20 L` }));
    tip.style.left = `${Math.min(Math.max(x(active), 70), W - 70)}px`;
    tip.style.top = `${y(pts[active].unl95)}px`;
    box.append(tip);
  }

  /* ---------- recent updates + history ---------- */
  function renderUpdates() {
    const list = $("updates");
    clear(list);
    const h = state.data.history || [];
    const p = state.data.prices;
    const items = [];
    if (p.checkedAt) items.push({ when: dateTime(p.checkedAt), what: "Fuel prices checked on IPT", badge: ["Updated", ""] });
    for (let i = h.length - 1; i >= 0 && items.length < 4; i--) {
      const t = h[i], prev = h[i - 1];
      const diff = prev && t.unl95 != null && prev.unl95 != null ? t.unl95 - prev.unl95 : null;
      items.push({
        when: dayLabel(t.date),
        what: diff == null ? "Official price table published" : `UNL 95 ${signed(diff)} L.L. (now ${fmt(t.unl95)})`,
        badge: diff == null || diff === 0 ? ["New table", "blue"] : diff < 0 ? ["Price drop", ""] : ["Price rise", "red"],
        rise: diff > 0,
      });
    }
    for (const it of items) {
      list.append(el("li", { class: it.rise ? "rise" : "" },
        el("div", {}, el("p", { class: "when", text: it.when }), el("p", { class: "what", text: it.what })),
        el("span", { class: `badge ${it.badge[1]}`, text: it.badge[0] })));
    }
  }

  function renderHistory() {
    const body = $("historyBody");
    clear(body);
    const h = state.data.history || [];
    const cell = (v, prev) => {
      const td = el("td", { class: "num", text: v != null ? fmt(v) : "—" });
      if (v != null && prev != null && v !== prev) td.append(el("span", { class: `chg ${v > prev ? "up" : "down"}`, text: signed(v - prev) }));
      return td;
    };
    for (let i = h.length - 1; i >= 0; i--) {
      const t = h[i], pv = h[i - 1] || {};
      body.append(el("tr", {},
        el("td", { text: dayLabel(t.date) }),
        cell(t.unl95, pv.unl95), cell(t.unl98, pv.unl98), cell(t.diesel, pv.diesel), cell(t.lpg, pv.lpg)));
    }
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
    if (state.data && state.data.rate.mixed) return;
    state.days = readInt($("days"), 0, 31);
    if (state.data) renderTotals();
  });
  $("employees").addEventListener("input", () => {
    state.employees = readInt($("employees"), 1, 9999);
    if (state.data) renderTotals();
  });
  $("breakBody").addEventListener("input", (e) => {
    const inp = e.target.closest(".day-input");
    if (!inp) return;
    state[inp.dataset.key] = readInt(inp, 0, Number(inp.max));
    renderTotals();
  });
  for (const id of ["month", "monthTile"]) $(id).addEventListener("change", (e) => load({ month: e.target.value }));
  $("monthsBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-month]");
    if (!b) return;
    load({ month: b.dataset.month });
    $("calc").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("retryBtn").addEventListener("click", () => load());

  /* ---------- quick actions ---------- */
  $("reportBtn").addEventListener("click", () => $("reports").scrollIntoView({ behavior: "smooth", block: "start" }));
  $("printBtn").addEventListener("click", () => window.print());
  $("exportBtn").addEventListener("click", () => {
    if (!state.data) return;
    const { rate: r, rule, months, prices } = state.data;
    const emp = state.employees ?? 1;
    const days = daysOf(r);
    const L = days != null ? lineFor(r, days) : null;
    const rows = [
      ["TransportIQ Lebanon — transportation allowance"],
      ["Payroll period", r.label],
      ["Fuel", rule.fuel], ["Litres per day", rule.litresPerDay],
      ["Average price / 20 L", r.avgQuote20L ?? ""], ["Daily rate (L.L.)", r.ratePerDay],
      ["Employees", emp], [],
      ["Period", "Days worked", "Daily rate", "Total (per employee)"],
    ];
    if (r.mixed) {
      rows.push([`Before ${rule.newRuleStart}`, state.daysOld ?? "", r.oldRatePerDay, (state.daysOld ?? 0) * r.oldRatePerDay]);
      rows.push([`From ${rule.newRuleStart}`, state.daysNew ?? "", r.ratePerDay, (state.daysNew ?? 0) * r.ratePerDay]);
    } else {
      rows.push([r.label, state.days ?? "", r.ratePerDay, (state.days ?? 0) * r.ratePerDay]);
    }
    rows.push(["Total", days ?? "", "", L ? L.total : ""]);
    rows.push([`Total for ${emp} employee(s)`, "", "", L ? L.total * emp : ""], []);
    rows.push(["Month by month"], ["Month", "Avg / 20 L", "Per day", "Status"]);
    for (const m of months) rows.push([m.label, m.avgQuote20L ?? "", m.ratePerDay, m.status]);
    rows.push([], ["Official prices", `table of ${prices.tableDate || ""}`], ["Product", "Price (L.L.)", "Unit", "Change"]);
    for (const f of prices.fuels) rows.push([f.name, f.price ?? "", f.unit, f.change ?? ""]);
    const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = "﻿" + rows.map((row) => row.map(esc).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = el("a", { href: url, download: `transport-allowance-${r.month}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  /* ---------- "Refresh Prices" ---------- */
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
        : body.status === "failed" ? "IPT unreachable"
        : "Already up to date";
      await load({ fresh: true });
    } catch { msg = "Couldn't update"; }
    btn.disabled = false; btn.classList.remove("spin"); text.textContent = msg;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { text.textContent = "Refresh Prices"; }, 3500);
  });

  $("chart").addEventListener("mousemove", (e) => {
    const box = $("chart");
    if (!box.dataset.n) return;
    const px = e.clientX - box.getBoundingClientRect().left;
    const i = Math.max(0, Math.min(Number(box.dataset.n) - 1, Math.round((px - Number(box.dataset.x0)) / Number(box.dataset.step))));
    if (i !== state.hover) { state.hover = i; renderChart(); }
  });
  $("chart").addEventListener("mouseleave", () => { if (state.hover != null) { state.hover = null; renderChart(); } });

  let rz = null;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => state.data && renderChart(), 120); });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.data && Date.now() - state.loadedAt > 10 * 60 * 1000) load();
  });

  load();
})();
