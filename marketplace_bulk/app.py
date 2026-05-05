from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__
from .importers import import_existing_outputs
from .storage import (
    DEFAULT_DB_PATH,
    ROOT,
    approve_listing,
    delete_listing,
    delete_listings,
    export_posting_queue,
    get_listing,
    get_settings,
    init_db,
    list_listings,
    list_logs,
    patch_listing,
    patch_photo,
    update_settings,
)


class PatchBody(BaseModel):
    data: dict[str, Any]


def create_app(db_path: Path = DEFAULT_DB_PATH) -> FastAPI:
    init_db(db_path)
    app = FastAPI(title="Marketplace Bulk Listing Workstation", version=__version__)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"ok": "true", "version": __version__}

    @app.get("/favicon.ico", include_in_schema=False)
    def favicon() -> Response:
        return Response(status_code=204)

    @app.get("/api/project")
    def project() -> dict[str, Any]:
        return {"settings": get_settings(db_path), "counts": summarize_counts(db_path)}

    @app.get("/api/settings")
    def settings() -> dict[str, Any]:
        return get_settings(db_path)

    @app.patch("/api/settings")
    def settings_patch(body: PatchBody) -> dict[str, Any]:
        return update_settings(body.data, db_path)

    @app.get("/api/listings")
    def listings(status: str = "all") -> list[dict[str, Any]]:
        return list_listings(status=status, db_path=db_path)

    @app.get("/api/listings/{listing_id}")
    def listing_get(listing_id: str) -> dict[str, Any]:
        listing = get_listing(listing_id, db_path)
        if not listing:
            raise HTTPException(status_code=404, detail="Listing not found")
        return listing

    @app.patch("/api/listings/{listing_id}")
    def listing_patch(listing_id: str, body: PatchBody) -> dict[str, Any]:
        try:
            return patch_listing(listing_id, body.data, db_path)
        except KeyError:
            raise HTTPException(status_code=404, detail="Listing not found") from None

    @app.delete("/api/listings/{listing_id}")
    def listing_delete(listing_id: str) -> dict[str, Any]:
        if not delete_listing(listing_id, db_path):
            raise HTTPException(status_code=404, detail="Listing not found")
        return {"deleted": [listing_id]}

    @app.post("/api/listings/bulk-delete")
    def listings_bulk_delete(body: PatchBody) -> dict[str, Any]:
        ids = [str(value) for value in body.data.get("ids", []) if str(value).strip()]
        return {"deleted": delete_listings(ids, db_path)}

    @app.post("/api/listings/{listing_id}/approve")
    def listing_approve(listing_id: str, body: PatchBody) -> dict[str, Any]:
        try:
            return approve_listing(listing_id, bool(body.data.get("approved", True)), db_path)
        except KeyError:
            raise HTTPException(status_code=404, detail="Listing not found") from None

    @app.patch("/api/listings/{listing_id}/photos/{photo_id}")
    def photo_patch(listing_id: str, photo_id: str, body: PatchBody) -> dict[str, Any]:
        try:
            return patch_photo(listing_id, photo_id, body.data, db_path)
        except KeyError:
            raise HTTPException(status_code=404, detail="Photo not found") from None

    @app.get("/api/assets/photos/{photo_id}")
    def photo_asset(photo_id: str) -> FileResponse:
        for listing in list_listings(db_path=db_path):
            for photo in listing["photos"]:
                if photo["id"] == photo_id and photo.get("path"):
                    path = Path(photo["path"])
                    if path.exists():
                        return FileResponse(path)
        raise HTTPException(status_code=404, detail="Photo asset not found")

    @app.post("/api/intake/existing-outputs")
    def intake_existing() -> dict[str, int]:
        return import_existing_outputs()

    @app.get("/api/posting-queue")
    def posting_queue() -> list[dict[str, Any]]:
        return export_posting_queue(db_path)

    @app.get("/api/logs")
    def logs(limit: int = 100) -> list[dict[str, Any]]:
        return list_logs(limit=limit, db_path=db_path)

    frontend_dist = ROOT / "app" / "frontend" / "dist"
    if frontend_dist.exists():
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
    else:
        @app.get("/")
        def no_frontend() -> JSONResponse:
            return JSONResponse(
                {
                    "message": "Frontend has not been built yet. Run `npm install` and `npm run build` in app/frontend, or use `npm run dev` for the Vite app."
                }
            )

    return app


def summarize_counts(db_path: Path) -> dict[str, int]:
    rows = list_listings(db_path=db_path)
    return {
        "all": len(rows),
        "needs_review": sum(1 for row in rows if row["status"] == "needs_review"),
        "approved": sum(1 for row in rows if row["approved"]),
        "drafted": sum(1 for row in rows if row["status"] == "drafted"),
        "published": sum(1 for row in rows if row["status"] == "published"),
    }


app = create_app()
