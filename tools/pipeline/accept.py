#!/usr/bin/env python3
"""accept.py <TASK-ID> — слить codex/<ID> в main (--no-ff), снять рабочую копию, записать в done. Push не делает."""
from __future__ import annotations

import subprocess
import sys

import lib

CHECKS = ("typecheck", "lint", "test", "build")


def run_checks(cwd, timeout: int = 900) -> tuple[bool, str]:
    """Корневые проверки проекта. -> (все зелёные, текст о первой ошибке)."""
    env = lib.codex_env()
    if not (cwd / "node_modules").exists():
        res = subprocess.run(["npm", "ci"], cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
        if res.returncode:
            return False, "npm ci: " + (res.stderr or res.stdout)[-600:]
    for name in CHECKS:
        try:
            res = subprocess.run(["npm", "run", name], cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return False, f"npm run {name}: превышено время {timeout} с"
        if res.returncode:
            tail = (res.stdout + "\n" + res.stderr)[-900:]
            return False, f"npm run {name} упал:\n{tail}"
    return True, "typecheck, lint, test, build зелёные"


def accept_task(tid: str, verify_after_merge: bool = True) -> tuple[bool, str]:
    """Сливает ветку задачи в main. -> (успех, сообщение). Не вызывает sys.exit."""
    state = lib.load_state()
    r = lib.find_run(state, tid)
    if not r:
        return False, f"нет запуска {tid}"
    if (lib.REPO / ".git" / "MERGE_HEAD").exists() or lib.git("diff", "--name-only", "--diff-filter=U"):
        return False, "незавершённое слияние в main — разрешите вручную"
    if lib.git("status", "--porcelain"):
        lib.git("add", "-A")
        lib.git("commit", "-m", f"orchestrator: snapshot before merge {tid}")
    pre = lib.git("rev-parse", "HEAD")
    msg = f"Merge {r['branch']}: {r.get('summary', tid)[:120]}"
    res = lib.run(["git", "merge", "--no-ff", r["branch"], "-m", msg], check=False)
    if res.returncode != 0:
        conflicts = [p for p in lib.git("diff", "--name-only", "--diff-filter=U").splitlines() if p]
        if conflicts and set(conflicts) <= {"package-lock.json"}:
            # Лок-файл пересоберём сами после слияния.
            lib.git("checkout", "--ours", "--", "package-lock.json")
            lib.git("add", "package-lock.json")
            lib.git("commit", "--no-edit")
        else:
            lib.run(["git", "merge", "--abort"], check=False)
            return False, f"конфликт слияния {r['branch']} в файлах: {', '.join(conflicts) or res.stdout[-300:]}"

    merge_sha = lib.git("rev-parse", "HEAD")
    changed = lib.git("diff", "--name-only", pre, "HEAD").splitlines()
    if any(p.endswith("package.json") or p == "package-lock.json" for p in changed):
        inst = subprocess.run(["npm", "install"], cwd=lib.REPO, env=lib.codex_env(), capture_output=True, text=True, timeout=900)
        if inst.returncode:
            lib.run(["git", "revert", "--no-edit", "-m", "1", merge_sha], check=False)
            return False, "после слияния npm install упал, слияние откатано:\n" + (inst.stderr or inst.stdout)[-500:]
        if lib.git("status", "--porcelain", "--", "package-lock.json"):
            lib.git("add", "package-lock.json")
            lib.git("commit", "-m", f"{tid}: refresh package-lock after merge")

    if verify_after_merge:
        ok, detail = run_checks(lib.REPO)
        if not ok:
            rv = lib.run(["git", "revert", "--no-edit", "-m", "1", merge_sha], check=False)
            tail = "слияние откатано" if rv.returncode == 0 else "ОТКАТ НЕ УДАЛСЯ — проверить main вручную"
            return False, f"после слияния проверки красные ({tail}):\n{detail}"

    lib.run(["git", "worktree", "remove", "--force", r["worktree"]], check=False)
    state = lib.load_state()
    r = lib.find_run(state, tid)
    r["status"] = "accepted"
    r.pop("attention", None)
    if tid not in state["done"]:
        state["done"].append(tid)
    lib.save_state(state)
    return True, f"{tid} принята и слита в main (push не выполнялся)"


def main() -> int:
    if len(sys.argv) != 2:
        sys.exit("usage: accept.py <TASK-ID>")
    ok, msg = accept_task(sys.argv[1])
    print(msg)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
