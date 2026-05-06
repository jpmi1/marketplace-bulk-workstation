#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from marketplace_bulk.local_recognition import recognize_listings
from marketplace_bulk.storage import DEFAULT_DB_PATH, init_db


def main() -> None:
    parser = argparse.ArgumentParser(description="Run local image recognition and OCR against marketplace listings.")
    parser.add_argument("--ids", help="Comma-separated listing IDs. Defaults to needs-review listings.")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="SQLite project database path.")
    args = parser.parse_args()
    db_path = Path(args.db)
    init_db(db_path)
    ids = [value.strip() for value in (args.ids or "").split(",") if value.strip()] or None
    print(json.dumps(recognize_listings(ids, db_path), indent=2))


if __name__ == "__main__":
    main()
