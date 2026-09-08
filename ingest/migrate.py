#!/usr/bin/env python3
"""Apply the music system's forward-only PostgreSQL migrations."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import psycopg2


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "db" / "migrations"

# Public-history cleanup removed private reconciliation figures from a SQL
# comment. The statement itself did not change. Accept the previously recorded
# checksum once and normalize it to the public file's checksum.
LEGACY_COMMENT_ONLY_CHECKSUMS = {
    "0013_offline_batch_plays.sql": {
        "b560face53883e0e659b7331071dd4448fa599510aea493786645e1756666089",
    },
}


def load_local_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def main() -> None:
    load_local_env()
    db_uri = os.environ.get("DB_URI")
    if not db_uri:
        raise RuntimeError("DB_URI is required")

    migration_files = sorted(MIGRATIONS_DIR.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    if not migration_files:
        raise RuntimeError(f"No migrations found in {MIGRATIONS_DIR}")

    with psycopg2.connect(db_uri) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS public.music_schema_migrations (
                    filename text PRIMARY KEY,
                    checksum text NOT NULL,
                    applied_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            cursor.execute(
                "SELECT filename, checksum FROM public.music_schema_migrations"
            )
            applied = dict(cursor.fetchall())

            for path in migration_files:
                sql = path.read_text()
                checksum = hashlib.sha256(sql.encode()).hexdigest()
                previous_checksum = applied.get(path.name)

                if previous_checksum:
                    if previous_checksum != checksum:
                        accepted = previous_checksum in LEGACY_COMMENT_ONLY_CHECKSUMS.get(path.name, set())
                        if not accepted:
                            raise RuntimeError(f"Applied migration changed: {path.name}")
                        cursor.execute(
                            "UPDATE public.music_schema_migrations SET checksum = %s WHERE filename = %s",
                            (checksum, path.name),
                        )
                        print(f"note  {path.name} (comment-only checksum normalized)")
                        continue
                    print(f"skip  {path.name}")
                    continue

                print(f"apply {path.name}")
                cursor.execute(sql)
                cursor.execute(
                    """
                    INSERT INTO public.music_schema_migrations (filename, checksum)
                    VALUES (%s, %s)
                    """,
                    (path.name, checksum),
                )

    print("Migrations are up to date.")


if __name__ == "__main__":
    main()
