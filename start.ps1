# Starts all three services locally (no Docker required), each in its own window.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

if (-not (Test-Path (Join-Path $root ".env"))) {
    Copy-Item (Join-Path $root ".env.example") (Join-Path $root ".env")
    Write-Host "Created .env from .env.example - please add your API keys!" -ForegroundColor Yellow
}

Write-Host "Starting Self-Healing Log Analyser (local mode, no Docker)..." -ForegroundColor Cyan

# AI Service (Node.js, calls Gemini directly) - port 8001, no Python/pip/Docker needed
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$root\ai-service-node'; npm run dev"
)

# Backend (Node.js/Express) - port 3001
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$root\backend'; npm run dev"
)

# Frontend (React/Vite) - port 3000
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$root\frontend'; npm run dev"
)

Write-Host ""
Write-Host "Services starting in separate windows:" -ForegroundColor Green
Write-Host "  Frontend:   http://localhost:3000" -ForegroundColor White
Write-Host "  Backend:    http://localhost:3001" -ForegroundColor White
Write-Host "  AI Service: http://localhost:8001 (Node.js + Gemini)" -ForegroundColor White
Write-Host ""
Write-Host "Demo credentials: appsupport / password123 (also: sdm, sm, im)" -ForegroundColor Cyan
