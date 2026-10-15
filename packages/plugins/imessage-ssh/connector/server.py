#!/usr/bin/env python3
"""MCP stdio adapter in the OpenTeam computer; SSH credentials stay on the host."""
import base64
import json
import os
from pathlib import Path
import re
import sys
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler

from bridge import validate_target

MAX_RESPONSE = 72_000_000  # A 50 MB attachment, base64-encoded, plus its JSON envelope.
FOLDERS = (Path("/workspace/shared/imessage-attachments"), Path.home() / "imessage-attachments")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class Client:
    def __init__(self, target, config_path=None):
        self.target = validate_target(target)
        path = Path(config_path or Path.home() / ".config/openteam/imessage-bridge.json")
        if path.stat().st_mode & 0o077:
            raise ValueError("Internal bridge configuration must be private")
        self.config = json.loads(path.read_text())
        self.http = build_opener(ProxyHandler({}), NoRedirect())

    def rpc(self, request, timeout=55):
        req = Request(self.config["endpoint"], data=json.dumps(request).encode(), headers={
            "Authorization": "Bearer " + self.config["token"], "Content-Type": "application/json",
            "X-OpenTeam-SSH-Target": self.target})
        with self.http.open(req, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise ValueError("Bridge response too large")
        return json.loads(raw) if raw else None

    def check(self):
        for name in ("IMessageStatus", "imessage_status"):  # The second serves a host bridge not yet upgraded.
            response = self.rpc({"jsonrpc": "2.0", "id": "connect-check", "method": "tools/call",
                                 "params": {"name": name, "arguments": {}}})
            if response.get("error", {}).get("code") != -32602:
                break
        result = response.get("result", {})
        if result.get("isError") or "error" in response:
            raise ValueError("SSH or Messages access failed. Verify host SSH access and Mac disk permissions.")
        content = result.get("content", [])
        if not any(json.loads(item["text"]).get("readable") for item in content if item.get("type") == "text"):
            raise ValueError("Mac did not confirm Messages access")


def land(response, folders=FOLDERS):
    """Save a fetched attachment in this computer and hand the agent its path instead of its bytes."""
    try:
        content = response["result"]["content"]
        value = json.loads(content[0]["text"])
        data = value.pop("bytesBase64")
    except (KeyError, IndexError, TypeError, ValueError, AttributeError):
        return response
    name = re.sub(r"[^\w.\- ]", "_", os.path.basename(str(value.get("filename") or ""))).strip(" .") or "attachment"
    stem, suffix = os.path.splitext(name)
    for folder in folders:
        try:
            folder.mkdir(parents=True, exist_ok=True)
            path, copy = folder / name, 1
            while path.exists():
                copy += 1
                path = folder / ("%s (%d)%s" % (stem, copy, suffix))
            path.write_bytes(base64.b64decode(data))
            path.chmod(0o644)
        except OSError:
            continue
        value["path"] = str(path)
        content[0]["text"] = json.dumps(value, ensure_ascii=False)
        return response
    content[0]["text"] = json.dumps({"error": "attachment_not_saved", "message": "This computer couldn't save the attachment."})
    response["result"]["isError"] = True
    return response


def main():
    try:
        client = Client(os.environ.get("IMESSAGE_SSH_TARGET", ""))
        client.check()  # Marketplace Connect verifies actual Messages access before tools discovery.
    except Exception:
        print("iMessage connection failed: verify user@host, host SSH credentials/known_hosts, Mac disk permissions, "
              "and the deployment's internal Messages bridge (connector/SETUP.md).", file=sys.stderr)
        return 1
    for raw in sys.stdin.buffer:
        request = None
        try:
            if len(raw) > 32768:
                raise ValueError("Request too large")
            request = json.loads(raw)
            fetch = request.get("method") == "tools/call" and (request.get("params") or {}).get("name") == "FetchIMessageAttachment"
            response = client.rpc(request, timeout=120 if fetch else 55)
            if fetch and response is not None:
                response = land(response)
        except Exception:
            response = {"jsonrpc": "2.0", "id": request.get("id") if isinstance(request, dict) else None,
                        "error": {"code": -32603, "message": "Messages bridge unavailable; reconnect and test SSH access"}}
        if response is not None:
            print(json.dumps(response), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
