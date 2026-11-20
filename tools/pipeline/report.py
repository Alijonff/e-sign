#!/usr/bin/env python3
"""report.py "<text>" — добавить запись в docs/progress/REPORT.md."""
import sys

import lib


def add(text: str) -> None:
    path = lib.PROGRESS / "REPORT.md"
    stamp = lib.now().strftime("%Y-%m-%d %H:%M")
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"## {stamp}\n\n{text.strip()}\n\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: report.py <text>")
    add(" ".join(sys.argv[1:]))
