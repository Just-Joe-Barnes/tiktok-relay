const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const Busboy = require('busboy');
const { URL } = require('url');

require('dotenv').config();

const app = express();
const PORT = Math.max(1, parseInt(process.env.AGENT_PORT || '5177', 10));
const STREAM_URL = process.env.AGENT_STREAM_URL || 'http://localhost:3000/stream';
const STREAM_SECRET = process.env.STREAM_SECRET || '';
const GIFT_LIST_URL = process.env.GIFT_LIST_URL || 'https://mcstreams.com/gifts';
const GIFT_LIST_CACHE_MS = Math.max(60_000, parseInt(process.env.GIFT_LIST_CACHE_MS || '43200000', 10));
const SOUNDS_DIR = path.join(__dirname, 'public', 'sounds');

app.use(express.static(path.join(__dirname, 'public')));

const giftCache = {
    updatedAt: 0,
    gifts: [],
    source: GIFT_LIST_URL,
    error: null,
    lastUpdateText: null,
};

app.get('/config', (_req, res) => {
    res.json({
        streamUrl: STREAM_URL,
        streamSecret: STREAM_SECRET,
    });
});

const fetchUrl = (url) => new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, (res) => {
        if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`Gift list fetch failed: ${res.statusCode}`));
            return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
            body += chunk;
        });
        res.on('end', () => resolve(body));
    });
    req.on('error', reject);
});

const stripTags = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

const parseGiftList = (html) => {
    const text = stripTags(html);
    const tokens = text
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);

    const gifts = [];
    for (let i = 0; i < tokens.length - 2; i += 1) {
        const coinValue = Number(tokens[i]);
        const name = tokens[i + 1];
        const idToken = tokens[i + 2];

        if (!Number.isFinite(coinValue)) continue;
        if (!name) continue;
        if (!/^#\d+$/.test(idToken)) continue;

        gifts.push({
            id: idToken.slice(1),
            name,
            coins: coinValue,
        });
        i += 2;
    }

    const updateMatch = text.match(/Last update:\s*([0-9.\-/]+)/i);
    const lastUpdateText = updateMatch ? updateMatch[1] : null;

    return { gifts, lastUpdateText };
};

const refreshGiftList = async () => {
    const html = await fetchUrl(GIFT_LIST_URL);
    const parsed = parseGiftList(html);
    if (!parsed.gifts.length) {
        throw new Error('Gift list parse returned 0 items');
    }
    giftCache.gifts = parsed.gifts;
    giftCache.updatedAt = Date.now();
    giftCache.error = null;
    giftCache.lastUpdateText = parsed.lastUpdateText;
};

app.get('/gifts', async (req, res) => {
    const forceRefresh = req.query.refresh === '1';
    const stale = Date.now() - giftCache.updatedAt > GIFT_LIST_CACHE_MS;

    if (forceRefresh || giftCache.gifts.length === 0 || stale) {
        try {
            await refreshGiftList();
        } catch (err) {
            giftCache.error = err.message || String(err);
        }
    }

    res.json({
        source: giftCache.source,
        updatedAt: giftCache.updatedAt || null,
        lastUpdateText: giftCache.lastUpdateText,
        gifts: giftCache.gifts,
        error: giftCache.error,
    });
});

const sanitizeFileName = (value) =>
    String(value || '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^_+/, '')
        .slice(0, 120);

app.post('/upload-sound', (req, res) => {
    fs.mkdirSync(SOUNDS_DIR, { recursive: true });

    const busboy = new Busboy({ headers: req.headers });
    let fileName = null;
    let fileSaved = false;

    busboy.on('file', (_fieldname, file, info) => {
        const original = info.filename || 'sound';
        const ext = path.extname(original).toLowerCase() || '.mp3';
        const safeBase = sanitizeFileName(path.basename(original, ext));
        fileName = `${safeBase}${ext}`;
        const filePath = path.join(SOUNDS_DIR, fileName);
        const stream = fs.createWriteStream(filePath);
        file.pipe(stream);
        stream.on('close', () => {
            fileSaved = true;
        });
    });

    busboy.on('finish', () => {
        if (!fileSaved || !fileName) {
            res.status(400).json({ ok: false, message: 'No file uploaded.' });
            return;
        }
        res.json({ ok: true, fileName, url: `/sounds/${fileName}` });
    });

    req.pipe(busboy);
});

const buildStreamUrl = () => {
    const url = new URL(STREAM_URL);
    if ((!url.pathname || url.pathname === '/') && !url.pathname.endsWith('/stream')) {
        url.pathname = `${url.pathname || ''}/stream`;
    }
    if (STREAM_SECRET && !url.searchParams.get('secret')) {
        url.searchParams.set('secret', STREAM_SECRET);
    }
    return url;
};

app.get('/stream', (req, res) => {
    const streamUrl = buildStreamUrl();
    const isHttps = streamUrl.protocol === 'https:';

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    console.log(`[agent] connecting to relay stream: ${streamUrl.toString()}`);

    const upstreamReq = (isHttps ? https : http).request(
        streamUrl,
        { headers: { Accept: 'text/event-stream' } },
        (upstreamRes) => {
            console.log(`[agent] relay stream status: ${upstreamRes.statusCode}`);
            if (upstreamRes.statusCode !== 200) {
                res.write(`event: error\ndata: ${JSON.stringify({ status: upstreamRes.statusCode })}\n\n`);
                res.end();
                upstreamRes.resume();
                return;
            }

            upstreamRes.on('data', (chunk) => {
                res.write(chunk);
            });

            upstreamRes.on('end', () => {
                console.log('[agent] relay stream ended');
                res.end();
            });
        }
    );

    upstreamReq.on('error', (err) => {
        console.error('[agent] relay stream error:', err.message || err);
        try {
            res.write(`event: error\ndata: ${JSON.stringify({ message: err.message || String(err) })}\n\n`);
        } catch (writeErr) {
            // Ignore write errors when client is gone.
        }
        res.end();
    });

    upstreamReq.end();

    req.on('close', () => {
        upstreamReq.destroy();
        res.end();
    });
});

app.listen(PORT, () => {
    console.log(`[agent] dashboard listening on :${PORT}`);
});
