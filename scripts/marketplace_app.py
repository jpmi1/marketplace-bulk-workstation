#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from marketplace_bulk.app import create_app
from marketplace_bulk.importers import import_existing_outputs
from marketplace_bulk.storage import DEFAULT_DB_PATH, init_db


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Sell to 1 BTC, the local Marketplace listing and progress tracker.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--import-existing", action="store_true", help="Import current script outputs before launching.")
    args = parser.parse_args()

    init_db(args.db)
    if args.import_existing:
        counts = import_existing_outputs()
        print(f"Imported existing outputs: {counts}")
    uvicorn.run(create_app(args.db), host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
