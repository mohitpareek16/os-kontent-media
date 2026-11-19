from fastapi import APIRouter

from app.api.routers import (
    analytics,
    auth,
    brand_assets,
    chat,
    jobs,
    notifications,
    pods,
    search,
    users,
    video_types,
    voice_notes,
    whatsapp,
    whatsapp_webhook,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(video_types.router)
api_router.include_router(pods.router)
api_router.include_router(jobs.router)
api_router.include_router(brand_assets.router)
api_router.include_router(analytics.router)
api_router.include_router(notifications.router)
api_router.include_router(chat.router)
api_router.include_router(voice_notes.router)
api_router.include_router(search.router)
api_router.include_router(whatsapp.router)
# Registered after the admin router so the authenticated /whatsapp/* routes
# are matched first. The webhook's two paths are distinct from all of them,
# and it is the one router here with no auth dependency — Meta cannot carry
# a bearer token. Its own signature check is what stands in for one.
api_router.include_router(whatsapp_webhook.router)
