#!/usr/bin/env python3
import json, os
home = os.path.expanduser("~")
auth_path = os.path.join(home, ".openclaw/agents/main/agent/auth-profiles.json")
config_path = os.path.join(home, ".openclaw/openclaw.json")
try:
    with open(auth_path) as f:
        auth = json.load(f)
    providers = set(k.split(":")[0] for k in auth.get("profiles", {}))
    with open(config_path) as f:
        cfg = json.load(f)
    fallbacks = cfg.get("agents", {}).get("defaults", {}).get("model", {}).get("fallbacks", [])
    missing = [fb for fb in fallbacks if fb.split("/")[0] not in providers]
    print(",".join(missing) if missing else "OK")
except Exception as e:
    print("ERR:" + str(e))
