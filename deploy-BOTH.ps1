# deploy.ps1 — SnapFind AI Deploy Script
# Run this every time you want to rebuild and redeploy
# Usage: .\deploy.ps1

Write-Host "Stopping containers..." -ForegroundColor Yellow
docker compose down

Write-Host "Removing old images..." -ForegroundColor Yellow
docker rmi snapfind-backend:latest -f
docker rmi snapfind-frontend:latest -f

Write-Host "Building fresh images..." -ForegroundColor Cyan
docker compose build backend frontend

Write-Host "Starting all services..." -ForegroundColor Cyan
docker compose up -d

Write-Host "Cleaning dangling layers..." -ForegroundColor Yellow
docker image prune -f

Write-Host "Done! All services running." -ForegroundColor Green
docker compose ps
