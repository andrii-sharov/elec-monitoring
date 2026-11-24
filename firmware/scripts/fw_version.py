import os
import re

Import("env")

version = os.environ.get("FW_VERSION") or "0.0.0-dev"
if not re.fullmatch(r"\d+\.\d+\.\d+(-dev)?", version):
    raise SystemExit(f"FW_VERSION must be MAJOR.MINOR.PATCH, got {version!r}")

server_url = env.GetProjectOption("custom_server_url")
env.Append(
    CPPDEFINES=[
        ("FW_VERSION", env.StringifyMacro(version)),
        ("SERVER_URL", env.StringifyMacro(server_url)),
    ]
)
