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
    renderExport();
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
        el("thead", {}, el("tr", {}, el("th", { text: "Official price table" }), el("th", { class: "num", text: `${rule.fuel} / ${rule.litresPerQuote} L` }))),
        el("tbody", {}, r.segments.map((s) => el("tr", {},
          el("td", { text: `In force from ${dayLabel(s.tableDate)}` }),
          el("td", { class: "num", text: fmt(s.unl95) }))),
        ),
        el("tfoot", {}, el("tr", {},
          el("th", { text: `Average (${fmt(r.sumQuotes)} ÷ ${r.count})` }),
          el("th", { class: "num", text: fmt(r.avgQuote20L) })))));
    }
    if (r.status === "partial") {
      used.append(el("p", { class: "note", text: "This month isn't over yet: the average uses the price tables published up to today and updates itself whenever IPT publishes a new one." }));
    } else if (r.status === "future") {
      used.append(el("p", { class: "note", text: "No prices are published for this month yet. This is an estimate from the latest table and will update automatically." }));
    }


    $("rateSub").textContent =
      `Calculated using the average of the official ${rule.fuel} price tables for ${rangeLabel(r.averagedFrom, r.averagedTo)} (${r.count} price${r.count === 1 ? "" : "s"}), ` +
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

    renderOct();
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
  $("retryBtn").addEventListener("click", () => load());

  /* ---------- quick actions ---------- */
  $("reportBtn").addEventListener("click", () => $("octCalc").scrollIntoView({ behavior: "smooth", block: "center" }));
  $("printBtn").addEventListener("click", () => window.print());
  $("exportBtn").addEventListener("click", () => {
    if (!state.data) return;
    const { rate: r, rule, months, prices } = state.data;
    const emp = state.employees ?? 1;
    const days = daysOf(r);
    const L = days != null ? lineFor(r, days) : null;
    const rows = [
      ["Transport Lebanon — transportation allowance"],
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


  /* =====================================================================
     October calculator — "the new terms start on <date>"
       days before the date (from 2 Oct) stay at 450,000
       days from the date use the fuel rate, averaged from the date until today
     The server does the maths (/api/period); the days stay editable here.
     ===================================================================== */
  state.oct = { from: null, data: null, days: { old: null, new: null }, daysFor: null, seq: 0 };

  const shortRange = (a, b) => {
    const [, m1, d1] = part(a), [, m2, d2] = part(b);
    if (a === b) return `${d1} ${MON[m1 - 1]}`;
    return m1 === m2 ? `${d1} – ${d2} ${MON[m1 - 1]}` : `${d1} ${MON[m1 - 1]} – ${d2} ${MON[m2 - 1]}`;
  };

  async function loadOct(from) {
    const my = ++state.oct.seq;
    try {
      const res = await fetch(`/api/period${from ? `?from=${encodeURIComponent(from)}` : ""}`, { headers: { Accept: "application/json" } });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body && body.error) || `Server error (${res.status})`);
      if (my !== state.oct.seq) return;
      const o = state.oct;
      o.data = body;
      o.from = body.from;
      if (o.daysFor !== body.from) {            // a new start date → days go back to the defaults
        o.daysFor = body.from;
        o.days = { old: null, new: null };
        for (const r of body.rows) o.days[r.key] = r.days;
      }
      renderOct(true);
    } catch (e) {
      if (my !== state.oct.seq) return;
      $("octHow").textContent = e && e.message && !/failed to fetch|networkerror|load failed/i.test(e.message)
        ? e.message : "Couldn't reach the server. Check your connection and try again.";
    }
  }

  function renderOct(rebuild) {
    const o = state.oct, d = o.data;
    if (!d) return;
    const emp = state.employees ?? 1;

    // controls
    const inp = $("octFrom");
    inp.min = d.first; inp.max = d.to;
    if (document.activeElement !== inp) inp.value = d.from;
    inp.setAttribute("aria-invalid", "false");
    $("octWhole").hidden = d.from === d.first;
    const badge = $("octBadge");
    badge.textContent = d.status === "complete" ? "full month" : `to ${shortDay(d.to)}`;

    // one chip per IPT price change in October → start the new average from that table
    const chips = $("octChips");
    const csig = d.chips.map((c) => `${c.date}${c.future ? "f" : ""}`).join(",") + "|" + d.from;
    if (chips.dataset.sig !== csig) {
      chips.dataset.sig = csig;
      clear(chips);
      for (const c of d.chips) {
        chips.append(el("button", {
          type: "button", class: "chip" + (c.published ? "" : " soft"), "data-date": c.date, "aria-pressed": String(c.date === d.from),
          disabled: c.future, text: shortDay(c.date),
          title: c.future ? "Not published yet — available as soon as IPT publishes it" : c.published ? null : "No new table that day — the price in force is used",
        }));
      }
    }

    // rows (rebuilt only when the date / prices change, so typing keeps its focus)
    const sig = `${d.from}|${d.to}|${d.ratePerDay}|${d.rows.map((r) => r.key).join()}`;
    const tb = $("octBody");
    if (rebuild || tb.dataset.sig !== sig) {
      tb.dataset.sig = sig;
      clear(tb);
      for (const r of d.rows) {
        const isNew = r.key === "new";
        const input = el("input", { class: "day-input", type: "number", inputmode: "numeric", min: "0", max: "31", step: "1", "data-key": r.key, "aria-label": `Days worked ${shortRange(r.from, r.to)}` });
        input.value = o.days[r.key] == null ? "" : String(o.days[r.key]);
        tb.append(el("tr", { class: isNew ? "fuel-row" : "" },
          el("td", {}, el("span", { class: "per", text: shortRange(r.from, r.to) }),
            el("span", { class: "sub", text: `${fmt(r.ratePerDay)} / day` })),
          el("td", { class: "num" }, input),
          el("td", { class: "num", "data-oct-total": r.key })));
      }
    }
    let days = 0, total = 0, ok = true;
    for (const r of d.rows) {
      const n = o.days[r.key];
      const cell = tb.querySelector(`[data-oct-total="${r.key}"]`);
      if (n == null) { ok = false; cell.textContent = "—"; continue; }
      days += n; total += n * r.ratePerDay;
      cell.textContent = fmt(n * r.ratePerDay);
    }
    $("octDays").textContent = ok ? String(days) : "—";
    $("octTotal").textContent = ok ? fmt(total) : "—";
    $("octAvg").textContent = ok && days > 0 ? fmt(total / days) : "—";
    const em = $("octEmp");
    em.hidden = !(ok && emp > 1);
    if (!em.hidden) em.textContent = `For ${fmt(emp)} employees: ${fmt(total * emp)} L.L.`;

    // how the rate was found
    const how = $("octHow");
    clear(how);
    const lim = d.clamped === "min" ? `raised to the ${fmt(d.rule.minPerDay)} minimum`
      : d.clamped === "max" ? `capped at the ${fmt(d.rule.maxPerDay)} maximum` : `within ${fmt(d.rule.minPerDay)} – ${fmt(d.rule.maxPerDay)}`;
    how.append(
      `Fuel rate from ${shortDay(d.from)}: `, el("b", { text: `${fmt(d.count)} IPT price${d.count === 1 ? "" : "s"}` }),
      ` (${shortRange(d.from, d.to)}) → average `, el("b", { text: fmt(d.avgQuote20L) }),
      ` per 20 L → ÷ 20 × ${d.rule.litresPerDay} L = ${fmt(d.rawPerDay)} → `, el("b", { text: `${fmt(d.ratePerDay)} / day` }),
      el("span", { class: "tag" + (d.clamped ? "" : " ok"), text: lim }));
    $("octFoot").textContent = `IPT table of ${dayLabel(d.latestTable)}` +
      (d.checkedAt ? ` · checked ${new Date(d.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : " · saved prices") + ".";
  }

  $("octFrom").addEventListener("change", (e) => {
    const v = e.target.value;
    const d = state.oct.data;
    if (!v || (d && (v < d.first || v > d.to))) { e.target.setAttribute("aria-invalid", "true"); return; }
    loadOct(v);
  });
  $("octChips").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (c) loadOct(c.dataset.date);
  });
  $("octWhole").addEventListener("click", () => state.oct.data && loadOct(state.oct.data.first));
  $("octRecheck").addEventListener("click", () => $("updateBtn").click());
  $("octBody").addEventListener("input", (e) => {
    const inp = e.target.closest(".day-input");
    if (!inp) return;
    state.oct.days[inp.dataset.key] = readInt(inp, 0, 31);
    renderOct(false);
  });

  /* =====================================================================
     Fuel Price History → Excel (.xlsx), with a date range
     A tiny hand-made .xlsx (zip of XML files) — no library needed.
     ===================================================================== */
  const xlsx = (() => {
    const enc = new TextEncoder();
    const crcTable = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
      return t;
    })();
    const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

    function zip(files) { // "stored" entries (no compression) — valid, and plenty for a small sheet
      const parts = [], central = [];
      let offset = 0;
      const now = new Date();
      const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
      const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
      for (const f of files) {
        const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data), len = data.length;
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
        lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
        lh.setUint32(18, len, true); lh.setUint32(22, len, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
        parts.push(new Uint8Array(lh.buffer), name, data);
        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
        ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
        ch.setUint32(20, len, true); ch.setUint32(24, len, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
        central.push(new Uint8Array(ch.buffer), name);
        offset += 30 + name.length + len;
      }
      const cdSize = central.reduce((a, b) => a + b.length, 0);
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
      end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
      return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    }

    const X = (v) => String(v).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
    const col = (i) => String.fromCharCode(65 + i); // A..I is all we need
    const HEAD = 1, DATE = 2, PRICE = 3, CHANGE = 4; // style ids in styles.xml below

    /** headers: string[]; rows: Array<Array<{t:"s"|"n"|"d", v}|null>>; widths: number[] */
    function sheet(name, headers, rows, widths) {
      const cell = (c, r, x, style) => {
        const ref = `${col(c)}${r}`;
        if (x == null) return "";
        if (x.t === "s") return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${X(x.v)}</t></is></c>`;
        return `<c r="${ref}" s="${style}"><v>${x.v}</v></c>`;
      };
      const head = `<row r="1" ht="32" customHeight="1">${headers.map((h, i) => cell(i, 1, { t: "s", v: h }, HEAD)).join("")}</row>`;
      const body = rows.map((row, ri) => `<row r="${ri + 2}">${row.map((x, ci) => cell(ci, ri + 2, x, x && x.t === "d" ? DATE : ci % 2 === 1 ? PRICE : CHANGE)).join("")}</row>`).join("");
      const last = `${col(headers.length - 1)}${rows.length + 1}`;
      const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
        `<sheetFormatPr defaultRowHeight="18"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
        `<sheetData>${head}${body}</sheetData>${rows.length ? `<autoFilter ref="A1:${last}"/>` : ""}</worksheet>`;
      const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<numFmts count="2"><numFmt numFmtId="164" formatCode="d mmm yyyy"/><numFmt numFmtId="165" formatCode="[Red]+#,##0;[Color10]-#,##0;&quot;&quot;"/></numFmts>` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>` +
        `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F2A4D"/><bgColor indexed="64"/></patternFill></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
        `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>` +
        `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
        `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
      return zip([
        { name: "[Content_Types].xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
        { name: "_rels/.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
        { name: "xl/workbook.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${X(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
        { name: "xl/_rels/workbook.xml.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
        { name: "xl/styles.xml", text: styles },
        { name: "xl/worksheets/sheet1.xml", text: sheetXml },
      ]);
    }
    return { sheet };
  })();

  const FUEL_COLS = [["unl95", "UNL 95 (per 20 L)", "UNL 95 change"], ["unl98", "UNL 98 (per 20 L)", "UNL 98 change"],
    ["diesel", "Diesel (per 20 L)", "Diesel change"], ["lpg", "Gas LPG (per 10 kg)", "Gas LPG change"]];
  const excelDate = (iso) => { const [y, m, d] = part(iso); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000; };
  const isoToday = () => state.data ? state.data.today : new Date().toISOString().slice(0, 10);
  const addDaysIso = (iso, n) => { const [y, m, d] = part(iso); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

  function exportRange() {
    const from = $("xlFrom").value, to = $("xlTo").value;
    const h = (state.data && state.data.history) || [];
    const ok = from && to && from <= to;
    const rows = ok ? h.filter((t) => t.date >= from && t.date <= to) : [];
    return { from, to, ok, rows };
  }

  function renderExport() {
    const h = (state.data.history || []);
    if (!h.length) return;
    const first = h[0].date, last = h[h.length - 1].date;
    const f = $("xlFrom"), t = $("xlTo");
    for (const x of [f, t]) { x.min = first; x.max = last; }
    if (!f.value || !t.value || !f.dataset.touched) { f.value = first; t.value = last; }   // untouched → the whole history
    else if (t.dataset.followLatest === "1") t.value = last;                               // a new table arrived → "to" follows it
    updateExportInfo();
  }

  function updateExportInfo() {
    const { from, to, ok, rows } = exportRange();
    const info = $("xlInfo"), btn = $("xlBtn");
    info.classList.toggle("bad", !ok || rows.length === 0);
    if (!ok) info.textContent = from && to ? "“From” is after “To” — swap the dates." : "Pick both dates.";
    else if (!rows.length) info.textContent = "No price tables took effect in this range.";
    else info.textContent = `${rows.length} price table${rows.length === 1 ? "" : "s"} · ${dayLabel(rows[0].date)} → ${dayLabel(rows[rows.length - 1].date)}`;
    btn.disabled = !ok || rows.length === 0;
    for (const c of document.querySelectorAll(".xl .chip")) {
      const r = presetRange(c.dataset.range);
      c.setAttribute("aria-pressed", String(!!r && r[0] === from && r[1] === to));
    }
  }

  function presetRange(kind) {
    const h = (state.data && state.data.history) || [];
    if (!h.length) return null;
    const last = h[h.length - 1].date, first = h[0].date, today = isoToday();
    if (kind === "all") return [first, last];
    if (kind === "month") { const m = today.slice(0, 7); return [`${m}-01` < first ? first : `${m}-01`, last]; }
    if (kind === "30") { const a = addDaysIso(today, -29); return [a < first ? first : a, last]; }
    return null;
  }

  for (const id of ["xlFrom", "xlTo"]) {
    $(id).addEventListener("input", () => {
      $("xlFrom").dataset.touched = "1";
      const h = (state.data && state.data.history) || [];
      $("xlTo").dataset.followLatest = h.length && $("xlTo").value === h[h.length - 1].date ? "1" : "0";
      updateExportInfo();
    });
  }
  $("xl").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    const r = presetRange(c.dataset.range);
    if (!r) return;
    $("xlFrom").value = r[0]; $("xlTo").value = r[1];
    $("xlFrom").dataset.touched = c.dataset.range === "all" ? "" : "1";
    $("xlTo").dataset.followLatest = "1";
    updateExportInfo();
  });

  $("xlBtn").addEventListener("click", () => {
    const { from, to, ok, rows } = exportRange();
    if (!ok || !rows.length) return;
    const all = state.data.history;
    const cells = rows.slice().reverse().map((t) => {         // newest first, like the page
      const prev = all[all.findIndex((x) => x.date === t.date) - 1] || {};
      const row = [{ t: "d", v: excelDate(t.date) }];
      for (const [k] of FUEL_COLS) {
        row.push(t[k] != null ? { t: "n", v: t[k] } : null);
        row.push(t[k] != null && prev[k] != null && t[k] !== prev[k] ? { t: "n", v: t[k] - prev[k] } : null);
      }
      return row;
    });
    const blob = xlsx.sheet("Fuel Price History",
      ["In force from", ...FUEL_COLS.flatMap(([, a, b]) => [a, b])], cells, [16, 18, 15, 18, 15, 18, 15, 20, 15]);
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: `fuel-price-history_${from}_to_${to}.xlsx` });
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
      await Promise.all([load({ fresh: true }), loadOct(state.oct.from)]);
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
    if (document.visibilityState === "visible" && state.data && Date.now() - state.loadedAt > 10 * 60 * 1000) { load(); loadOct(state.oct.from); }
  });

  load();
  loadOct();
})();
