#!/usr/bin/env bash
# Usage: ./scripts/get-telegram-chat-id.sh <bot_token>
# Sends a message to the bot first, then run this to get your chat ID.

set -euo pipefail

BOT_TOKEN="${1:-}"

if [[ -z "$BOT_TOKEN" ]]; then
  echo "Usage: $0 <bot_token>"
  exit 1
fi

echo "Waiting for a message... Send anything to your bot in Telegram now."
echo ""

RESULT=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?timeout=30&offset=-1")

python3 - <<EOF
import json, sys

data = json.loads('''${RESULT}''')
updates = data.get("result", [])

if not updates:
    print("No messages received. Make sure the bot isn't running elsewhere (it consumes updates).")
    sys.exit(1)

for u in updates:
    msg = u.get("message") or u.get("channel_post") or {}
    chat = msg.get("chat", {})
    sender = msg.get("from", {})
    if chat:
        print(f"chat_id : {chat['id']}")
        print(f"type    : {chat['type']}")
        print(f"username: {sender.get('username', 'N/A')}")
EOF
