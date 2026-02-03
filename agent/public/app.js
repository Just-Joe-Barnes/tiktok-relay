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

const LIKE_CHAT_COOLDOWN_MS = 60_000;
const likeChatCooldownByUser = new Map();

const giftSoundRules = [
    {
        match: 'heart me',
        sound: '/sounds/heart-me.mp3',
    },
    {
        match: 'rose',
        sound: '/sounds/rose.mp3',
    },
];

let audioEnabled = false;
let dynamicSoundMap = {};
let giftCatalog = new Map();

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
    feed: document.getElementById('feed'),
    enableAudio: document.getElementById('enableAudio'),
    testHeart: document.getElementById('testHeart'),
    testGiftName: document.getElementById('testGiftName'),
    testGiftCount: document.getElementById('testGiftCount'),
    testGift: document.getElementById('testGift'),
    tikfinityTestType: document.getElementById('tikfinityTestType'),
    tikfinityTestValue: document.getElementById('tikfinityTestValue'),
    tikfinityTest: document.getElementById('tikfinityTest'),
    testChat: document.getElementById('testChat'),
    testShare: document.getElementById('testShare'),
    testLike: document.getElementById('testLike'),
    refreshGifts: document.getElementById('refreshGifts'),
    giftList: document.getElementById('giftList'),
    giftListStatus: document.getElementById('giftListStatus'),
    soundGiftName: document.getElementById('soundGiftName'),
    soundFile: document.getElementById('soundFile'),
    uploadSound: document.getElementById('uploadSound'),
    uploadStatus: document.getElementById('uploadStatus'),
    audioState: document.getElementById('audioState'),
    obsStatus: document.getElementById('obsStatus'),
    streamStatus: document.getElementById('streamStatus'),
    sbStatus: document.getElementById('sbStatus'),
    refreshObs: document.getElementById('refreshObs'),
    refreshStatus: document.getElementById('refreshStatus'),
    relayStatus: document.getElementById('relayStatus'),
    streamerbotStatus: document.getElementById('streamerbotStatus'),
    backendStatus: document.getElementById('backendStatus'),
    ruleType: document.getElementById('ruleType'),
    ruleValue: document.getElementById('ruleValue'),
    ruleUseStreamerbot: document.getElementById('ruleUseStreamerbot'),
    ruleAction: document.getElementById('ruleAction'),
    ruleScene: document.getElementById('ruleScene'),
    ruleSource: document.getElementById('ruleSource'),
    ruleFilter: document.getElementById('ruleFilter'),
    ruleSbAction: document.getElementById('ruleSbAction'),
    saveRule: document.getElementById('saveRule'),
    rulesList: document.getElementById('rulesList'),
    openLogs: document.getElementById('openLogs'),
    openRules: document.getElementById('openRules'),
    closeLogs: document.getElementById('closeLogs'),
    closeRules: document.getElementById('closeRules'),
    logModal: document.getElementById('logModal'),
    rulesModal: document.getElementById('rulesModal'),
};

const setConnectionState = (value) => {
    if (!elements.connectionState) return;
    elements.connectionState.textContent = value;
    elements.connectionState.dataset.state = value;
};

const toggleModal = (modal, isOpen) => {
    if (!modal) return;
    modal.classList.toggle('is-open', isOpen);
    modal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
};

const setAudioState = (enabled) => {
    audioEnabled = enabled;
    if (elements.audioState) {
        elements.audioState.textContent = `audio: ${enabled ? 'on' : 'off'}`;
    }
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const formatTime = (iso) => {
    if (!iso) return '--';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleTimeString();
};

const getListLimit = (list) => {
    const max = Number.parseInt(list?.dataset?.maxItems || '', 10);
    if (Number.isFinite(max) && max > 0) return max;
    return MAX_ITEMS;
};

const renderLineContent = (container, content) => {
    if (typeof content === 'string') {
        container.textContent = content;
        return;
    }

    const time = content?.time;
    const username = content?.username;
    const message = content?.message;

    let hasTime = false;
    let hasUser = false;

    if (time) {
        const timeSpan = document.createElement('span');
        timeSpan.className = 'item-time';
        timeSpan.textContent = time;
        container.appendChild(timeSpan);
        hasTime = true;
    }

    if (username) {
        if (hasTime) {
            container.appendChild(document.createTextNode(' - '));
        }
        const userSpan = document.createElement('strong');
        userSpan.className = 'item-user';
        userSpan.textContent = username;
        container.appendChild(userSpan);
        hasUser = true;
    }

    if (message) {
        if (hasUser) {
            if (!message.startsWith(':')) {
                container.appendChild(document.createTextNode(' '));
            }
        } else if (hasTime) {
            container.appendChild(document.createTextNode(' - '));
        }
        const messageSpan = document.createElement('span');
        messageSpan.className = 'item-message';
        messageSpan.textContent = message;
        container.appendChild(messageSpan);
    }
};

const appendItem = (list, text, options = {}) => {
    if (!list) return;
    const limit = getListLimit(list);
    const item = document.createElement('li');
    if (options.eventType) {
        item.classList.add(`event-${options.eventType}`);
    }
    if (options.imageUrl) {
        item.classList.add('with-icon');
        const img = document.createElement('img');
        img.className = 'gift-icon';
        img.src = options.imageUrl;
        img.alt = options.alt || '';
        img.loading = 'lazy';
        item.appendChild(img);
    }
    const span = document.createElement('span');
    span.className = 'item-text';
    renderLineContent(span, text);
    item.appendChild(span);
    list.prepend(item);
    if (list.children.length > limit) {
        list.removeChild(list.lastChild);
    }
};

const isDockView = () => document.body?.classList?.contains('dock');

const ensureListBottom = (list) => {
    if (!list) return;
    const last = list.lastElementChild;
    if (last) {
        last.scrollIntoView({ block: 'end' });
    }
    list.scrollTop = list.scrollHeight;
};

const startDockAutoScroll = () => {
    if (!isDockView()) return;
    if (!elements.chat) return;
    setInterval(() => ensureListBottom(elements.chat), 500);
};

const appendItemBottom = (list, text, options = {}) => {
    if (!list) return;
    const limit = getListLimit(list);
    const item = document.createElement('li');
    if (options.eventType) {
        item.classList.add(`event-${options.eventType}`);
    }
    if (options.imageUrl) {
        item.classList.add('with-icon');
        const img = document.createElement('img');
        img.className = 'gift-icon';
        img.src = options.imageUrl;
        img.alt = options.alt || '';
        img.loading = 'lazy';
        item.appendChild(img);
    }
    const span = document.createElement('span');
    span.className = 'item-text';
    renderLineContent(span, text);
    item.appendChild(span);
    list.appendChild(item);
    if (list.children.length > limit) {
        list.removeChild(list.firstChild);
    }
    const scrollToBottom = () => {
        list.scrollTop = list.scrollHeight;
    };
    scrollToBottom();
    requestAnimationFrame(scrollToBottom);
    if (isDockView()) {
        setTimeout(() => ensureListBottom(list), 60);
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

const loadSoundMap = () => {
    try {
        const stored = localStorage.getItem('giftSoundMap');
        dynamicSoundMap = stored ? JSON.parse(stored) : {};
    } catch (err) {
        dynamicSoundMap = {};
    }
};

const saveSoundMap = () => {
    try {
        localStorage.setItem('giftSoundMap', JSON.stringify(dynamicSoundMap));
    } catch (err) {
        // ignore storage errors
    }
};

const resolveSoundForGift = (giftName) => {
    const normalized = normalizeText(giftName);
    if (!normalized) return null;
    if (dynamicSoundMap[normalized]) return dynamicSoundMap[normalized];
    const rule = giftSoundRules.find((entry) => normalizeText(entry.match) === normalized);
    return rule ? rule.sound : null;
};

const handleGiftSounds = (event) => {
    const giftName = normalizeText(event.giftName);
    if (!giftName) return;

    const soundUrl = resolveSoundForGift(giftName);
    if (!soundUrl) return;

    if (event.giftType === 1 && !event.repeatEnd) {
        if (Number(event.repeatCount || 1) !== 1) {
            return;
        }
    }

    void playSound(soundUrl);
};

const buildGiftLine = (event) => {
    const name = event.username || event.userId || 'unknown';
    const gift = event.giftName || event.giftId || 'gift';
    const coins = event.coins || 0;
    return {
        time: formatTime(event.receivedAt),
        username: name,
        message: `sent ${gift} (${coins} coins)`,
    };
};

const buildChatLine = (event) => {
    const name = event.username || event.userId || 'unknown';
    const message = event.message || '';
    return {
        time: formatTime(event.receivedAt),
        username: name,
        message: `: ${message}`,
    };
};

const buildCommandLine = (event) => {
    const name = event.username || event.userId || 'unknown';
    return {
        time: formatTime(event.receivedAt),
        username: name,
        message: `: command ${event.command}`,
    };
};

const buildEventLine = (event) => {
    const name = event.username || event.userId || 'unknown';
    const type = event.eventType || 'event';
    if (type === 'like') {
        const count = event.likeCount || event.totalLikeCount || 1;
        return {
            time: formatTime(event.receivedAt),
            username: name,
            message: `liked (+${count})`,
        };
    }
    if (type === 'share') {
        return {
            time: formatTime(event.receivedAt),
            username: name,
            message: 'shared the live',
        };
    }
    if (type === 'follow') {
        return {
            time: formatTime(event.receivedAt),
            username: name,
            message: 'followed',
        };
    }
    if (type === 'member') {
        return {
            time: formatTime(event.receivedAt),
            username: name,
            message: 'joined',
        };
    }
    if (type === 'roomUser') {
        const viewers = event.viewerCount || 'unknown';
        return {
            time: formatTime(event.receivedAt),
            message: `viewers: ${viewers}`,
        };
    }
    return {
        time: formatTime(event.receivedAt),
        username: name,
        message: type,
    };
};

const buildLogLine = (event) => {
    const name = event.username || event.userId || 'unknown';
    const details = event.message || event.giftName || event.command || '';
    const suffix = details ? ` ${details}` : '';
    return {
        time: formatTime(event.receivedAt),
        username: name,
        message: `${event.eventType}${suffix}`,
    };
};

const increment = (type) => {
    state.total += 1;
    if (elements.totalEvents) {
        elements.totalEvents.textContent = String(state.total);
    }

    if (state.counts[type] !== undefined) {
        state.counts[type] += 1;
    }

    if (elements.giftCount) elements.giftCount.textContent = String(state.counts.gift + state.counts.gift_streak);
    if (elements.chatCount) elements.chatCount.textContent = String(state.counts.chat);
    if (elements.likeCount) elements.likeCount.textContent = String(state.counts.like);
    if (elements.followCount) elements.followCount.textContent = String(state.counts.follow);
    if (elements.commandCount) elements.commandCount.textContent = String(state.counts.command);
};

const handleEvent = (event) => {
    if (!event || !event.eventType) return;
    if (event.eventType === 'config') return;
    increment(event.eventType);

    if (elements.lastEvent) {
        elements.lastEvent.textContent = formatTime(event.receivedAt);
    }

    if (event.eventType === 'gift' || event.eventType === 'gift_streak') {
        const imageUrl = resolveGiftImage(event.giftName || event.giftId)
            || event.imageUrl
            || event.giftImage
            || event.giftImageUrl;
        appendItemBottom(elements.gifts, buildGiftLine(event), {
            imageUrl,
            alt: event.giftName || 'gift',
            eventType: 'gift',
        });
        handleGiftSounds(event);
        if (elements.chat) {
            appendItemBottom(elements.chat, buildGiftLine(event), {
                imageUrl,
                alt: event.giftName || 'gift',
                eventType: 'gift',
            });
        }
    } else if (event.eventType === 'chat') {
        appendItemBottom(elements.chat, buildChatLine(event));
    } else if (event.eventType === 'command') {
        appendItemBottom(elements.chat, buildCommandLine(event));
    } else if (event.eventType === 'share') {
        const line = buildEventLine(event);
        appendItemBottom(elements.events, line, { eventType: 'share' });
        if (elements.chat) {
            appendItemBottom(elements.chat, line, { eventType: 'share' });
        }
    } else if (event.eventType === 'like') {
        const line = buildEventLine(event);
        appendItemBottom(elements.events, line, { eventType: 'like' });
        const userKey = normalizeText(event.username || event.userId || 'unknown');
        const now = Date.now();
        const lastShown = likeChatCooldownByUser.get(userKey) || 0;
        if (now - lastShown >= LIKE_CHAT_COOLDOWN_MS) {
            likeChatCooldownByUser.set(userKey, now);
            if (elements.chat) {
                appendItemBottom(elements.chat, line, { eventType: 'like' });
            }
        }
    } else {
        appendItemBottom(elements.events, buildEventLine(event), { eventType: event.eventType || 'event' });
    }

    const logImage = event.eventType === 'gift' || event.eventType === 'gift_streak'
        ? (resolveGiftImage(event.giftName || event.giftId)
            || event.imageUrl
            || event.giftImage
            || event.giftImageUrl)
        : null;
    appendItem(elements.log, buildLogLine(event), {
        imageUrl: logImage,
        alt: event.giftName || 'gift',
        eventType: event.eventType || 'event',
    });
    if (elements.feed) {
        appendItemBottom(elements.feed, buildLogLine(event), {
            imageUrl: logImage,
            alt: event.giftName || 'gift',
            eventType: event.eventType || 'event',
        });
    }
};

const resolveGiftCoins = (giftName) => {
    const key = normalizeText(giftName);
    if (!key) return 1;
    const entry = giftCatalog.get(key);
    const coins = entry?.coins ?? entry;
    return Number.isFinite(coins) && coins > 0 ? coins : 1;
};

const resolveGiftImage = (giftName) => {
    const key = normalizeText(giftName);
    if (!key) return null;
    const entry = giftCatalog.get(key);
    return entry?.imageUrl || entry?.src_url || entry?.image || null;
};

const buildTestEvent = (giftName = 'Heart Me', repeatCount = 1) => {
    const coinsPerGift = resolveGiftCoins(giftName);
    const totalCoins = coinsPerGift * repeatCount;
    return ({
    id: `test-${normalizeText(giftName) || 'gift'}`,
    platform: 'tiktok',
    eventType: 'gift',
    userId: 'test-user',
    username: 'test-user',
    giftName,
    giftId: normalizeText(giftName) || 'gift',
    coins: totalCoins,
    giftType: repeatCount > 1 ? 1 : 0,
    repeatCount,
    repeatEnd: true,
    receivedAt: new Date().toISOString(),
    });
};

const sendTestEvent = async (event) => {
    try {
        await fetch('/test-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event),
        });
    } catch (err) {
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - test event failed`);
    }
};

const sendTikfinityTest = async (payload) => {
    try {
        await fetch('/test-tikfinity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (err) {
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - tikfinity test failed`);
    }
};
const buildLocalTikfinityEvent = (eventType, value) => {
    const base = {
        id: `tikfinity-local-${Date.now()}`,
        platform: 'tiktok',
        eventType,
        userId: 'tikfinity-test',
        username: 'tikfinity-test',
        receivedAt: new Date().toISOString(),
    };

    const trimmedValue = String(value || '').trim();
    if (eventType === 'gift') {
        return {
            ...base,
            giftName: trimmedValue || 'Rose',
            giftId: trimmedValue ? normalizeText(trimmedValue) : 'rose',
            coins: resolveGiftCoins(trimmedValue || 'Rose'),
            repeatCount: 1,
            repeatEnd: true,
            giftType: 0,
        };
    }
    if (eventType === 'chat') {
        return {
            ...base,
            message: trimmedValue || 'Test chat from Tikfinity',
        };
    }
    if (eventType === 'like') {
        const countValue = Number(trimmedValue || 1);
        return {
            ...base,
            likeCount: Number.isFinite(countValue) ? countValue : 1,
        };
    }
    if (eventType === 'share') {
        return base;
    }
    if (eventType === 'follow') {
        return base;
    }
    return base;
};

const setupControls = () => {
    const enableAudio = () => {
        if (!audioEnabled) {
            setAudioState(true);
        }
    };

    if (elements.enableAudio) {
        elements.enableAudio.addEventListener('click', enableAudio);
    }

    document.addEventListener('click', enableAudio, { once: true });
    document.addEventListener('keydown', enableAudio, { once: true });

    if (elements.testHeart) {
        elements.testHeart.addEventListener('click', () => {
            void sendTestEvent(buildTestEvent());
        });
    }

    if (elements.testGift) {
        elements.testGift.addEventListener('click', () => {
            const giftName = elements.testGiftName?.value?.trim() || 'Gift';
            const countValue = Number(elements.testGiftCount?.value || 1);
            const repeatCount = Number.isFinite(countValue) && countValue > 0 ? countValue : 1;
            const event = buildTestEvent(giftName, repeatCount);
            void sendTestEvent(event);
        });
    }

    if (elements.tikfinityTest) {
        elements.tikfinityTest.addEventListener('click', () => {
            const eventType = elements.tikfinityTestType?.value || 'gift';
            const value = elements.tikfinityTestValue?.value || '';
            void sendTikfinityTest({ eventType, value });
        });
    }

    if (elements.testChat) {
        elements.testChat.addEventListener('click', () => {
            const message = elements.tikfinityTestValue?.value || 'Test chat from Tikfinity';
            void sendTikfinityTest({ eventType: 'chat', value: message });
        });
    }

    if (elements.testShare) {
        elements.testShare.addEventListener('click', () => {
            void sendTikfinityTest({ eventType: 'share', value: '' });
        });
    }

    if (elements.testLike) {
        elements.testLike.addEventListener('click', () => {
            const countValue = elements.tikfinityTestValue?.value || '1';
            void sendTikfinityTest({ eventType: 'like', value: countValue });
        });
    }

    if (elements.uploadSound) {
        elements.uploadSound.addEventListener('click', async () => {
            const giftName = elements.soundGiftName?.value?.trim();
            const file = elements.soundFile?.files?.[0];

            if (!giftName) {
                elements.uploadStatus.textContent = 'upload: missing gift name';
                return;
            }
            if (!file) {
                elements.uploadStatus.textContent = 'upload: choose a file';
                return;
            }

            elements.uploadStatus.textContent = 'upload: uploading...';
            const formData = new FormData();
            formData.append('sound', file);

            try {
                const response = await fetch('/upload-sound', {
                    method: 'POST',
                    body: formData,
                });
                const result = await response.json();
                if (!result.ok) {
                    throw new Error(result.message || 'Upload failed');
                }

                dynamicSoundMap[normalizeText(giftName)] = result.url;
                saveSoundMap();
                elements.uploadStatus.textContent = `upload: saved ${result.fileName}`;
            } catch (err) {
                elements.uploadStatus.textContent = `upload: ${err.message || err}`;
            }
        });
    }

    setAudioState(false);
};

const setupModals = () => {
    if (elements.openLogs && elements.logModal) {
        elements.openLogs.addEventListener('click', () => toggleModal(elements.logModal, true));
    }
    if (elements.openRules && elements.rulesModal) {
        elements.openRules.addEventListener('click', () => toggleModal(elements.rulesModal, true));
    }
    if (elements.closeLogs && elements.logModal) {
        elements.closeLogs.addEventListener('click', () => toggleModal(elements.logModal, false));
    }
    if (elements.closeRules && elements.rulesModal) {
        elements.closeRules.addEventListener('click', () => toggleModal(elements.rulesModal, false));
    }
    if (elements.logModal) {
        elements.logModal.addEventListener('click', (event) => {
            if (event.target === elements.logModal) toggleModal(elements.logModal, false);
        });
    }
    if (elements.rulesModal) {
        elements.rulesModal.addEventListener('click', (event) => {
            if (event.target === elements.rulesModal) toggleModal(elements.rulesModal, false);
        });
    }
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            toggleModal(elements.logModal, false);
            toggleModal(elements.rulesModal, false);
        }
    });
};

const setupStream = () => {
    const source = new EventSource('/stream');

    source.addEventListener('hello', () => {
        setConnectionState('connected');
        if (elements.streamStatus) elements.streamStatus.textContent = 'stream: connected';
    });

    source.onopen = () => {
        setConnectionState('connected');
        if (elements.streamStatus) elements.streamStatus.textContent = 'stream: connected';
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
        if (elements.streamStatus) elements.streamStatus.textContent = 'stream: disconnected';
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - stream error or disconnected`);
    };
};

const renderGiftList = (gifts) => {
    if (!elements.giftList) return;
    elements.giftList.innerHTML = '';
    giftCatalog = new Map();
    gifts.forEach((gift) => {
        const option = document.createElement('option');
        option.value = gift.name;
        option.label = `${gift.name} (${gift.coins})`;
        elements.giftList.appendChild(option);
        giftCatalog.set(normalizeText(gift.name), {
            coins: Number(gift.coins),
            imageUrl: gift.imageUrl || gift.src_url || gift.image || null,
        });
    });
};

const fetchGiftList = async (refresh = false) => {
    try {
        const url = refresh ? '/gifts?refresh=1' : '/gifts';
        const response = await fetch(url);
        const data = await response.json();
        if (data.error) {
            elements.giftListStatus.textContent = `gifts: error`;
            appendItem(elements.log, `${new Date().toLocaleTimeString()} - gift list error: ${data.error}`);
            return;
        }
        renderGiftList(data.gifts || []);
        const count = data.gifts?.length || 0;
        const imageNote = data.hasImages === false ? ' (no images)' : '';
        elements.giftListStatus.textContent = `gifts: ${count}${imageNote}`;
        if (elements.rulesList) {
            await fetchRules();
        }
    } catch (err) {
        elements.giftListStatus.textContent = 'gifts: fetch failed';
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - gift list fetch failed`);
    }
};

const setObsStatus = (text) => {
    if (elements.obsStatus) {
        elements.obsStatus.textContent = text;
    }
};

const setSbStatus = (text) => {
    if (elements.sbStatus) {
        elements.sbStatus.textContent = text;
    }
};

let obsScenes = [];
let obsSceneItems = [];
let obsFilters = [];
let sbActions = [];

const renderSceneOptions = () => {
    if (!elements.ruleScene) return;
    elements.ruleScene.innerHTML = '';
    obsScenes.forEach((scene) => {
        const option = document.createElement('option');
        option.value = scene.sceneName;
        option.textContent = scene.sceneName;
        elements.ruleScene.appendChild(option);
    });
};

const renderSourceOptions = () => {
    if (!elements.ruleSource) return;
    elements.ruleSource.innerHTML = '';
    obsSceneItems.forEach((item) => {
        const option = document.createElement('option');
        option.value = String(item.sceneItemId);
        option.textContent = item.sourceName;
        option.dataset.sourceName = item.sourceName;
        elements.ruleSource.appendChild(option);
    });
};

const renderFilterOptions = () => {
    if (!elements.ruleFilter) return;
    elements.ruleFilter.innerHTML = '';
    obsFilters.forEach((filter) => {
        const option = document.createElement('option');
        option.value = filter.filterName;
        option.textContent = filter.filterName;
        elements.ruleFilter.appendChild(option);
    });
};

const renderSbActions = () => {
    if (!elements.ruleSbAction) return;
    elements.ruleSbAction.innerHTML = '';
    sbActions.forEach((action) => {
        const option = document.createElement('option');
        option.value = action.id || action.name;
        option.textContent = action.name || action.id;
        option.dataset.actionId = action.id || '';
        option.dataset.actionName = action.name || '';
        elements.ruleSbAction.appendChild(option);
    });
};

const fetchObsStatus = async () => {
    try {
        const response = await fetch('/obs/status');
        const data = await response.json();
        setObsStatus(data.connected ? 'obs: connected' : 'obs: disconnected');
        if (data.lastError) {
            appendItem(elements.log, `${new Date().toLocaleTimeString()} - obs error: ${data.lastError}`);
        }
    } catch (err) {
        setObsStatus('obs: error');
    }
};

const fetchObsScenes = async () => {
    try {
        const response = await fetch('/obs/scenes');
        const data = await response.json();
        if (!data.scenes) throw new Error('No scenes');
        obsScenes = data.scenes;
        renderSceneOptions();
        if (data.currentProgramSceneName && elements.ruleScene) {
            elements.ruleScene.value = data.currentProgramSceneName;
        }
        await fetchObsSceneItems(elements.ruleScene?.value);
    } catch (err) {
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - obs scenes error`);
    }
};

const fetchObsSceneItems = async (sceneName) => {
    if (!sceneName) return;
    try {
        const response = await fetch(`/obs/scene-items?scene=${encodeURIComponent(sceneName)}`);
        const data = await response.json();
        obsSceneItems = data.sceneItems || [];
        renderSourceOptions();
        const sourceName = elements.ruleSource?.selectedOptions?.[0]?.dataset?.sourceName;
        if (sourceName) {
            await fetchObsFilters(sourceName);
        }
    } catch (err) {
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - obs sources error`);
    }
};

const fetchObsFilters = async (sourceName) => {
    if (!sourceName) return;
    try {
        const response = await fetch(`/obs/filters?source=${encodeURIComponent(sourceName)}`);
        const data = await response.json();
        obsFilters = data.filters || [];
        renderFilterOptions();
    } catch (err) {
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - obs filters error`);
    }
};

const fetchSbStatus = async () => {
    try {
        const response = await fetch('/sb/status');
        const data = await response.json();
        setSbStatus(data.connected ? 'sb: connected' : 'sb: disconnected');
        if (data.lastError) {
            appendItem(elements.log, `${new Date().toLocaleTimeString()} - sb error: ${data.lastError}`);
        }
    } catch (err) {
        setSbStatus('sb: error');
    }
};

const fetchSbActions = async () => {
    try {
        const response = await fetch('/sb/actions');
        const data = await response.json();
        sbActions = data.actions || [];
        renderSbActions();
    } catch (err) {
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - sb actions error`);
    }
};

const renderRulesList = (rules) => {
    if (!elements.rulesList) return;
    elements.rulesList.innerHTML = '';
    if (!rules.length) {
        const li = document.createElement('li');
        li.textContent = 'No rules loaded yet.';
        elements.rulesList.appendChild(li);
        return;
    }
    rules.forEach((rule) => {
        const li = document.createElement('li');
        li.className = 'rule-item';
        const text = document.createElement('span');
        text.className = 'item-text';
        const matchLabel = `${rule.match?.type} ${rule.match?.value}`;
        const actionLabel = rule.action?.type === 'streamerbotAction'
            ? `streamer.bot: ${rule.action?.actionName || rule.action?.actionId || 'action'}`
            : `${rule.action?.type}`;
        text.textContent = `${matchLabel} -> ${actionLabel}`;
        if (rule.match?.type === 'gift') {
            const imageUrl = resolveGiftImage(rule.match?.value);
            if (imageUrl) {
                const img = document.createElement('img');
                img.className = 'gift-icon';
                img.src = imageUrl;
                img.alt = rule.match?.value || 'gift';
                img.loading = 'lazy';
                li.appendChild(img);
            }
        }
        const actions = document.createElement('div');
        actions.className = 'rule-actions';
        const testBtn = document.createElement('button');
        testBtn.textContent = 'Test';
        testBtn.className = 'button button-ghost';
        testBtn.addEventListener('click', async () => {
            await fetch(`/rules/${rule.id}/test`, { method: 'POST' });
        });
        const remove = document.createElement('button');
        remove.textContent = 'Delete';
        remove.className = 'button button-ghost';
        remove.addEventListener('click', async () => {
            await fetch(`/rules/${rule.id}`, { method: 'DELETE' });
            await fetchRules();
        });
        li.appendChild(text);
        actions.appendChild(testBtn);
        actions.appendChild(remove);
        li.appendChild(actions);
        elements.rulesList.appendChild(li);
    });
};

const fetchRules = async () => {
    try {
        const response = await fetch('/rules');
        if (!response.ok) {
            throw new Error(`rules http ${response.status}`);
        }
        const data = await response.json();
        renderRulesList(data);
        const count = Array.isArray(data) ? data.length : (data?.rules?.length || 0);
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - rules loaded: ${count}`);
    } catch (err) {
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - rules fetch failed`);
    }
};
const updateActionFields = () => {
    const useStreamerbot = Boolean(elements.ruleUseStreamerbot?.checked);
    const obsFields = [elements.ruleAction, elements.ruleScene, elements.ruleSource, elements.ruleFilter];
    const sbField = elements.ruleSbAction;

    const showObs = !useStreamerbot;
    obsFields.forEach((field) => {
        if (field) field.style.display = showObs ? '' : 'none';
    });
    if (sbField) {
        sbField.style.display = showObs ? 'none' : '';
    }
};

const updateHealthStatus = async () => {
    try {
        const response = await fetch('/status');
        const data = await response.json();
        if (elements.relayStatus) {
            const source = data.source || 'relay';
            const relayConnected = Boolean(data.relay?.connected);
            const tikfinityConnected = Boolean(data.tikfinity?.connected);
            const connected = source === 'tikfinity' ? tikfinityConnected : relayConnected;
            elements.relayStatus.textContent = `source: ${source} (${connected ? 'connected' : 'disconnected'})`;
            setConnectionState(connected ? 'connected' : 'disconnected');
            if (source === 'tikfinity' && data.tikfinity?.lastError) {
                appendItem(elements.log, `${new Date().toLocaleTimeString()} - tikfinity error: ${data.tikfinity.lastError}`);
            }
        }
        if (elements.streamerbotStatus) {
            const sbText = data.streamerbot?.connected ? 'streamer.bot: connected' : 'streamer.bot: disconnected';
            elements.streamerbotStatus.textContent = sbText;
        }
        if (elements.backendStatus) {
            const backendState = data.backend?.ok === null
                ? 'backend: not configured'
                : data.backend?.ok
                    ? `backend: ok (${data.backend.status})`
                    : 'backend: down';
            elements.backendStatus.textContent = backendState;
        }
    } catch (err) {
        if (elements.relayStatus) elements.relayStatus.textContent = 'relay: error';
        if (elements.streamerbotStatus) elements.streamerbotStatus.textContent = 'streamer.bot: error';
        if (elements.backendStatus) elements.backendStatus.textContent = 'backend: error';
    }
};

setConnectionState('connecting');
loadSoundMap();
setupControls();
setupModals();
setupStream();
fetchGiftList(false);
fetchObsStatus();
fetchObsScenes();
fetchRules();
fetchSbStatus();
fetchSbActions();
updateActionFields();
updateHealthStatus();
startDockAutoScroll();

if (elements.refreshGifts) {
    elements.refreshGifts.addEventListener('click', () => {
        fetchGiftList(true);
    });
}

if (elements.refreshObs) {
    elements.refreshObs.addEventListener('click', async () => {
        await fetchObsStatus();
        await fetchObsScenes();
        await fetchSbStatus();
        await fetchSbActions();
    });
}

if (elements.refreshStatus) {
    elements.refreshStatus.addEventListener('click', () => {
        updateHealthStatus();
    });
}

if (elements.ruleScene) {
    elements.ruleScene.addEventListener('change', async () => {
        await fetchObsSceneItems(elements.ruleScene.value);
    });
}

if (elements.ruleSource) {
    elements.ruleSource.addEventListener('change', async () => {
        const sourceName = elements.ruleSource.selectedOptions?.[0]?.dataset?.sourceName;
        await fetchObsFilters(sourceName);
    });
}

if (elements.ruleAction) {
    elements.ruleAction.addEventListener('change', () => {
        updateActionFields();
    });
}

if (elements.ruleUseStreamerbot) {
    elements.ruleUseStreamerbot.addEventListener('change', () => {
        updateActionFields();
    });
}

if (elements.saveRule) {
    elements.saveRule.addEventListener('click', async () => {
        const type = elements.ruleType?.value || 'gift';
        const value = elements.ruleValue?.value?.trim();
        const useStreamerbot = Boolean(elements.ruleUseStreamerbot?.checked);
        const actionType = useStreamerbot ? 'streamerbotAction' : elements.ruleAction?.value;

        if (!value && type !== 'share') {
            appendItem(elements.log, `${new Date().toLocaleTimeString()} - rule missing value`);
            return;
        }

        const match = {
            type,
            field: type === 'command' ? 'command' : type === 'gift' ? 'giftName' : null,
            value,
        };

        const action = { type: actionType };
        if (actionType === 'switchScene') {
            action.sceneName = elements.ruleScene?.value;
        } else if (['toggleSource', 'showSource', 'hideSource'].includes(actionType)) {
            action.sceneName = elements.ruleScene?.value;
            action.sceneItemId = Number(elements.ruleSource?.value);
            action.sourceName = elements.ruleSource?.selectedOptions?.[0]?.dataset?.sourceName;
        } else if (actionType === 'toggleFilter') {
            action.sourceName = elements.ruleSource?.selectedOptions?.[0]?.dataset?.sourceName;
            action.filterName = elements.ruleFilter?.value;
        } else if (actionType === 'playMedia') {
            action.sourceName = elements.ruleSource?.selectedOptions?.[0]?.dataset?.sourceName;
        } else if (actionType === 'streamerbotAction') {
            const option = elements.ruleSbAction?.selectedOptions?.[0];
            action.actionId = option?.dataset?.actionId || null;
            action.actionName = option?.dataset?.actionName || null;
        }

        const payload = { match, action, enabled: true };
        await fetch('/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        await fetchRules();
    });
}
