import tempfile
import unittest
from pathlib import Path

from marketplace_bulk.photo_intake import commit_photo_batch, get_batch, group_photos, save_batch
from marketplace_bulk.local_recognition import extract_codes, recognition_patch
from marketplace_bulk.storage import (
    apply_pickup_location_to_listings,
    approve_listing,
    btc_entries_csv,
    btc_entries_xlsx,
    btc_progress_summary,
    create_btc_entry,
    delete_listings,
    get_settings,
    list_btc_entries,
    list_listings,
    update_settings,
    upsert_listing,
)
from marketplace_bulk.validation import ensure_pickup_description_line, format_pickup_location, public_inventory_description, sanitize_public_description


class MarketplaceBulkCoreTests(unittest.TestCase):
    def test_sanitizes_owner_facing_description_notes(self):
        text = """Selling camera.

Notes from inventory sheet: owner note
Photos still need to be added before posting.
Untested by pipeline; confirm before posting.
Local pickup available."""
        cleaned = sanitize_public_description(text)
        self.assertIn("Selling camera.", cleaned)
        self.assertIn("Local pickup available.", cleaned)
        self.assertNotIn("Notes from inventory sheet", cleaned)
        self.assertNotIn("Photos still need", cleaned)
        self.assertNotIn("pipeline", cleaned.lower())

    def test_inventory_description_is_buyer_facing(self):
        description = public_inventory_description(
            item_name="Generic panel",
            public_quantity_text="5+ available",
            condition_mix="New: 5; Used: 2",
            details="Small solar panel.",
            product_title="Generic manufacturer panel",
            product_domain="example.com",
        )
        self.assertIn("Selling Generic panel.", description)
        self.assertIn("Quantity: 5+ available.", description)
        self.assertNotIn("storage inventory", description.lower())
        self.assertNotIn("notes from", description.lower())

    def test_pickup_location_format_and_description_rewrite(self):
        settings = {
            "location": "Austin, TX",
            "pickup_zip_code": "78702",
            "pickup_place_name": "The Guthrie",
            "forbidden_public_phrases": [],
        }
        self.assertEqual(format_pickup_location(settings), "The Guthrie, 78702")
        description = "Selling lamp.\n\nLocal pickup in old spot. Shipping available.\n\nThanks."
        updated = ensure_pickup_description_line(description, settings, True)
        self.assertIn("Selling lamp.", updated)
        self.assertIn("Local pickup at The Guthrie, 78702.", updated)
        self.assertEqual(updated.lower().count("local pickup"), 1)

    def test_project_state_persists_edits_photos_and_approval_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "project.db"
            settings = get_settings(db_path)
            self.assertEqual(settings["location"], "Your City, ST ZIP")
            listing = upsert_listing(
                {
                    "id": "test-1",
                    "title": "Test Listing",
                    "price": 25,
                    "condition": "Used - Good",
                    "category": "Electronics",
                    "quantity_text": "1 unit available",
                    "description": "Clean buyer-facing description.",
                    "shipping_enabled": True,
                    "package_weight_oz": 12,
                    "photos": [
                        {
                            "id": "photo-1",
                            "uri": "https://example.com/photo.jpg",
                            "source_url": "https://example.com/photo.jpg",
                            "kind": "web_candidate",
                            "cover": True,
                            "sort_order": 1,
                        }
                    ],
                },
                db_path,
            )
            self.assertEqual(listing["validation"][0]["severity"], "error")
            gated = approve_listing("test-1", True, db_path)
            self.assertFalse(gated["approved"])
            listing = upsert_listing({**listing, "reference_only_approved": True}, db_path)
            approved = approve_listing("test-1", True, db_path)
            self.assertTrue(approved["approved"])
            self.assertEqual(len(list_listings(db_path=db_path)), 1)
            self.assertEqual(delete_listings(["test-1", "missing"], db_path), ["test-1"])
            self.assertEqual(list_listings(db_path=db_path), [])

    def test_photo_intake_groups_and_commits_uploaded_photos(self):
        photos = [
            {"id": "p1", "name": "001.jpg", "last_modified": 1000, "path": "/tmp/001.jpg"},
            {"id": "p2", "name": "002.jpg", "last_modified": 2000, "path": "/tmp/002.jpg"},
            {"id": "p3", "name": "003.jpg", "last_modified": 600000, "path": "/tmp/003.jpg"},
        ]
        groups = group_photos(photos)
        self.assertEqual(len(groups), 2)
        self.assertEqual(groups[0]["photo_ids"], ["p1", "p2"])

        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "project.db"
            photo_path = Path(tmp) / "photo.jpg"
            photo_path.write_bytes(b"fake image bytes")
            batch_id = "batch-test-intake"
            save_batch(
                {
                    "id": batch_id,
                    "photos": [
                        {
                            "id": "photo-1",
                            "name": "photo.jpg",
                            "path": str(photo_path),
                            "uri": "/api/intake/batches/batch-test-intake/photos/photo-1",
                        }
                    ],
                    "groups": [
                        {
                            "id": "group-001",
                            "title": "Uploaded item",
                            "photo_ids": ["photo-1"],
                            "removed_photo_ids": [],
                            "cover_photo_id": "photo-1",
                        }
                    ],
                    "status": "uploaded",
                }
            )
            result = commit_photo_batch(batch_id, get_batch(batch_id)["groups"], db_path)
            self.assertEqual(len(result["created"]), 1)
            listings = list_listings(db_path=db_path)
            self.assertEqual(listings[0]["source"], "photo_upload")
            self.assertEqual(listings[0]["photos"][0]["path"], str(photo_path))

    def test_photo_intake_preserves_upload_order_and_splits_short_staging_gaps(self):
        photos = [
            {"id": "newer", "name": "IMG_4500.JPG", "last_modified": 100000, "path": "/tmp/newer.jpg"},
            {"id": "same-item", "name": "IMG_4499.JPG", "last_modified": 92000, "path": "/tmp/same.jpg"},
            {"id": "next-item", "name": "IMG_4498.JPG", "last_modified": 60000, "path": "/tmp/next.jpg"},
        ]
        groups = group_photos(photos)
        self.assertEqual(groups[0]["photo_ids"], ["newer", "same-item"])
        self.assertEqual(groups[1]["photo_ids"], ["next-item"])

    def test_local_recognition_extracts_barcodes_and_models(self):
        barcodes, models = extract_codes("UPC 012345678905 Model: HUE-A19 SKU ABC-123 Serial SN9")
        self.assertIn("012345678905", barcodes)
        self.assertIn("HUE-A19", models)
        self.assertIn("ABC-123", models)

    def test_local_recognition_patch_improves_placeholder_listing(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = get_settings(Path(tmp) / "project.db")
            listing = {
                "title": "Photo group 1",
                "category": "",
                "condition": "Used - Good",
                "description": "Selling the item shown in the photos.",
                "shipping_enabled": True,
                "tags": [],
                "private_notes": "Created from upload.",
            }
            facts = {
                "title": "Philips Hue smart lighting bundle",
                "category": "Electronics",
                "condition": "Used - Good",
                "brand": "Philips Hue",
                "model_numbers": ["A19"],
                "barcode_numbers": ["012345678905"],
                "tags": ["smart lighting", "philips hue"],
                "description_bullets": ["Includes bulbs and bridge shown in photos."],
                "visible_text": "Philips Hue A19",
                "confidence": 0.82,
                "needs_review": False,
                "notes": "Brand and model visible on packaging.",
            }
            patch = recognition_patch(listing, facts, settings)
            self.assertEqual(patch["title"], "Philips Hue smart lighting bundle")
            self.assertEqual(patch["category"], "Electronics")
            self.assertIn("Includes bulbs", patch["description"])
            self.assertIn("012345678905", patch["private_notes"])
            self.assertIn("philips hue", patch["tags"])

            listing["title"] = "Existing careful title"
            patch = recognition_patch(listing, facts, settings)
            self.assertNotIn("title", patch)

    def test_btc_progress_summary_math_and_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "project.db"
            update_settings({"btc_owned": 0.1, "manual_btc_usd_price": 100000, "google_sheet_url": "https://docs.google.com/demo"}, db_path)
            create_btc_entry({"entry_type": "sale_proceeds", "title": "Desk sale", "amount_usd": 250, "entry_date": "2026-05-01"}, db_path)
            create_btc_entry({"entry_type": "cash_set_aside", "title": "Cash jar", "amount_usd": 50, "entry_date": "2026-05-02"}, db_path)
            create_btc_entry({"entry_type": "btc_purchase", "title": "BTC buy", "amount_usd": 100, "btc_amount": 0.001, "entry_date": "2026-05-03"}, db_path)
            create_btc_entry({"entry_type": "referral_bonus", "title": "Referral", "btc_amount": 0.0002, "entry_date": "2026-05-04"}, db_path)

            summary = btc_progress_summary(db_path)
            self.assertAlmostEqual(summary["gross_proceeds_usd"], 300)
            self.assertAlmostEqual(summary["spent_on_btc_usd"], 100)
            self.assertAlmostEqual(summary["available_usd"], 200)
            self.assertAlmostEqual(summary["estimated_purchasable_btc"], 0.002)
            self.assertAlmostEqual(summary["total_btc_owned"], 0.1012)
            self.assertAlmostEqual(summary["projected_btc"], 0.1032)
            self.assertEqual(summary["google_sheet_url"], "https://docs.google.com/demo")

            csv_text = btc_entries_csv(db_path)
            self.assertIn("entry_type", csv_text)
            self.assertIn("Desk sale", csv_text)
            self.assertGreater(len(btc_entries_xlsx(db_path)), 1000)
            self.assertEqual(len(list_btc_entries(db_path)), 4)

    def test_btc_settings_defaults_and_referral_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "project.db"
            settings = get_settings(db_path)
            self.assertEqual(settings["project_name"], "Bulk Facebook Marketplace Poster")
            self.assertEqual(settings["btc_goal_amount"], 1.0)
            self.assertEqual(settings["kraken_referral_url"], "")
            updated = update_settings({"manual_btc_usd_price": 90000, "progress_currency": "USD"}, db_path)
            self.assertEqual(updated["manual_btc_usd_price"], 90000)

    def test_apply_pickup_location_to_existing_listings(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "project.db"
            update_settings({"location": "Austin, TX", "pickup_zip_code": "78702", "pickup_place_name": "The Guthrie"}, db_path)
            upsert_listing(
                {
                    "id": "pickup-1",
                    "title": "Pickup test listing",
                    "price": 10,
                    "condition": "Used - Good",
                    "category": "Household",
                    "quantity_text": "1 available",
                    "description": "Selling a pickup test.\n\nLocal pickup in old location.",
                    "photos": [{"id": "photo-1", "path": "/tmp/photo.jpg", "cover": True, "sort_order": 1}],
                },
                db_path,
            )
            result = apply_pickup_location_to_listings(db_path=db_path)
            self.assertEqual(result["location"], "The Guthrie, 78702")
            listing = list_listings(db_path=db_path)[0]
            self.assertEqual(listing["location"], "The Guthrie, 78702")
            self.assertIn("Local pickup at The Guthrie, 78702.", listing["description"])
            self.assertEqual(listing["description"].lower().count("local pickup"), 1)

    def test_published_status_survives_validation_refresh(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "project.db"
            listing = upsert_listing(
                {
                    "id": "posted-1",
                    "title": "Posted test listing",
                    "price": 10,
                    "condition": "Used - Good",
                    "category": "Household",
                    "quantity_text": "1 available",
                    "description": "Clean buyer-facing description.",
                    "approved": True,
                    "status": "approved",
                    "photos": [{"id": "photo-1", "path": "/tmp/photo.jpg", "cover": True, "sort_order": 1}],
                },
                db_path,
            )
            self.assertEqual(listing["status"], "approved")
            posted = upsert_listing({**listing, "status": "published", "posting_status": "publish_clicked", "posted_url": "https://www.facebook.com/marketplace/item/123"}, db_path)
            self.assertEqual(posted["status"], "published")
            self.assertEqual(posted["posted_url"], "https://www.facebook.com/marketplace/item/123")


if __name__ == "__main__":
    unittest.main()
