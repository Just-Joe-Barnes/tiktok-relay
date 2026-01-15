# TikTok Relay

Minimal relay service that connects to TikTok Live and forwards gift events to Ned's Decks.

## Setup

1) Install dependencies:

```bash
npm install
```

2) Copy `.env.example` to `.env` and fill in values:

- `TIKTOK_USERNAME`: the TikTok username to watch
- `API_BASE_URL`: your Ned's Decks API base URL
- `RELAY_SECRET`: shared secret used to authenticate relay requests
- `STREAMER_ID`: optional streamer DB id
- `EVENT_ENDPOINT`: API endpoint path for events

3) Run:

```bash
npm start
```

## Render

Create a new Web Service (or Background Worker) pointing to this repo.
Set the env vars above in Render.
Expose a health endpoint at `/health`.
