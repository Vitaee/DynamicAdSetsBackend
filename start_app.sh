#!/bin/bash

# If not running under bash (e.g., invoked with `sh`), re-exec with bash
if [ -z "${BASH_VERSION:-}" ]; then
  echo "Re-executing with bash for compatibility..."
  exec bash "$0" "$@"
fi

# WeatherTrigger  Automation Engine Startup Script

set -e

echo "Starting WeatherTrigger  Automation Engine..."

# Resolve repo root (works on macOS and Linux)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Detect Docker Compose command (plugin or legacy)
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose -f "$REPO_ROOT/docker-compose.yml")
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose -f "$REPO_ROOT/docker-compose.yml")
else
  echo "Docker Compose not found. Install Docker Desktop (macOS) or docker-compose (Linux)."
  exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "Docker is not running. Please start Docker first."
    exit 1
fi

# Load environment variables from .env files (macOS-safe)
if [ -f ".env" ]; then
    echo "Loading environment from .env"
    set -o allexport
    # Strip potential CRLF to avoid parse issues
    sed -e 's/\r$//' .env > /tmp/.env.start-automation.$$
    # shellcheck disable=SC1090
    source /tmp/.env.start-automation.$$ && rm -f /tmp/.env.start-automation.$$
    set +o allexport
else
    echo ".env not found in repo root. Copy .env.example to .env and fill values."
    exit 1
fi

# Optionally load backend-specific overrides
if [ -f "apps/backend/.env" ]; then
    echo "Loading backend overrides from apps/backend/.env"
    set -o allexport
    sed -e 's/\r$//' apps/backend/.env > /tmp/.env.backend.start-automation.$$
    # shellcheck disable=SC1090
    source /tmp/.env.backend.start-automation.$$ && rm -f /tmp/.env.backend.start-automation.$$
    set +o allexport
fi

# Basic required variable checks
missing=0
for var in POSTGRES_USER POSTGRES_DB; do
  if [ -z "${!var:-}" ]; then
    echo "Missing required env var: $var"
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "Please set the missing variables in your .env file."
  exit 1
fi

# Start databases
echo "Starting databases (PostgreSQL + Redis)..."
"${DC[@]}" up -d postgres redis

# Wait for databases to be ready
echo "Waiting for databases to be ready..."
sleep 5

# Check if databases are healthy
echo " Checking database health..."
until "${DC[@]}" exec postgres pg_isready -U "${POSTGRES_USER:-weathertrigger}" > /dev/null 2>&1; do
    echo "Waiting for PostgreSQL..."
    sleep 2
done

until "${DC[@]}" exec redis redis-cli ping > /dev/null 2>&1; do
    echo "Waiting for Redis..."
    sleep 2
done

echo "Databases are ready!"

## Run database migrations inside the Postgres container (no local psql)
echo "Running database migrations..."
cd "$REPO_ROOT/apps/backend"

# Resolve the Postgres container ID from docker compose service name
POSTGRES_CONTAINER_ID=$("${DC[@]}" ps -q postgres)
if [ -z "$POSTGRES_CONTAINER_ID" ]; then
  echo "Could not determine Postgres container. Is docker compose up?"
  exit 1
fi

# Apply all SQL files in migrations/ in order
for migration in migrations/*.sql; do
  echo "Running: $migration"
  if docker exec -i "$POSTGRES_CONTAINER_ID" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < "$migration"; then
    echo "Successfully ran: $migration"
  else
    echo "Failed to run: $migration"
    exit 1
  fi
done

echo "Database migrations completed!"

# Check if required environment variables are set
echo "Checking environment variables..."


# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi


echo " CLI Tools Available:"
echo "  npx ts-node apps/backend/src/cli/automation-cli.ts list-workers"
echo "  npx ts-node apps/backend/src/cli/automation-cli.ts job-stats"
echo "  npx ts-node apps/backend/src/cli/automation-cli.ts rate-limit-stats"
echo "  npx ts-node apps/backend/src/cli/automation-cli.ts help"
echo ""

echo "Starting the  automation engine..."
echo "   Backend will start on http://localhost:3001"
echo "   Worker ID: worker_${NODE_ENV:-development}_$$"
echo ""

# Start the backend with  automation engine
cd ../../ && npm run dev