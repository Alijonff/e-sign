#!/usr/bin/env python3
"""check.py — обновить статусы запущенных задач Codex и напечатать, что требует решения Claude."""
from __future__ import annotations

import json
import os
import signal
import time
from datetime import datetime, timedelta
from pathlib import Path

import lib


def scan_log(path: Path) -> tuple[str | None, bool, str]:
    """-> (thread_id, limit_hit, tail). Читает JSONL построчно, не падает на мусоре."""
    thread, limit, tail = None, False, ""
    if not path.exists():
        return thread, limit, tail
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    for ln in lines:
        try:
            ev = json.loads(ln)
        except ValueError:
            continue
        if thread is None:
            thread = ev.get("thread_id") or (ev.get("msg") or {}).get("thread_id") or (ev.get("msg") or {}).get("session_id")
    for ln in lines[-30:]:
        low = ln.lower()
        if any(m in low for m in lib.LIMIT_MARKERS) and ("error" in low or "fail" in low or "limit" in low):
            limit = True
    tail = "\n".join(lines[-3:])[:600]
    return thread, limit, tail


def autocommit(wt: Path, tid: str) -> bool:
    if not wt.exists() or not lib.git("status", "--porcelain", cwd=wt, check=False):
        return False
    lib.git("add", "-A", cwd=wt)
    lib.git("commit", "-m", f"{tid}: autocommit by dispatcher (sandbox did not allow commit)", cwd=wt, check=False)
    return True


def main() -> int:
    state = lib.load_state()
    actions: list[str] = []
    for r in state["runs"]:
        if r["status"] not in ("running", "waiting_limit"):
            continue
        tid, wt = r["task"], Path(r["worktree"])
        log = lib.REPO / r["log"]
        thread, limit, tail = scan_log(log)
        if thread and not r.get("thread_id"):
            r["thread_id"] = thread
        started = datetime.fromisoformat(r["started_at"])
        age_min = (lib.now() - started).total_seconds() / 60

        if r["status"] == "waiting_limit":
            retry = datetime.fromisoformat(r["retry_at"])
            if lib.now() >= retry:
                actions.append(f"RESUME {tid}: лимит должен был сброситься — python3 tools/pipeline/resume.py {tid}")
            continue

        if lib.pid_alive(r["pid"]):
            if age_min > lib.kill_after(r):
                try:
                    os.killpg(os.getpgid(r["pid"]), signal.SIGTERM)
                    time.sleep(3)
                    if lib.pid_alive(r["pid"]):
                        os.killpg(os.getpgid(r["pid"]), signal.SIGKILL)
                except ProcessLookupError:
                    pass
                autocommit(wt, tid)
                r["status"] = "killed"
                actions.append(f"KILLED {tid}: {age_min:.0f} мин > {lib.kill_after(r)}; разобрать журнал, решить resume/разделить")
            continue

        # процесс завершился
        autocommit(wt, tid)
        sf = wt / "docs" / "progress" / "tasks" / f"{tid}.status.json"
        if sf.exists():
            try:
                st = json.loads(sf.read_text(encoding="utf-8"))
                r["status"] = st.get("state", "failed")
                r["summary"] = st.get("summary", "")
            except ValueError:
                r["status"] = "failed"
                r["summary"] = "status.json не читается"
            actions.append(f"{r['status'].upper()} {tid}: {r.get('summary', '')[:200]}")
        elif limit:
            r["status"] = "waiting_limit"
            r["retry_at"] = (lib.now() + timedelta(minutes=60)).isoformat(timespec="seconds")
            actions.append(f"WAITING_LIMIT {tid}: упёрлась в лимит, повтор после {r['retry_at']}")
        else:
            r["status"] = "failed"
            r["summary"] = "процесс завершился без status.json"
            actions.append(f"FAILED {tid}: нет status.json; хвост журнала: {tail[:300]!r}")
        r["finished_at"] = lib.now().isoformat(timespec="seconds")
    lib.save_state(state)

    running = [r for r in state["runs"] if r["status"] == "running"]
    print(f"{lib.now():%H:%M} · запущено {len(running)}/{lib.MAX_PARALLEL}")
    for r in running:
        age = (lib.now() - datetime.fromisoformat(r["started_at"])).total_seconds() / 60
        print(f"  running {r['task']} pid {r['pid']} {age:.0f} мин")
    for a in actions:
        print("→", a)
    if not actions:
        print("→ без изменений")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
