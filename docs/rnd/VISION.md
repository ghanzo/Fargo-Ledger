# Vision — Fargo Ledger

**Last Updated:** 2026-03-16

---

## What This Project Is

Fargo Ledger is a self-hosted personal finance dashboard for managing bank transaction data across multiple institutions. It is a tool built for one person — the owner — to import, categorize, analyze, and report on their financial activity across multiple accounts and banks.

It is **not** a bank. It does not connect to bank APIs, initiate payments, or move money. It is a **ledger** — a place to bring your data, make sense of it, and get answers from it.

---

## Core Beliefs

### Data belongs to the owner
All data stays on the owner's machine. No cloud sync, no third-party analytics, no telemetry. Self-hosted means self-sovereign.

### The tool should learn from the owner
When the owner categorizes a transaction, the system should remember that decision and apply it to similar transactions in the future. Over time, manual work should decrease to near zero.

### Clarity over features
A smaller tool that shows you exactly where your money goes is more valuable than a complex tool that requires a manual. Every page should answer a clear question: Where did my money go? Am I on budget? What does this project cost me?

### The system should be honest about uncertainty
Auto-categorization uses confidence scores. When the system isn't sure, it asks rather than guessing wrong. Suggestions are pending until approved. This builds trust.

### Edit anywhere, not just one page
When you're analyzing data and spot something wrong, you should be able to fix it right there — not navigate away to a different page, search for the transaction, and come back. Every view that shows transactions should let you edit them.

---

## Who This Is For

A single person who:
- Has bank accounts across multiple institutions (Wells Fargo, Redwood Credit Union, Coinbase, etc.)
- Manages business entities (e.g., Blackwood) and personal accounts — needs separation by "Account" with per-institution tracking
- Wants to track spending by category, vendor, and project
- Needs per-project income statements for business reporting and taxes
- Files taxes and needs to identify deductible expenses
- Prefers to own their data rather than use Mint/YNAB/etc.

---

## Key Concepts

### Account vs Institution
- **Account** = the business/purpose level (e.g., "Blackwood", "Personal Checking"). This is the top-level entity that separates your databases of transactions.
- **Institution** = the bank/source (e.g., Wells Fargo, Redwood Credit Union, Coinbase). Multiple institutions can feed into the same account. Auto-detected from CSV format on import.

### Project
A project is a business entity, property, initiative, or bucket that transactions belong to. Transactions are grouped by project in reports and analysis to produce per-project P&L statements. Examples: "Blackwood", "Rental Property A", "Side Business".

### Vendor Rules & Confidence
The system learns from how you categorize. Each vendor builds up pattern-matching rules and a confidence score. High confidence = auto-categorize on import. Low confidence = suggest and wait for approval. User corrections decrease confidence so the system self-corrects.

---

## What Success Looks Like

### Today
- Import CSVs from Wells Fargo and Redwood Credit Union, auto-detecting format
- 80%+ of transactions auto-categorized correctly via vendor rules
- Open analysis and immediately understand spending by category, vendor, or project
- Drill into any breakdown and edit transactions in-place (bulk or single)
- Generate a year-end report with per-project income statement and reconciliation
- Export to Excel with formulas, running balances, and multi-sheet workbooks

### Near-term (next 2-3 phases)
- Add Coinbase and other institution CSV formats
- Test coverage that makes refactoring safe
- Performance that handles 5+ years of transaction history without lag
- Authentication for network-accessible deployments

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

## Professional Standards

### Report Quality
The report page produces output modeled on real accounting practices:
- **Income Statement** — per-project P&L with income and expense line items by category, net income per project, and grand total
- **Reconciliation** — beginning balance + net income + transfers = ending balance
- **Check Register** — chronological transaction log with running balance, project, vendor, category, and institution columns
- **Excel Export** — multi-sheet workbook with Excel formulas (SUM references, running balance formulas), proper number formatting, freeze panes, and professional styling

### Category & Vendor Organization
- Categories are free-form strings, not a fixed taxonomy — the owner defines what makes sense for their situation
- Vendors are tracked with business metadata (trade category, phone, email, rating) for professional reference
- Projects group transactions for P&L reporting — any transaction can belong to a project
- The system does not force a chart of accounts; it adapts to how the owner thinks about their money

### What an accountant would expect to see
The current report structure covers the essentials: income statement, reconciliation, and check register. Areas to strengthen:
- **Chart of accounts** — a formal mapping from categories to standard account codes (could be added as a future layer)
- **Accrual vs cash basis** — currently cash-basis only (transactions recorded when they clear the bank). This is standard for personal finance and small business
- **Audit trail** — timestamps on all mutations, undo capability on bulk edits, source file tracking on every transaction
- **Transfer handling** — transfers between accounts are identified and excluded from P&L, which is correct accounting treatment

---

## Guiding Principles for Development

1. **Fix what's broken before building what's new** — stability and correctness come first
2. **Test before you trust** — no refactoring without a safety net
3. **Keep the stack simple** — FastAPI + PostgreSQL + Next.js. No microservices, no message queues, no caching layers until they're genuinely needed
4. **Document as you go** — if it took effort to figure out, write it down
5. **Respect the privacy rule** — never print real financial data in logs, terminal output, or error messages
6. **Edit in context** — wherever data is displayed, it should be editable. Don't make the user navigate away to fix something.
