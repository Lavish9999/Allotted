# Allotted App Logic Audit

Status: addressed in the committed `www/index.html` source as of version `1.0.5`.

The previous review found several high-risk issues caused by app logic living in one large file and then being patched during the build. The build-time patcher has been removed. The committed source is now the source of truth and `npm test` validates that directly.

## Fixed Areas

### Paycheck safe-to-spend

`safeUntilPayday()` now calculates the full pay period from previous payday through next payday. It subtracts period bills, prorated savings, and flexible spending for the same period before calculating safe daily spending.

### Future-month bill visibility

`billOccurrencesBetween()` can use the latest prior plan as a virtual source when a future month has not been created yet, so recurring bills do not disappear across month boundaries.

### Selected-month bill status

`billStatus(i, monthKey)` builds due dates from the selected budget month instead of always using the current real month.

### Restore behavior

`applyBackup()` now confirms first, resets to a fresh default state, then adopts backup data. Restore semantics now match the UI copy: restore replaces the current app data.

### Storage failure protection

`load()` records a storage failure instead of silently continuing, startup avoids saving over unreadable local data, and `save()` returns success/failure so the UI can warn users when storage is unavailable.

### Onboarding usefulness

Guided setup now creates a usable first month with income, savings, bills, and suggested category amounts. Paycheck mode is enabled automatically when payday or pay amount is provided.

### Month carry-forward

Month switching goes through `selectMonth()`, which carries forward a prior plan for future empty months and offers undo.

### Bill due dates

Undated recurring items display `Set due date` instead of being treated as due on the 1st for dated paycheck calculations.

### Debt input safety

Debt balances, APRs, minimum payments, and extra payments are clamped to non-negative values before storage and payoff calculations.

### Transaction editing

Spend rows are now editable. Users can tap a transaction, change amount/date/note/category line, move it to another line, or delete it with confirmation. Item totals are recalculated after every edit/delete.

### Backup reminder

The dashboard now surfaces a backup reminder when the user has meaningful local data and has not backed up recently.

### Navigation

Bills are now a primary tab. Debt payoff lives under More, which better matches everyday budgeting usage.

## Remaining Release Follow-ups

- Generate a real `package-lock.json` from an unrestricted npm registry connection and then switch Codemagic from `npm install` to `npm ci`.
- Enable public hosting for `support.html` and `privacy.html` through the manual GitHub Pages setup in `docs/pages-setup.md`.
- Test the TestFlight build on a real iPhone with fresh install, restore backup, bill pay/unpay, transaction edit/delete, month carry-forward, debt payoff, and storage backup flows.
