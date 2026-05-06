from __future__ import annotations

import base64
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import textwrap
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

from .storage import DEFAULT_DB_PATH, DEFAULT_PROJECT_DIR, ROOT, add_log, get_listing, get_settings, patch_listing
from .validation import pickup_description_line, sanitize_public_description


PIPELINE_CONFIG = Path("/Volumes/Rewind-Data/Onsite photos/media_catalog/config.json")
RECOGNITION_ROOT = DEFAULT_PROJECT_DIR / "recognition-cache"
SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"}
BARCODE_RE = re.compile(r"\b(?:\d[\s-]?){8,14}\b")
MODEL_RE = re.compile(r"\b(?:model|mdl|part|p/n|pn|sku|item|style|serial|s/n|sn)[\s:#-]*([A-Z0-9][A-Z0-9._/-]{2,})\b", re.I)
GENERIC_TITLES = {
    "uploaded item",
    "photo group",
    "selling the item shown in the photos",
}


def pipeline_defaults() -> dict[str, str]:
    if not PIPELINE_CONFIG.exists():
        return {}
    try:
        data = json.loads(PIPELINE_CONFIG.read_text(encoding="utf-8"))
    except Exception:
        return {}
    vision_models = [str(model) for model in data.get("vision_models") or [] if str(model).strip()]
    return {
        "local_vision_ollama_host": str(data.get("ollama_host") or "").strip(),
        "local_vision_model": vision_models[-1] if vision_models else "",
        "local_vision_model_root": str(data.get("model_root") or "").strip(),
    }


def prepare_image_for_model(path: Path, max_dimension: int = 1024) -> Path:
    RECOGNITION_ROOT.mkdir(parents=True, exist_ok=True)
    out = RECOGNITION_ROOT / "images" / f"{path.stem}-{abs(hash((str(path), path.stat().st_mtime_ns))) & 0xfffffff:x}.jpg"
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() in {".heic", ".heif"} and shutil.which("sips"):
        subprocess.run(["sips", "-s", "format", "jpeg", str(path), "--out", str(out)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return out
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        image.thumbnail((max_dimension, max_dimension))
        image.save(out, format="JPEG", quality=90)
    return out


def encode_image(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def compact_text(value: str, limit: int = 1400) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    return text[:limit]


def dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = str(value).strip()
        if not cleaned or cleaned.lower() in seen:
            continue
        seen.add(cleaned.lower())
        result.append(cleaned)
    return result


def extract_codes(text: str) -> tuple[list[str], list[str]]:
    barcodes = []
    for match in BARCODE_RE.findall(text or ""):
        digits = re.sub(r"\D+", "", match)
        if len(digits) in {8, 12, 13, 14}:
            barcodes.append(digits)
    models = [match.group(1).strip(" .,:;") for match in MODEL_RE.finditer(text or "")]
    return dedupe(barcodes), dedupe(models)


def run_tesseract(path: Path, timeout: int = 30) -> str:
    if not shutil.which("tesseract"):
        return ""
    try:
        result = subprocess.run(
            ["tesseract", str(path), "stdout", "--psm", "6"],
            check=False,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
    except Exception:
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def run_apple_vision(path: Path, timeout: int = 45) -> dict[str, Any]:
    if not shutil.which("swift"):
        return {}
    script = ROOT / "scripts" / "macos_vision_extract.swift"
    if not script.exists():
        return {}
    try:
        result = subprocess.run(
            ["swift", str(script), str(path)],
            check=False,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
    except Exception:
        return {}
    if result.returncode != 0:
        return {}
    try:
        parsed = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def ollama_env(settings: dict[str, Any]) -> dict[str, str]:
    env = os.environ.copy()
    if settings.get("local_vision_ollama_host"):
        env["OLLAMA_HOST"] = str(settings["local_vision_ollama_host"])
    if settings.get("local_vision_model_root"):
        env["OLLAMA_MODELS"] = str(settings["local_vision_model_root"])
    return env


def ensure_ollama(settings: dict[str, Any]) -> bool:
    host = str(settings.get("local_vision_ollama_host") or "").rstrip("/")
    if not host:
        return False
    try:
        urllib.request.urlopen(f"{host}/api/tags", timeout=2).read()
        return True
    except Exception:
        pass
    server = Path("/Applications/Ollama.app/Contents/Resources/ollama")
    if not server.exists():
        return False
    log_path = RECOGNITION_ROOT / "ollama-managed.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handle = log_path.open("a", encoding="utf-8")
    subprocess.Popen([str(server), "serve"], env=ollama_env(settings), stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(12):
        try:
            urllib.request.urlopen(f"{host}/api/tags", timeout=2).read()
            return True
        except Exception:
            time.sleep(1)
    return False


def local_vision_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "category": {"type": "string"},
            "condition": {"type": "string"},
            "brand": {"type": "string"},
            "model_numbers": {"type": "array", "items": {"type": "string"}},
            "barcode_numbers": {"type": "array", "items": {"type": "string"}},
            "tags": {"type": "array", "items": {"type": "string"}},
            "description_bullets": {"type": "array", "items": {"type": "string"}},
            "visible_text": {"type": "string"},
            "confidence": {"type": "number"},
            "needs_review": {"type": "boolean"},
            "notes": {"type": "string"},
        },
        "required": ["title", "category", "condition", "brand", "model_numbers", "barcode_numbers", "tags", "description_bullets", "visible_text", "confidence", "needs_review", "notes"],
        "additionalProperties": False,
    }


def ollama_analyze(images: list[Path], listing: dict[str, Any], settings: dict[str, Any], ocr_text: str, barcodes: list[str], models: list[str]) -> dict[str, Any]:
    model = str(settings.get("local_vision_model") or "").strip()
    host = str(settings.get("local_vision_ollama_host") or "").rstrip("/")
    if not model or not host or not ensure_ollama(settings):
        return {}
    system_prompt = textwrap.dedent(
        """
        You identify secondhand items for Facebook Marketplace listing prep using only on-device/local image analysis.
        Return JSON exactly matching the schema.
        Be conservative: do not invent brand, model, dimensions, compatibility, or condition.
        Keep public-facing description bullets buyer-friendly and avoid internal notes.
        Put uncertainty in notes and set needs_review=true when details are ambiguous.
        Choose a common Facebook Marketplace category such as Electronics, Household, Clothing & Shoes, Bags & Luggage, Tools, Toys & Games, Sports & Outdoors, Home Goods, or Other.
        """
    ).strip()
    user_prompt = textwrap.dedent(
        f"""
        Current title: {listing.get('title') or ''}
        Current category: {listing.get('category') or ''}
        Current condition: {listing.get('condition') or ''}
        Photo count: {len(images)}
        OCR text: {compact_text(ocr_text, 1800)}
        Barcode candidates: {', '.join(barcodes)}
        Model/SKU candidates: {', '.join(models)}

        Improve the listing candidate from the photos, labels, tags, barcodes, and OCR.
        """
    ).strip()
    payload = {
        "model": model,
        "stream": False,
        "think": False,
        "format": local_vision_schema(),
        "options": {"temperature": 0, "num_ctx": 4096, "num_predict": 700},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt, "images": [encode_image(path) for path in images[:4]]},
        ],
    }
    request = urllib.request.Request(f"{host}/api/chat", data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            content = json.loads(response.read().decode("utf-8")).get("message", {}).get("content", "")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return {}
    try:
        return json.loads(content) if content.strip().startswith("{") else json.loads(re.search(r"\{.*\}", content, re.DOTALL).group(0))  # type: ignore[union-attr]
    except Exception:
        return {}


def generic_title(title: str) -> bool:
    normalized = re.sub(r"\s+\d+$", "", (title or "").strip().lower())
    if not normalized:
        return True
    return any(normalized.startswith(value) for value in GENERIC_TITLES)


def description_from_bullets(listing: dict[str, Any], facts: dict[str, Any], settings: dict[str, Any]) -> str:
    title = str(facts.get("title") or listing.get("title") or "Item").strip()
    bullets = [compact_text(str(item), 120) for item in facts.get("description_bullets") or [] if compact_text(str(item), 120)]
    if not bullets:
        bullets = ["See photos for details and included items."]
    lines = [f"Selling {title}.", "", *[f"- {bullet}" for bullet in bullets[:5]], "", f"Condition: {facts.get('condition') or listing.get('condition') or settings['default_condition']}."]
    lines.extend(["", pickup_description_line(settings, bool(listing.get("shipping_enabled")))])
    return sanitize_public_description("\n".join(lines), settings.get("forbidden_public_phrases"))


def recognition_patch(listing: dict[str, Any], facts: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    title = compact_text(str(facts.get("title") or ""), 120)
    if title and (generic_title(str(listing.get("title") or "")) or len(str(listing.get("title") or "")) < 8):
        patch["title"] = title
    category = compact_text(str(facts.get("category") or ""), 80)
    if category and not listing.get("category"):
        patch["category"] = category
    condition = compact_text(str(facts.get("condition") or ""), 40)
    if condition and str(listing.get("condition") or "").startswith("Used") and condition in {"New", "Used - Like New", "Used - Good", "Used - Fair"}:
        patch["condition"] = condition
    current_description = str(listing.get("description") or "")
    if "Selling the item shown in the photos" in current_description and facts.get("description_bullets"):
        patch["description"] = description_from_bullets(listing, facts, settings)
    tags = dedupe([*(listing.get("tags") or []), *(str(tag).lower().strip() for tag in facts.get("tags") or [])])
    if tags != (listing.get("tags") or []):
        patch["tags"] = tags[:20]
    notes = [
        str(listing.get("private_notes") or "").rstrip(),
        "",
        f"Local recognition {dt.datetime.now().isoformat(timespec='seconds')}:",
        f"- confidence: {facts.get('confidence', 0)}",
    ]
    for label, key in (("brand", "brand"), ("model numbers", "model_numbers"), ("barcodes", "barcode_numbers"), ("visible text", "visible_text"), ("notes", "notes")):
        value = facts.get(key)
        if not value:
            continue
        if isinstance(value, list):
            value = ", ".join(str(item) for item in value if str(item).strip())
        value_text = compact_text(str(value), 500)
        if value_text:
            notes.append(f"- {label}: {value_text}")
    patch["private_notes"] = "\n".join(notes).strip()
    return patch


def recognize_listing(listing_id: str, db_path: Path = DEFAULT_DB_PATH) -> dict[str, Any]:
    listing = get_listing(listing_id, db_path)
    if not listing:
        raise KeyError(listing_id)
    settings = get_settings(db_path)
    if not settings.get("local_image_recognition_enabled"):
        return listing

    photo_paths = [Path(photo["path"]) for photo in listing.get("photos", []) if photo.get("path") and not photo.get("removed")]
    photo_paths = [path for path in photo_paths if path.exists() and path.suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS]
    if not photo_paths:
        return listing

    prepared: list[Path] = []
    ocr_chunks: list[str] = []
    detected_barcodes: list[str] = []
    detected_models: list[str] = []
    for path in photo_paths[:6]:
        try:
            image_path = prepare_image_for_model(path)
            prepared.append(image_path)
        except Exception:
            continue
        if settings.get("local_ocr_enabled"):
            vision = run_apple_vision(image_path)
            ocr_chunks.extend(str(item) for item in vision.get("text") or [] if str(item).strip())
            detected_barcodes.extend(str(item) for item in vision.get("barcodes") or [] if str(item).strip())
            tesseract_text = run_tesseract(image_path)
            if tesseract_text:
                ocr_chunks.append(tesseract_text)

    ocr_text = compact_text("\n".join(ocr_chunks), 2500)
    barcodes, models = extract_codes(ocr_text)
    barcodes = dedupe([*detected_barcodes, *barcodes])
    models = dedupe([*detected_models, *models])
    facts = ollama_analyze(prepared, listing, settings, ocr_text, barcodes, models) if prepared else {}
    if not facts:
        facts = {
            "title": "",
            "category": "",
            "condition": listing.get("condition") or settings["default_condition"],
            "brand": "",
            "model_numbers": models,
            "barcode_numbers": barcodes,
            "tags": ["ocr-reviewed"] if ocr_text else [],
            "description_bullets": [],
            "visible_text": ocr_text,
            "confidence": 0.35 if ocr_text else 0,
            "needs_review": True,
            "notes": "OCR-only local recognition; local vision model was unavailable or returned no structured result.",
        }
    facts["barcode_numbers"] = dedupe([*(facts.get("barcode_numbers") or []), *barcodes])
    facts["model_numbers"] = dedupe([*(facts.get("model_numbers") or []), *models])
    if ocr_text and not facts.get("visible_text"):
        facts["visible_text"] = ocr_text
    updated = patch_listing(listing_id, recognition_patch(listing, facts, settings), db_path)
    add_log("info", f"Ran local image recognition/OCR for {listing_id}", listing_id=listing_id, details={"confidence": facts.get("confidence"), "needs_review": facts.get("needs_review")}, db_path=db_path)
    return updated


def recognize_listings(listing_ids: list[str] | None = None, db_path: Path = DEFAULT_DB_PATH) -> dict[str, Any]:
    from .storage import list_listings

    rows = list_listings(db_path=db_path)
    target_ids = set(listing_ids or [row["id"] for row in rows if row.get("status") == "needs_review"])
    updated: list[str] = []
    failed: dict[str, str] = {}
    for listing_id in target_ids:
        try:
            recognize_listing(listing_id, db_path)
            updated.append(listing_id)
        except Exception as exc:
            failed[listing_id] = str(exc)
            add_log("warning", f"Local recognition failed for {listing_id}", listing_id=listing_id, details={"error": str(exc)}, db_path=db_path)
    return {"updated": sorted(updated), "failed": failed}
