const express = require('express');
const axios = require('axios');
const { WebcastPushConnection } = require('tiktok-live-connector');

require('dotenv').config();

const {
    TIKTOK_USERNAME,
    API_BASE_URL,
    RELAY_SECRET,
    STREAMER_ID,
    EVENT_ENDPOINT = '/api/external/event',
    PORT = 3000,
} = process.env;

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
    const path = EVENT_ENDPOINT.startsWith('/') ? EVENT_ENDPOINT : `/${EVENT_ENDPOINT}`;
    return `${base}${path}`;
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

    return 0;
};

const shouldProcessGift = (data) => {
    if (!data) return false;

    // Gift streaks send multiple events. Only process when the streak ends.
    if (data.giftType === 1 && !data.repeatEnd) {
        return false;
    }

    return true;
};

const buildPayload = (data, totalCoins) => ({
    platform: 'tiktok',
    eventType: 'gift',
    streamerId: STREAMER_ID || null,
    userId: data.userId || data.uniqueId || data.secUid || null,
    username: data.uniqueId || data.nickname || null,
    coins: totalCoins,
    giftId: data.giftId || null,
    giftName: data.giftName || null,
    repeatCount: data.repeatCount || 1,
    receivedAt: new Date().toISOString(),
    raw: {
        userId: data.userId,
        uniqueId: data.uniqueId,
        secUid: data.secUid,
        nickname: data.nickname,
        giftId: data.giftId,
        giftName: data.giftName,
        giftType: data.giftType,
        repeatCount: data.repeatCount,
        repeatEnd: data.repeatEnd,
        diamondCount: data.diamondCount,
    },
});

const postEvent = async (payload) => {
    const url = buildEndpoint();

    await axios.post(url, payload, {
        timeout: 5000,
        headers: {
            'x-relay-secret': RELAY_SECRET,
        },
    });
};

const connectToTikTok = () => {
    const connection = new WebcastPushConnection(TIKTOK_USERNAME, {
        processInitialData: false,
        enableExtendedGiftInfo: true,
    });

    connection.connect()
        .then(state => {
            console.log(`[relay] connected to ${TIKTOK_USERNAME} (roomId: ${state.roomId})`);
        })
        .catch(err => {
            console.error('[relay] failed to connect:', err.message || err);
        });

    connection.on('gift', async (data) => {
        try {
            if (!shouldProcessGift(data)) {
                return;
            }

            const coinsPerGift = resolveGiftCoins(data);
            const repeatCount = data.repeatCount || 1;
            const totalCoins = coinsPerGift * repeatCount;

            if (!totalCoins) {
                console.warn('[relay] gift ignored: missing coin value', data.giftId);
                return;
            }

            const payload = buildPayload(data, totalCoins);
            await postEvent(payload);

            console.log(`[relay] sent gift event for ${payload.username || payload.userId} (${totalCoins} coins)`);
        } catch (err) {
            console.error('[relay] failed to post gift event:', err.response?.data || err.message || err);
        }
    });

    connection.on('disconnected', () => {
        console.warn('[relay] disconnected, retrying in 5s...');
        setTimeout(() => connection.connect().catch(() => null), 5000);
    });

    connection.on('error', (err) => {
        console.error('[relay] connection error:', err.message || err);
    });

    return connection;
};

connectToTikTok();

app.listen(PORT, () => {
    console.log(`[relay] health server listening on :${PORT}`);
});
