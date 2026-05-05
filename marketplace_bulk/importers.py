from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .storage import ROOT, get_settings, upsert_listing
from .validation import public_inventory_description, sanitize_public_description


PHOTO_QUEUE = ROOT / "outputs" / "posting_queue" / "posting_queue.json"
STORAGE_REVIEW_CSV = ROOT / "outputs" / "storage_inventory_review" / "storage_inventory_review.csv"
STORAGE_STATE = ROOT / "outputs" / "storage_inventory_review" / "storage_preview_state.json"
STORAGE_FOUND_IMAGES = ROOT / "outputs" / "storage_inventory_review" / "storage_inventory_found_images.json"
STORAGE_APPROVED_QUEUE = ROOT / "outputs" / "storage_inventory_review" / "storage_approved_posting_queue.json"


def money_to_int(value: Any) -> int | None:
    cleaned = re.sub(r"[^0-9.]", "", str(value or ""))
    if not cleaned:
        return None
    return max(0, round(float(cleaned)))


def product_domain(url: str) -> str:
    host = urlparse(url or "").netloc.lower()
    return host[4:] if host.startswith("www.") else host


def condition_from_mix(mix: str) -> str:
    lower = (mix or "").lower()
    if "used:" in lower and "new:" not in lower:
        return "Used - Good"
    if "new:" in lower and "used:" not in lower and "altered:" not in lower:
        return "New"
    return "Used - Good"


def category_from_storage(category: str) -> str:
    lower = (category or "").lower()
    if "solar" in lower or "deployment" in lower or "hardware" in lower:
        return "Home Improvement Supplies"
    if "camera" in lower or "electronics" in lower or "battery" in lower:
        return "Electronics"
    return category or "Electronics"


def import_existing_outputs() -> dict[str, int]:
    counts = {
        "photo_pipeline": import_photo_pipeline_queue(),
        "storage_inventory": import_storage_inventory_review(),
        "storage_approved_assets": import_storage_approved_queue(),
    }
    return counts


def import_photo_pipeline_queue(path: Path = PHOTO_QUEUE) -> int:
    if not path.exists():
        return 0
    settings = get_settings()
    rows = json.loads(path.read_text(encoding="utf-8"))
    count = 0
    for row in rows:
        item_id = str(row.get("item_id") or row.get("id") or "").strip()
        if not item_id:
            continue
        photo_paths = row.get("photo_path_list")
        if not isinstance(photo_paths, list):
            photo_paths = [
                value.strip()
                for value in str(row.get("photo_paths") or "").split(";")
                if value.strip()
            ]
        photos = [
            {
                "id": f"{item_id}-photo-{idx:02d}",
                "uri": Path(photo).as_uri() if Path(photo).exists() else str(photo),
                "path": str(photo),
                "kind": "original",
                "provenance": "Imported from local photo pipeline",
                "cover": idx == 1,
                "sort_order": idx,
            }
            for idx, photo in enumerate(photo_paths, start=1)
        ]
        upsert_listing(
            {
                "id": item_id,
                "source": "photo_folder",
                "title": row.get("title") or "",
                "price": money_to_int(row.get("price")),
                "condition": row.get("condition") or "Used - Good",
                "category": row.get("category") or "",
                "quantity_text": row.get("quantity_text") or "1 unit available",
                "description": sanitize_public_description(row.get("description") or ""),
                "location": settings["location"],
                "pickup_enabled": True,
                "shipping_enabled": True,
                "package_weight_oz": row.get("package_weight_oz") or None,
                "private_notes": row.get("review_notes") or "",
                "status": "needs_review",
                "photos": photos,
                "comps": comp_links(row.get("comp_sources") or ""),
            }
        )
        count += 1
    return count


def comp_links(raw: str) -> list[dict[str, str]]:
    links = []
    for url in re.findall(r"https?://[^\s;|]+", str(raw or "")):
        links.append({"url": url, "source_type": "comp", "confidence": "imported"})
    return links


def import_storage_inventory_review(path: Path = STORAGE_REVIEW_CSV) -> int:
    if not path.exists():
        return 0
    settings = get_settings()
    state = read_json(STORAGE_STATE, {})
    found_images = read_json(STORAGE_FOUND_IMAGES, {})
    count = 0
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            row_id = str(row.get("Source row number") or "").strip()
            if not row_id:
                continue
            saved = state.get(row_id, {})
            removed = set(saved.get("removed") or [])
            cover = str(saved.get("cover") or "")
            candidates = found_images.get(row_id, [])
            photos = []
            for idx, image in enumerate(candidates, start=1):
                image_url = str(image.get("image") or image.get("thumbnail") or "")
                thumb_url = str(image.get("thumbnail") or image_url)
                if not image_url:
                    continue
                photos.append(
                    {
                        "id": f"storage-{row_id}-candidate-{idx:02d}",
                        "uri": thumb_url,
                        "source_url": image_url,
                        "kind": "web_candidate",
                        "provenance": image.get("source") or image.get("page") or "Web image candidate",
                        "removed": image_url in removed or thumb_url in removed,
                        "cover": image_url == cover or thumb_url == cover or (idx == 1 and not cover),
                        "sort_order": idx,
                        "rights_warning": "Reference candidate. Verify and approve before using as a final listing photo.",
                    }
                )
            description = public_inventory_description(
                item_name=row.get("Item name") or row.get("Draft title") or "",
                public_quantity_text=row.get("Public quantity text") or "",
                condition_mix=row.get("Condition mix") or "",
                details=row.get("Product page summary") or "",
                product_title=row.get("Product page title") or "",
                product_domain=product_domain(row.get("Product URL") or ""),
                location=settings["location"],
                shipping_enabled=True,
            )
            approved = saved.get("status") == "approved"
            upsert_listing(
                {
                    "id": f"storage-{row_id}",
                    "source": "excel_inventory",
                    "title": row.get("Draft title") or row.get("Item name") or "",
                    "price": money_to_int(row.get("Recommended listing price")),
                    "condition": condition_from_mix(row.get("Condition mix") or ""),
                    "category": category_from_storage(row.get("Category") or ""),
                    "quantity_text": row.get("Public quantity text") or "",
                    "description": description,
                    "location": settings["location"],
                    "pickup_enabled": True,
                    "shipping_enabled": True,
                    "private_notes": "; ".join(
                        value
                        for value in [
                            row.get("Data cleanup flag") or "",
                            row.get("Review status") or "",
                            row.get("Product URL") or "",
                        ]
                        if value
                    ),
                    "approved": approved,
                    "status": "approved" if approved else "needs_review",
                    "reference_only_approved": False,
                    "photos": photos,
                    "comps": comp_links(row.get("Pricing sources") or ""),
                }
            )
            count += 1
    return count


def import_storage_approved_queue(path: Path = STORAGE_APPROVED_QUEUE) -> int:
    """Import downloaded approved image assets from a previous inventory runner."""
    if not path.exists():
        return 0
    settings = get_settings()
    rows = json.loads(path.read_text(encoding="utf-8"))
    count = 0
    for row in rows:
        row_id = str(row.get("row_id") or "").strip()
        if not row_id:
            continue
        listing_id = f"storage-{row_id}"
        photo_paths = [str(path) for path in row.get("photo_paths") or []]
        photos = [
            {
                "id": f"{listing_id}-asset-{idx:02d}",
                "uri": Path(photo).as_uri() if Path(photo).exists() else photo,
                "path": photo,
                "kind": "reference_asset",
                "provenance": "Downloaded from approved preview candidate",
                "cover": idx == 1,
                "sort_order": idx,
                "rights_warning": "Previously approved web/reference asset. Confirm rights before final reuse.",
            }
            for idx, photo in enumerate(photo_paths, start=1)
        ]
        upsert_listing(
            {
                "id": listing_id,
                "source": "excel_inventory",
                "title": row.get("title") or "",
                "price": money_to_int(row.get("price")),
                "condition": row.get("condition") or "Used - Good",
                "category": row.get("category") or "",
                "quantity_text": row.get("public_quantity_text") or "",
                "description": sanitize_public_description(row.get("description") or ""),
                "location": settings["location"],
                "pickup_enabled": True,
                "shipping_enabled": True,
                "approved": True,
                "status": "approved",
                "reference_only_approved": True,
                "photos": photos,
            }
        )
        count += 1
    return count


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback
