"""Общие функции конвейера Claude <-> Codex (только стандартная библиотека). Упрощено из Lifestyle."""
from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Tashkent")
REPO = Path(__file__).resolve().parents[2]
WT_ROOT = REPO.parent / "e-sign-wt"
PROGRESS = REPO / "docs" / "progress"
STATE_FILE = PROGRESS / "STATE.json"
LOGS = PROGRESS / "logs"
TASKS = PROGRESS / "tasks"
QUEUE_FILE = REPO / "docs" / "plans" / "QUEUE.md"
CODEX = os.environ.get(
    "CODEX_BIN", "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
)
# Node и npm для задач Codex (на Mac в PATH может не быть нужной версии).
RUNTIME = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies"

MODELS = {"sol": "gpt-6.2-sol", "astra": "gpt-6-astra", "luna": "gpt-6-luna"}
DEFAULT_MODEL = "gpt-6.2-sol"
EFFORTS = ("low", "medium", "high", "xhigh")
DEFAULT_EFFORT = "high"
SESSION_LIMIT_MIN = 45
KILL_GRACE_MIN = 5  # запас сверх лимита сессии до принудительной остановки
MAX_PARALLEL = 3

LIMIT_MARKERS = ("rate_limit", "usage_limit", "usage limit", "rate limit", "429", "quota")


def now() -> datetime:
    return datetime.now(TZ)


def codex_env() -> dict[str, str]:
    env = dict(os.environ)
    extra = [str(RUNTIME / "node" / "bin"), str(RUNTIME / "bin" / "fallback")]
    env["PATH"] = os.pathsep.join([p for p in extra if Path(p).is_dir()] + [env.get("PATH", "")])
    return env


def limit_for(card: dict | None = None) -> int:
    """Лимит сессии в минутах: ⏱ карточки, если больше стандартных 45."""
    return max(SESSION_LIMIT_MIN, (card or {}).get("minutes") or 0)


def kill_after(run: dict) -> int:
    return run.get("limit_min", SESSION_LIMIT_MIN) + KILL_GRACE_MIN


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {"runs": [], "done": []}
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def save_state(state: dict) -> None:
    state["updated_at"] = now().isoformat(timespec="seconds")
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(STATE_FILE)


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    res = subprocess.run(cmd, cwd=cwd or REPO, capture_output=True, text=True)
    if check and res.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}\n{res.stdout}\n{res.stderr}")
    return res


def git(*args: str, cwd: Path | None = None, check: bool = True) -> str:
    return run(["git", *args], cwd=cwd, check=check).stdout.strip()


def find_run(state: dict, task_id: str) -> dict | None:
    for r in reversed(state["runs"]):
        if r["task"] == task_id:
            return r
    return None


def pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    res = run(["ps", "-o", "stat=", "-p", str(pid)], check=False)
    return bool(res.stdout.strip()) and not res.stdout.strip().startswith("Z")


# ---------- карточки очереди ----------

def parse_deps(text: str) -> list[str]:
    return sorted(set(re.findall(r"\bT-\d{3}\b", text)))


def load_cards() -> dict[str, dict]:
    """ID -> {id, title, deps, model, effort, minutes, text}.

    Карточка начинается заголовком `### T-NNN · название` и строкой `D T-001, T-002 · ⏱ 60 · M sol/high`
    (`D —` — без зависимостей). Заканчивается следующим `###`, `## ` или строкой `---`.
    """
    cards: dict[str, dict] = {}
    text = QUEUE_FILE.read_text(encoding="utf-8")
    for part in re.split(r"(?m)^(?=### )", text):
        if not part.startswith("### "):
            continue
        body = re.split(r"(?m)^---\s*$|^## ", part, maxsplit=1)[0].rstrip() + "\n"
        head, _, rest = body.partition("\n")
        m = re.search(r"\bT-\d{3}\b", head)
        if not m:
            continue
        line = next((ln for ln in rest.splitlines() if ln.startswith("D ")), "")
        dep_part = line[2:].split("·")[0] if line else ""
        mm = re.search(r"·\s*M\s+([a-z0-9.\-]+)/([a-z]+)", line)
        tm = re.search(r"⏱\s*(\d+)", line)
        model, effort = DEFAULT_MODEL, DEFAULT_EFFORT
        if mm:
            model = MODELS.get(mm.group(1), mm.group(1))
            effort = mm.group(2) if mm.group(2) in EFFORTS else DEFAULT_EFFORT
        cards[m.group(0)] = {
            "id": m.group(0),
            "title": head.removeprefix("### ").strip(),
            "deps": parse_deps(dep_part),
            "model": model,
            "effort": effort,
            "minutes": int(tm.group(1)) if tm else None,
            "text": body,
        }
    return cards


def deps_missing(card: dict, state: dict) -> list[str]:
    done = set(state.get("done", []))
    return [d for d in card["deps"] if d not in done]
