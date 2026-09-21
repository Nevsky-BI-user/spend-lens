#!/bin/sh
# privacy-guard.sh — PreToolUse hook for the Bash tool (wiring: .claude/settings.json,
# rationale and test matrix: .claude/hooks/README.md).
#
# The repo is public, and real data lives next to the code: collector/.env
# (service_role key), collector/.cache/ (logs with real project names),
# web/public/data/usage.json (real spend), report/out/*.pdf. .gitignore is the
# only thing between those files and GitHub. This hook refuses the git commands
# that stage blindly or name a private file — but only when the git command
# runs inside THIS repository. Everything else passes silently.
#
# Hook contract (Claude Code hooks reference):
#   stdin  — JSON; the shell command is tool_input.command, the working
#            directory is cwd, the project root is $CLAUDE_PROJECT_DIR
#   exit 0 — allow; nothing is printed
#   exit 2 — block; stderr is shown to the model as the reason
#
# POSIX sh, runs under Windows Git Bash. JSON is parsed with jq, else python3,
# else python, else a best-effort sed. Runs inside Claude's own process — no
# window is opened (CLAUDE.md §1).

set -f   # no globbing: tokens such as *.pdf must stay literal

input=$(cat)
[ -z "$input" ] && exit 0

# ---------------------------------------------------------------------------
# JSON access: json_field .cwd | json_field .tool_input.command
# ---------------------------------------------------------------------------
json_field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$input" | python3 -c 'import json,sys
d=json.load(sys.stdin)
for k in sys.argv[1].strip(".").split("."):
    d=d.get(k) if isinstance(d,dict) else None
print(d if isinstance(d,str) else "")' "$1" 2>/dev/null
  elif command -v python >/dev/null 2>&1; then
    printf '%s' "$input" | python -c 'import json,sys
d=json.load(sys.stdin)
for k in sys.argv[1].strip(".").split("."):
    d=d.get(k) if isinstance(d,dict) else None
print(d if isinstance(d,str) else "")' "$1" 2>/dev/null
  else
    # Last resort without a JSON parser. The command extraction is
    # over-inclusive on purpose (it may pull in the following keys), which can
    # only make the check stricter, never looser.
    case "$1" in
      .cwd)
        printf '%s' "$input" \
          | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
          | sed 's/\\\\/\\/g' ;;
      *)
        printf '%s' "$input" \
          | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' \
          | sed 's/\\n/\n/g; s/\\"/"/g; s/\\\\/\\/g' ;;
    esac
  fi
}

cmd=$(json_field .tool_input.command)
[ -z "$cmd" ] && exit 0
cwd=$(json_field .cwd)

# ---------------------------------------------------------------------------
# Paths. The guard applies only inside this project: root = $CLAUDE_PROJECT_DIR
# (Claude Code sets it), else the repository this script lives in.
# norm_path: \ → /, "C:/x" → "/c/x" (Git Bash form), lower-case, no trailing /.
# ---------------------------------------------------------------------------
norm_path() {
  printf '%s' "$1" | tr '\\' '/' | tr 'A-Z' 'a-z' \
    | sed 's#^\([a-z]\):/#/\1/#; s#^\([a-z]\):$#/\1#; s#/*$##'
}

root=${CLAUDE_PROJECT_DIR:-}
[ -z "$root" ] && root=$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)
root=$(norm_path "$root")

# Unknown ("?") counts as inside: when in doubt, guard.
in_project() {
  [ "$1" = '?' ] && return 0
  [ -z "$root" ] && return 0
  case "$1" in
    "$root"|"$root"/*) return 0 ;;
  esac
  return 1
}

# resolve BASE TARGET → normalised absolute path, or "?" when it cannot be known
# (variables, command substitution, ~user).
resolve() {
  t=$2
  t=${t#\"}; t=${t%\"}; t=${t#\'}; t=${t%\'}
  case "$t" in
    ''|'~')  t=${HOME:-?} ;;
    '~/'*)   t="${HOME:-?}/${t#\~/}" ;;
    '~'*|*'$'*|*'`'*) printf '?'; return ;;
  esac
  t=$(norm_path "$t")
  case "$t" in
    /*) abs=$t ;;
    *)  [ "$1" = '?' ] && { printf '?'; return; }
        abs="$1/$t" ;;
  esac
  out=''
  oldIFS=$IFS; IFS=/
  for c in $abs; do
    case "$c" in
      ''|.) ;;
      ..)   out=${out%/*} ;;
      *)    out="$out/$c" ;;
    esac
  done
  IFS=$oldIFS
  printf '%s' "$out"
}

# ---------------------------------------------------------------------------
# Messages (Ukrainian — they are shown to the model as the blocking reason)
# ---------------------------------------------------------------------------

msg_all='БЛОКОВАНО (privacy-guard): «git add -A», «git add .», «git add --all» у цьому репозиторії заборонено.
Репозиторій публічний, а поруч із кодом лежать реальні дані: collector/.env (service_role-ключ), collector/.cache/, web/public/data/usage.json, report/out/*.pdf.
Єдиний їхній захист — .gitignore; масове додавання ставить усе на один рядок у ньому.
Додавай файли поіменно: git add <шлях> [<шлях>...]. Перед комітом — git status.
Правило: CONTRACT.md → Privacy. Перелік файлів: .gitignore → PRIVACY-CRITICAL.'

msg_force='БЛОКОВАНО (privacy-guard): «git add -f» / «git add --force» у цьому репозиторії заборонено.
-f обходить .gitignore — єдиний захист реальних даних (collector/.env, collector/.cache/, usage.json, *.pdf) від публічного репозиторію.
Якщо файл справді має бути в git — свідомо прибери його з .gitignore і додай без -f.
Правило: CONTRACT.md → Privacy.'

msg_private() {
  printf '%s\n' \
    "БЛОКОВАНО (privacy-guard): «$1» — приватний файл, у публічний репозиторій він не потрапляє." \
    'Що приватне: .env (ключі й паролі), collector/.cache/ (кеш і логи з реальними назвами), collector/projects.json, будь-який usage.json (реальні витрати), report/out/ і *.pdf (звіти).' \
    'Ці шляхи вже в .gitignore. Не додавай їх ані поіменно, ані через -f, ані в commit.' \
    'Правило: CONTRACT.md → Privacy. Перелік файлів: .gitignore → PRIVACY-CRITICAL.'
}

block() {
  printf '%s\n' "$1" >&2
  exit 2
}

# ---------------------------------------------------------------------------
# Is this token a private path? Mirrors .gitignore → PRIVACY-CRITICAL and
# CONTRACT.md → Privacy. Quotes are stripped, Windows separators normalised.
# ---------------------------------------------------------------------------
is_private() {
  p=$1
  p=${p#\"}; p=${p%\"}; p=${p#\'}; p=${p%\'}
  p=$(printf '%s' "$p" | tr '\\' '/')
  case "$p" in */) p=${p%/} ;; esac
  case "$p" in
    .env.example|*/.env.example) return 1 ;;                       # the committed template
    .env|*/.env|.env.*|*/.env.*) return 0 ;;                       # collector/.env, report/.env, .env.local ...
    .cache|*/.cache|.cache/*|*/.cache/*) return 0 ;;               # collector/.cache/ and everything inside
    projects.json|collector/projects.json|*/collector/projects.json) return 0 ;;
    report/out|*/report/out|report/out/*|*/report/out/*) return 0 ;;
    *.pdf|*.PDF) return 0 ;;
    usage.json|*/usage.json) return 0 ;;                           # real snapshot: web/public/data and any build dir
  esac
  return 1
}

# ---------------------------------------------------------------------------
# One simple command (already split on ; | & and newlines).
# cd / pushd / popd move the tracked directory ($dir); git -C <path> moves it
# for that one command. Only a command that really starts with git is
# inspected — an `echo`, `grep` or `printf` that merely mentions "git add -A"
# is not. A git command outside the project root is not our business.
# ---------------------------------------------------------------------------
scan_segment() {
  # shellcheck disable=SC2086
  set -- $1
  state=pre
  skip=0
  segdir=$dir
  for tok in "$@"; do
    case $state in
      pre)
        case "$tok" in
          *=*|sudo|command|env|exec|time|nice|nohup) ;;             # prefixes before the real command
          cd|pushd) state=cd ;;
          popd) prev=$dir; dir='?'; return 0 ;;
          git|git.exe|*/git|*/git.exe) state=sub ;;
          *) return 0 ;;                                           # not a git command
        esac
        ;;
      cd)
        case "$tok" in
          -)  new=$prev ;;
          -*) continue ;;                                          # cd -P / -L / --
          *)  new=$(resolve "$dir" "$tok") ;;
        esac
        prev=$dir; dir=$new
        return 0
        ;;
      sub)
        if [ "$skip" = C ]; then segdir=$(resolve "$dir" "$tok"); skip=0; continue; fi
        if [ "$skip" = 1 ]; then skip=0; continue; fi
        case "$tok" in
          add|commit) in_project "$segdir" || return 0; state=$tok ;;
          -C) skip=C ;;                                            # git -C <dir>: separate value, moves the command
          -c|--git-dir|--work-tree|--namespace|--exec-path) skip=1 ;;
          -*) ;;                                                   # other global option
          *) return 0 ;;                                           # another subcommand
        esac
        ;;
      add)
        case "$tok" in
          --all|--no-ignore-removal) block "$msg_all" ;;
          -A*|-[!-]*A*) block "$msg_all" ;;                        # -A and short-flag clusters: -Af, -fA, -vAf
          --force|-f*|-[!-]*f*) block "$msg_force" ;;              # -f and clusters: -fv, -nf
          .|./|:/|:/.|'*') block "$msg_all" ;;
        esac
        if is_private "$tok"; then block "$(msg_private "$tok")"; fi
        ;;
      commit)
        if is_private "$tok"; then block "$(msg_private "$tok")"; fi
        ;;
    esac
  done
  # bare `cd` / `pushd` without an argument → $HOME
  if [ "$state" = cd ]; then prev=$dir; dir=$(resolve "$dir" ""); fi
  return 0
}

# Starting directory: the payload's cwd, else the hook's own $PWD.
dir=$(norm_path "${cwd:-$PWD}")
prev=$dir

# Split the command line into simple commands: ; | & newline, plus ( ) { }
# turned into spaces so «(git add -A)» is still seen. The subshell's cd is
# tracked linearly — good enough for «cd X && git …» chains.
printf '%s\n' "$cmd" | tr ';|&\n(){}' '\n\n\n\n    ' | while IFS= read -r seg; do
  scan_segment "$seg"
done
exit $?
