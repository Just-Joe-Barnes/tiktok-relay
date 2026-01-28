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

Open http://localhost:5177 in your browser.
