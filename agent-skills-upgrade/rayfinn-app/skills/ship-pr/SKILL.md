---
name: ship-pr
description: >
  Ship the current work as a PR following this repo's PR ritual: CLAUDE.md's
  auto-merge + branch-cleanup commands, plus a quality gate added by this skill
  (feature branch, push, gh pr create).
  Invoke explicitly: /ship-pr, "зроби PR", "відправ PR", "ship this".
disable-model-invocation: true
---

# Ship PR — ритуал цього репозиторію

User-invoked workflow. Виконуй кроки строго по черзі; не пропускай quality gate.

## 1. Quality gate — перед усім іншим

```bash
npm run lint && npm test
```

Червоний lint або тести — виправ спочатку. Ніколи не відкривай PR з червоними перевірками (auto-merge зіллє їх без жодного CI).

## 2. Feature branch

```bash
git checkout -b <type>/<kebab-name>   # якщо ще на master; e.g. feat/absence-chart, fix/metadata-keys
```

Ніколи не коміть напряму в `master`.

## 3. Commit + push

```bash
git add <files> && git commit -m "<стислий опис>"
git push -u origin <гілка>
```

## 4. PR + auto-merge (одразу)

```bash
gh pr create --title "<title>" --body "<що і навіщо>"
gh pr merge <номер> --auto --merge      # точна команда з CLAUDE.md — вмикай одразу після створення
```

## 5. Після мерджу — прибирання гілок

CLAUDE.md: видаляй фіча-гілки і на remote, і локально; перед видаленням локальної — перемкнись на `master`:

```bash
git checkout master && git pull
git push origin --delete <гілка>
git branch -D <гілка>
```

## 6. Заборони / Never

- **Не видаляй `master`** та інші довгоживучі гілки. / **NEVER delete `master`** or long-lived branches.
- Не форсуй мердж (`--admin`, `--squash` тощо) — тільки `--auto --merge` як у CLAUDE.md.
- Не лишай смердж-ені гілки висіти — крок 5 обовʼязковий.
