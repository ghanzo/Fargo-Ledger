# Vision — Fargo Ledger

**Last Updated:** 2026-03-03

---

## What This Project Is

Fargo Ledger is a self-hosted personal finance dashboard for managing bank transaction data. It is a tool built for one person — the owner — to import, categorize, analyze, and report on their financial activity across multiple accounts.

It is **not** a bank. It does not connect to bank APIs, initiate payments, or move money. It is a **ledger** — a place to bring your data, make sense of it, and get answers from it.

---

## Core Beliefs

### Data belongs to the owner
All data stays on the owner's machine. No cloud sync, no third-party analytics, no telemetry. Self-hosted means self-sovereign.

### The tool should learn from the owner
When the owner categorizes a transaction, the system should remember that decision and apply it to similar transactions in the future. Over time, manual work should decrease to near zero.

### Clarity over features
A smaller tool that shows you exactly where your money goes is more valuable than a complex tool that requires a manual. Every page should answer a clear question: Where did my money go? Am I on budget? What does this property cost me?

### The system should be honest about uncertainty
Auto-categorization uses confidence scores. When the system isn't sure, it asks rather than guessing wrong. Suggestions are pending until approved. This builds trust.

---

## Who This Is For

A single person who:
- Has bank accounts (currently Wells Fargo, expandable to others)
- Manages rental properties and needs per-property P&L
- Wants to track spending by category, vendor, and project
- Files taxes and needs to identify deductible expenses
- Prefers to own their data rather than use Mint/YNAB/etc.

---

## What Success Looks Like

### Today
- Import a CSV, and 80%+ of transactions are auto-categorized correctly
- Open the analysis page and immediately understand monthly spending patterns
- Generate a year-end report with per-property breakdown for taxes
- Manage vendor rules so the system gets smarter over time

### Near-term (next 2-3 phases)
- Import from any bank, not just Wells Fargo
- Test coverage that makes refactoring safe
- Performance that handles 5+ years of transaction history without lag

### Long-term (horizon)
- The system categorizes 95%+ of transactions without human intervention
- Spending trends and anomalies are surfaced proactively
- The tool is deployable by anyone with Docker, not just the original developer
- Cash flow forecasting based on historical patterns and known obligations

---

## What This Project Is Not

- **Not a budgeting app** — it has budgets, but the focus is on understanding past spending, not constraining future spending
- **Not a bank aggregator** — it processes exported CSVs, not live bank feeds
- **Not multi-user** — there is one owner with full access; no roles, no sharing
- **Not a mobile app** — desktop-first, though responsive design is a future goal

---

## Guiding Principles for Development

1. **Fix what's broken before building what's new** — stability and correctness come first
2. **Test before you trust** — no refactoring without a safety net
3. **Keep the stack simple** — FastAPI + PostgreSQL + Next.js. No microservices, no message queues, no caching layers until they're genuinely needed
4. **Document as you go** — if it took effort to figure out, write it down
5. **Respect the privacy rule** — never print real financial data in logs, terminal output, or error messages
