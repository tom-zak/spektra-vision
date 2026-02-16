![Spektra](frontend/src/assets/spektra.svg)

# spektra-vision

Image annotation platform for object detection and segmentation, powered by a
FastAPI backend, React + Konva frontend, and a Celery worker that runs YOLO
training and inference.

## Architecture

```
┌──────────┐   ┌───────────┐   ┌────────────┐
│  nginx   │──▶│  frontend │   │   worker   │
│  :80     │   │  React    │   │  Celery    │
│          │──▶│  :80      │   │  YOLO      │
│          │   └───────────┘   └─────┬──────┘
│          │──▶┌───────────┐         │
│          │   │  backend  │◀────────┘
│          │   │  FastAPI  │
└──────────┘   │  :8000    │
               └─────┬─────┘
          ┌──────────┼──────────┐
          ▼          ▼          ▼
     ┌─────────┐ ┌───────┐ ┌───────┐
     │ Postgres│ │ Redis │ │ MinIO │
     │  :5432  │ │ :6379 │ │ :9000 │
     └─────────┘ └───────┘ └───────┘
```

| Service   | Purpose                                           |
| --------- | ------------------------------------------------- |
| backend   | REST API + WebSocket for job logs                 |
| frontend  | React SPA with Konva canvas for annotation        |
| worker    | Celery worker for YOLO training and inference     |
| nginx     | Reverse proxy — `/api/` → backend, `/` → frontend |
| db        | PostgreSQL 16 — projects, images, annotations     |
| redis     | Pub/sub for live job logs, Celery broker          |
| minio     | S3-compatible object storage for images & models  |
| portainer | (Optional) Docker management UI                   |

## Prerequisites

- **Docker** ≥ 24 and **Docker Compose** v2
- (For local dev without Docker) **Python** ≥ 3.10, **Node.js** ≥ 20

## Quick Start (Docker Compose)

```bash
# Clone the repo and enter the directory
cd spektra

# Start all services (includes Portainer)
docker compose up --build -d

# Run database migrations (backend also runs this on startup)
docker compose exec backend alembic upgrade head

# (Optional) Ingest a local dataset (not bundled in repo)
docker compose exec backend python -m scripts.ingest_local_dataset \
  --dataset-root /app/images/"Vehicles - OpenImages Dataset" \
  --project-name Vehicles

# Open the app
open http://localhost          # nginx (frontend + /api)
open http://localhost:9001     # MinIO console (minioadmin / minioadmin)
open https://localhost:9443    # Portainer (admin UI)
```

To stop everything:

```bash
docker compose down            # keep data volumes
docker compose down -v         # remove data volumes too
```

## Local Development (without Docker)

Start the infrastructure services only:

```bash
docker compose up db redis minio -d
```

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Run migrations
alembic upgrade head

# Start the API server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The backend reads configuration from `backend/.env`. Copy
`backend/.env.example` to `backend/.env` and adjust as needed.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens on <http://localhost:5173>. API calls go to `VITE_API_URL` defined in
`frontend/.env.local` (defaults to `http://localhost:8000/api`).

### Worker

```bash
cd worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

celery -A worker.app:celery_app worker --loglevel=info --concurrency=1
```

The worker reads configuration from `worker/.env`. Copy
`worker/.env.example` to `worker/.env` and adjust as needed.

## Ingesting a Dataset

A helper script loads local images into MinIO and metadata into Postgres:

```bash
# From the backend directory (or via Docker exec)
PYTHONPATH=.. python -m scripts.ingest_local_dataset \
  --dataset-root ../images/"Vehicles - OpenImages Dataset" \
  --project-name Vehicles \
  --project-type DETECTION \
  --limit 200
```

Each split folder (`train/`, `valid/`, `test/`) is scanned for `.jpg` / `.png`
files. Labels are read from `_classes.txt`.

## API Overview

All API routes are prefixed with `/api`. For the full API, use FastAPI docs at
`/docs` or `/openapi.json` when the backend is running.

| Method | Path                          | Description                   |
| ------ | ----------------------------- | ----------------------------- |
| GET    | `/api/health`                 | Health check                  |
| POST   | `/api/projects`               | Create a project              |
| GET    | `/api/projects`               | List projects                 |
| GET    | `/api/projects/:id/images`    | Paginated image list          |
| GET    | `/api/projects/:id/labels`    | Labels for a project          |
| POST   | `/api/images/upload`          | Upload images (multipart)     |
| POST   | `/api/images/:id/complete`    | Finalize presigned upload     |
| GET    | `/api/images/:id/url`         | Get presigned download URL    |
| GET    | `/api/images/:id/annotations` | List annotations for an image |
| PATCH  | `/api/images/:id/annotations` | Bulk create/update/delete     |
| WS     | `/ws/jobs/:id`                | Stream job logs via WebSocket |

## Project Structure

```
spektra/
├── backend/            FastAPI application
│   ├── app/
│   │   ├── api/        Routes and dependencies
│   │   ├── core/       Config and logging
│   │   ├── db/         SQLAlchemy engine and base
│   │   ├── models/     ORM models
│   │   ├── schemas/    Pydantic request/response schemas
│   │   └── services/   S3, Redis, EXIF helpers
│   ├── alembic/        Database migrations
│   └── scripts/        Dataset ingestion script
├── frontend/           React + Vite SPA
│   └── src/
│       ├── components/ UI and workspace components
│       ├── layouts/    Dashboard shell
│       ├── lib/        API client and utilities
│       ├── pages/      Gallery and Workspace pages
│       ├── providers/  React Query provider
│       └── store/      Zustand state stores
├── worker/             Celery background worker
│   ├── tasks/          Train and predict tasks
│   └── utils/          DB, S3, Redis, YOLO helpers
├── docker-compose.yml  Full stack orchestration
└── nginx.conf          Reverse proxy config
```

## Environment Variables

### Backend / Worker

| Variable                          | Default                                                | Description                              |
| --------------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| `DATABASE_URL`                    | `postgresql+asyncpg://spektra:spektra@db:5432/spektra` | Async Postgres connection                |
| `REDIS_URL`                       | `redis://redis:6379/0`                                 | Redis connection                         |
| `CELERY_BROKER_URL`               | `redis://redis:6379/0`                                 | Celery broker (worker only)              |
| `MINIO_ENDPOINT`                  | `http://minio:9000`                                    | MinIO / S3 endpoint                      |
| `MINIO_PUBLIC_ENDPOINT`           | `http://localhost:9000`                                | Public MinIO URL for presigned downloads |
| `MINIO_ACCESS_KEY`                | `minioadmin`                                           | S3 access key                            |
| `MINIO_SECRET_KEY`                | `minioadmin`                                           | S3 secret key                            |
| `MINIO_BUCKET`                    | `spektra`                                              | S3 bucket name                           |
| `MINIO_REGION`                    | `us-east-1`                                            | S3 region                                |
| `JWT_SECRET_KEY`                  | `change-me-in-production`                              | JWT signing secret                       |
| `JWT_ALGORITHM`                   | `HS256`                                                | JWT algorithm                            |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `480`                                                  | JWT access token TTL (minutes)           |

### Frontend

| Variable       | Default | Description      |
| -------------- | ------- | ---------------- |
| `VITE_API_URL` | `/api`  | Backend API base |

## Tech Stack

| Layer    | Technology                                                                   |
| -------- | ---------------------------------------------------------------------------- |
| Backend  | Python 3.10+ (Docker uses 3.11), FastAPI, SQLAlchemy 2, Alembic, Pydantic 2  |
| Frontend | React 19, TypeScript, Vite 6, Konva, Zustand, TanStack Query, Tailwind CSS 3 |
| Worker   | Celery 5, Ultralytics YOLOv8                                                 |
| Storage  | PostgreSQL 16, Redis 7, MinIO                                                |
| Infra    | Docker Compose, nginx                                                        |

## License

Apache-2.0. See LICENSE.

Tomasz Zakrzewski
