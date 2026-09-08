#!/usr/bin/env python3
"""Provision a least-privilege login for the Next.js server.

The generated password is written only to the gitignored local .env file and
is never printed. Add the resulting WEB_DB_URI to the deployment environment.
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

import psycopg2
from psycopg2 import sql


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
LOGIN_ROLE = "music_web_app"


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in ENV_PATH.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"').strip("'")
    return values


def write_web_uri(uri: str) -> None:
    lines = ENV_PATH.read_text().splitlines()
    replacement = f"WEB_DB_URI={uri}"
    for index, line in enumerate(lines):
        if line.startswith("WEB_DB_URI="):
            lines[index] = replacement
            break
    else:
        lines.append(replacement)
    ENV_PATH.write_text("\n".join(lines) + "\n")


def build_web_uri(admin_uri: str, password: str) -> str:
    parsed = urlsplit(admin_uri)
    admin_username = parsed.username or "postgres"
    project_suffix = admin_username.split(".", 1)[1] if "." in admin_username else ""
    pooler_username = LOGIN_ROLE + (f".{project_suffix}" if project_suffix else "")
    hostname = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"{quote(pooler_username, safe='.') }:{quote(password, safe='')}@{hostname}{port}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))


def main() -> None:
    env = read_env()
    admin_uri = env.get("DB_URI") or os.environ.get("DB_URI")
    if not admin_uri:
        raise RuntimeError("DB_URI is required")

    password = secrets.token_urlsafe(32)
    with psycopg2.connect(admin_uri) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (LOGIN_ROLE,))
            if cursor.fetchone():
                cursor.execute(
                    sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {}").format(
                        sql.Identifier(LOGIN_ROLE), sql.Literal(password)
                    )
                )
            else:
                cursor.execute(
                    sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(
                        sql.Identifier(LOGIN_ROLE), sql.Literal(password)
                    )
                )
            cursor.execute(
                sql.SQL("GRANT music_web_reader TO {}").format(sql.Identifier(LOGIN_ROLE))
            )

    write_web_uri(build_web_uri(admin_uri, password))
    print("Provisioned music_web_app and updated the local WEB_DB_URI.")


if __name__ == "__main__":
    main()
