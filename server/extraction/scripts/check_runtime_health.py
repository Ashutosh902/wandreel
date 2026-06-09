import json
import sys

from runtime_support import build_runtime_diagnostics, configure_runtime_paths


def main() -> int:
    runtime_path_additions = configure_runtime_paths()
    diagnostics = build_runtime_diagnostics("check_runtime_health.py", runtime_path_additions)
    print(json.dumps({"ok": True, "runtime": diagnostics}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
