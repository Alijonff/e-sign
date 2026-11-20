#!/usr/bin/env python3
"""dispatch.py <TASK-ID> [--extra "текст"] — запустить Codex на карточке из docs/plans/QUEUE.md."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import lib


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("task")
    ap.add_argument("--force", action="store_true", help="игнорировать лимит параллели и зависимости (только для Claude)")
    ap.add_argument("--extra", default="", help="доп. указания к промту (ответы на вопросы, замечания)")
    ap.add_argument("--effort", choices=lib.EFFORTS, help="усилие вручную")
    args = ap.parse_args()
    tid = args.task

    state = lib.load_state()
    card = lib.load_cards().get(tid)
    if not card:
        print(f"нет карточки {tid} в docs/plans/QUEUE.md")
        return 2
    if tid in state["done"]:
        print(f"{tid} уже принята")
        return 3
    prev = lib.find_run(state, tid)
    if prev and prev["status"] in ("running", "waiting_limit"):
        print(f"{tid} уже в работе ({prev['status']})")
        return 3
    if not args.force:
        running = [r for r in state["runs"] if r["status"] == "running" and lib.pid_alive(r["pid"])]
        if len(running) >= lib.MAX_PARALLEL:
            print(f"параллельных задач {len(running)} ≥ {lib.MAX_PARALLEL} — не запускаю")
            return 4
        missing = lib.deps_missing(card, state)
        if missing:
            print(f"{tid}: ждёт {', '.join(missing)}")
            return 4
    effort = args.effort or card["effort"]

    # 1. зафиксировать main (карточки, контракт и ядро Claude должны попасть в ветку задачи). Push не делаем.
    if lib.git("status", "--porcelain"):
        lib.git("add", "-A")
        lib.git("commit", "-m", f"orchestrator: snapshot before {tid}")

    # 2. рабочая копия
    wt = lib.WT_ROOT / tid
    branch = f"codex/{tid}"
    attempt = (prev["attempt"] + 1) if prev else 1
    if not wt.exists():
        lib.WT_ROOT.mkdir(parents=True, exist_ok=True)
        exists = lib.run(["git", "rev-parse", "--verify", branch], check=False).returncode == 0
        if exists:
            lib.git("worktree", "add", str(wt), branch)
        else:
            lib.git("worktree", "add", str(wt), "-b", branch, "main")

    # 3. промт
    lib.LOGS.mkdir(parents=True, exist_ok=True)
    limit = lib.limit_for(card)
    header = (Path(__file__).parent / "prompt_header.md").read_text(encoding="utf-8")
    prompt = (header.replace("{ID}", tid).replace("{WORKTREE}", str(wt)).replace("{REPO}", str(lib.REPO))
              .replace("{LIMIT}", str(limit)).replace("{EXTRA}", args.extra).replace("{CARD}", card["text"]))
    tag = f"{tid}.a{attempt}"
    prompt_file = lib.LOGS / f"{tag}.prompt.md"
    prompt_file.write_text(prompt, encoding="utf-8")
    jsonl = lib.LOGS / f"{tag}.jsonl"
    last = lib.LOGS / f"{tag}.last.md"

    cmd = [lib.CODEX, "exec", "-m", card["model"],
           "-c", f'model_reasoning_effort="{effort}"',
           "-c", "sandbox_workspace_write.network_access=true",
           "-s", "workspace-write", "-C", str(wt),
           "--add-dir", str(lib.REPO / ".git"),
           "--json", "-o", str(last), "-"]
    with open(prompt_file, "rb") as fin, open(jsonl, "wb") as fout:
        proc = subprocess.Popen(cmd, stdin=fin, stdout=fout, stderr=subprocess.STDOUT,
                                cwd=wt, start_new_session=True, env=lib.codex_env())

    state["runs"].append({
        "task": tid, "branch": branch, "worktree": str(wt), "pid": proc.pid, "thread_id": None,
        "started_at": lib.now().isoformat(timespec="seconds"), "status": "running",
        "attempt": attempt, "model": card["model"], "effort": effort, "limit_min": limit,
        "log": str(jsonl.relative_to(lib.REPO)),
    })
    lib.save_state(state)
    print(f"запущена {tid} attempt {attempt}, pid {proc.pid}, {card['model']}/{effort}, лимит {limit} мин")
    return 0


if __name__ == "__main__":
    sys.exit(main())
