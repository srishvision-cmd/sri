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
from lib.db import client, ensure_indexes
from routers import auth as auth_router
from routers import users as users_router
from routers import policies as policies_router
from routers import commission as commission_router
from routers import commission_grid as commission_grid_router
from routers import margin_grid as margin_grid_router
from routers import holds as holds_router
from routers import statements as statements_router
from routers import recon as recon_router
from routers import portals as portals_router
from routers import insurers as insurers_router
from routers import onspot as onspot_router
from routers import rule_tools as rule_tools_router
from routers import recalc as recalc_router
from routers import rule_purge as rule_purge_router
from routers import margin_presets as margin_presets_router
from routers import grid_templates as grid_templates_router
from lib.migrations import run_migrations
from lib.storage import init_storage
from lib.live_reset import ensure_bootstrap_admin


async def _warm_up() -> None:
    """Non-blocking boot work: storage key + resume interrupted OCR. Failures are retried lazily."""
    log = logging.getLogger(__name__)
    try:
        await init_storage()
        log.info("Object storage initialized")
    except Exception as exc:
        log.error("Object storage init failed: %s", exc)
    try:  # create the first admin only when none exists (never deletes data)
        await ensure_bootstrap_admin()
    except Exception as exc:
        log.error("Bootstrap admin failed: %s", exc)
    try:  # retired broker mode "Pay Later" means the same as Cash (pending) — rename, no data lost
        from lib.db import db
        await db.policies.update_many({"broker_payment_mode": "Pay Later"}, {"$set": {"broker_payment_mode": "Cash"}})
    except Exception as exc:
        log.error("Broker mode migration failed: %s", exc)
    try:  # new-vehicle placeholders (NEW-0001 …) → unique auto code; release wrongly-rejected duplicates
        await policies_router.fix_new_vehicle_regs()
        await policies_router.fix_rto_names()
    except Exception as exc:
        log.error("New-vehicle reg migration failed: %s", exc)
    try:
        await policies_router.requeue_stuck_ocr()
    except Exception as exc:
        log.error("OCR requeue failed: %s", exc)


async def _recover() -> None:
    """Background: finish work a previous restart interrupted (stuck OCR, unallocated upload-batch payments)."""
    from routers.policies import recover_stuck_ocr
    from routers.recon import allocate_stale_batches
    try:
        await recover_stuck_ocr()
        await allocate_stale_batches()
    except Exception:
        logging.getLogger(__name__).exception("Startup recovery failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # background: index builds / network calls must never delay the server answering /health
    app.state.index_task = asyncio.create_task(ensure_indexes())
    app.state.warmup_task = asyncio.create_task(_warm_up())
    app.state.migrations_task = asyncio.create_task(run_migrations())
    app.state.recover_task = asyncio.create_task(_recover())
    app.state.ocr_worker = asyncio.create_task(policies_router.ocr_worker())  # durable OCR queue (policy records)
    yield
    app.state.ocr_worker.cancel()
    client.close()


app = FastAPI(lifespan=lifespan, title="General Insurance MIS")


@app.middleware("http")
async def sliding_session(request, call_next):
    from lib.auth import renew_session

    response = await call_next(request)
    renew_session(request, response)
    return response

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


api_router.include_router(recalc_router.router)
api_router.include_router(rule_purge_router.router)
api_router.include_router(margin_presets_router.router)
api_router.include_router(grid_templates_router.router)
api_router.include_router(rule_tools_router.router)  # before commission_router: /commission/rules/copy must not hit /{id}
api_router.include_router(auth_router.router)
api_router.include_router(users_router.router)
api_router.include_router(policies_router.router)
api_router.include_router(commission_router.router)
api_router.include_router(commission_grid_router.router)
api_router.include_router(margin_grid_router.router)
api_router.include_router(holds_router.router)
api_router.include_router(statements_router.router)
api_router.include_router(recon_router.router)
api_router.include_router(portals_router.router)
api_router.include_router(insurers_router.router)
api_router.include_router(onspot_router.router)

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
