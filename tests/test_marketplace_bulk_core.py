import tempfile
import unittest
from pathlib import Path

from marketplace_bulk.storage import approve_listing, delete_listings, get_settings, list_listings, upsert_listing
from marketplace_bulk.validation import public_inventory_description, sanitize_public_description


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


if __name__ == "__main__":
    unittest.main()
