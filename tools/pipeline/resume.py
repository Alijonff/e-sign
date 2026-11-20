#!/usr/bin/env python3
"""resume.py <TASK-ID> [сообщение] — продолжить сессию Codex (после лимита, kill, вопроса или замечаний ревью)."""
import subprocess
import sys
from pathlib import Path

import lib

DEFAULT_MSG = "Продолжай задачу с места остановки. Правила и карточка те же."


def main() -> int:
    if len(sys.argv) < 2:
        sys.exit("usage: resume.py <TASK-ID> [message]")
    tid = sys.argv[1]
    msg = " ".join(a for a in sys.argv[2:] if a != "--force") or DEFAULT_MSG
    state = lib.load_state()
    r = lib.find_run(state, tid)
    if not r or not r.get("thread_id"):
        print(f"нет thread_id для {tid}: запусти dispatch.py заново с --extra")
        return 2
    if r["status"] == "running" and lib.pid_alive(r["pid"]):
        print("уже работает")
        return 3
    running = [x for x in state["runs"] if x["status"] == "running" and lib.pid_alive(x["pid"])]
    if len(running) >= lib.MAX_PARALLEL and "--force" not in sys.argv:
        print(f"параллельных задач {len(running)} ≥ {lib.MAX_PARALLEL} — не возобновляю")
        return 4
    card = lib.load_cards().get(tid)
    model = (card or {}).get("model", lib.DEFAULT_MODEL)
    effort = (card or {}).get("effort", lib.DEFAULT_EFFORT)
    wt = Path(r["worktree"])
    attempt = r["attempt"] + 1
    tag = f"{tid}.a{attempt}"
    jsonl, last = lib.LOGS / f"{tag}.jsonl", lib.LOGS / f"{tag}.last.md"
    cmd = [lib.CODEX, "exec", "resume", r["thread_id"],
           "-m", model, "-c", f'model_reasoning_effort="{effort}"',
           "-c", "sandbox_workspace_write.network_access=true",
           "--json", "-o", str(last), msg]
    with open(jsonl, "wb") as fout:
        proc = subprocess.Popen(cmd, stdout=fout, stderr=subprocess.STDOUT, cwd=wt, start_new_session=True,
                                env=lib.codex_env())
    r.update({"model": model, "effort": effort, "pid": proc.pid, "status": "running", "attempt": attempt,
              "log": str(jsonl.relative_to(lib.REPO)), "started_at": lib.now().isoformat(timespec="seconds")})
    r.pop("retry_at", None)
    r.pop("finished_at", None)
    r.pop("summary", None)
    r.pop("notified", None)
    r.pop("attention", None)
    lib.save_state(state)
    print(f"возобновлена {tid} attempt {attempt}, pid {proc.pid}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
