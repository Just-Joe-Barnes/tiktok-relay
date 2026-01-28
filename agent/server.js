const express = require('express');
const path = require('path');

require('dotenv').config();

const app = express();
const PORT = Math.max(1, parseInt(process.env.AGENT_PORT || '5177', 10));
const STREAM_URL = process.env.AGENT_STREAM_URL || 'http://localhost:3000/stream';
const STREAM_SECRET = process.env.STREAM_SECRET || '';

app.use(express.static(path.join(__dirname, 'public')));

app.get('/config', (_req, res) => {
    res.json({
        streamUrl: STREAM_URL,
        streamSecret: STREAM_SECRET,
    });
});

app.listen(PORT, () => {
    console.log(`[agent] dashboard listening on :${PORT}`);
});
