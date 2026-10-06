import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, db, ensure_indexes
from routers import auth as auth_router
from routers import users as users_router
from routers import policies as policies_router
from lib.storage import init_storage


async def _warm_up() -> None:
    """Non-blocking boot work: storage key + resume interrupted OCR. Failures are retried lazily."""
    log = logging.getLogger(__name__)
    try:
        await init_storage()
        log.info("Object storage initialized")
    except Exception as exc:
        log.error("Object storage init failed: %s", exc)
    try:  # going live: purge demo/sample policies (seed rows only — never real uploads)
        res = await db.policies.delete_many({"seeded": True})
        if res.deleted_count:
            log.info("Removed %d demo policies", res.deleted_count)
    except Exception as exc:
        log.error("Demo purge failed: %s", exc)
    try:
        await policies_router.requeue_stuck_ocr()
    except Exception as exc:
        log.error("OCR requeue failed: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # background: index builds / network calls must never delay the server answering /health
    app.state.index_task = asyncio.create_task(ensure_indexes())
    app.state.warmup_task = asyncio.create_task(_warm_up())
    yield
    client.close()


app = FastAPI(lifespan=lifespan, title="General Insurance MIS")

api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "General Insurance MIS API"}


@api_router.get("/health")
async def api_health():
    return {"status": "ok"}


# Platform liveness/readiness probe hits GET /health at the root (outside /api) — keep it
# dependency-free (no DB / storage calls) so it always answers instantly.
@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


api_router.include_router(auth_router.router)
api_router.include_router(users_router.router)
api_router.include_router(policies_router.router)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
