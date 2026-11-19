#!/bin/sh
# shovel-cli-script
# shovel のコマンドラインツール（macOS / Linux）。shovel を引数付きで起動し、すぐに終わる。

SHOVEL_VERSION='__SHOVEL_VERSION__'
# shovel の実行ファイル。空なら、このスクリプトの置き場所から求める。
SHOVEL_APP=''

usage() {
  cat <<'EOF'
Usage: shovel [path]

Open the directory at <path> as a shovel project (default: the current directory).

  - If a shovel project already uses the directory, it is opened.
  - Otherwise a project is added from the Docker Sandboxes sandbox whose
    workspace is the directory (`sbx ls`). No sandbox is created.

Options:
  -h, --help       Show this help and exit.
  -v, --version    Show the version and exit.
EOF
}

die() {
  echo "shovel: $1" >&2
  echo "Try 'shovel --help' for more information." >&2
  exit 2
}

target=''
has_target=0
end_of_options=0
for arg in "$@"; do
  if [ "$end_of_options" -eq 0 ]; then
    case $arg in
      -h | --help)
        usage
        exit 0
        ;;
      -v | --version)
        echo "shovel $SHOVEL_VERSION"
        exit 0
        ;;
      --)
        end_of_options=1
        continue
        ;;
      -*)
        die "unknown option: $arg"
        ;;
    esac
  fi
  [ "$has_target" -eq 0 ] || die "too many arguments"
  target=$arg
  has_target=1
done

if [ -z "$SHOVEL_APP" ]; then
  # シンボリックリンクを辿って、このスクリプトの実体があるディレクトリを求める。
  self=$0
  while [ -L "$self" ]; do
    link=$(readlink "$self")
    case $link in
      /*) self=$link ;;
      *) self=$(dirname "$self")/$link ;;
    esac
  done
  bin_dir=$(cd "$(dirname "$self")" && pwd -P) || exit 1
  if [ "$(uname)" = Darwin ]; then
    # shovel.app/Contents/Resources/bin → shovel.app/Contents/MacOS/shovel
    SHOVEL_APP=$bin_dir/../../MacOS/shovel
  else
    # <install>/resources/bin → <install>/shovel
    SHOVEL_APP=$bin_dir/../../shovel
  fi
fi

if [ ! -x "$SHOVEL_APP" ]; then
  echo "shovel: the shovel application was not found: $SHOVEL_APP" >&2
  echo "Reinstall the command from shovel's settings." >&2
  exit 1
fi

if [ "$has_target" -eq 1 ]; then
  set -- --shovel-cli -- "$target"
else
  set -- --shovel-cli
fi

# ターミナルから切り離して起動する（ターミナルを閉じても shovel が終わらないように）。
if command -v setsid >/dev/null 2>&1; then
  setsid "$SHOVEL_APP" "$@" </dev/null >/dev/null 2>&1 &
else
  nohup "$SHOVEL_APP" "$@" </dev/null >/dev/null 2>&1 &
fi
exit 0
