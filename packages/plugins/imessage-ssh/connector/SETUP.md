# Connect your Mac

**Before you start:** ask your OpenTeam administrator to enable this integration
and verify SSH access to your Mac without a password prompt.

1. On your Mac, enable **Remote Login** and allow the SSH user to read Messages history.
2. In **Marketplace → iMessage (SSH) → account settings**, enter your **Mac SSH address**,
   such as `alex@100.64.0.10`. Use your Mac login username, not your Apple Account
   email. A hostname also works. Do not include `ssh`.
3. Choose **Connect**. OpenTeam installs a read-only helper and checks Messages
   access. Once connected, ask your agent what's new or to find a conversation.

Keep the Mac online and Messages signed in for new messages to sync. This
integration reads synced iMessage, SMS and RCS history, shows Contacts names, and
can open attachments that are downloaded to the Mac; sending is not supported.

If Connect fails, ask your administrator to check SSH access and Messages
permissions using the troubleshooting section below.

## Deployment internals — for the host administrator or deployment agent

The path is **agent tool → computer's packaged stdio connector → internal host
bridge → SSH → Mac reader**. The computer uses OpenTeam's existing MCP runtime.
SSH keys stay on the host. The internal bridge token is provisioned automatically
outside the plugin and Marketplace account; users never enter it.

On a Linux Docker/systemd deployment, run this once as the host user whose SSH
access should be used, from the package's connector directory:

```sh
python3 install-host.py --computer-container openteam-computer-1
```

This installs/updates the host service, generates an internal token, discovers
the computer's Docker bridge address, and writes the internal connection into
the computer's persistent home with mode 0600. The listener binds only to that
private bridge interface. The host user needs Docker access, a systemd user
session, and lingering enabled for service persistence after logout. If needed,
an administrator enables lingering with `loginctl enable-linger USER`.
No server/container rebuild is required. Re-run provisioning if Docker networking
changes or the computer's persistent home is replaced.

This provisioning script is included with the plugin; it is **not yet wired into
the general OpenTeam deployment installer**. A new deployment needs this one-time
host provisioning before the single-field Marketplace flow works. Existing
`~/.config/openteam-imessage/config.json` restricted connections migrate automatically.

The Mac needs Python 3 at `/usr/bin/python3` and a readable
`~/Library/Messages/chat.db` for the SSH user. Existing downloaded history can
be read while signed out; fresh iMessage/SMS/RCS history requires syncing.
Contacts names come from `~/Library/Application Support/AddressBook`, which the
same Full Disk Access covers; without it, handles appear without names. Attachments
are read only through their message from `~/Library/Messages`, capped at 50 MB, with
HEIC, HEIF and TIFF images converted to JPEG by `/usr/bin/sips`; the computer's
connector saves them under `/workspace/shared/imessage-attachments`.
macOS permissions or Apple Account sign-in may require the user on the Mac.

After the host's bridge files are updated, the bridge checks each Mac's reader on
first use and reinstalls an older one through the host's existing SSH access, as
on the first connection. Older bridges sharing the same Mac keep working.

For a new Mac, first establish and verify the host user's normal SSH connection.
Do not disable host-key checking or automatically trust `ssh-keyscan` output.
The bridge creates one restricted key per `user@host` and installs the reader
using the host's existing authorized connection. Only validated destinations
and fixed packaged operations are accepted; no arbitrary command/SQL tool exists.

## Troubleshooting

- Connection fails before tools appear: check the host service, private network,
  and `/home/box/.config/openteam/imessage-bridge.json` in the computer.
- `ssh_setup_required`: verify the host user's passwordless SSH and known_hosts,
  Python 3 on the Mac, and Messages database permissions.
- `ssh_unavailable`: check Mac availability, pinned host key, and restricted key.
- `messages_unavailable`: check the Mac SSH user's disk access and local database.
- `helper_outdated`: the bridge could not reinstall an older Mac reader; check the
  host user's normal SSH access to the Mac, then restart `openteam-imessage.service`.
- `IMessageStatus` returns a `notice`: nothing has reached the Mac for a day. Check
  that Messages on the Mac is signed in to iMessage and that the iPhone forwards
  SMS to it (Settings > Apps > Messages > Text Message Forwarding).

Use `IMessageStatus`, then `IMessageActivity` and `ChatItems` to validate, or run
`probe.py --endpoint ... --token-file ... --target user@host` for a content-free
end-to-end check.
Use counts when reporting diagnostics; do not print private message contents.

To remove host infrastructure, stop/disable `openteam-imessage.service`, remove
its unit and `~/.local/share/openteam-imessage`, and remove the private host config
and computer bridge config. Revoke only this integration's restricted public-key
entries from the Mac's authorized_keys; preserve all other keys. Remove the Mac
reader only when no remaining integration uses it.
