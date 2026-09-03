#!/usr/bin/env python3
"""Статистика збоїв у транскриптах сесій Claude Code (stdlib only).

Читає `.jsonl` головної сесії та її `subagents/*.jsonl`, рахує:
  - виклики інструментів;
  - помилки інструментів за класами (регулярки нижче);
  - блокування хуків і системні повідомлення;
  - короткі повідомлення користувача, схожі на виправлення.

Використання:
  python session_error_stats.py <транскрипт.jsonl> [ще транскрипти…]
  python session_error_stats.py --project ~/.claude/projects/<-шлях-до-проєкту>

Вивід — текст; персональних даних скрипт не друкує (лише лічильники й перші
120 символів команди чи шляху, за якими можна знайти місце в транскрипті).
"""
import collections
import glob
import json
import os
import re
import sys

CLASSES = [
    ("Edit без попереднього Read", re.compile(r"has not been read yet|modified since read", re.I)),
    ("Мережа заблокована проксі", re.compile(r"EGRESS_BLOCKED|CONNECT tunnel failed|response 403", re.I)),
    ("Репозиторій поза скоупом сесії", re.compile(r"Access denied: repository", re.I)),
    ("Хук проєкту заблокував виклик", re.compile(r"PreToolUse:\w+ hook error|hook error:", re.I)),
    ("Публікацію артефакту відхилено", re.compile(r"publish was refused|Publish refused", re.I)),
    ("Таймаут MCP-інструмента", re.compile(r"timed out", re.I)),
    ("Шлях/тека не існує", re.compile(r"No such file or directory|cannot access", re.I)),
    ("Синтаксис shell", re.compile(r"syntax error", re.I)),
    ("Команда завершилась з кодом ≠ 0", re.compile(r"^Exit code [1-9]", re.M)),
]
CORRECTION_HINTS = re.compile(
    r"не просив|я мав на увазі|не потрібн|не так|не те|заново|переробити|не в вебі|локально", re.I
)


def iter_records(path):
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def analyze(path, stats):
    tool_by_id = {}
    for d in iter_records(path):
        t = d.get("type")
        msg = d.get("message") or {}
        content = msg.get("content")
        if t == "assistant" and isinstance(content, list):
            for b in content:
                if b.get("type") == "tool_use":
                    stats["tools"][b.get("name")] += 1
                    inp = b.get("input") or {}
                    short = inp.get("command") or inp.get("file_path") or inp.get("url") or ""
                    tool_by_id[b.get("id")] = (b.get("name"), str(short)[:120].replace("\n", " "))
        elif t == "user":
            if isinstance(content, str):
                texts = [content]
                results = []
            elif isinstance(content, list):
                texts = [b.get("text", "") for b in content if b.get("type") == "text"]
                results = [b for b in content if b.get("type") == "tool_result"]
            else:
                texts, results = [], []
            for txt in texts:
                s = txt.strip()
                if s and not s.startswith("<") and len(s) < 400 and CORRECTION_HINTS.search(s):
                    stats["corrections"].append(s[:200].replace("\n", " "))
            for r in results:
                rc = r.get("content")
                if isinstance(rc, list):
                    rtxt = " ".join(x.get("text", "") for x in rc if isinstance(x, dict))
                else:
                    rtxt = str(rc or "")
                name, short = tool_by_id.get(r.get("tool_use_id"), ("?", ""))
                if not r.get("is_error") and "hook error" not in rtxt:
                    continue
                stats["errors_total"] += 1
                stats["errors_by_tool"][name] += 1
                klass = "Інше"
                for label, rx in CLASSES:
                    if rx.search(rtxt):
                        klass = label
                        break
                stats["classes"][klass] += 1
                short = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "<email>", short)
                stats["examples"][klass].append(f"{name}: {short}")
        elif t == "system":
            c = d.get("content") or ""
            if isinstance(c, str) and c.strip():
                stats["system"][c.strip()[:80]] += 1


def main(argv):
    paths = []
    if len(argv) >= 2 and argv[0] == "--project":
        root = os.path.expanduser(argv[1])
        paths = sorted(glob.glob(os.path.join(root, "*.jsonl")))
        paths += sorted(glob.glob(os.path.join(root, "*", "subagents", "*.jsonl")))
    else:
        for p in argv:
            paths.append(p)
            sub = os.path.join(os.path.splitext(p)[0], "subagents")
            paths += sorted(glob.glob(os.path.join(sub, "*.jsonl")))
    if not paths:
        print(__doc__)
        return 2
    stats = {
        "tools": collections.Counter(),
        "errors_total": 0,
        "errors_by_tool": collections.Counter(),
        "classes": collections.Counter(),
        "examples": collections.defaultdict(list),
        "corrections": [],
        "system": collections.Counter(),
    }
    for p in paths:
        analyze(p, stats)
    print(f"Транскриптів: {len(paths)}")
    print("\n== Виклики інструментів ==")
    for k, v in stats["tools"].most_common(15):
        print(f"{v:5d}  {k}")
    print(f"\n== Помилки інструментів: {stats['errors_total']} ==")
    for k, v in stats["classes"].most_common():
        print(f"{v:5d}  {k}")
        for ex in stats["examples"][k][:3]:
            print(f"         напр.: {ex}")
    print("\n== Помилки за інструментом ==")
    for k, v in stats["errors_by_tool"].most_common():
        print(f"{v:5d}  {k}")
    if stats["corrections"]:
        print("\n== Повідомлення користувача, схожі на виправлення ==")
        for c in stats["corrections"]:
            print(f"  - {c}")
    if stats["system"]:
        print("\n== Системні повідомлення ==")
        for k, v in stats["system"].most_common(10):
            print(f"{v:5d}  {k}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
