from __future__ import annotations

from pathlib import Path
from typing import Any

import json

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__
from .importers import import_existing_outputs
from .local_recognition import recognize_listing, recognize_listings
from .photo_intake import append_photo_batch, commit_photo_batch, create_photo_batch, get_batch, photo_asset_path
from .storage import (
    DEFAULT_DB_PATH,
    ROOT,
    apply_pickup_location_to_listings,
    approve_listing,
    btc_entries_csv,
    btc_entries_xlsx,
    btc_progress_summary,
    create_btc_entry,
    delete_listing,
    delete_listings,
    delete_btc_entry,
    export_posting_queue,
    get_listing,
    get_settings,
    init_db,
    list_btc_entries,
    list_listings,
    list_logs,
    patch_btc_entry,
    patch_listing,
    patch_photo,
    update_settings,
)


class PatchBody(BaseModel):
    data: dict[str, Any]


def create_app(db_path: Path = DEFAULT_DB_PATH) -> FastAPI:
    init_db(db_path)
    app = FastAPI(title="Bulk Facebook Marketplace Poster", version=__version__)
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

    @app.post("/api/listings/apply-pickup-location")
    def listings_apply_pickup_location(body: PatchBody) -> dict[str, Any]:
        ids = [str(value).strip() for value in body.data.get("ids", []) if str(value).strip()]
        return apply_pickup_location_to_listings(ids or None, db_path)

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

    @app.post("/api/listings/{listing_id}/recognize")
    def listing_recognize(listing_id: str) -> dict[str, Any]:
        try:
            return recognize_listing(listing_id, db_path)
        except KeyError:
            raise HTTPException(status_code=404, detail="Listing not found") from None

    @app.post("/api/listings/recognize")
    def listings_recognize(body: PatchBody) -> dict[str, Any]:
        ids = [str(value).strip() for value in body.data.get("ids", []) if str(value).strip()]
        return recognize_listings(ids or None, db_path)

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

    @app.post("/api/intake/photos")
    async def intake_photos(files: list[UploadFile] = File(...), metadata: str = Form("[]")) -> dict[str, Any]:
        try:
            parsed_metadata = json.loads(metadata or "[]")
            if not isinstance(parsed_metadata, list):
                parsed_metadata = []
        except json.JSONDecodeError:
            parsed_metadata = []
        return await create_photo_batch(files, parsed_metadata, db_path)

    @app.post("/api/intake/batches/{batch_id}/photos")
    async def intake_batch_append_photos(batch_id: str, files: list[UploadFile] = File(...), metadata: str = Form("[]")) -> dict[str, Any]:
        try:
            parsed_metadata = json.loads(metadata or "[]")
            if not isinstance(parsed_metadata, list):
                parsed_metadata = []
        except json.JSONDecodeError:
            parsed_metadata = []
        try:
            return await append_photo_batch(batch_id, files, parsed_metadata, db_path)
        except KeyError:
            raise HTTPException(status_code=404, detail="Intake batch not found") from None

    @app.get("/api/intake/batches/{batch_id}")
    def intake_batch(batch_id: str) -> dict[str, Any]:
        try:
            return get_batch(batch_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Intake batch not found") from None

    @app.get("/api/intake/batches/{batch_id}/photos/{photo_id}")
    def intake_photo_asset(batch_id: str, photo_id: str) -> FileResponse:
        try:
            path = photo_asset_path(batch_id, photo_id)
        except KeyError:
            path = None
        if path and path.exists():
            return FileResponse(path)
        raise HTTPException(status_code=404, detail="Intake photo not found")

    @app.post("/api/intake/photo-groups/{batch_id}/commit")
    def intake_photo_groups_commit(batch_id: str, body: PatchBody) -> dict[str, Any]:
        groups = body.data.get("groups", [])
        if not isinstance(groups, list):
            groups = []
        try:
            return commit_photo_batch(batch_id, groups, db_path)
        except KeyError:
            raise HTTPException(status_code=404, detail="Intake batch not found") from None

    @app.get("/api/posting-queue")
    def posting_queue() -> list[dict[str, Any]]:
        return export_posting_queue(db_path)

    @app.get("/api/logs")
    def logs(limit: int = 100) -> list[dict[str, Any]]:
        return list_logs(limit=limit, db_path=db_path)

    @app.get("/api/btc-progress")
    def btc_progress_entries() -> list[dict[str, Any]]:
        return list_btc_entries(db_path)

    @app.post("/api/btc-progress")
    def btc_progress_create(body: PatchBody) -> dict[str, Any]:
        return create_btc_entry(body.data, db_path)

    @app.get("/api/btc-progress/summary")
    def btc_progress_summary_get() -> dict[str, Any]:
        return btc_progress_summary(db_path)

    @app.get("/api/kraken-referral")
    def kraken_referral() -> RedirectResponse:
        url = str(get_settings(db_path).get("kraken_referral_url") or "").strip()
        if not url:
            raise HTTPException(status_code=404, detail="Kraken referral URL is not configured")
        return RedirectResponse(url=url)

    @app.get("/api/btc-progress/export.csv")
    def btc_progress_csv_export() -> Response:
        return Response(
            content=btc_entries_csv(db_path),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="sell-to-1btc-progress.csv"'},
        )

    @app.get("/api/btc-progress/export.xlsx")
    def btc_progress_xlsx_export() -> Response:
        return Response(
            content=btc_entries_xlsx(db_path),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="sell-to-1btc-progress.xlsx"'},
        )

    @app.patch("/api/btc-progress/{entry_id}")
    def btc_progress_patch(entry_id: int, body: PatchBody) -> dict[str, Any]:
        try:
            return patch_btc_entry(entry_id, body.data, db_path)
        except KeyError:
            raise HTTPException(status_code=404, detail="BTC progress entry not found") from None

    @app.delete("/api/btc-progress/{entry_id}")
    def btc_progress_delete(entry_id: int) -> dict[str, Any]:
        if not delete_btc_entry(entry_id, db_path):
            raise HTTPException(status_code=404, detail="BTC progress entry not found")
        return {"deleted": [entry_id]}

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
