#!/usr/bin/env python3
"""run.py — автоконвейер: держит до 3 задач Codex одновременно, сам принимает прошедшие проверки и сразу запускает следующие.

Цикл каждые --poll секунд:
  1. обновить статусы запущенных задач (check.refresh);
  2. задача со state=done проходит шлагбаум: не тронуты защищённые файлы, в рабочей копии зелёные
     typecheck/lint/test/build; затем слияние в main и те же проверки в main (при красных — откат слияния);
  3. question/blocked/failed/killed и провал шлагбаума — «ждёт Claude»: раннер их не трогает, шлёт уведомление;
  4. после лимита Codex — resume; свободные места занимаются картами, у которых приняты все зависимости.
Раннер выходит, когда ничего не запущено и запускать нечего. Push не делает никогда.
Запуск: python3 tools/pipeline/run.py [--poll 20] [--no-auto-accept] [--once]
"""
from __future__ import annotations

import argparse
import atexit
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import accept
import check
import lib
import report

LOCK = lib.PROGRESS / "RUNNER.lock"
ATTENTION = {"question", "blocked", "failed", "killed", "attention"}

# Эти пути Codex менять не вправе (контракт, ядро, образцы, конвейер, планы).
FORBIDDEN_PREFIXES = (
    "shared/src/", "server/src/core/", "samples/", "tools/", "docs/plans/",
    "docs/BRIEF.md", "docs/LETTER-SIGNOTEC.md", "AGENTS.md", "CLAUDE.md", ".gitignore",
    "server/test/placement.test.ts", "server/test/pdf.test.ts", "server/test/helpers.ts",
)


def log(msg: str) -> None:
    print(f"{lib.now():%H:%M:%S} {msg}", flush=True)


def notify(title: str, message: str) -> None:
    try:
        script = f"display notification {json.dumps(message, ensure_ascii=False)} with title {json.dumps(title, ensure_ascii=False)}"
        subprocess.run(["osascript", "-e", script], capture_output=True, timeout=10)
    except Exception:  # noqa: BLE001 — уведомление не критично
        pass


def forbidden_changes(r: dict) -> list[str]:
    """Файлы ветки задачи, которые менять нельзя (по сравнению с main)."""
    tid = r["task"]
    out = lib.git("diff", "--name-only", f"main...{r['branch']}", check=False)
    bad = []
    for path in (p for p in out.splitlines() if p):
        if path == f"docs/progress/tasks/{tid}.status.json":
            continue
        if path.startswith("docs/progress/") or any(path.startswith(f) for f in FORBIDDEN_PREFIXES):
            bad.append(path)
    return bad


def gate(r: dict) -> tuple[bool, str]:
    bad = forbidden_changes(r)
    if bad:
        return False, "изменены защищённые файлы: " + ", ".join(bad[:10])
    ok, detail = accept.run_checks(Path(r["worktree"]))
    if not ok:
        return False, "в рабочей копии задачи проверки красные: " + detail
    return True, "шлагбаум пройден"


def mark_attention(state: dict, r: dict, reason: str) -> None:
    r["status"] = "attention"
    r["attention"] = reason
    lib.save_state(state)
    report.add(f"{r['task']}: нужен Claude — {reason}")
    notify("e-sign", f"{r['task']}: нужен Claude")
    log(f"ВНИМАНИЕ {r['task']}: {reason[:300]}")


def handle_finished(state: dict, auto_accept: bool) -> None:
    for r in state["runs"]:
        tid = r["task"]
        if r["status"] in ("question", "blocked", "failed", "killed") and not r.get("notified"):
            r["notified"] = True
            lib.save_state(state)
            report.add(f"{tid}: {r['status']} — {r.get('summary', '')[:300]}")
            notify("e-sign", f"{tid}: {r['status']}")
            log(f"ВНИМАНИЕ {tid}: {r['status']} — {r.get('summary', '')[:200]}")
        elif r["status"] == "done" and tid not in state["done"]:
            if not auto_accept:
                if not r.get("notified"):
                    r["notified"] = True
                    lib.save_state(state)
                    log(f"{tid}: готова, ждёт приёмки (авто-приёмка выключена)")
                continue
            log(f"{tid}: готова, проверяю шлагбаум")
            ok, msg = gate(r)
            if not ok:
                mark_attention(state, r, msg)
                continue
            ok, msg = accept.accept_task(tid)
            state.clear()
            state.update(lib.load_state())
            r = lib.find_run(state, tid)
            if ok:
                report.add(f"{tid}: принята автоматически (шлагбаум и проверки в main зелёные). Ревью Claude — после.")
                log(msg)
            else:
                mark_attention(state, r, msg)


def resume_after_limit(state: dict) -> None:
    for r in state["runs"]:
        if r["status"] == "waiting_limit" and datetime.fromisoformat(r["retry_at"]) <= lib.now():
            log(f"{r['task']}: лимит сброшен, возобновляю")
            subprocess.run([sys.executable, str(Path(__file__).parent / "resume.py"), r["task"]], cwd=lib.REPO)


def dispatch_next(state: dict) -> int:
    """Запускает карточки, пока есть свободные места. -> сколько запущено."""
    started = 0
    cards = lib.load_cards()
    for tid in sorted(cards):
        running = [r for r in state["runs"] if r["status"] == "running" and lib.pid_alive(r["pid"])]
        if len(running) >= lib.MAX_PARALLEL:
            break
        if tid in state["done"] or lib.find_run(state, tid):
            continue
        if lib.deps_missing(cards[tid], state):
            continue
        res = subprocess.run([sys.executable, str(Path(__file__).parent / "dispatch.py"), tid],
                             cwd=lib.REPO, capture_output=True, text=True)
        log(res.stdout.strip() or res.stderr.strip())
        if res.returncode == 0:
            started += 1
            state.clear()
            state.update(lib.load_state())
    return started


def summary(state: dict) -> str:
    cards = lib.load_cards()
    done = [t for t in sorted(cards) if t in state["done"]]
    waiting = [f"{r['task']}({r['status']})" for r in state["runs"] if r["status"] in ATTENTION and r["task"] not in state["done"]]
    idle = [t for t in sorted(cards) if t not in state["done"] and not lib.find_run(state, t)]
    return f"принято: {', '.join(done) or '—'}; ждут Claude: {', '.join(waiting) or '—'}; не запущены: {', '.join(idle) or '—'}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--poll", type=int, default=20)
    ap.add_argument("--no-auto-accept", action="store_true")
    ap.add_argument("--once", action="store_true", help="одна итерация и выход")
    args = ap.parse_args()

    if LOCK.exists():
        try:
            pid = int(LOCK.read_text().strip())
        except ValueError:
            pid = 0
        if lib.pid_alive(pid):
            print(f"раннер уже запущен (pid {pid})")
            return 3
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    LOCK.write_text(str(os.getpid()))
    atexit.register(lambda: LOCK.unlink(missing_ok=True))
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    log(f"раннер запущен, pid {os.getpid()}, до {lib.MAX_PARALLEL} задач, авто-приёмка {'выкл' if args.no_auto_accept else 'вкл'}")
    while True:
        state = lib.load_state()
        for a in check.refresh(state):
            log(a)
        lib.save_state(state)
        handle_finished(state, not args.no_auto_accept)
        state = lib.load_state()
        resume_after_limit(state)
        state = lib.load_state()
        dispatch_next(state)
        state = lib.load_state()

        active = [r for r in state["runs"] if r["status"] in ("running", "waiting_limit")]
        if args.once:
            log(summary(state))
            return 0
        if not active:
            text = summary(state)
            log("нечего запускать и ничего не идёт — раннер завершает работу. " + text)
            report.add("Раннер завершил работу. " + text)
            notify("e-sign", "Конвейер остановился: " + text[:120])
            return 0
        time.sleep(args.poll)


if __name__ == "__main__":
    sys.exit(main())
