# TikTok Relay

Relay + event hub that connects to TikTok Live, forwards selected events to Ned's Decks, and writes local JSONL logs.

## Setup

1) Install dependencies:

```bash
npm install
```

2) Copy `.env.example` to `.env` and fill in values:

Required:
- `TIKTOK_USERNAME`: the TikTok username to watch
- `API_BASE_URL`: your Ned's Decks API base URL
- `RELAY_SECRET`: shared secret used to authenticate relay requests

Optional:
- `STREAMER_ID`: optional streamer DB id
- `EVENT_ENDPOINT`: API endpoint path for forwarded events (default `/api/external/event`)
- `FORWARD_EVENT_TYPES`: comma-separated event types to forward (default `gift`)
- `BUFFER_FLUSH_MS`: buffer window before sending events (default `3000`)
- `BUFFER_MAX_EVENTS`: flush early if the buffer reaches this size (default `200`)

Logging:
- `LOG_DIR`: log directory (default `logs`)
- `LOG_TO_FILE`: enable JSONL logs (default `true`)
- `LOG_INCLUDE_RAW`: include raw payloads in local logs (default `true`)
- `POST_INCLUDE_RAW`: include raw payloads in forwarded events (default `false`)
- `LOG_EVENT_TYPES`: comma-separated event types to log, or `*` for all (default `*`)
- `LOG_CONTROL_EVENTS`: log connect/disconnect/stream end (default `true`)
- `LOG_RAW_DATA`: log raw protobuf data (default `false`)
- `LOG_DECODED_DATA`: log decoded protobuf data (default `false`)

Commands:
- `COMMAND_PREFIXES`: comma-separated command prefixes (default `!`)
- `COMMAND_MAX_PER_MESSAGE`: max commands extracted per chat message (default `5`)
- `EMIT_COMMAND_EVENTS`: emit `command` events when a chat contains commands (default `true`)

TikTok connection options:
- `TIKTOK_SESSION_ID`
- `TIKTOK_TT_TARGET_IDC`
- `TIKTOK_CONNECT_WITH_UNIQUE_ID`
- `TIKTOK_FETCH_ROOMINFO`
- `TIKTOK_FORCE_CONNECT`
- `TIKTOK_CONNECT_FALLBACK`
- `TIKTOK_SIGN_API_KEY`

3) Run:

```bash
npm start
```

## Events

The relay listens for a wide set of TikTok Live events (chat, gift, like, member, social/follow/share/subscribe, room user count, link mic, live intro, emote, envelope, stream end, and more). Events are normalized and written to JSONL logs. Forwarding is controlled by `FORWARD_EVENT_TYPES`.

Notes:
- Gift streaks are logged as `gift_streak` and do not forward unless you include that type.
- Chat commands like `!fart` produce `command` events if enabled.
- The current Ned's Decks backend only processes `gift` events; forward additional types when the backend is ready.

## Render

Create a new Web Service (or Background Worker) pointing to this repo.
Set the env vars above in Render.
Expose a health endpoint at `/health`.
