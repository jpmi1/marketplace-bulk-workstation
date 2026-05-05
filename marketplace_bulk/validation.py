from __future__ import annotations

import re
from typing import Any


FORBIDDEN_PUBLIC_PHRASES = [
    "storage inventory",
    "internal",
    "pipeline",
    "notes from sheet",
    "notes from inventory sheet",
    "inventory condition mix",
    "photos still need",
    "photo needed",
    "reference/product photos are included",
    "untested by pipeline",
]

VALID_CONDITIONS = ["New", "Used - Like New", "Used - Good", "Used - Fair"]


def clean_whitespace(text: str) -> str:
    cleaned = re.sub(r"[ \t]+", " ", str(text or "")).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


def contains_forbidden_public_phrase(text: str, phrases: list[str] | None = None) -> list[str]:
    haystack = str(text or "").lower()
    return [phrase for phrase in (phrases or FORBIDDEN_PUBLIC_PHRASES) if phrase.lower() in haystack]


def sanitize_public_description(text: str, forbidden_phrases: list[str] | None = None) -> str:
    """Remove owner-facing review notes from public buyer copy.

    This intentionally keeps factual compatibility and condition caveats, but
    strips lines that describe the listing workflow itself.
    """
    phrases = [p.lower() for p in (forbidden_phrases or FORBIDDEN_PUBLIC_PHRASES)]
    lines: list[str] = []
    for raw_line in str(text or "").splitlines():
        lower = raw_line.lower()
        if any(phrase in lower for phrase in phrases):
            continue
        lines.append(raw_line.rstrip())
    cleaned = clean_whitespace("\n".join(lines))
    cleaned = cleaned.replace("weird ass", "non-standard")
    cleaned = cleaned.replace("Quantity: Quantity needs review.", "Quantity: needs review.")
    return cleaned


def public_inventory_description(
    *,
    item_name: str,
    public_quantity_text: str,
    condition_mix: str,
    details: str = "",
    product_title: str = "",
    product_domain: str = "",
    location: str = "Your City, ST ZIP",
    shipping_enabled: bool = True,
) -> str:
    sections = [f"Selling {item_name.strip()}."]
    if public_quantity_text:
        sections.append(f"Quantity: {public_quantity_text}.")
    if condition_mix:
        sections.append(f"Condition: {condition_mix}.")
    if product_title:
        suffix = f" ({product_domain})" if product_domain else ""
        sections.append(f"Product reference: {product_title}{suffix}.")
    if details:
        sections.append(f"Details: {details.strip()}")
    sections.append("Please confirm compatibility, connector type, sizing, and fit from the photos before buying.")
    shipping = "Shipping available through Facebook when supported; buyer pays shipping." if shipping_enabled else "Local pickup only."
    sections.append(f"Local pickup in {location}. {shipping}")
    return sanitize_public_description("\n\n".join(section for section in sections if section))


def validate_listing(listing: dict[str, Any], settings: dict[str, Any]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    required = ["title", "price", "condition", "category", "description"]
    for field in required:
        value = listing.get(field)
        if value in (None, ""):
            issues.append({"field": field, "severity": "error", "message": f"{field.replace('_', ' ').title()} is required."})

    title = str(listing.get("title") or "")
    if len(title) > 150:
        issues.append({"field": "title", "severity": "error", "message": "Title must be 150 characters or less."})

    description = str(listing.get("description") or "")
    if len(description) > 5000:
        issues.append({"field": "description", "severity": "error", "message": "Description must be 5000 characters or less."})
    for phrase in contains_forbidden_public_phrase(description, settings.get("forbidden_public_phrases")):
        issues.append({"field": "description", "severity": "error", "message": f"Remove owner-facing phrase: {phrase}"})

    if listing.get("condition") and listing["condition"] not in VALID_CONDITIONS:
        issues.append({"field": "condition", "severity": "error", "message": "Condition is not accepted by Facebook."})

    photos = listing.get("photos") or []
    usable_photos = [photo for photo in photos if not photo.get("removed")]
    reference_only = all(photo.get("kind") != "original" for photo in usable_photos) if usable_photos else False
    if not usable_photos:
        issues.append({"field": "photos", "severity": "error", "message": "Add at least one usable photo."})
    elif reference_only and not listing.get("reference_only_approved"):
        issues.append({"field": "photos", "severity": "error", "message": "Only reference/web images are selected. Explicitly approve reference-only posting."})

    if listing.get("shipping_enabled"):
        has_weight = listing.get("package_weight_oz") or settings.get("default_package_weight_oz")
        if not has_weight:
            issues.append({"field": "shipping", "severity": "error", "message": "Shipping needs package weight or a default fallback."})

    return issues
