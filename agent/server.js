const express = require('express');
const http = require('http');
const { randomUUID } = require('crypto');
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
const TIKFINITY_WS_URL = process.env.TIKFINITY_WS_URL || '';
const EVENT_SOURCE = (process.env.EVENT_SOURCE || (TIKFINITY_WS_URL ? 'tikfinity' : 'relay')).trim().toLowerCase();
const COMMAND_PREFIXES = (process.env.COMMAND_PREFIXES || '!')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const AGENT_STREAM_BUFFER_MAX = Math.max(0, parseInt(process.env.AGENT_STREAM_BUFFER_MAX || '200', 10));
const DEFAULT_GIFT_LIST_URL = 'https://www.beetgames.com/gift_data.js';
const GIFT_LIST_URL = process.env.GIFT_LIST_URL || DEFAULT_GIFT_LIST_URL;
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
const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL || '';

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

const likeState = {
    totalLikes: 0,
    lastThresholdByRule: new Map(),
};
let sbSocket = null;
let sbConnected = false;
let sbLastError = null;
let sbRequestId = 1;
const sbPending = new Map();

let relayConnected = false;
let lastRelayEventAt = null;
let tikfinitySocket = null;
let tikfinityConnected = false;
let tikfinityLastError = null;
let tikfinityReconnectTimer = null;

const streamClients = new Set();
const streamBuffer = [];

app.get('/config', (_req, res) => {
    res.json({
        streamUrl: STREAM_URL,
        streamSecret: STREAM_SECRET,
        source: EVENT_SOURCE,
    });
});

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const enqueueStreamEvent = (event) => {
    if (!event) return;
    streamBuffer.push(event);
    if (AGENT_STREAM_BUFFER_MAX > 0) {
        while (streamBuffer.length > AGENT_STREAM_BUFFER_MAX) {
            streamBuffer.shift();
        }
    }
    const payload = `event: event\ndata: ${JSON.stringify(event)}\n\n`;
    streamClients.forEach((client) => {
        try {
            client.res.write(payload);
        } catch (err) {
            streamClients.delete(client);
        }
    });
};

const parseCommandsFromChat = (message) => {
    if (!message) return [];
    if (!COMMAND_PREFIXES.length) return [];
    const trimmed = String(message).trim();
    const commands = [];
    for (const prefix of COMMAND_PREFIXES) {
        if (!prefix) continue;
        if (trimmed.startsWith(prefix)) {
            const command = trimmed.slice(prefix.length).trim().split(/\s+/)[0];
            if (command) commands.push(command);
        }
    }
    return commands;
};

const handleIncomingEvent = async (event) => {
    if (!event || !event.eventType) return;

    if (normalizeText(event.eventType) === 'like') {
        const count = Number(event.totalLikeCount || 0);
        if (Number.isFinite(count) && count > likeState.totalLikes) {
            likeState.totalLikes = count;
        } else {
            likeState.totalLikes += Number(event.likeCount || 1);
        }
        event.totalLikeCount = likeState.totalLikes;
    }

    lastRelayEventAt = new Date().toISOString();
    enqueueStreamEvent(event);
    await applyRules(event);

    if (normalizeText(event.eventType) === 'chat' && !event.command) {
        const commands = parseCommandsFromChat(event.message);
        for (const command of commands) {
            const commandEvent = {
                ...event,
                id: `${event.id || 'cmd'}-${command}`,
                eventType: 'command',
                command,
            };
            enqueueStreamEvent(commandEvent);
            await applyRules(commandEvent);
        }
    }
};

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
    const totalLikeCount = Number(event.totalLikeCount || 0);

    for (const rule of rules) {
        const match = rule.match || {};
        const matchType = normalizeText(match.type);
        if (matchType !== eventType) continue;
        const expected = normalizeText(match.value);
        if (match.field === 'giftName' && expected && giftName !== expected) continue;
        if (match.field === 'command' && expected && command !== expected) continue;

        if (matchType === 'like_total') {
            const threshold = Number(match.value || 0);
            if (!Number.isFinite(threshold) || threshold <= 0) continue;
            if (totalLikeCount < threshold) continue;

            const last = likeState.lastThresholdByRule.get(rule.id) || 0;
            if (totalLikeCount < last + threshold) {
                continue;
            }
            likeState.lastThresholdByRule.set(rule.id, totalLikeCount);
        }

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

const parseGiftDataJs = (body) => {
    const start = body.indexOf('[');
    const end = body.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('Gift data JSON block not found');
    }
    const json = body.slice(start, end + 1);
    const data = JSON.parse(json);
    const gifts = data
        .map((gift, index) => ({
            id: gift.id ? String(gift.id) : String(index + 1),
            name: gift.name,
            coins: Number(gift.coins) || 0,
            imageUrl: gift.src_url || gift.imageUrl || gift.image || null,
            localPath: gift.local_path || null,
        }))
        .filter((gift) => gift.name);
    return { gifts, lastUpdateText: null };
};

const parseGiftListFromHtml = (html) => {
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

const parseGiftList = (body) => {
    if (body.includes('giftData') || body.includes('src_url')) {
        return parseGiftDataJs(body);
    }
    return parseGiftListFromHtml(body);
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

const checkBackendHealth = async () => {
    if (!HEALTHCHECK_URL) return { ok: null, status: null };
    const url = HEALTHCHECK_URL;
    const client = url.startsWith('https:') ? https : http;
    return new Promise((resolve) => {
        const req = client.get(url, (response) => {
            response.resume();
            resolve({ ok: response.statusCode >= 200 && response.statusCode < 500, status: response.statusCode });
        });
        req.on('error', () => resolve({ ok: false, status: null }));
        req.setTimeout(4000, () => {
            req.destroy();
            resolve({ ok: false, status: null });
        });
    });
};

app.get('/status', async (_req, res) => {
    const backend = await checkBackendHealth();
    res.json({
        source: EVENT_SOURCE,
        relay: {
            connected: EVENT_SOURCE === 'relay' ? relayConnected : tikfinityConnected,
            lastEventAt: lastRelayEventAt,
        },
        tikfinity: {
            connected: tikfinityConnected,
            lastError: tikfinityLastError,
            url: TIKFINITY_WS_URL,
        },
        streamerbot: {
            connected: sbConnected,
            lastError: sbLastError,
        },
        obs: {
            connected: obsConnected,
            lastError: obsLastError,
        },
        backend,
    });
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

app.post('/test-event', async (req, res) => {
    const payload = req.body || {};
    if (!payload.eventType) {
        return res.status(400).json({ message: 'Missing eventType.' });
    }
    try {
        await applyRules(payload);
        return res.json({ ok: true });
    } catch (err) {
        return res.status(500).json({ message: err.message || err });
    }
});

app.post('/test-tikfinity', async (req, res) => {
    const { eventType, value } = req.body || {};
    if (!eventType) {
        return res.status(400).json({ message: 'Missing eventType.' });
    }

    const base = {
        id: `tikfinity-test-${Date.now()}`,
        platform: 'tiktok',
        eventType,
        userId: 'tikfinity-test',
        username: 'tikfinity-test',
        receivedAt: new Date().toISOString(),
    };

    let event = { ...base };
    const normalizedType = normalizeText(eventType);
    const trimmedValue = String(value || '').trim();

    if (normalizedType === 'gift') {
        event = {
            ...base,
            giftName: trimmedValue || 'Rose',
            giftId: trimmedValue ? normalizeText(trimmedValue) : 'rose',
            coins: 1,
            repeatCount: 1,
            repeatEnd: true,
            giftType: 0,
        };
    } else if (normalizedType === 'chat') {
        event = {
            ...base,
            message: trimmedValue || 'Test chat from Tikfinity',
        };
    } else if (normalizedType === 'like') {
        const likeCount = Number(trimmedValue || 1);
        event = {
            ...base,
            likeCount: Number.isFinite(likeCount) ? likeCount : 1,
        };
    }

    try {
        await handleIncomingEvent(event);
        return res.json({ ok: true });
    } catch (err) {
        return res.status(500).json({ message: err.message || err });
    }
});

app.post('/rules/:id/test', async (req, res) => {
    const { id } = req.params;
    const rule = ruleState.rules.find((entry) => entry.id === id);
    if (!rule) {
        return res.status(404).json({ message: 'Rule not found.' });
    }

    const eventType = normalizeText(rule.match?.type || 'gift');
    const value = rule.match?.value || '';
    const event = {
        id: `test-${id}`,
        platform: 'tiktok',
        eventType,
        giftName: eventType === 'gift' ? value : undefined,
        command: eventType === 'command' ? value : undefined,
        receivedAt: new Date().toISOString(),
    };

    try {
        await applyRules(event);
        return res.json({ ok: true });
    } catch (err) {
        return res.status(500).json({ message: err.message || err });
    }
});

const startRelayListener = () => {
    if (EVENT_SOURCE !== 'relay') return;
    const streamUrl = buildStreamUrl();
    const source = new EventSource(streamUrl.toString());

    source.addEventListener('open', () => {
        relayConnected = true;
        console.log('[agent] relay listener connected');
    });

    source.addEventListener('event', async (message) => {
        try {
            const event = JSON.parse(message.data);
            await handleIncomingEvent(event);
        } catch (err) {
            console.warn('[agent] relay listener parse error:', err.message || err);
        }
    });

    source.addEventListener('error', () => {
        relayConnected = false;
        console.warn('[agent] relay listener error, reconnecting in 5s');
        source.close();
        setTimeout(startRelayListener, 5000);
    });
};

const mapTikfinityEvent = (payload) => {
    if (!payload || !payload.event) return null;
    const eventType = normalizeText(payload.event);
    const data = payload.data || {};
    const userId = data.userId || data.uniqueId || data.user?.userId || data.user?.uniqueId || null;
    const username = data.uniqueId || data.user?.uniqueId || data.nickname || data.user?.nickname || null;
    const base = {
        id: data.msgId || data.eventId || `tikfinity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        platform: 'tiktok',
        eventType,
        userId,
        username,
        receivedAt: new Date().toISOString(),
        raw: data,
    };

    if (eventType === 'chat') {
        return {
            ...base,
            message: data.comment || data.message || '',
        };
    }

    if (eventType === 'gift') {
        return {
            ...base,
            giftName: data.giftName || data.gift?.giftName || null,
            giftId: data.giftId || data.gift?.giftId || null,
            coins: data.diamondCount || data.gift?.diamondCount || data.diamondCountTotal || 0,
            repeatCount: data.repeatCount || 1,
            repeatEnd: data.repeatEnd ?? true,
            giftType: data.giftType || 0,
        };
    }

    if (eventType === 'like') {
        return {
            ...base,
            likeCount: data.likeCount || data.count || 1,
            totalLikeCount: data.totalLikeCount || data.total || null,
        };
    }

    return base;
};

const scheduleTikfinityReconnect = () => {
    if (tikfinityReconnectTimer) return;
    tikfinityReconnectTimer = setTimeout(() => {
        tikfinityReconnectTimer = null;
        startTikfinityListener();
    }, 5000);
};

const startTikfinityListener = () => {
    if (EVENT_SOURCE !== 'tikfinity') return;
    if (!TIKFINITY_WS_URL) {
        tikfinityLastError = 'Missing TIKFINITY_WS_URL';
        console.warn('[agent] Tikfinity WS URL missing');
        return;
    }
    if (tikfinitySocket) return;

    console.log(`[agent] connecting to Tikfinity: ${TIKFINITY_WS_URL}`);
    tikfinitySocket = new WebSocket(TIKFINITY_WS_URL);

    tikfinitySocket.on('open', () => {
        tikfinityConnected = true;
        tikfinityLastError = null;
        console.log('[agent] Tikfinity connected');
    });

    tikfinitySocket.on('message', async (data) => {
        try {
            const payload = JSON.parse(data.toString());
            const event = mapTikfinityEvent(payload);
            if (event) {
                await handleIncomingEvent(event);
            }
        } catch (err) {
            console.warn('[agent] Tikfinity parse error:', err.message || err);
        }
    });

    tikfinitySocket.on('close', () => {
        tikfinityConnected = false;
        tikfinitySocket = null;
        console.warn('[agent] Tikfinity disconnected, reconnecting in 5s');
        scheduleTikfinityReconnect();
    });

    tikfinitySocket.on('error', (err) => {
        tikfinityLastError = err.message || String(err);
        console.warn('[agent] Tikfinity error:', tikfinityLastError);
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
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const client = { id: randomUUID(), res };
    streamClients.add(client);

    res.write(`event: hello\ndata: ${JSON.stringify({ id: client.id, source: EVENT_SOURCE })}\n\n`);
    if (streamBuffer.length) {
        res.write(`event: snapshot\ndata: ${JSON.stringify(streamBuffer)}\n\n`);
    }

    req.on('close', () => {
        streamClients.delete(client);
        res.end();
    });
});

app.listen(PORT, () => {
    console.log(`[agent] dashboard listening on :${PORT}`);
    loadRules();
    connectObs();
    connectStreamerBot();
    startRelayListener();
    startTikfinityListener();
});
