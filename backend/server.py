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
from lib.storage import init_storage


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.index_task = asyncio.create_task(ensure_indexes())  # background: a big index build must not block boot
    try:
        await init_storage()
        logging.getLogger(__name__).info("Object storage initialized")
    except Exception as exc:  # retried lazily on first upload
        logging.getLogger(__name__).error("Object storage init failed: %s", exc)
    await policies_router.requeue_stuck_ocr()
    yield
    client.close()


app = FastAPI(lifespan=lifespan, title="General Insurance MIS")

api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "General Insurance MIS API"}


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
