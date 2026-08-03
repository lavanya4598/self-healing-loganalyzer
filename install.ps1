# Installs dependencies for all three services (no Docker required).
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

if (-not (Test-Path (Join-Path $root ".env"))) {
    Copy-Item (Join-Path $root ".env.example") (Join-Path $root ".env")
    Write-Host "Created .env from .env.example - add your OPENAI_API_KEY or GOOGLE_API_KEY!" -ForegroundColor Yellow
}

Write-Host "Installing backend (Node.js) dependencies..." -ForegroundColor Cyan
Push-Location (Join-Path $root "backend")
npm install
Pop-Location

Write-Host "Installing frontend (React) dependencies..." -ForegroundColor Cyan
Push-Location (Join-Path $root "frontend")
npm install
Pop-Location

Write-Host "Installing AI service (Node.js) dependencies..." -ForegroundColor Cyan
Push-Location (Join-Path $root "ai-service-node")
npm install
Pop-Location

Write-Host ""
Write-Host "Done! Run ./start.ps1 to launch all three services locally (no Docker needed)." -ForegroundColor Green
