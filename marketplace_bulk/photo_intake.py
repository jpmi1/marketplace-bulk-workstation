from __future__ import annotations

import json
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import UploadFile

from .local_recognition import recognize_listing
from .storage import DEFAULT_DB_PATH, DEFAULT_PROJECT_DIR, add_log, default_listing_location, get_settings, upsert_listing
from .validation import pickup_description_line


UPLOAD_ROOT = DEFAULT_PROJECT_DIR / "uploads"
BATCH_ROOT = DEFAULT_PROJECT_DIR / "intake-batches"
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"}
GROUP_GAP_MS = 25 * 1000
CAMERA_SEQUENCE_GAP = 3
MAX_AUTO_GROUP_PHOTOS = 8


def safe_name(value: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(value or "photo").name).strip("._")
    return stem[:120] or "photo"


def photo_asset_path(batch_id: str, photo_id: str) -> Path | None:
    batch = get_batch(batch_id)
    for photo in batch.get("photos", []):
        if photo.get("id") == photo_id:
            path = Path(photo.get("path", ""))
            return path if path.exists() else None
    return None


def batch_path(batch_id: str) -> Path:
    return BATCH_ROOT / f"{batch_id}.json"


def save_batch(batch: dict[str, Any]) -> dict[str, Any]:
    BATCH_ROOT.mkdir(parents=True, exist_ok=True)
    batch_path(batch["id"]).write_text(json.dumps(batch, indent=2), encoding="utf-8")
    return batch


def get_batch(batch_id: str) -> dict[str, Any]:
    path = batch_path(batch_id)
    if not path.exists():
        raise KeyError(batch_id)
    return json.loads(path.read_text(encoding="utf-8"))


async def create_photo_batch(files: list[UploadFile], metadata: list[dict[str, Any]] | None = None, db_path: Path = DEFAULT_DB_PATH) -> dict[str, Any]:
    batch_id = f"batch-{uuid.uuid4().hex[:12]}"
    upload_dir = UPLOAD_ROOT / batch_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    photos = _store_uploads(batch_id, upload_dir, files, metadata or [], start_index=1)

    groups = group_photos(photos)
    for group in groups:
        if group["photo_ids"]:
            group["cover_photo_id"] = group["photo_ids"][0]
    batch = {
        "id": batch_id,
        "photos": photos,
        "groups": groups,
        "status": "uploaded",
        "created_count": 0,
    }
    save_batch(batch)
    add_log("info", f"Uploaded {len(photos)} photos for intake batch {batch_id}", details={"batch_id": batch_id}, db_path=db_path)
    return batch


async def append_photo_batch(batch_id: str, files: list[UploadFile], metadata: list[dict[str, Any]] | None = None, db_path: Path = DEFAULT_DB_PATH) -> dict[str, Any]:
    batch = get_batch(batch_id)
    upload_dir = UPLOAD_ROOT / batch_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    existing_photos = batch.get("photos", [])
    start_index = len(existing_photos) + 1
    new_photos = _store_uploads(batch_id, upload_dir, files, metadata or [], start_index=start_index)
    if not new_photos:
        return batch

    new_groups = group_photos(new_photos)
    existing_group_ids = {group.get("id") for group in batch.get("groups", [])}
    start_group_index = len(batch.get("groups", [])) + 1
    for offset, group in enumerate(new_groups):
        group["id"] = unique_group_id(existing_group_ids, start_group_index + offset)
        group["title"] = f"Photo group {start_group_index + offset}"
        if group["photo_ids"]:
            group["cover_photo_id"] = group["photo_ids"][0]
        existing_group_ids.add(group["id"])

    batch["photos"] = [*existing_photos, *new_photos]
    batch["groups"] = [*batch.get("groups", []), *new_groups]
    batch["status"] = "uploaded"
    save_batch(batch)
    add_log("info", f"Added {len(new_photos)} photos to intake batch {batch_id}", details={"batch_id": batch_id}, db_path=db_path)
    return batch


def _store_uploads(batch_id: str, upload_dir: Path, files: list[UploadFile], metadata: list[dict[str, Any]], start_index: int) -> list[dict[str, Any]]:
    metadata_by_name = {str(item.get("name") or ""): item for item in metadata or []}
    photos: list[dict[str, Any]] = []

    for index, upload in enumerate(files, start=start_index):
        original_name = safe_name(upload.filename or f"photo-{index}.jpg")
        ext = Path(original_name).suffix.lower()
        if ext and ext not in SUPPORTED_EXTENSIONS:
            continue
        filename = f"{index:03d}-{original_name}"
        output_path = upload_dir / filename
        with output_path.open("wb") as f:
            shutil.copyfileobj(upload.file, f)
        meta = metadata_by_name.get(upload.filename or "", {})
        photo_id = f"{batch_id}-photo-{index:03d}"
        photos.append(
            {
                "id": photo_id,
                "name": upload.filename or filename,
                "path": str(output_path.resolve()),
                "uri": f"/api/intake/batches/{batch_id}/photos/{photo_id}",
                "last_modified": meta.get("lastModified"),
                "size": meta.get("size") or output_path.stat().st_size,
                "content_type": upload.content_type or meta.get("type") or "",
                "removed": False,
                "cover": False,
                "sort_order": index,
            }
        )
    return photos


def unique_group_id(existing_ids: set[str | None], index: int) -> str:
    candidate = f"group-{index:03d}"
    suffix = 2
    while candidate in existing_ids:
        candidate = f"group-{index:03d}-{suffix}"
        suffix += 1
    return candidate


def group_photos(photos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []
    previous: dict[str, Any] | None = None
    for photo in photos:
        starts_new = bool(current) and should_start_new_group(previous, photo, len(current))
        if starts_new:
            groups.append(group_from_photos(len(groups) + 1, current))
            current = []
        current.append(photo)
        previous = photo
    if current:
        groups.append(group_from_photos(len(groups) + 1, current))
    return groups


def should_start_new_group(previous: dict[str, Any] | None, photo: dict[str, Any], current_count: int) -> bool:
    if not previous:
        return False

    previous_time = int(previous.get("last_modified") or 0)
    timestamp = int(photo.get("last_modified") or 0)
    if previous_time and timestamp and abs(timestamp - previous_time) > GROUP_GAP_MS:
        return True

    previous_sequence = camera_sequence(previous.get("name") or "")
    sequence = camera_sequence(photo.get("name") or "")
    if previous_sequence is not None and sequence is not None and abs(sequence - previous_sequence) > CAMERA_SEQUENCE_GAP and current_count >= 2:
        return True

    return current_count >= MAX_AUTO_GROUP_PHOTOS


def camera_sequence(name: str) -> int | None:
    match = re.search(r"(?:IMG_|DSC_|PXL_)?(\d{3,})(?=\D*$)", Path(name).stem, flags=re.IGNORECASE)
    return int(match.group(1)) if match else None


def group_from_photos(index: int, photos: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": f"group-{index:03d}",
        "title": f"Photo group {index}",
        "photo_ids": [photo["id"] for photo in photos],
        "removed_photo_ids": [],
        "cover_photo_id": photos[0]["id"] if photos else "",
    }


def commit_photo_batch(batch_id: str, groups: list[dict[str, Any]], db_path: Path = DEFAULT_DB_PATH) -> dict[str, Any]:
    batch = get_batch(batch_id)
    settings = get_settings(db_path)
    photos_by_id = {photo["id"]: photo for photo in batch.get("photos", [])}
    created: list[str] = []
    for index, group in enumerate(groups, start=1):
        removed = set(group.get("removed_photo_ids") or [])
        photo_ids = [photo_id for photo_id in group.get("photo_ids", []) if photo_id in photos_by_id and photo_id not in removed]
        if not photo_ids:
            continue
        listing_id = f"upload-{batch_id.replace('batch-', '')}-{index:03d}"
        cover_id = group.get("cover_photo_id") if group.get("cover_photo_id") in photo_ids else photo_ids[0]
        listing_photos = []
        for sort_order, photo_id in enumerate(photo_ids, start=1):
            source = photos_by_id[photo_id]
            listing_photos.append(
                {
                    "id": f"{listing_id}-photo-{sort_order:02d}",
                    "uri": Path(source["path"]).as_uri(),
                    "path": source["path"],
                    "kind": "original",
                    "provenance": f"Uploaded photo: {source.get('name') or photo_id}",
                    "cover": photo_id == cover_id,
                    "sort_order": sort_order,
                }
            )
        upsert_listing(
            {
                "id": listing_id,
                "source": "photo_upload",
                "title": group.get("title") or f"Uploaded item {index}",
                "price": None,
                "condition": settings["default_condition"],
                "category": "",
                "quantity_text": "1 unit available",
                "description": (
                    f"Selling the item shown in the photos.\n\n"
                    f"Quantity: 1 unit available.\n\n"
                    f"Condition: {settings['default_condition']}.\n\n"
                    "Please confirm details, sizing, and fit from the photos before buying.\n\n"
                    f"{pickup_description_line(settings, bool(settings['shipping_enabled_default']))}"
                ),
                "location": default_listing_location(settings),
                "pickup_enabled": True,
                "shipping_enabled": bool(settings["shipping_enabled_default"]),
                "package_weight_oz": settings.get("default_package_weight_oz"),
                "private_notes": f"Created from photo intake batch {batch_id}. Review title, category, price, and condition before approving.",
                "status": "needs_review",
                "photos": listing_photos,
            },
            db_path,
        )
        if settings.get("local_image_recognition_enabled"):
            try:
                recognize_listing(listing_id, db_path)
            except Exception as exc:
                add_log(
                    "warning",
                    f"Local recognition skipped for {listing_id}",
                    listing_id=listing_id,
                    details={"error": str(exc)},
                    db_path=db_path,
                )
        created.append(listing_id)

    batch["groups"] = groups
    batch["status"] = "committed"
    batch["created_count"] = len(created)
    batch["created_listing_ids"] = created
    save_batch(batch)
    add_log("info", f"Created {len(created)} listings from intake batch {batch_id}", details={"batch_id": batch_id, "listing_ids": created}, db_path=db_path)
    return {"batch_id": batch_id, "created": created}
