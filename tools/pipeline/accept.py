#!/usr/bin/env python3
"""accept.py <TASK-ID> — слить codex/<ID> в main (--no-ff), снять рабочую копию, записать в done. Push не делает."""
from __future__ import annotations

import sys

import lib


def main() -> int:
    if len(sys.argv) != 2:
        sys.exit("usage: accept.py <TASK-ID>")
    tid = sys.argv[1]
    state = lib.load_state()
    r = lib.find_run(state, tid)
    if not r:
        sys.exit(f"нет запуска {tid}")
    if (lib.REPO / ".git" / "MERGE_HEAD").exists() or lib.git("diff", "--name-only", "--diff-filter=U"):
        sys.exit("незавершённое слияние в main — разрешите вручную")
    if lib.git("status", "--porcelain"):
        lib.git("add", "-A")
        lib.git("commit", "-m", f"orchestrator: snapshot before merge {tid}")
    res = lib.run(["git", "merge", "--no-ff", r["branch"], "-m", f"Merge {r['branch']}: {r.get('summary', tid)[:120]}"], check=False)
    if res.returncode != 0:
        lib.run(["git", "merge", "--abort"], check=False)
        sys.exit(f"конфликт слияния {r['branch']} — слияние отменено:\n{res.stdout[-800:]}")
    lib.run(["git", "worktree", "remove", "--force", r["worktree"]], check=False)
    state = lib.load_state()
    r = lib.find_run(state, tid)
    r["status"] = "accepted"
    if tid not in state["done"]:
        state["done"].append(tid)
    lib.save_state(state)
    print(f"{tid} принята и слита в main (push не выполнялся)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
