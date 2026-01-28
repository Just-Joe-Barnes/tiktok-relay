const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const Busboy = require('busboy');
const EventSource = require('eventsource');
const OBSWebSocket = require('obs-websocket-js').default;
const WebSocket = require('ws');
const { URL } = require('url');

require('dotenv').config();

const app = express();
const PORT = Math.max(1, parseInt(process.env.AGENT_PORT || '5177', 10));
const STREAM_URL = process.env.AGENT_STREAM_URL || 'http://localhost:3000/stream';
const STREAM_SECRET = process.env.STREAM_SECRET || '';
const GIFT_LIST_URL = process.env.GIFT_LIST_URL || 'https://mcstreams.com/gifts';
const GIFT_LIST_CACHE_MS = Math.max(60_000, parseInt(process.env.GIFT_LIST_CACHE_MS || '43200000', 10));
const SOUNDS_DIR = path.join(__dirname, 'public', 'sounds');
const DATA_DIR = path.join(__dirname, 'data');
const RULES_FILE = path.join(DATA_DIR, 'obs-rules.json');
const OBS_WS_URL = process.env.OBS_WS_URL || 'ws://localhost:4455';
const OBS_WS_PASSWORD = process.env.OBS_WS_PASSWORD || '';
const OBS_AUTO_CONNECT = process.env.OBS_AUTO_CONNECT !== 'false';
const STREAMERBOT_WS_URL = process.env.STREAMERBOT_WS_URL || 'ws://127.0.0.1:8080/';
const STREAMERBOT_WS_PASSWORD = process.env.STREAMERBOT_WS_PASSWORD || '';
const STREAMERBOT_AUTO_CONNECT = process.env.STREAMERBOT_AUTO_CONNECT !== 'false';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const giftCache = {
    updatedAt: 0,
    gifts: [],
    source: GIFT_LIST_URL,
    error: null,
    lastUpdateText: null,
};

const obs = new OBSWebSocket();
let obsConnected = false;
let obsLastError = null;
let obsConnecting = false;

const ruleState = {
    rules: [],
};

let sbSocket = null;
let sbConnected = false;
let sbLastError = null;
let sbRequestId = 1;
const sbPending = new Map();

app.get('/config', (_req, res) => {
    res.json({
        streamUrl: STREAM_URL,
        streamSecret: STREAM_SECRET,
    });
});

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const loadRules = () => {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (!fs.existsSync(RULES_FILE)) {
            ruleState.rules = [];
            return;
        }
        const raw = fs.readFileSync(RULES_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        ruleState.rules = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn('[agent] failed to load rules:', err.message || err);
        ruleState.rules = [];
    }
};

const saveRules = () => {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(RULES_FILE, JSON.stringify(ruleState.rules, null, 2));
    } catch (err) {
        console.warn('[agent] failed to save rules:', err.message || err);
    }
};

const connectObs = async () => {
    if (!OBS_AUTO_CONNECT || obsConnected || obsConnecting) return;
    obsConnecting = true;
    try {
        await obs.connect(OBS_WS_URL, OBS_WS_PASSWORD || undefined);
        obsConnected = true;
        obsLastError = null;
        console.log('[agent] OBS connected');
    } catch (err) {
        obsLastError = err.message || String(err);
        console.warn('[agent] OBS connect failed:', obsLastError);
    } finally {
        obsConnecting = false;
    }
};

obs.on('ConnectionClosed', () => {
    obsConnected = false;
    console.warn('[agent] OBS disconnected');
});

const sendSbRequest = (payload) => new Promise((resolve, reject) => {
    if (!sbConnected || !sbSocket || sbSocket.readyState !== WebSocket.OPEN) {
        reject(new Error('Streamer.bot not connected'));
        return;
    }
    const id = payload.id || `sb_${sbRequestId++}`;
    payload.id = id;
    sbPending.set(id, { resolve, reject, createdAt: Date.now() });
    sbSocket.send(JSON.stringify(payload));
});

const connectStreamerBot = () => {
    if (!STREAMERBOT_AUTO_CONNECT || sbConnected || sbSocket) return;
    sbLastError = null;
    sbSocket = new WebSocket(STREAMERBOT_WS_URL);

    sbSocket.on('open', () => {
        sbConnected = true;
        console.log('[agent] Streamer.bot connected');
        if (STREAMERBOT_WS_PASSWORD) {
            // If auth is required, streamer.bot expects an Authenticate request.
            sendSbRequest({ request: 'Authenticate', password: STREAMERBOT_WS_PASSWORD })
                .catch((err) => {
                    sbLastError = err.message || String(err);
                    console.warn('[agent] Streamer.bot auth failed:', sbLastError);
                });
        }
    });

    sbSocket.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            if (message?.id && sbPending.has(message.id)) {
                const pending = sbPending.get(message.id);
                sbPending.delete(message.id);
                if (message.status === 'error' || message.error) {
                    pending.reject(new Error(message.error || 'Streamer.bot error'));
                } else {
                    pending.resolve(message);
                }
            }
        } catch (err) {
            // ignore malformed payloads
        }
    });

    sbSocket.on('close', () => {
        sbConnected = false;
        sbSocket = null;
        console.warn('[agent] Streamer.bot disconnected');
    });

    sbSocket.on('error', (err) => {
        sbLastError = err.message || String(err);
        console.warn('[agent] Streamer.bot error:', sbLastError);
    });
};

const getStreamerBotActions = async () => {
    const response = await sendSbRequest({ request: 'GetActions' });
    return response.actions || [];
};

const doStreamerBotAction = async ({ id, name, args }) => {
    const action = {};
    if (id) action.id = id;
    if (name) action.name = name;
    if (!action.id && !action.name) {
        throw new Error('Missing Streamer.bot action id or name');
    }
    await sendSbRequest({ request: 'DoAction', action, args: args || {} });
};

const ensureObs = async () => {
    if (!obsConnected) {
        await connectObs();
    }
    if (!obsConnected) {
        throw new Error('OBS not connected');
    }
};

const toggleSceneItem = async ({ sceneName, sceneItemId, enabled }) => {
    if (enabled === undefined) {
        const current = await obs.call('GetSceneItemEnabled', { sceneName, sceneItemId });
        enabled = !current.sceneItemEnabled;
    }
    await obs.call('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: enabled });
};

const toggleFilter = async ({ sourceName, filterName, enabled }) => {
    if (enabled === undefined) {
        const current = await obs.call('GetSourceFilter', { sourceName, filterName });
        enabled = !current.filterEnabled;
    }
    await obs.call('SetSourceFilterEnabled', { sourceName, filterName, filterEnabled: enabled });
};

const playMedia = async ({ sourceName }) => {
    await obs.call('TriggerMediaInputAction', {
        inputName: sourceName,
        mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART',
    });
};

const runObsAction = async (action) => {
    await ensureObs();
    switch (action.type) {
        case 'switchScene':
            await obs.call('SetCurrentProgramScene', { sceneName: action.sceneName });
            break;
        case 'showSource':
            await toggleSceneItem({ sceneName: action.sceneName, sceneItemId: action.sceneItemId, enabled: true });
            break;
        case 'hideSource':
            await toggleSceneItem({ sceneName: action.sceneName, sceneItemId: action.sceneItemId, enabled: false });
            break;
        case 'toggleSource':
            await toggleSceneItem({ sceneName: action.sceneName, sceneItemId: action.sceneItemId });
            break;
        case 'toggleFilter':
            await toggleFilter({ sourceName: action.sourceName, filterName: action.filterName });
            break;
        case 'playMedia':
            await playMedia({ sourceName: action.sourceName });
            break;
        default:
            throw new Error(`Unknown action: ${action.type}`);
    }
};

const runStreamerBotAction = async (action) => {
    if (!sbConnected) {
        connectStreamerBot();
    }
    if (!sbConnected) {
        throw new Error('Streamer.bot not connected');
    }
    await doStreamerBotAction({
        id: action.actionId,
        name: action.actionName,
        args: action.args || {},
    });
};

const applyRules = async (event) => {
    const rules = ruleState.rules.filter((rule) => rule.enabled !== false);
    if (!rules.length) return;

    const eventType = normalizeText(event.eventType);
    const giftName = normalizeText(event.giftName);
    const command = normalizeText(event.command);

    for (const rule of rules) {
        const match = rule.match || {};
        if (normalizeText(match.type) !== eventType) continue;
        const expected = normalizeText(match.value);
        if (match.field === 'giftName' && expected && giftName !== expected) continue;
        if (match.field === 'command' && expected && command !== expected) continue;

        try {
            if (rule.action?.type === 'streamerbotAction') {
                await runStreamerBotAction(rule.action);
            } else {
                await runObsAction(rule.action || {});
            }
            console.log(`[agent] rule fired: ${rule.name || rule.id}`);
        } catch (err) {
            console.warn('[agent] rule failed:', err.message || err);
        }
    }
};

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

app.get('/sb/status', (_req, res) => {
    res.json({
        connected: sbConnected,
        url: STREAMERBOT_WS_URL,
        lastError: sbLastError,
    });
});

app.get('/sb/actions', async (_req, res) => {
    try {
        connectStreamerBot();
        const actions = await getStreamerBotActions();
        res.json({ actions });
    } catch (err) {
        res.status(500).json({ message: err.message || err });
    }
});

app.get('/obs/status', (_req, res) => {
    res.json({
        connected: obsConnected,
        url: OBS_WS_URL,
        lastError: obsLastError,
    });
});

app.get('/obs/scenes', async (_req, res) => {
    try {
        await ensureObs();
        const result = await obs.call('GetSceneList');
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: err.message || err });
    }
});

app.get('/obs/scene-items', async (req, res) => {
    try {
        await ensureObs();
        const sceneName = req.query.scene;
        if (!sceneName) {
            return res.status(400).json({ message: 'Missing scene parameter.' });
        }
        const result = await obs.call('GetSceneItemList', { sceneName });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ message: err.message || err });
    }
});

app.get('/obs/filters', async (req, res) => {
    try {
        await ensureObs();
        const sourceName = req.query.source;
        if (!sourceName) {
            return res.status(400).json({ message: 'Missing source parameter.' });
        }
        const result = await obs.call('GetSourceFilterList', { sourceName });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ message: err.message || err });
    }
});

app.get('/rules', (_req, res) => {
    res.json(ruleState.rules);
});

app.post('/rules', (req, res) => {
    const payload = req.body || {};
    if (!payload.match || !payload.action) {
        return res.status(400).json({ message: 'Missing match or action.' });
    }
    const id = payload.id || `rule_${Date.now()}`;
    const existingIndex = ruleState.rules.findIndex((rule) => rule.id === id);
    const entry = { ...payload, id };
    if (existingIndex >= 0) {
        ruleState.rules[existingIndex] = entry;
    } else {
        ruleState.rules.push(entry);
    }
    saveRules();
    return res.json(entry);
});

app.delete('/rules/:id', (req, res) => {
    const { id } = req.params;
    const before = ruleState.rules.length;
    ruleState.rules = ruleState.rules.filter((rule) => rule.id !== id);
    if (ruleState.rules.length !== before) {
        saveRules();
    }
    res.json({ ok: true });
});

const startRelayListener = () => {
    const streamUrl = buildStreamUrl();
    const source = new EventSource(streamUrl.toString());

    source.addEventListener('open', () => {
        console.log('[agent] relay listener connected');
    });

    source.addEventListener('event', async (message) => {
        try {
            const event = JSON.parse(message.data);
            await applyRules(event);
        } catch (err) {
            console.warn('[agent] relay listener parse error:', err.message || err);
        }
    });

    source.addEventListener('error', () => {
        console.warn('[agent] relay listener error, reconnecting in 5s');
        source.close();
        setTimeout(startRelayListener, 5000);
    });
};

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
    loadRules();
    connectObs();
    connectStreamerBot();
    startRelayListener();
});
