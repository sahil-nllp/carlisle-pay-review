# Carlisle Pay Review — Deployment & Operations Guide

## Server Details

| | |
|---|---|
| **Provider** | Google Cloud Platform (GCP) |
| **OS** | Debian 12 (Bookworm) |
| **Public IP** | 34.151.116.211 |
| **SSH User** | sahil |
| **SSH Key** | `C:\Users\sahil\.ssh\id_ed25519` |

---

## Architecture

```
Browser
  └── Nginx :8080
        ├── /api/*  →  proxy → uvicorn :8001  (FastAPI)
        └── /*      →  proxy → Next.js  :3000  (Node SSR)

FastAPI → PostgreSQL 15 (localhost:5432, db: carlisle_payreview)
Storage → /srv/carlisle-payreview/backend/storage/  (auto-created)
```

---

## Directory Layout

```
/srv/carlisle-payreview/        ← git repo
  backend/
    app/                        ← FastAPI application code
    alembic/                    ← database migrations
    storage/                    ← runtime file storage (gitignored)
      uploads/                  ← uploaded wage model Excel files
      outputs/<cycle>/<site>/   ← generated letters, UKG, regional Excel
    .venv/                      ← Python virtual environment
    .env                        ← secrets (not in git)
  frontend/
    src/                        ← Next.js app source
    .env.local                  ← Next.js env vars (not in git)
  scripts/
    seed_admin.py               ← creates initial HR Admin user
```

---

## SSH Access

```bash
ssh sahil@34.151.116.211 -i C:\Users\sahil\.ssh\id_ed25519
sudo su
```

---

## Database

| | |
|---|---|
| **Host** | localhost (server-side) |
| **Port** | 5432 |
| **Database** | carlisle_payreview |
| **User** | carlisle |
| **Password** | *(same as other Carlisle project)* |

```bash
# Connect via psql
sudo -u postgres psql -d carlisle_payreview
```

**DBeaver (local) via SSH tunnel:**
- Main tab: host `localhost`, port `5432`, db `carlisle_payreview`, user `carlisle`
- SSH tab: host `34.151.116.211`, port `22`, user `sahil`, key `id_ed25519`

---

## Useful Commands

### API

```bash
journalctl -u carlisle-payreview-api -f          # live logs
journalctl -u carlisle-payreview-api -n 50 --no-pager
systemctl restart carlisle-payreview-api
systemctl status carlisle-payreview-api
```

### Frontend (Next.js)

```bash
journalctl -u carlisle-payreview-web -f
journalctl -u carlisle-payreview-web -n 50 --no-pager
systemctl restart carlisle-payreview-web
systemctl status carlisle-payreview-web
```

### Migrations

```bash
cd /srv/carlisle-payreview/backend
source .venv/bin/activate
alembic upgrade head      # run all pending migrations
alembic current           # check current version
```

### Nginx

```bash
nginx -t
systemctl reload nginx
tail -f /var/log/nginx/error.log
```

---

## Deploying Code Updates

```bash
cd /srv/carlisle-payreview

# 1. Pull latest code
git pull

# 2. Run any new migrations
cd backend
source .venv/bin/activate
alembic upgrade head
systemctl restart carlisle-payreview-api

# 3. Rebuild frontend
cd ../frontend
pnpm install
pnpm build
systemctl restart carlisle-payreview-web
```

> **Note:** After `pnpm build`, restart the web service — Next.js does not hot-reload in production.

---

## Initial Setup (from scratch)

### 1. System packages

```bash
apt update && apt install -y python3 python3-venv python3-pip nginx git curl
```

### 2. Node.js + pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pnpm
```

### 3. Create the database

```bash
sudo -u postgres psql -c "CREATE DATABASE carlisle_payreview OWNER carlisle;"
```

*(Uses the existing `carlisle` user — no new DB user needed.)*

### 4. Clone repo

```bash
cd /srv
git clone https://github.com/YOUR_ORG/carlisle-payreview.git carlisle-payreview
```

### 5. Backend setup

```bash
cd /srv/carlisle-payreview/backend

python3 -m venv .venv
source .venv/bin/activate
pip install .

cp .env.example .env
nano .env
```

**`backend/.env` contents:**

```ini
ENVIRONMENT=production
DEBUG=false

DATABASE_URL=postgresql+asyncpg://carlisle:YOUR_DB_PASS@localhost:5432/carlisle_payreview
DATABASE_URL_SYNC=postgresql+psycopg2://carlisle:YOUR_DB_PASS@localhost:5432/carlisle_payreview

SECRET_KEY=<generate: python3 -c "import secrets; print(secrets.token_urlsafe(64))">
SESSION_COOKIE_NAME=carlisle_payreview_session
SESSION_LIFETIME_HOURS=8

# IMPORTANT: must be false when serving over plain HTTP (no HTTPS)
COOKIE_SECURE=false

CORS_ORIGINS=http://34.151.116.211:8080
APP_NAME=Carlisle Pay Review
API_PREFIX=/api/v1
```

### 6. Run migrations & seed admin user

```bash
# Run from backend/ directory so .env is found
cd /srv/carlisle-payreview/backend
source .venv/bin/activate
alembic upgrade head

# Seed the first HR Admin user
SEED_EMAIL=admin@carlislehealth.com.au SEED_NAME="Admin" SEED_PASSWORD="yourpassword" \
    python ../scripts/seed_admin.py
```

### 7. Systemd — FastAPI

```bash
nano /etc/systemd/system/carlisle-payreview-api.service
```

```ini
[Unit]
Description=Carlisle Pay Review API
After=network.target postgresql.service

[Service]
User=root
WorkingDirectory=/srv/carlisle-payreview/backend
EnvironmentFile=/srv/carlisle-payreview/backend/.env
ExecStart=/srv/carlisle-payreview/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 --workers 2
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable carlisle-payreview-api
systemctl start carlisle-payreview-api
```

### 8. Frontend setup

```bash
cd /srv/carlisle-payreview/frontend
pnpm install

cp .env.example .env.local
nano .env.local
```

**`frontend/.env.local` contents:**

```ini
# Baked into client-side JS at build time — must match your public URL
NEXT_PUBLIC_API_URL=http://34.151.116.211:8080

# Used in server components only — direct internal connection
API_URL=http://localhost:8001

# Must match SESSION_COOKIE_NAME in backend .env
SESSION_COOKIE_NAME=carlisle_payreview_session
```

```bash
pnpm build
```

### 9. Systemd — Next.js

```bash
nano /etc/systemd/system/carlisle-payreview-web.service
```

```ini
[Unit]
Description=Carlisle Pay Review Web (Next.js)
After=network.target carlisle-payreview-api.service

[Service]
User=root
WorkingDirectory=/srv/carlisle-payreview/frontend
ExecStart=/usr/bin/pnpm start --port 3000
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable carlisle-payreview-web
systemctl start carlisle-payreview-web
```

### 10. Nginx vhost

```bash
nano /etc/nginx/sites-available/carlisle-payreview
```

```nginx
server {
    listen 8080;
    server_name _;

    # API → FastAPI
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 50M;
    }

    # Everything else → Next.js SSR
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/carlisle-payreview /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 11. GCP Firewall

In **GCP Console → VPC Network → Firewall → Create Rule:**
- Name: `allow-payreview`
- Direction: Ingress
- Action: Allow
- Targets: All instances in the network
- Source IPv4 ranges: `0.0.0.0/0`
- Protocols/ports: TCP `8080`

---

## Known Gotchas

| Issue | Cause | Fix |
|---|---|---|
| Stuck on login page after success | `COOKIE_SECURE=true` on HTTP | Set `COOKIE_SECURE=false` in backend `.env` |
| `pip install .` fails with "Multiple top-level packages" | setuptools finds both `app/` and `alembic/` | Fixed in `pyproject.toml` via `[tool.setuptools.packages.find]` |
| `seed_admin.py` uses wrong DB user | Script run from project root, `.env` not found | Run from `backend/` directory |
| Downloaded ZIP contains .docx instead of PDFs | Stale file generated before PDF code was added | Use Regenerate button on Downloads page |

---

## Default Login

After seeding:

| Field | Value |
|---|---|
| Email | *(whatever you passed to `SEED_EMAIL`)* |
| Password | *(whatever you passed to `SEED_PASSWORD`)* |
| Role | HR Admin (full access) |

Additional users are created by HR Admin via **Admin → Users**.
