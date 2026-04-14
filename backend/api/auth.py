"""
api/auth.py — Auth Supabase proxy + helpers JWT — x-translator-mvp
"""
from __future__ import annotations

from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel

from core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

SUPABASE_AUTH_URL = f"{settings.SUPABASE_URL}/auth/v1" if settings.SUPABASE_URL else ""


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str


# ── Helpers JWT ───────────────────────────────────────────────────────────────

async def _verify_jwt(token: str) -> dict | None:
    """Vérifie un JWT Supabase et retourne le payload user."""
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{SUPABASE_AUTH_URL}/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": settings.SUPABASE_SERVICE_KEY,
                },
            )
            if resp.status_code == 200:
                return resp.json()
    except Exception:
        pass
    return None


async def get_current_user_optional(
    authorization: Optional[str] = Header(None),
) -> Optional[dict]:
    """Dépendance FastAPI : retourne l'utilisateur ou None si non connecté."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    return await _verify_jwt(token)


async def get_current_user(
    authorization: Optional[str] = Header(None),
) -> dict:
    """Dépendance FastAPI : exige un utilisateur connecté."""
    user = await get_current_user_optional(authorization)
    if not user:
        raise HTTPException(401, "Non authentifié")
    return user


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/register")
async def register(body: RegisterRequest):
    """Inscription via Supabase Auth."""
    if not SUPABASE_AUTH_URL:
        raise HTTPException(503, "Auth non configurée")
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{SUPABASE_AUTH_URL}/signup",
            headers={"apikey": settings.SUPABASE_SERVICE_KEY},
            json={"email": body.email, "password": body.password},
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(resp.status_code, resp.json().get("msg", "Erreur inscription"))
    return resp.json()


@router.post("/login")
async def login(body: LoginRequest):
    """Connexion via Supabase Auth → retourne access_token."""
    if not SUPABASE_AUTH_URL:
        raise HTTPException(503, "Auth non configurée")
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{SUPABASE_AUTH_URL}/token?grant_type=password",
            headers={"apikey": settings.SUPABASE_SERVICE_KEY},
            json={"email": body.email, "password": body.password},
        )
    if resp.status_code != 200:
        raise HTTPException(401, "Email ou mot de passe incorrect")
    return resp.json()


@router.get("/me")
async def me(user=Depends(get_current_user)):
    """Retourne le profil de l'utilisateur connecté."""
    return user
