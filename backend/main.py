"""main.py — FastAPI app — x-translator-mvp"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from core.config import settings
from core.db import init_pool, close_pool
from api.auth import router as auth_router
from api.jobs import router as jobs_router
from api.billing import router as billing_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    yield
    await close_pool()

app = FastAPI(title="SpottedYou Translator", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(auth_router)
app.include_router(jobs_router)
app.include_router(billing_router)

@app.get("/health")
async def health():
    return {"ok": True, "env": settings.APP_ENV}
