"use strict";

/* ============================================================
   Abono — local itemized-expense splitter
   No dependencies. State is saved locally in the browser (localStorage).
   ============================================================ */

const CURRENCY = "₱"; // ₱ — change here for a different symbol
const STORAGE_KEY = "abono.v1";
const PWD_DISCOUNT_PCT = 20; // fixed PWD/Senior discount % (PH law: RA 9994 / RA 10754)
const PWD_VAT_PCT = 12;      // fixed VAT % (PH)

/* ---------- id generator ---------- */
let _idc = 0;
function uid(prefix) {
  return (prefix || "id") + "_" + Date.now().toString(36) + (++_idc).toString(36);
}

/* ---------- number helpers ---------- */
// Parse a user-entered string into a number (tolerant of partial input).
function num(s) {
  if (typeof s === "number") return isFinite(s) ? s : 0;
  if (s == null) return 0;
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
}
function fmt(n) {
  if (!isFinite(n)) n = 0;
  // avoid "-0.00"
  if (Object.is(n, -0) || (n < 0 && n > -0.005)) n = 0;
  return n.toFixed(2);
}

// Split an amount evenly into n parts (in cents), distributing the leftover
// cent(s) to the first parts. Works for negative amounts (discounts) too.
function splitEvenCents(amount, n) {
  if (n <= 0) return [];
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / n);
  let rem = cents - base * n; // 0..n-1
  const out = [];
  for (let i = 0; i < n; i++) out.push(base + (i < rem ? 1 : 0));
  return out;
}

// Distribute `total` across weights proportionally, balanced to the exact
// total in cents (largest-remainder method).
function distributeProportionalCents(total, weights) {
  const totalCents = Math.round(total * 100);
  const n = weights.length;
  const out = new Array(n).fill(0);
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (n === 0 || sumW === 0 || totalCents === 0) return out;

  const raw = weights.map((w) => (totalCents * w) / sumW);
  const floors = raw.map((x) => Math.floor(x));
  let used = floors.reduce((a, b) => a + b, 0);
  let leftover = totalCents - used; // can be negative
  // order indices by fractional remainder (desc for positive leftover)
  const fracs = raw
    .map((x, i) => ({ i, f: x - Math.floor(x) }))
    .sort((a, b) => b.f - a.f);
  const step = leftover >= 0 ? 1 : -1;
  let k = 0;
  leftover = Math.abs(leftover);
  while (leftover > 0 && n > 0) {
    out[fracs[k % n].i] += step;
    k++;
    leftover--;
  }
  for (let i = 0; i < n; i++) out[i] += floors[i];
  return out;
}

/* ---------- state ---------- */
let state = null;

function seedState() {
  const p1 = uid("p"), p2 = uid("p"), p3 = uid("p");
  const mk = (name, price, included) => {
    const shares = {};
    [p1, p2, p3].forEach((pid) => {
      shares[pid] = { included: included.includes(pid), override: null };
    });
    return { id: uid("it"), name, price, splitEqually: true, shares };
  };
  return {
    currency: CURRENCY,
    people: [
      { id: p1, name: "Foo" },
      { id: p2, name: "Bar" },
      { id: p3, name: "Baz" },
    ],
    items: [
      mk("Sinigang na Adobo", "705", [p1, p2, p3]),
      mk("Tinolang Porkchop", "330", [p1]),
    ],
    tax: { mode: "amount", value: "0" },
    tip: { mode: "percent", value: "0" },
    pwd: { disc: "20", vat: "12", discountable: "", members: {} },
  };
}

function normalize(s) {
  // Make sure every item has a share entry for every person.
  s.people.forEach((p) => {
    s.items.forEach((it) => {
      if (!it.shares[p.id]) it.shares[p.id] = { included: false, override: null };
    });
  });
  // Drop share entries for people who no longer exist.
  const ids = new Set(s.people.map((p) => p.id));
  s.items.forEach((it) => {
    Object.keys(it.shares).forEach((pid) => {
      if (!ids.has(pid)) delete it.shares[pid];
    });
  });
  // Blank rows default to "everyone included" (keeps saved/imported bills consistent
  // with the current default so the row you type into starts split among all).
  s.items.forEach((it) => {
    if (isBlankItem(it)) s.people.forEach((p) => (it.shares[p.id].included = true));
  });
  if (!s.tax) s.tax = { mode: "amount", value: "0" };
  if (!s.tip) s.tip = { mode: "percent", value: "0" };
  if (!s.pwd) s.pwd = { disc: "20", vat: "12", discountable: "", members: {} };
  if (!s.pwd.members) s.pwd.members = {};
  if (s.pwd.disc == null) s.pwd.disc = "20";
  if (s.pwd.vat == null) s.pwd.vat = "12";
  if (s.pwd.discountable == null) s.pwd.discountable = "";
  Object.keys(s.pwd.members).forEach((pid) => { if (!ids.has(pid)) delete s.pwd.members[pid]; });
  s.currency = s.currency || CURRENCY;
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.warn("Could not load saved bill:", e);
  }
  return seedState();
}

let _saveTimer = null;
function save() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Could not save bill:", e);
    }
  }, 150);
}

/* ---------- item helpers ---------- */
function isBlankItem(it) {
  const noName = !it.name || !it.name.trim();
  const noPrice = it.price == null || String(it.price).trim() === "";
  return noName && noPrice;
}

function blankItem() {
  // new rows default to being split among everyone (all cells ON)
  const shares = {};
  state.people.forEach((p) => (shares[p.id] = { included: true, override: null }));
  return { id: uid("it"), name: "", price: "", splitEqually: true, shares };
}

// Always keep exactly one trailing blank row.
function ensureTrailingBlank() {
  while (state.items.length > 1 && isBlankItem(state.items[state.items.length - 1]) &&
         isBlankItem(state.items[state.items.length - 2])) {
    state.items.pop();
  }
  if (state.items.length === 0 || !isBlankItem(state.items[state.items.length - 1])) {
    state.items.push(blankItem());
  }
}

/* ---------- computation ---------- */
// Returns per-person amounts (numbers) + N/A for one item.
function computeItem(it) {
  const price = num(it.price);
  const amounts = {};
  state.people.forEach((p) => (amounts[p.id] = 0));

  const included = state.people.filter((p) => it.shares[p.id] && it.shares[p.id].included);

  // even split among included people without an override
  const overridden = included.filter((p) => it.shares[p.id].override != null &&
                                             String(it.shares[p.id].override).trim() !== "");
  const auto = included.filter((p) => !overridden.includes(p));

  let overrideSum = 0;
  overridden.forEach((p) => {
    const v = num(it.shares[p.id].override);
    amounts[p.id] = v;
    overrideSum += v;
  });

  const remaining = price - overrideSum;
  const parts = splitEvenCents(remaining, auto.length);
  auto.forEach((p, i) => (amounts[p.id] = parts[i] / 100));

  let assigned = overrideSum + parts.reduce((a, b) => a + b, 0) / 100;
  return { amounts, na: price - assigned };
}

function computeAll() {
  const perItem = state.items.map(computeItem);

  const subtotals = {};
  state.people.forEach((p) => (subtotals[p.id] = 0));
  let naTotal = 0;
  let subtotalTotal = 0;

  state.items.forEach((it, idx) => {
    subtotalTotal += num(it.price);
    naTotal += perItem[idx].na;
    state.people.forEach((p) => (subtotals[p.id] += perItem[idx].amounts[p.id]));
  });

  // PWD / Senior discount (PH): for a PWD person, remove VAT from their share,
  // then take the discount off the VAT-exclusive amount. Service charge (tip) is
  // computed on the VAT-exclusive net for everyone (PH-standard).
  // The discount base is entered manually (e.g. the most-expensive order the restaurant
  // discounted, VAT-exclusive — the receipt's DISCOUNTABLE line). VAT-removal + discount are
  // computed from it and the whole deduction is given to the PWD/Senior person(s).
  const vat = PWD_VAT_PCT / 100;
  const disc = PWD_DISCOUNT_PCT / 100;
  const discountable = num(state.pwd.discountable);
  const r2 = (x) => Math.round(x * 100) / 100;
  const vatRemoved = r2(discountable * vat);   // VAT lifted off the discountable base
  const pwdDiscAmt = r2(discountable * disc);   // the % discount itself (rounded like the receipt)
  const totalDeduction = vatRemoved + pwdDiscAmt;

  const members = state.people.filter((p) => state.pwd.members[p.id]);
  const vatCents = splitEvenCents(vatRemoved, members.length);  // split evenly if >1 PWD
  const discCents = splitEvenCents(pwdDiscAmt, members.length);

  const pwdReduction = {}, vatShare = {}, discShare = {}, netAfterPwd = {}, scBase = {};
  state.people.forEach((p) => { pwdReduction[p.id] = 0; vatShare[p.id] = 0; discShare[p.id] = 0; });
  members.forEach((p, i) => {
    vatShare[p.id] = vatCents[i] / 100;
    discShare[p.id] = discCents[i] / 100;
    pwdReduction[p.id] = vatShare[p.id] + discShare[p.id];
  });

  let pwdTotal = 0, vatRemovedTotal = 0, pwdDiscTotal = 0;
  state.people.forEach((p) => {
    const s = subtotals[p.id];
    netAfterPwd[p.id] = s - pwdReduction[p.id];        // full deduction goes to the PWD
    scBase[p.id] = s / (1 + vat) - discShare[p.id];    // service charge on VAT-exclusive net
    pwdTotal += pwdReduction[p.id];
    vatRemovedTotal += vatShare[p.id];
    pwdDiscTotal += discShare[p.id];
  });

  const taxWeights = state.people.map((p) => netAfterPwd[p.id]);
  const tipWeights = state.people.map((p) => scBase[p.id]);
  const St = taxWeights.reduce((a, b) => a + b, 0);
  const Ss = tipWeights.reduce((a, b) => a + b, 0);

  const taxTotal = state.tax.mode === "percent" ? (St * num(state.tax.value)) / 100 : num(state.tax.value);
  const tipTotal = state.tip.mode === "percent" ? (Ss * num(state.tip.value)) / 100 : num(state.tip.value);

  const taxCents = distributeProportionalCents(taxTotal, taxWeights);
  const tipCents = distributeProportionalCents(tipTotal, tipWeights);

  const tax = {}, tip = {}, grand = {};
  state.people.forEach((p, i) => {
    tax[p.id] = taxCents[i] / 100;
    tip[p.id] = tipCents[i] / 100;
    grand[p.id] = netAfterPwd[p.id] + tax[p.id] + tip[p.id];
  });

  return {
    perItem,
    subtotals,
    naTotal,
    subtotalTotal,
    pwdReduction,
    vatShare,
    discShare,
    vatRemovedTotal,
    pwdDiscTotal,
    pwdTotal,
    netAfterPwd,
    tax,
    tip,
    grand,
    taxTotal,
    tipTotal,
    grandTotal: subtotalTotal - pwdTotal + taxTotal + tipTotal,
  };
}

/* ---------- rendering ---------- */
const tableEl = document.getElementById("bill");

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function render() {
  ensureTrailingBlank();
  const c = computeAll();
  const people = state.people;

  /* ---- header ---- */
  let head = "<thead><tr>";
  head += `<th class="col-item">Item</th>`;
  head += `<th class="col-price">${esc(state.currency)}</th>`;
  people.forEach((p) => {
    head += `<th class="col-person">
      <div class="person-head">
        <input class="txt-input pname" data-act="pname" data-person="${p.id}"
               data-focus="pname:${p.id}" value="${esc(p.name)}" placeholder="Name" />
        <button type="button" class="icon-btn" data-act="del-person" data-person="${p.id}" title="Remove person">✕</button>
      </div>
    </th>`;
  });
  head += `<th class="col-add"><button type="button" class="tab-add" data-act="add-person" title="Add person">+</button></th>`;
  head += `<th class="col-na">N/A</th>`;
  head += `<th class="col-ctrl"></th>`;
  head += "</tr></thead>";

  /* ---- body ---- */
  let body = "<tbody>";
  state.items.forEach((it, idx) => {
    const res = c.perItem[idx];
    const trailing = idx === state.items.length - 1 && isBlankItem(it);
    body += "<tr>";
    body += `<td class="col-item-cell">
      <input class="txt-input" data-act="iname" data-item="${it.id}" data-focus="iname:${it.id}"
             value="${esc(it.name)}" placeholder="Description" /></td>`;
    body += `<td class="col-price-cell">
      <input class="num-input" data-act="price" data-item="${it.id}" data-focus="price:${it.id}"
             value="${esc(it.price)}" placeholder="0" inputmode="decimal" /></td>`;

    people.forEach((p) => {
      const sh = it.shares[p.id] || { included: false, override: null };
      // click-to-toggle cell (both directions); even split shown as text
      const cls = ["pcell", "toggle"];
      if (sh.included) cls.push("included");
      const disp = sh.included ? fmt(res.amounts[p.id]) : "&nbsp;";
      body += `<td class="${cls.join(" ")}" data-act="toggle" data-item="${it.id}"
            data-person="${p.id}" role="button" tabindex="0"
            title="Click to include / exclude">${disp}</td>`;
    });

    const allIn = people.length > 0 && people.every((p) => it.shares[p.id] && it.shares[p.id].included);
    body += `<td class="cell-add"></td>`;
    body += `<td class="cell-na">${fmt(res.na)}</td>`;
    body += `<td class="cell-ctrl">`;
    body += `<input type="checkbox" data-act="all-toggle" data-item="${it.id}" ${allIn ? "checked" : ""} title="Include everyone / no one" />`;
    if (!trailing) {
      body += `<button type="button" class="icon-btn" data-act="del-item" data-item="${it.id}" title="Remove item">✕</button>`;
    }
    body += `</td></tr>`;
  });
  body += "</tbody>";

  /* ---- footer ---- */
  const nCols = people.length;
  const foot = [];
  // Subtotal
  let sub = `<tr><td class="foot-label sub">Subtotal</td>`;
  sub += `<td class="foot-total">${fmt(c.subtotalTotal)}</td>`;
  people.forEach((p) => (sub += `<td class="foot-num">${fmt(c.subtotals[p.id])}</td>`));
  sub += `<td class="col-add"></td><td class="foot-num">${fmt(c.naTotal)}</td><td></td></tr>`;
  foot.push(sub);

  // PWD / Senior discount row: discountable base + who is PWD; shows the % discount only
  let pwd = `<tr class="pwd-row"><td class="foot-label">PWD / Senior
    <span class="pwd-rates">&minus;${PWD_DISCOUNT_PCT}% &nbsp;VAT ${PWD_VAT_PCT}%
      <label class="disc-field">&middot; Discountable ${esc(state.currency)}<input class="rate-mini disc-mini"
        data-act="pwd-discountable" data-focus="pwd-discountable" value="${esc(state.pwd.discountable)}"
        placeholder="0" inputmode="decimal"
        title="Discountable amount (VAT-exclusive) — the receipt's DISCOUNTABLE line" /></label></span></td>`;
  pwd += `<td class="foot-total pwd-amt">${c.pwdDiscTotal ? "&minus;" + fmt(c.pwdDiscTotal) : fmt(0)}</td>`;
  people.forEach((p) => {
    const on = !!state.pwd.members[p.id];
    const cls = ["pcell", "toggle", "pwd-cell"];
    if (on) cls.push("included");
    const disp = on ? "&minus;" + fmt(c.discShare[p.id]) : `<span class="pwd-hint">PWD?</span>`;
    pwd += `<td class="${cls.join(" ")}" data-act="pwd-toggle" data-person="${p.id}"
          role="button" tabindex="0" title="Mark this person as PWD / Senior">${disp}</td>`;
  });
  pwd += `<td class="col-add"></td><td class="foot-num"></td><td></td></tr>`;
  foot.push(pwd);

  // Less VAT row: VAT lifted off the PWD's discounted share (shown only when it applies)
  if (c.vatRemovedTotal) {
    let vrow = `<tr class="pwd-row"><td class="foot-label">Less VAT</td>`;
    vrow += `<td class="foot-total pwd-amt">&minus;${fmt(c.vatRemovedTotal)}</td>`;
    people.forEach((p) => {
      const on = !!state.pwd.members[p.id];
      const cls = ["pcell", "pwd-cell"];
      if (on) cls.push("included");
      const disp = on ? "&minus;" + fmt(c.vatShare[p.id]) : "&nbsp;";
      vrow += `<td class="${cls.join(" ")}">${disp}</td>`;
    });
    vrow += `<td class="col-add"></td><td class="foot-num"></td><td></td></tr>`;
    foot.push(vrow);
  }

  // Tax
  let tax = `<tr><td class="foot-label">+ Tax</td>`;
  tax += `<td class="col-price-cell">${rateCell("tax")}</td>`;
  people.forEach((p) => (tax += `<td class="foot-num">${fmt(c.tax[p.id])}</td>`));
  tax += `<td class="col-add"></td><td class="foot-num">0.00</td><td></td></tr>`;
  foot.push(tax);

  // Tip
  let tip = `<tr><td class="foot-label">+ Tip</td>`;
  tip += `<td class="col-price-cell">${rateCell("tip")}</td>`;
  people.forEach((p) => (tip += `<td class="foot-num">${fmt(c.tip[p.id])}</td>`));
  tip += `<td class="col-add"></td><td class="foot-num">0.00</td><td></td></tr>`;
  foot.push(tip);

  // Grand total
  let grand = `<tr class="grand"><td class="foot-label">Grand total</td>`;
  grand += `<td class="foot-total">${fmt(c.grandTotal)}</td>`;
  people.forEach((p) => (grand += `<td class="foot-total">${fmt(c.grand[p.id])}</td>`));
  grand += `<td class="col-add"></td><td class="foot-num">${fmt(c.naTotal)}</td><td></td></tr>`;
  foot.push(grand);

  const footer = `<tfoot>${foot.join("")}</tfoot>`;

  const focus = captureFocus();
  tableEl.innerHTML = head + body + footer;
  restoreFocus(focus);

  // show a dash (indeterminate) on the row checkbox when only some people are included
  const boxes = tableEl.querySelectorAll('[data-act="all-toggle"]');
  for (let i = 0; i < boxes.length; i++) {
    const it = findItem(boxes[i].dataset.item);
    if (!it) continue;
    const inc = people.filter((p) => it.shares[p.id] && it.shares[p.id].included).length;
    boxes[i].indeterminate = inc > 0 && inc < people.length;
  }

  save();
}

function rateCell(which) {
  const r = state[which];
  const sym = r.mode === "percent" ? "%" : esc(state.currency);
  return `<span class="rate-cell">
    <button type="button" class="mode-btn" data-act="${which}-mode" title="Toggle amount / percent">${sym}</button>
    <input class="rate-input" data-act="${which}" data-focus="${which}" value="${esc(r.value)}"
           inputmode="decimal" placeholder="0" />
  </span>`;
}

/* ---------- focus preservation across innerHTML rebuild ---------- */
function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.dataset || !el.dataset.focus) return null;
  const f = { key: el.dataset.focus };
  try {
    f.start = el.selectionStart;
    f.end = el.selectionEnd;
  } catch (e) { /* some inputs disallow selection */ }
  return f;
}
function restoreFocus(f) {
  if (!f) return;
  const el = tableEl.querySelector(`[data-focus="${cssEscape(f.key)}"]`);
  if (!el) return;
  el.focus();
  if (f.start != null) {
    try { el.setSelectionRange(f.start, f.end); } catch (e) { /* ignore */ }
  }
}
function cssEscape(s) {
  return String(s).replace(/["\\]/g, "\\$&");
}

/* ---------- mutations ---------- */
function findItem(id) { return state.items.find((it) => it.id === id); }

function addPerson() {
  const p = { id: uid("p"), name: "" };
  state.people.push(p);
  // include the new person on blank/new rows (everyone-by-default), off on existing items
  state.items.forEach((it) => (it.shares[p.id] = { included: isBlankItem(it), override: null }));
  render();
}
function delPerson(id) {
  state.people = state.people.filter((p) => p.id !== id);
  state.items.forEach((it) => delete it.shares[id]);
  render();
}
function delItem(id) {
  state.items = state.items.filter((it) => it.id !== id);
  render();
}

/* ---------- events (delegated) ---------- */
tableEl.addEventListener("input", (e) => {
  const t = e.target;
  const act = t.dataset && t.dataset.act;
  if (!act) return;

  if (act === "pname") {
    const p = state.people.find((x) => x.id === t.dataset.person);
    if (p) { p.name = t.value; save(); }
    return;
  }
  if (act === "iname") {
    const it = findItem(t.dataset.item);
    if (it) { it.name = t.value; renderKeepingTyping(); }
    return;
  }
  if (act === "price") {
    const it = findItem(t.dataset.item);
    if (it) { it.price = t.value; render(); }
    return;
  }
  if (act === "tax" || act === "tip") {
    state[act].value = t.value;
    render();
    return;
  }
  if (act === "pwd-discountable") { state.pwd.discountable = t.value; render(); return; }
});

// Adding an item name shouldn't reflow away the trailing-blank the user is typing
// in unless a new blank is needed; render() handles ensureTrailingBlank + focus.
function renderKeepingTyping() { render(); }

// keyboard toggle for accessibility (Enter / Space on a focused cell)
tableEl.addEventListener("keydown", (e) => {
  const cell = e.target.closest && e.target.closest('[data-act="toggle"],[data-act="pwd-toggle"]');
  if (!cell) return;
  if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
    e.preventDefault();
    if (cell.dataset.act === "pwd-toggle") {
      togglePwd(cell.dataset.person);
    } else {
      const it = findItem(cell.dataset.item);
      if (it) {
        const sh = it.shares[cell.dataset.person];
        sh.included = !sh.included;
        sh.override = null;
        render();
      }
    }
  }
});

function togglePwd(pid) {
  if (state.pwd.members[pid]) delete state.pwd.members[pid];
  else state.pwd.members[pid] = true;
  render();
}

tableEl.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.act === "all-toggle") {
    const it = findItem(t.dataset.item);
    if (it) {
      const on = t.checked; // checked -> everyone in, unchecked -> everyone out
      state.people.forEach((p) => {
        it.shares[p.id].included = on;
        it.shares[p.id].override = null;
      });
      render();
    }
  }
});

tableEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;

  // click a person cell to toggle them in/out of the item (even-split mode)
  if (act === "toggle") {
    const it = findItem(btn.dataset.item);
    if (it) {
      const sh = it.shares[btn.dataset.person];
      sh.included = !sh.included;
      sh.override = null;
      render();
    }
    return;
  }

  // click a PWD row cell to mark / unmark that person as PWD / Senior
  if (act === "pwd-toggle") { togglePwd(btn.dataset.person); return; }

  if (act === "add-person") { addPerson(); return; }
  if (act === "del-person") { delPerson(btn.dataset.person); return; }
  if (act === "del-item") { delItem(btn.dataset.item); return; }
  if (act === "tax-mode") { state.tax.mode = state.tax.mode === "percent" ? "amount" : "percent"; render(); return; }
  if (act === "tip-mode") { state.tip.mode = state.tip.mode === "percent" ? "amount" : "percent"; render(); return; }
});

/* ---------- toolbar ---------- */
document.querySelector(".toolbar").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  if (btn.dataset.act === "clear") clearAll();
});

function clearAll() {
  if (!confirm("Clear the whole bill and start over?")) return;
  state = seedState();
  // start truly empty except one blank row + the seeded people
  state.items = [];
  render();
}

/* ---------- init ---------- */
state = load();
render();
