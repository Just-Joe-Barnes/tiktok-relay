const MAX_ITEMS = 200;

const state = {
    total: 0,
    counts: {
        gift: 0,
        gift_streak: 0,
        chat: 0,
        like: 0,
        follow: 0,
        share: 0,
        command: 0,
    },
};

const giftSoundRules = [
    {
        match: 'heart me',
        sound: '/sounds/heart-me.mp3',
    },
];

let audioEnabled = false;

const elements = {
    connectionState: document.getElementById('connectionState'),
    lastEvent: document.getElementById('lastEvent'),
    totalEvents: document.getElementById('totalEvents'),
    giftCount: document.getElementById('giftCount'),
    chatCount: document.getElementById('chatCount'),
    likeCount: document.getElementById('likeCount'),
    followCount: document.getElementById('followCount'),
    commandCount: document.getElementById('commandCount'),
    gifts: document.getElementById('gifts'),
    chat: document.getElementById('chat'),
    events: document.getElementById('events'),
    log: document.getElementById('log'),
    enableAudio: document.getElementById('enableAudio'),
    testHeart: document.getElementById('testHeart'),
    audioState: document.getElementById('audioState'),
};

const setConnectionState = (value) => {
    elements.connectionState.textContent = value;
    elements.connectionState.dataset.state = value;
};

const setAudioState = (enabled) => {
    audioEnabled = enabled;
    elements.audioState.textContent = `audio: ${enabled ? 'on' : 'off'}`;
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const formatTime = (iso) => {
    if (!iso) return '--';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleTimeString();
};

const appendItem = (list, text) => {
    const item = document.createElement('li');
    item.textContent = text;
    list.prepend(item);
    if (list.children.length > MAX_ITEMS) {
        list.removeChild(list.lastChild);
    }
};

const playSound = async (soundUrl) => {
    if (!audioEnabled) return;
    try {
        const audio = new Audio(soundUrl);
        await audio.play();
    } catch (err) {
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - audio error: ${err.message || err}`);
    }
};

const handleGiftSounds = (event) => {
    const giftName = normalizeText(event.giftName);
    if (!giftName) return;

    const rule = giftSoundRules.find((entry) => normalizeText(entry.match) === giftName);
    if (!rule) return;

    void playSound(rule.sound);
};

const formatGift = (event) => {
    const name = event.username || event.userId || 'unknown';
    const gift = event.giftName || event.giftId || 'gift';
    const coins = event.coins || 0;
    return `${formatTime(event.receivedAt)} - ${name} sent ${gift} (${coins} coins)`;
};

const formatChat = (event) => {
    const name = event.username || event.userId || 'unknown';
    const message = event.message || '';
    return `${formatTime(event.receivedAt)} - ${name}: ${message}`;
};

const formatEvent = (event) => {
    const name = event.username || event.userId || 'unknown';
    return `${formatTime(event.receivedAt)} - ${event.eventType} from ${name}`;
};

const formatLog = (event) => {
    const name = event.username || event.userId || 'unknown';
    const details = event.message || event.giftName || event.command || '';
    return `${formatTime(event.receivedAt)} - ${event.eventType} - ${name} ${details}`.trim();
};

const increment = (type) => {
    state.total += 1;
    elements.totalEvents.textContent = String(state.total);

    if (state.counts[type] !== undefined) {
        state.counts[type] += 1;
    }

    elements.giftCount.textContent = String(state.counts.gift + state.counts.gift_streak);
    elements.chatCount.textContent = String(state.counts.chat);
    elements.likeCount.textContent = String(state.counts.like);
    elements.followCount.textContent = String(state.counts.follow);
    elements.commandCount.textContent = String(state.counts.command);
};

const handleEvent = (event) => {
    if (!event || !event.eventType) return;
    increment(event.eventType);

    elements.lastEvent.textContent = formatTime(event.receivedAt);

    if (event.eventType === 'gift' || event.eventType === 'gift_streak') {
        appendItem(elements.gifts, formatGift(event));
        handleGiftSounds(event);
    } else if (event.eventType === 'chat') {
        appendItem(elements.chat, formatChat(event));
    } else if (event.eventType === 'command') {
        appendItem(elements.chat, formatChat({
            ...event,
            message: `command: ${event.command}`,
        }));
    } else {
        appendItem(elements.events, formatEvent(event));
    }

    appendItem(elements.log, formatLog(event));
};

const buildTestEvent = () => ({
    id: 'test-heart-me',
    platform: 'tiktok',
    eventType: 'gift',
    userId: 'test-user',
    username: 'test-user',
    giftName: 'Heart Me',
    giftId: 'heart_me',
    coins: 1,
    receivedAt: new Date().toISOString(),
});

const setupControls = () => {
    if (elements.enableAudio) {
        elements.enableAudio.addEventListener('click', () => {
            setAudioState(true);
            void playSound('/sounds/heart-me.mp3');
        });
    }

    if (elements.testHeart) {
        elements.testHeart.addEventListener('click', () => {
            handleEvent(buildTestEvent());
        });
    }

    setAudioState(false);
};

const setupStream = () => {
    const source = new EventSource('/stream');

    source.addEventListener('hello', () => {
        setConnectionState('connected');
    });

    source.onopen = () => {
        setConnectionState('connected');
    };

    source.addEventListener('snapshot', (event) => {
        try {
            const payload = JSON.parse(event.data);
            if (Array.isArray(payload)) {
                payload.forEach(handleEvent);
            }
        } catch (err) {
            console.warn('Failed to parse snapshot', err);
        }
    });

    source.addEventListener('event', (event) => {
        try {
            const payload = JSON.parse(event.data);
            handleEvent(payload);
        } catch (err) {
            console.warn('Failed to parse event', err);
        }
    });

    source.onerror = () => {
        setConnectionState('disconnected');
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - stream error or disconnected`);
    };
};

setConnectionState('connecting');
setupControls();
setupStream();
