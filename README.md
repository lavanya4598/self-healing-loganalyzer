# Self-Healing Log Analyser

An AI-powered log analysis and self-healing platform with role-based approval workflows.

## Architecture

```
React Frontend (port 3000)
    ↓
Node.js API Gateway (port 3001)
    ↓              ↓
Python AI Service  ChromaDB Vector DB
(port 8001)        (port 8000)
    ↓
GenAI API (OpenAI / Google Gemini)
```

## Features

- **Log Ingestion** — Upload `.log` files or paste raw log lines
- **LLM Analysis** — GPT-4o / Gemini 1.5 Pro analyses logs, detects anomalies, identifies root causes
- **Vector DB** — ChromaDB stores log embeddings for similarity search and pattern learning
- **Self-Healing Actions** — AI generates specific remediation commands
- **3-Level Approval Workflow**:
  - **L1 (Auto)** — Safe, low-risk actions execute automatically
  - **L2 (Team Lead)** — Medium-risk actions need team lead or admin approval
  - **L3 (Manager)** — High-risk actions (rollbacks, scale, credentials) need manager approval
- **Agent-Executed Remediation** — Once an L2/L3 action is approved, the self-healing
  agent automatically SSHes into the target VM and runs the fixed,
  operator-configured command for that action type — no separate manual step
  required. A human-triggered "Execute Now" button remains for actions with a
  configured command that weren't auto-run, and a **Manual Command (addon)**
  lets an approver type an exact one-off command to run on the VM when no
  fixed command is configured. `rotate_credentials` is never auto- or
  manually-executed through the app.
- **Multi-VM Targets** — Configure any number of named SSH targets (e.g. two
  local CentOS VMs in VMware Workstation) and route each log batch's healing
  actions to the right one via `target_host`.
- **Healing Plans** — AI generates step-by-step execution plans after approval
- **Continuous Learning** — Successful healing patterns are stored in vector DB for future reference
- **Real-time Updates** — WebSocket notifications on analysis/approval events
- **Audit Trail** — Full audit log of all events

## Quick Start

### With Docker (recommended)

```powershell
# 1. Copy and fill in your API keys
Copy-Item .env.example .env
# Edit .env and add OPENAI_API_KEY or GOOGLE_API_KEY

# 2. Start everything
./start.ps1
```

### Without Docker (local dev)

```powershell
# 1. Install dependencies
./install.ps1

# 2. Start ChromaDB
docker run -p 8000:8000 chromadb/chroma

# 3. Start AI service
cd ai-service
uvicorn main:app --port 8001 --reload

# 4. Start backend
cd backend
npm run dev

# 5. Start frontend
cd frontend
npm run dev
```

## Demo Users

| Username   | Password    | Role       | Can Approve |
|-----------|-------------|------------|-------------|
| admin     | password123 | Admin      | L1, L2, L3  |
| teamlead  | password123 | Team Lead  | L2          |
| manager   | password123 | Manager    | L3          |
| engineer  | password123 | Engineer   | View only   |

## LLM Configuration

Set in `.env`:

```env
LLM_PROVIDER=openai          # or 'google'
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o          # optional, default gpt-4o

# Or for Google Gemini:
LLM_PROVIDER=google
GOOGLE_API_KEY=AIza...
GOOGLE_MODEL=gemini-1.5-pro  # optional
```

## API Reference

### Backend (Node.js — port 3001)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login |
| GET  | `/api/auth/me` | Current user |
| POST | `/api/logs/upload` | Upload log file |
| POST | `/api/logs/ingest` | Ingest log lines (JSON) |
| GET  | `/api/logs` | List analyses |
| GET  | `/api/anomalies` | List anomalies |
| GET  | `/api/anomalies/:id` | Anomaly detail + actions |
| GET  | `/api/approvals` | My pending approvals |
| GET  | `/api/approvals/targets` | List configured self-healing SSH target VMs |
| POST | `/api/approvals/:id/approve` | Approve action (agent auto-executes if a fixed command is configured) |
| POST | `/api/approvals/:id/reject` | Reject action |
| POST | `/api/approvals/:id/execute` | Human-triggered remote execution of the fixed command |
| POST | `/api/approvals/:id/execute-manual` | Addon: run a human-typed command on the target VM |
| POST | `/api/approvals/:id/complete` | Mark execution done |
| GET  | `/api/dashboard/stats` | Dashboard statistics |
| GET  | `/api/dashboard/audit` | Audit trail |

### AI Service (Python — port 8001)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/analyze` | Analyse a log batch |
| POST | `/healing/plan` | Generate healing execution plan |
| POST | `/healing/feedback` | Record outcome for learning |
| POST | `/ingest` | Ingest logs to vector DB |

## Project Structure

```
Self_healing_loganalyser/
├── frontend/          React + Vite + TailwindCSS
│   └── src/
│       ├── pages/     Dashboard, LogUpload, Anomalies, Approvals, AuditTrail
│       ├── components/ Sidebar, Badges
│       ├── store/     Zustand state (auth, logs, anomalies, approvals)
│       └── services/  Axios API client, WebSocket hook
├── backend/           Node.js + Express
│   └── src/
│       ├── routes/    auth, logs, anomalies, approvals, dashboard
│       ├── middleware/ auth (JWT), errorHandler
│       └── websocket.js
├── ai-service/        Python + FastAPI + LangChain
│   ├── agents/
│   │   ├── log_analyzer.py   LLM log analysis
│   │   └── healing_agent.py  Healing plan generation
│   ├── vector_store.py       ChromaDB operations
│   ├── llm_client.py         OpenAI / Gemini client
│   └── main.py               FastAPI app
└── docker-compose.yml
```
