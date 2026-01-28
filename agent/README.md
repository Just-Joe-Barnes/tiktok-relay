# TikTok Relay Agent

Local dashboard for viewing TikTok relay events in real time.

## Setup

1) Install dependencies:

```bash
npm install
```

2) Copy `.env.example` to `.env` and set:

- `AGENT_STREAM_URL`: relay stream URL (e.g. `https://your-relay.onrender.com/stream`)
- `STREAM_SECRET`: must match the relay `STREAM_SECRET` (or `RELAY_SECRET` if unset)

3) Run:

```bash
npm start
```

Or double-click `JustJoesTikTokRelay.bat` to launch on Windows.

Open http://localhost:5177 in your browser.

## Gift Sounds

Put sound files in `agent/public/sounds`. Default rules:
- `Heart Me` -> `/sounds/heart-me.mp3`
- `Rose` -> `/sounds/rose.mp3`

Gift streaks play once at the start (when `repeatCount` is 1).

## Testing Without Going Live

Use the "Test Gift" box to simulate any gift name + count.
This verifies your local setup without needing a live TikTok stream.
