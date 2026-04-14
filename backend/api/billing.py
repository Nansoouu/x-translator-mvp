"""api/billing.py — Stripe checkout + webhook — x-translator-mvp"""
import uuid, stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from core.config import settings
from core.db import get_conn
from api.auth import get_current_user

router = APIRouter(prefix="/billing", tags=["billing"])

if settings.STRIPE_SECRET_KEY:
    stripe.api_key = settings.STRIPE_SECRET_KEY

class CheckoutRequest(BaseModel):
    plan: str  # "monthly" | "credits_10"

@router.post("/checkout")
async def create_checkout(body: CheckoutRequest, user=Depends(get_current_user)):
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(503, "Stripe non configuré")
    price_map = {"monthly": settings.STRIPE_PRICE_MONTHLY, "credits_10": settings.STRIPE_PRICE_CREDITS_10}
    price_id = price_map.get(body.plan)
    if not price_id:
        raise HTTPException(400, "Plan invalide")
    mode = "subscription" if body.plan == "monthly" else "payment"
    session = stripe.checkout.Session.create(
        customer_email=user.get("email"),
        line_items=[{"price": price_id, "quantity": 1}],
        mode=mode,
        success_url="http://localhost:3000/billing?success=1",
        cancel_url="http://localhost:3000/billing?cancelled=1",
        metadata={"user_id": user["id"], "plan": body.plan},
    )
    return {"checkout_url": session.url}

@router.post("/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(400, "Signature invalide")
    if event["type"] == "checkout.session.completed":
        sess = event["data"]["object"]
        uid  = sess["metadata"].get("user_id")
        plan = sess["metadata"].get("plan")
        if uid and plan:
            async with get_conn() as conn:
                if plan == "monthly":
                    await conn.execute(
                        """INSERT INTO subscriptions (user_id, plan, credits_remaining)
                           VALUES ($1,'monthly',9999)
                           ON CONFLICT (user_id) DO UPDATE SET plan='monthly', credits_remaining=9999, updated_at=now()""",
                        uuid.UUID(uid),
                    )
                elif plan == "credits_10":
                    await conn.execute(
                        """INSERT INTO subscriptions (user_id, plan, credits_remaining)
                           VALUES ($1,'free',10)
                           ON CONFLICT (user_id) DO UPDATE SET credits_remaining=subscriptions.credits_remaining+10, updated_at=now()""",
                        uuid.UUID(uid),
                    )
    elif event["type"] == "customer.subscription.deleted":
        cid = event["data"]["object"].get("customer")
        if cid:
            async with get_conn() as conn:
                await conn.execute("UPDATE subscriptions SET plan='free', credits_remaining=0, updated_at=now() WHERE stripe_customer_id=$1", cid)
    return {"ok": True}

@router.get("/status")
async def billing_status(user=Depends(get_current_user)):
    async with get_conn() as conn:
        row = await conn.fetchrow("SELECT plan, credits_remaining, period_end FROM subscriptions WHERE user_id=$1", uuid.UUID(user["id"]))
    if not row:
        return {"plan": "free", "credits_remaining": 3, "period_end": None}
    return dict(row)
