const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { WebcastPushConnection, SignConfig } = require('tiktok-live-connector');

require('dotenv').config();

const {
    TIKTOK_USERNAME,
    TIKTOK_SESSION_ID,
    TIKTOK_TT_TARGET_IDC,
    TIKTOK_CONNECT_WITH_UNIQUE_ID,
    TIKTOK_FETCH_ROOMINFO,
    TIKTOK_FORCE_CONNECT,
    TIKTOK_CONNECT_FALLBACK,
    TIKTOK_SIGN_API_KEY,
    API_BASE_URL,
    RELAY_SECRET,
    STREAMER_ID,
    EVENT_ENDPOINT = '/api/external/event',
    PORT = 3000,
    LOG_DIR = 'logs',
    LOG_TO_FILE,
    LOG_INCLUDE_RAW,
    POST_INCLUDE_RAW,
    LOG_EVENT_TYPES,
    FORWARD_EVENT_TYPES,
    BUFFER_FLUSH_MS,
    BUFFER_MAX_EVENTS,
    COMMAND_PREFIXES,
    COMMAND_MAX_PER_MESSAGE,
    EMIT_COMMAND_EVENTS,
    POST_TIMEOUT_MS,
    MAX_RETRY_ATTEMPTS,
    LOG_CONTROL_EVENTS,
    LOG_RAW_DATA,
    LOG_DECODED_DATA,
    HEALTH_LOG_INTERVAL_MS,
} = process.env;

const RECONNECT_DELAY_MS = parseInt(process.env.RECONNECT_DELAY_MS || '30000', 10);

if (!TIKTOK_USERNAME || !API_BASE_URL || !RELAY_SECRET) {
    console.error('Missing required env vars: TIKTOK_USERNAME, API_BASE_URL, RELAY_SECRET');
    process.exit(1);
}

const app = express();

app.get('/health', (req, res) => {
    res.status(200).json({ ok: true });
});

const normalizeBaseUrl = (baseUrl) => baseUrl.replace(/\/+$/, '');

const buildEndpoint = () => {
    const base = normalizeBaseUrl(API_BASE_URL);
    const pathValue = EVENT_ENDPOINT.startsWith('/') ? EVENT_ENDPOINT : `/${EVENT_ENDPOINT}`;
    return `${base}${pathValue}`;
};

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return fallback;
};

const parseList = (value, fallback = []) => {
    if (value === undefined || value === null || value === '') return fallback;
    return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
};

const parseEventFilter = (value, fallback) => {
    const list = parseList(value, fallback);
    if (!list.length || list.includes('*')) return null;
    return new Set(list.map((item) => item.toLowerCase()));
};

const normalizeEventType = (eventType) => {
    if (!eventType) return null;
    return String(eventType)
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/\s+/g, '_')
        .toLowerCase();
};

const safeJsonStringify = (value) =>
    JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val));

const LOG_TO_FILE_ENABLED = parseBoolean(LOG_TO_FILE, true);
const LOG_INCLUDE_RAW_ENABLED = parseBoolean(LOG_INCLUDE_RAW, true);
const POST_INCLUDE_RAW_ENABLED = parseBoolean(POST_INCLUDE_RAW, false);
const LOG_CONTROL_EVENTS_ENABLED = parseBoolean(LOG_CONTROL_EVENTS, true);
const LOG_RAW_DATA_ENABLED = parseBoolean(LOG_RAW_DATA, false);
const LOG_DECODED_DATA_ENABLED = parseBoolean(LOG_DECODED_DATA, false);
const EMIT_COMMAND_EVENTS_ENABLED = parseBoolean(EMIT_COMMAND_EVENTS, true);

const BUFFER_FLUSH_MS_VALUE = Math.max(250, parseInt(BUFFER_FLUSH_MS || '3000', 10));
const BUFFER_MAX_EVENTS_VALUE = Math.max(10, parseInt(BUFFER_MAX_EVENTS || '200', 10));
const POST_TIMEOUT_MS_VALUE = Math.max(1000, parseInt(POST_TIMEOUT_MS || '5000', 10));
const MAX_RETRY_ATTEMPTS_VALUE = Math.max(0, parseInt(MAX_RETRY_ATTEMPTS || '3', 10));
const HEALTH_LOG_INTERVAL_MS_VALUE = Math.max(0, parseInt(HEALTH_LOG_INTERVAL_MS || '60000', 10));

const COMMAND_PREFIXES_LIST = parseList(COMMAND_PREFIXES, ['!']);
const COMMAND_MAX_PER_MESSAGE_VALUE = Math.max(1, parseInt(COMMAND_MAX_PER_MESSAGE || '5', 10));

const LOG_EVENT_FILTER = parseEventFilter(LOG_EVENT_TYPES, ['*']);
const FORWARD_EVENT_FILTER = parseEventFilter(FORWARD_EVENT_TYPES, ['gift']);

const INCLUDE_RAW = LOG_INCLUDE_RAW_ENABLED || POST_INCLUDE_RAW_ENABLED;

const shouldLogEvent = (eventType) => {
    if (!LOG_TO_FILE_ENABLED) return false;
    if (!LOG_EVENT_FILTER) return true;
    return LOG_EVENT_FILTER.has(String(eventType || '').toLowerCase());
};

const shouldForwardEvent = (eventType) => {
    if (!FORWARD_EVENT_FILTER) return true;
    return FORWARD_EVENT_FILTER.has(String(eventType || '').toLowerCase());
};

let logStream = null;
let logDate = null;

const ensureLogStream = () => {
    if (!LOG_TO_FILE_ENABLED) return null;
    const currentDate = new Date().toISOString().slice(0, 10);
    if (logStream && logDate === currentDate) return logStream;

    if (logStream) {
        try {
            logStream.end();
        } catch (err) {
            console.warn('[relay] failed to close log stream:', err.message || err);
        }
    }

    fs.mkdirSync(LOG_DIR, { recursive: true });
    const fileName = `tiktok-relay-${currentDate}.jsonl`;
    const filePath = path.join(LOG_DIR, fileName);
    logStream = fs.createWriteStream(filePath, { flags: 'a' });
    logDate = currentDate;
    return logStream;
};

const stripRawFields = (payload) => {
    const { raw, rawData, decodedData, ...rest } = payload;
    return rest;
};

const stripInternalFields = (payload) => {
    const { _attempts, _skipForward, ...rest } = payload;
    return rest;
};

const logEvent = (payload) => {
    if (!shouldLogEvent(payload.eventType)) return;
    const stream = ensureLogStream();
    if (!stream) return;
    const entry = LOG_INCLUDE_RAW_ENABLED ? payload : stripRawFields(payload);
    const sanitized = stripInternalFields(entry);
    stream.write(`${safeJsonStringify({ ...sanitized, loggedAt: new Date().toISOString() })}\n`);
};

const logSystem = (message, details) => {
    if (!LOG_TO_FILE_ENABLED) return;
    const stream = ensureLogStream();
    if (!stream) return;
    const entry = {
        type: 'system',
        message,
        details: details || null,
        loggedAt: new Date().toISOString(),
    };
    stream.write(`${safeJsonStringify(entry)}\n`);
};

const pickFirst = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const extractUser = (data) => {
    if (!data) return { userId: null, uniqueId: null, secUid: null, nickname: null };
    const user = data.user || {};
    const userId = pickFirst(
        data.userId,
        user.userId,
        data.user_id,
        user.user_id,
        data.secUid,
        user.secUid,
        data.uniqueId,
        user.uniqueId
    );
    const uniqueId = pickFirst(data.uniqueId, user.uniqueId);
    const secUid = pickFirst(data.secUid, user.secUid);
    const nickname = pickFirst(data.nickname, user.nickname);
    const profilePictureUrl = pickFirst(
        data.profilePictureUrl,
        user.profilePictureUrl,
        user.avatarThumb && user.avatarThumb.urlList ? user.avatarThumb.urlList[0] : null,
        user.avatar && user.avatar.urlList ? user.avatar.urlList[0] : null
    );

    return {
        userId: userId || null,
        uniqueId: uniqueId || null,
        secUid: secUid || null,
        nickname: nickname || null,
        profilePictureUrl: profilePictureUrl || null,
        isModerator: pickFirst(data.isModerator, user.isModerator) ?? null,
        followRole: pickFirst(data.followRole, user.followRole) ?? null,
        isSubscriber: pickFirst(data.isSubscriber, user.isSubscriber) ?? null,
    };
};

const getUserKey = (data) => {
    const user = extractUser(data);
    return user.userId || user.uniqueId || user.secUid || null;
};

const resolveGiftCoins = (data) => {
    if (!data) return 0;

    if (typeof data.diamondCount === 'number') return data.diamondCount;
    if (typeof data.diamond_count === 'number') return data.diamond_count;

    if (data.giftDetails) {
        if (typeof data.giftDetails.diamondCount === 'number') return data.giftDetails.diamondCount;
        if (typeof data.giftDetails.diamond_count === 'number') return data.giftDetails.diamond_count;
    }

    if (data.gift) {
        if (typeof data.gift.diamondCount === 'number') return data.gift.diamondCount;
        if (typeof data.gift.diamond_count === 'number') return data.gift.diamond_count;
    }

    if (data.extendedGiftInfo) {
        if (typeof data.extendedGiftInfo.diamondCount === 'number') return data.extendedGiftInfo.diamondCount;
        if (typeof data.extendedGiftInfo.diamond_count === 'number') return data.extendedGiftInfo.diamond_count;
    }

    return 0;
};

const isGiftStreakInProgress = (data) => Boolean(data && data.giftType === 1 && !data.repeatEnd);

const resolveLikeDelta = (data) => {
    if (!data) return 1;
    if (typeof data.likeCount === 'number') return data.likeCount;
    if (typeof data.like_count === 'number') return data.like_count;
    if (typeof data.likes === 'number') return data.likes;
    return 1;
};

const extractCommands = (message) => {
    if (!message) return [];

    const commands = [];
    COMMAND_PREFIXES_LIST.forEach((prefix) => {
        if (!prefix) return;
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(^|\\s)${escaped}([a-zA-Z0-9_-]+)`, 'g');
        let match = null;
        while ((match = regex.exec(message)) !== null) {
            commands.push({
                name: match[2].toLowerCase(),
                raw: `${prefix}${match[2]}`,
                index: match.index,
            });
            if (commands.length >= COMMAND_MAX_PER_MESSAGE_VALUE) {
                break;
            }
        }
    });

    return commands;
};

let eventSequence = 0;

const buildBaseEvent = (eventType, data, sourceEvent, extra) => {
    const user = extractUser(data);
    const payload = {
        id: randomUUID(),
        sequence: (eventSequence += 1),
        platform: 'tiktok',
        eventType,
        sourceEvent: sourceEvent || eventType,
        streamerId: STREAMER_ID || null,
        userId: user.userId,
        username: user.uniqueId || user.nickname || null,
        receivedAt: new Date().toISOString(),
        user,
        ...(extra || {}),
    };

    if (INCLUDE_RAW) {
        payload.raw = data;
    }

    return payload;
};

const buildGenericEvent = (sourceEvent, data, extra) => {
    const eventType = normalizeEventType(sourceEvent);
    return buildBaseEvent(eventType, data, sourceEvent, extra);
};

const buildGiftEvent = (data) => {
    const streakInProgress = isGiftStreakInProgress(data);
    const eventType = streakInProgress ? 'gift_streak' : 'gift';
    const coinsPerGift = resolveGiftCoins(data);
    const repeatCount = data.repeatCount || 1;
    const totalCoins = coinsPerGift * repeatCount;

    const payload = buildBaseEvent(eventType, data, 'gift', {
        coins: totalCoins,
        giftId: data.giftId || null,
        giftName: data.giftName || null,
        giftType: data.giftType || null,
        repeatCount,
        repeatEnd: data.repeatEnd || false,
        streakInProgress,
        giftDetails: data.giftDetails || data.gift || data.extendedGiftInfo || null,
    });
    if (!totalCoins) {
        payload._skipForward = true;
    }
    return payload;
};

const buildChatEvent = (data) => {
    const message = pickFirst(data.comment, data.message, data.text, data.content);
    const commands = extractCommands(message || '');

    return {
        event: buildBaseEvent('chat', data, 'chat', {
            message: message || null,
            commands: commands.map((command) => command.name),
            commandCount: commands.length,
        }),
        commands,
        message: message || null,
    };
};

const buildCommandEvent = (data, chatEventId, command, message) => {
    return buildBaseEvent('command', data, 'chat', {
        command: command.name,
        commandRaw: command.raw,
        commandIndex: command.index,
        message: message || null,
        parentEventId: chatEventId || null,
    });
};

const buildLikeEvent = (data, totalLikesFromUser) => {
    const likeCount = resolveLikeDelta(data);
    return buildBaseEvent('like', data, 'like', {
        likeCount,
        totalLikesFromUser,
        totalLikeCount: pickFirst(data.totalLikeCount, data.total_like_count, data.likeCount),
    });
};

const resolveSocialAction = (data, sourceEvent) => {
    if (sourceEvent === 'follow' || sourceEvent === 'share') return sourceEvent;
    const displayType = pickFirst(data.displayType, data.label, data.socialType, data.type);
    if (!displayType) return null;
    const normalized = String(displayType).toLowerCase();
    if (normalized.includes('follow')) return 'follow';
    if (normalized.includes('share')) return 'share';
    if (normalized.includes('subscribe')) return 'subscribe';
    return null;
};

const buildSocialEvent = (data, sourceEvent) => {
    const action = resolveSocialAction(data, sourceEvent);
    const eventType = action || normalizeEventType(sourceEvent || 'social');
    return buildBaseEvent(eventType, data, sourceEvent || 'social', {
        action: action || null,
        socialDetails: {
            displayType: data.displayType || null,
            label: data.label || null,
            type: data.type || null,
        },
    });
};

const postEvent = async (payload) => {
    const url = buildEndpoint();

    await axios.post(url, payload, {
        timeout: POST_TIMEOUT_MS_VALUE,
        headers: {
            'x-relay-secret': RELAY_SECRET,
        },
    });
};

const eventQueue = [];
let flushTimer = null;
let flushing = false;

const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushEvents();
    }, BUFFER_FLUSH_MS_VALUE);
};

const enqueueEvent = (payload) => {
    if (shouldLogEvent(payload.eventType)) {
        logEvent(payload);
    }

    if (payload._skipForward || !shouldForwardEvent(payload.eventType)) {
        return;
    }

    eventQueue.push(payload);

    if (eventQueue.length >= BUFFER_MAX_EVENTS_VALUE) {
        void flushEvents();
        return;
    }

    scheduleFlush();
};

const flushEvents = async () => {
    if (flushing || eventQueue.length === 0) return;
    flushing = true;

    const batch = eventQueue.splice(0, eventQueue.length);

    for (const event of batch) {
        const sanitized = stripInternalFields(event);
        const payload = POST_INCLUDE_RAW_ENABLED ? sanitized : stripRawFields(sanitized);

        try {
            await postEvent(payload);
        } catch (err) {
            const attempts = event._attempts || 0;
            if (attempts < MAX_RETRY_ATTEMPTS_VALUE) {
                event._attempts = attempts + 1;
                eventQueue.push(event);
                scheduleFlush();
            } else {
                console.error('[relay] failed to post event:', err.response?.data || err.message || err);
                logSystem('post_failed', {
                    eventId: event.id,
                    eventType: event.eventType,
                    error: err.message || String(err),
                });
            }
        }
    }

    flushing = false;
};

let fallbackAttempted = false;
const userLikeCounts = new Map();

const connectToTikTok = (forceUseUniqueId) => {
    const useUniqueId = typeof forceUseUniqueId === 'boolean'
        ? forceUseUniqueId
        : parseBoolean(TIKTOK_CONNECT_WITH_UNIQUE_ID, false);
    const allowFallback = parseBoolean(TIKTOK_CONNECT_FALLBACK, true);
    const fetchRoomInfoOnConnect = parseBoolean(TIKTOK_FORCE_CONNECT, false)
        ? false
        : parseBoolean(TIKTOK_FETCH_ROOMINFO, true);

    if (TIKTOK_SIGN_API_KEY) {
        SignConfig.apiKey = TIKTOK_SIGN_API_KEY;
    }

    const connection = new WebcastPushConnection(TIKTOK_USERNAME, {
        processInitialData: false,
        enableExtendedGiftInfo: true,
        sessionId: TIKTOK_SESSION_ID || null,
        ttTargetIdc: TIKTOK_TT_TARGET_IDC || null,
        connectWithUniqueId: useUniqueId,
        fetchRoomInfoOnConnect,
    });

    let reconnectTimer = null;

    const scheduleReconnect = (reason) => {
        if (reconnectTimer) return;
        const delaySeconds = Math.max(1, Math.floor(RECONNECT_DELAY_MS / 1000));
        console.warn(`[relay] reconnecting in ${delaySeconds}s (${reason})`);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectNow();
        }, RECONNECT_DELAY_MS);
    };

    const connectNow = () => {
        connection.connect()
            .then(state => {
                console.log(`[relay] connected to ${TIKTOK_USERNAME} (roomId: ${state.roomId}) [uniqueId=${useUniqueId}]`);
                if (LOG_CONTROL_EVENTS_ENABLED) {
                    logSystem('connected', {
                        roomId: state.roomId,
                        uniqueId: TIKTOK_USERNAME,
                        connectWithUniqueId: useUniqueId,
                    });
                }
            })
            .catch(err => {
                const message = err?.message || String(err);
                console.error('[relay] failed to connect:', message);

                const offlineMatch = /offline|not online|room.*not.*found/i.test(message);
                if (allowFallback && offlineMatch && !fallbackAttempted && typeof forceUseUniqueId !== 'boolean') {
                    fallbackAttempted = true;
                    console.warn(`[relay] offline error detected. Retrying with connectWithUniqueId=${!useUniqueId}.`);
                    try {
                        if (typeof connection.disconnect === 'function') {
                            connection.disconnect();
                        }
                    } catch (disconnectError) {
                        console.warn('[relay] error while disconnecting prior connection:', disconnectError?.message || disconnectError);
                    }
                    connectToTikTok(!useUniqueId);
                    return;
                }

                scheduleReconnect('connect-failed');
            });
    };

    connectNow();

    connection.on('gift', async (data) => {
        const payload = buildGiftEvent(data);
        enqueueEvent(payload);

        if (payload.eventType === 'gift') {
            const displayName = payload.username || payload.userId;
            const coins = payload.coins || 0;
            console.log(`[relay] gift from ${displayName} (${coins} coins)`);
        }
    });

    connection.on('chat', (data) => {
        const chat = buildChatEvent(data);
        enqueueEvent(chat.event);

        if (EMIT_COMMAND_EVENTS_ENABLED && chat.commands.length) {
            chat.commands.forEach((command) => {
                enqueueEvent(buildCommandEvent(data, chat.event.id, command, chat.message));
            });
        }
    });

    connection.on('like', (data) => {
        const userKey = getUserKey(data);
        const delta = resolveLikeDelta(data);
        const total = userKey ? (userLikeCounts.get(userKey) || 0) + delta : null;
        if (userKey) {
            userLikeCounts.set(userKey, total);
        }
        enqueueEvent(buildLikeEvent(data, total));
    });

    const socialHandler = (sourceEvent) => (data) => {
        enqueueEvent(buildSocialEvent(data, sourceEvent));
    };

    connection.on('social', socialHandler('social'));
    connection.on('follow', socialHandler('follow'));
    connection.on('share', socialHandler('share'));
    connection.on('subscribe', socialHandler('subscribe'));

    connection.on('member', (data) => {
        enqueueEvent(buildGenericEvent('member', data, { action: 'join' }));
    });

    connection.on('roomUser', (data) => {
        enqueueEvent(buildGenericEvent('roomUser', data, {
            viewerCount: data.viewerCount || null,
            topGifter: data.topGifter || null,
        }));
    });

    connection.on('questionNew', (data) => {
        enqueueEvent(buildGenericEvent('questionNew', data));
    });

    connection.on('linkMicBattle', (data) => {
        enqueueEvent(buildGenericEvent('linkMicBattle', data));
    });

    connection.on('linkMicArmies', (data) => {
        enqueueEvent(buildGenericEvent('linkMicArmies', data));
    });

    connection.on('liveIntro', (data) => {
        enqueueEvent(buildGenericEvent('liveIntro', data));
    });

    connection.on('emote', (data) => {
        enqueueEvent(buildGenericEvent('emote', data));
    });

    connection.on('envelope', (data) => {
        enqueueEvent(buildGenericEvent('envelope', data));
    });

    connection.on('streamEnd', () => {
        if (LOG_CONTROL_EVENTS_ENABLED) {
            logSystem('stream_end', { uniqueId: TIKTOK_USERNAME });
        }
        userLikeCounts.clear();
    });

    if (LOG_RAW_DATA_ENABLED) {
        connection.on('rawData', (data) => {
            logSystem('raw_data', { rawData: data });
        });
    }

    if (LOG_DECODED_DATA_ENABLED) {
        connection.on('decodedData', (data) => {
            logSystem('decoded_data', { decodedData: data });
        });
    }

    connection.on('disconnected', () => {
        console.warn('[relay] disconnected');
        if (LOG_CONTROL_EVENTS_ENABLED) {
            logSystem('disconnected');
        }
        scheduleReconnect('disconnected');
    });

    connection.on('error', (err) => {
        console.error('[relay] connection error:', err.message || err);
        if (LOG_CONTROL_EVENTS_ENABLED) {
            logSystem('error', { message: err.message || String(err) });
        }
        scheduleReconnect('error');
    });

    return connection;
};

connectToTikTok();

app.listen(PORT, () => {
    console.log(`[relay] health server listening on :${PORT}`);
    if (HEALTH_LOG_INTERVAL_MS_VALUE > 0) {
        setInterval(() => {
            console.log('[relay] heartbeat: running');
        }, HEALTH_LOG_INTERVAL_MS_VALUE);
    }
});

const shutdown = async () => {
    try {
        await flushEvents();
    } catch (err) {
        console.warn('[relay] failed to flush events during shutdown:', err.message || err);
    }

    if (logStream) {
        try {
            logStream.end();
        } catch (err) {
            console.warn('[relay] failed to close log stream during shutdown:', err.message || err);
        }
    }

    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
