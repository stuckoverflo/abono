# Abono

A local, standalone itemized-expense splitter (a Splitwise-style bill divider).

## Run it

Just open **`index.html`** in any browser — double-click it, or drag it into a browser tab.
No install, no build, no server, no internet. Everything runs client-side and your bill is
saved automatically in the browser (localStorage).

## How to use

- The **+** button after the last person adds a column. The **✕** next to a name removes that person.
- Type an **item** name and its total price in the `₱` column. A new blank row appears automatically.
- **Click a person's cell** to toggle them in or out of an item — the cost splits evenly among
  everyone included, with leftover cents balanced so the row adds up exactly
  (e.g. `75.84 / 75.84 / 75.83 …`). Click again to remove them.
- **The checkbox on the right** includes everyone (checked) or clears the whole row (unchecked).
  To record something only one person paid, uncheck the row, then click just that person.
- **PWD / Senior discount** (Philippines): in the `PWD / Senior` footer row:
  - Type the **discountable** amount in the `₱` column — this is the VAT-exclusive base the
    restaurant actually discounted (often the most expensive single order, not necessarily what
    the PWD ordered). Enter the value from the receipt's `DISCOUNTABLE` line (e.g. `449.27`).
  - **Click the PWD/Senior person** to mark them. The 12% VAT is removed and the 20% discount
    applied to that base (fixed by PH law), and the **entire deduction is given to that person**
    (if you mark more than one, it splits evenly among them).
  - The service charge (Tip row) is computed on the VAT-exclusive net, matching PH receipts.
    Item prices are assumed VAT-inclusive.
- **+ Tax / + Tip**: click the `₱`/`%` button to switch between a flat amount and a percentage;
  it's split across people in proportion to their subtotal.
- Discounts: enter a **negative** price (e.g. `-500`).

## Reset

- **Clear** wipes the bill and starts over. Otherwise your bill is saved automatically in the
  browser (localStorage) and restored on the next visit.

## Files

- `index.html` — page structure
- `style.css` — styling
- `app.js` — all logic (state, split math, persistence)
