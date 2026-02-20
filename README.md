# Fargo Ledger

A self-hosted personal finance tracker built for importing and analyzing Wells Fargo bank statements. All data stays local — nothing is sent to any third-party service.

---

## Features

- **CSV Import** — drag-and-drop Wells Fargo CSV exports; duplicate detection prevents double-imports
- **Transaction Table** — sort, filter, search, and bulk-edit transactions with keyboard shortcuts
- **Categorization** — assign vendors, categories, notes, and tags to transactions; auto-suggest based on past history
- **Analysis Page** — drill-down explorer by category or vendor with period selector (month nav or custom date range)
  - Category → Vendor → Transaction drill-down
  - Signed net amounts (income and expense cancel correctly per vendor)
  - Uncategorized and no-vendor buckets surface hidden transactions
  - Monthly trends table
- **Budget Tracker** — set monthly spending limits per category with progress bars
- **Undo** — bulk edits can be reversed via a toast action

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI + SQLAlchemy + PostgreSQL 15 |
| Frontend | Next.js 16 + React 19 + TanStack Table |
| UI | shadcn/ui + Tailwind CSS 4 |
| Infrastructure | Docker + Docker Compose |

---

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js](https://nodejs.org/) (v18+)

### 1. Clone the repo

```bash
git clone https://github.com/ghanzo/Fargo-Ledger.git
cd Fargo-Ledger
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set a password if desired (the defaults work fine for local use):

```env
POSTGRES_USER=user
POSTGRES_PASSWORD=yourpassword
POSTGRES_DB=finance_db
DATABASE_URL=postgresql://user:yourpassword@db:5432/finance_db
```

### 3. Start the backend

```bash
docker compose up --build -d
```

This starts the PostgreSQL database and FastAPI backend at `http://localhost:8000`.

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

The app is now running at `http://localhost:3000`.

---

## Importing Transactions

1. Export a statement from Wells Fargo as a CSV file
2. In the app, click **Import** in the top navigation
3. Drag and drop your CSV file — new transactions are added; duplicates are skipped automatically

The `data/` directory is gitignored so your bank files are never committed.

---

## Project Structure

```
├── src/
│   ├── api.py          # FastAPI routes
│   ├── models.py       # SQLAlchemy ORM models
│   ├── schemas.py      # Pydantic schemas
│   ├── database.py     # DB connection
│   └── importer.py     # CSV import logic
├── frontend/
│   ├── app/
│   │   ├── page.tsx           # Transaction table
│   │   └── analysis/page.tsx  # Analysis & drill-down
│   ├── components/            # Shared UI components
│   └── types/                 # TypeScript types
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

---

## Keyboard Shortcuts (Transaction Table)

| Key | Action |
|-----|--------|
| `j` / `k` | Move selection down / up |
| `Space` | Toggle row selection |
| `e` | Open edit panel for selected row |
| `Ctrl+A` | Select all visible rows |
| `Esc` | Clear selection / close panel |
| `Shift+Click` | Range select rows |
