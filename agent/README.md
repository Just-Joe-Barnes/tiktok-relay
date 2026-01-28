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

## Gift List + Uploads

The agent fetches a gift list from a public catalog (currently mcstreams.com).
This is not an official TikTok API, so the list can change or be incomplete.

Use the dropdown to pick a gift name and the Upload Sound controls to attach
a local audio file. The file is saved into `agent/public/sounds` and remembered
in your browser (localStorage).

## OBS Integration

The agent can connect to OBS WebSocket and fire actions based on rules.
Default settings assume OBS WebSocket is enabled on `ws://localhost:4455`.

Optional env vars:
- `OBS_WS_URL` (default `ws://localhost:4455`)
- `OBS_WS_PASSWORD` (optional)
- `OBS_AUTO_CONNECT` (default `true`)

Use the OBS Rules panel in the dashboard to pick a gift/command and an OBS action.

## Streamer.bot Integration

Streamer.bot can be used as the automation layer instead of direct OBS actions.
Enable the WebSocket server in Streamer.bot (default `ws://127.0.0.1:8080/`).

Optional env vars:
- `STREAMERBOT_WS_URL` (default `ws://127.0.0.1:8080/`)
- `STREAMERBOT_WS_PASSWORD` (optional)
- `STREAMERBOT_AUTO_CONNECT` (default `true`)

In the Rules panel, choose action type `Streamer.bot Action` and select one of
your Streamer.bot actions. This will call `DoAction` over WebSocket.
