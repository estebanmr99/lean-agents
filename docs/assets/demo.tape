# Renders docs/assets/demo.gif in CI (.github/workflows/assets.yml), from the repo root.
# Throwaway HOME and --dry-run: nothing is installed.
Output docs/assets/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 720
Set Padding 20
Set TypingSpeed 35ms

Hide
Type 'export HOME="$(mktemp -d)"; unset XDG_CONFIG_HOME; clear'
Enter
Sleep 500ms
Show

Sleep 500ms
Type "bash install.sh --dry-run --yes --no-exec --agents claude,opencode-v2 --tools serena,caveman"
Sleep 800ms
Enter
Sleep 8s
