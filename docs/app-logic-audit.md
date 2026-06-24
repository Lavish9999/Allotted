# Allotted App Logic Audit

These are the highest-value fixes found during review of `www/index.html`.

The app currently lives in one large HTML file. These fixes should be made from a full checkout so the edited file can be run locally and smoke-tested before merging.

## P0 Bugs

### 1. Paycheck safe-to-spend can overstate money left

Area: `safeUntilPayday()`, `billsBeforePayday()`, `billOccurrencesBetween()`

`safeUntilPayday()` subtracts bills from `today` to next payday, but subtracts flexible spending from the whole pay period. Bills due or paid between the previous payday and today are ignored.

Fix: calculate bill obligations for previous payday through next payday, while separately displaying unpaid upcoming bills from today through next payday.

### 2. Future-month bills can be invisible

Area: `billOccurrencesBetween()`, month carry-forward logic

If a payday window crosses into a month that has not been created yet, recurring bills in that future month are skipped.

Fix: use the latest prior plan as a virtual source for recurring bills when `S.months[key]` is missing, or centralize month creation before bill/paycheck calculations.

### 3. Bill status uses the real current month instead of selected month

Area: `billStatus(i)`, `billsHTML()`

Viewing a past or future month can show misleading due labels because due dates are built from today instead of selected `mk`.

Fix: pass the selected month key into `billStatus`, build due date from `mk`, then compare that selected due date to today.

### 4. Restore says replace but actually merges

Area: `applyBackup()`, file restore listener, `adoptState()`

Older or partial backups can leave existing local debts/settings/theme behind because restore merges into current state.

Fix: restore into a fresh default state first, validate shape, then assign all known top-level fields with defaults for missing keys.

### 5. Corrupt local storage can be overwritten silently

Area: `load()`, `save()`, startup `load(); save(); render();`

`load()` swallows parse errors, then startup immediately saves default state, which can destroy recoverable corrupt data.

Fix: make `load()` return an error state and avoid saving after parse failure. Make `save()` return success/failure and show a persistent warning when storage fails.

## P1 Product/UX Fixes

### 6. Paycheck mode is not automatically enabled after onboarding

Area: `obFinish()`

Onboarding collects payday/pay amount, but users may never see paycheck planning.

Fix: set `S.settings.paycheckMode = true` when payday or pay amount exists, or add an explicit final toggle.

### 7. Onboarding creates zero-dollar categories

Area: `obFinish()`, Budget/Home views

Users can finish onboarding and land on a budget that still feels empty because categories start at `$0`.

Fix: either distribute remaining income across categories as suggested amounts, or add a Home checklist card prompting users to set amounts.

### 8. Month picker does not carry forward like arrow navigation

Area: `openMonthPicker()`, `[data-mnav]`, keyboard navigation

Arrow navigation carries forward a future plan, but picker/year-view navigation does not.

Fix: add a `selectMonth(key, { carryForward })` helper and use it everywhere month selection occurs.

### 9. Undated recurring lines become due on the 1st in calculations

Area: `openAddEntry()`, `openEditEntry()`, `billOccurrencesBetween()`

Recurring lines can be created without a due day, but calculations treat missing `dueDay` as `1`.

Fix: require due day when recurring is enabled, show `Set due date`, or exclude undated recurring lines from dated paycheck math.

### 10. Debt payoff accepts negative values

Area: `openDebtEdit()`, `openExtraEdit()`, `debtPayoff()`

Negative balances, APRs, minimums, or extra payments can produce bad payoff math.

Fix: clamp stored debt fields to non-negative values and reject invalid input before saving.

## P2 Follow-ups

- Improve semimonthly pay schedules by storing two fixed pay days instead of adding 15 days repeatedly.
- Use `payAmount || monthlyIncome / periodsPerMonth` as paycheck fallback.
- Add stronger confirmation sheets for restore, clear transactions, clear month, and start over.
- Surface debt due dates or remove the unused due-day field.
- Move Bills into primary nav or show it conditionally when recurring bills exist.
