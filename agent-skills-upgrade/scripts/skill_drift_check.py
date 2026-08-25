#!/usr/bin/env python3
"""skill_drift_check.py — детектор розсинхрону скіл-бібліотек.

Одна й та сама SKILL.md живе в 4-5 місцях (repo-канон, ~/.claude/skills,
synced з claude.ai, транспортні знімки). Цей скрипт знаходить усі копії
кожного скіла в заданих коренях, хешує файли і показує, де копії розійшлися.

Використання:
    python skill_drift_check.py ROOT [ROOT ...] [--full] [--canonical ROOT]

  ROOT         — директорія, під якою лежать скіли (шукає **/SKILL.md,
                 ігнорує .git і node_modules). Можна давати і repo-корінь —
                 плагіни marketplace (plugins/*/skills/*) знайдуться самі.
  --full       — порівнювати ВСІ файли скіла (reference.md, references/*,
                 scripts/*), а не лише SKILL.md.
  --canonical  — позначити один із коренів як канонічний: у звіті кожна
                 розбіжна копія отримає ярлик STALE?, якщо відрізняється
                 від канонічної.

Приклад (Windows, локальна машина):
    python skill_drift_check.py ^
        C:\\github\\powerbi-craft-marketplace ^
        C:\\github\\pbi-skills\\skills ^
        %USERPROFILE%\\.claude\\skills ^
        --canonical C:\\github\\powerbi-craft-marketplace --full

Коди виходу: 0 — дрейфу немає; 1 — знайдено дрейф (зручно для CI).
Лише stdlib; працює на Windows/Linux/macOS.
"""

import argparse
import hashlib
import os
import sys
from collections import defaultdict

IGNORE_DIRS = {".git", "node_modules", "__pycache__", ".venv", "evals"}

# розширення текстових файлів: лише для них нормалізуємо CRLF→LF перед хешуванням
TEXT_EXTS = {
    ".md", ".py", ".json", ".yml", ".yaml", ".txt", ".sh", ".ps1",
    ".dax", ".ts", ".js", ".css", ".html", ".svg",
}


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        data = f.read()
    # нормалізуємо переводи рядків, щоб CRLF/LF не рахувалися дрейфом —
    # але лише для текстових розширень; бінарні файли хешуємо як є
    if os.path.splitext(path)[1].lower() in TEXT_EXTS:
        data = data.replace(b"\r\n", b"\n")
    h.update(data)
    return h.hexdigest()


def find_skills(root: str):
    """Повертає [(skill_name, skill_dir), …] для всіх SKILL.md під root.

    Дублікат імені всередині одного кореня — теж дрейф, фіксуємо ВСІ копії.
    """
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        if "SKILL.md" in filenames:
            found.append((os.path.basename(dirpath), dirpath))
    return found


def skill_digest(skill_dir: str, full: bool) -> str:
    if not full:
        return sha256_file(os.path.join(skill_dir, "SKILL.md"))
    h = hashlib.sha256()
    for dirpath, dirnames, filenames in os.walk(skill_dir):
        dirnames[:] = sorted(d for d in dirnames if d not in IGNORE_DIRS)
        for fn in sorted(filenames):
            rel = os.path.relpath(os.path.join(dirpath, fn), skill_dir)
            h.update(rel.replace("\\", "/").encode())
            h.update(sha256_file(os.path.join(dirpath, fn)).encode())
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description="Skill library drift detector")
    ap.add_argument("roots", nargs="+", help="директорії зі скілами")
    ap.add_argument("--full", action="store_true", help="хешувати всі файли скіла")
    ap.add_argument("--canonical", default=None, help="канонічний корінь")
    args = ap.parse_args()

    roots = [os.path.abspath(r) for r in args.roots]
    for r in roots:
        if not os.path.isdir(r):
            print(f"ПОМИЛКА: не директорія: {r}", file=sys.stderr)
            return 2
    canonical = os.path.abspath(args.canonical) if args.canonical else None
    # порівнюємо шляхи через normcase, щоб на Windows різниця регістру
    # не дублювала корені
    if canonical:
        match = next(
            (r for r in roots
             if os.path.normcase(r) == os.path.normcase(canonical)),
            None,
        )
        if match is None:
            roots.append(canonical)
        else:
            canonical = match

    def is_canonical(root):
        return canonical is not None and \
            os.path.normcase(root) == os.path.normcase(canonical)

    # skill -> root -> [(dir, digest), …] — усі копії, включно з дублями
    # одного імені всередині одного кореня
    table = defaultdict(lambda: defaultdict(list))
    for root in roots:
        for name, sdir in find_skills(root):
            table[name][root].append((sdir, skill_digest(sdir, args.full)))

    label = {r: f"[{i+1}]" for i, r in enumerate(roots)}
    print("Корені:")
    for r in roots:
        mark = "  ← canonical" if is_canonical(r) else ""
        print(f"  {label[r]} {r}{mark}")
    mode = "усі файли скіла" if args.full else "лише SKILL.md"
    print(f"Режим порівняння: {mode}\n")

    drift = ok = single = 0
    for skill in sorted(table):
        copies = table[skill]
        total_copies = sum(len(lst) for lst in copies.values())
        digests = {dg for lst in copies.values() for _, dg in lst}
        if total_copies == 1:
            single += 1
            continue
        # DRIFT: розбіжні дайджести серед УСІХ копій у ВСІХ коренях —
        # включно з випадком, коли один корінь тримає >1 різних копій
        # одного імені
        if len(digests) == 1:
            ok += 1
            continue
        drift += 1
        print(f"DRIFT  {skill}")
        # групуємо корені за однаковим вмістом; корінь із кількома копіями
        # різного вмісту з'являється по разу на кожен свій дайджест
        groups = defaultdict(set)
        for root, lst in copies.items():
            for _sdir, dg in lst:
                groups[dg].add(root)
        canon_dgs = set()
        if canonical:
            for root, lst in copies.items():
                if is_canonical(root):
                    canon_dgs = {dg for _, dg in lst}
        for dg, rs in sorted(groups.items(), key=lambda kv: kv[0]):
            tag = ""
            if canon_dgs:
                tag = "  (canonical)" if dg in canon_dgs else "  (STALE?)"
            print(f"    {dg[:12]}  {' '.join(label[r] for r in sorted(rs))}{tag}")
        print()

    print("Підсумок:")
    print(f"  скілів усього: {len(table)}; у кількох коренях: {ok + drift}; лише в одному: {single}")
    print(f"  ідентичних: {ok}; РОЗБІЖНИХ: {drift}")
    if canonical:
        missing_in_canon = sorted(
            s for s, c in table.items()
            if not any(is_canonical(root) for root in c) and len(c) >= 1
        )
        if missing_in_canon:
            print(f"  відсутні в canonical ({len(missing_in_canon)}): "
                  + ", ".join(missing_in_canon[:20])
                  + (" …" if len(missing_in_canon) > 20 else ""))
    return 1 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
