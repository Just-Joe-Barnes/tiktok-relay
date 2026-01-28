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
    {
        match: 'rose',
        sound: '/sounds/rose.mp3',
    },
];

let audioEnabled = false;
let dynamicSoundMap = {};

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
    testGiftName: document.getElementById('testGiftName'),
    testGiftCount: document.getElementById('testGiftCount'),
    testGift: document.getElementById('testGift'),
    refreshGifts: document.getElementById('refreshGifts'),
    giftList: document.getElementById('giftList'),
    giftListStatus: document.getElementById('giftListStatus'),
    soundGiftName: document.getElementById('soundGiftName'),
    soundFile: document.getElementById('soundFile'),
    uploadSound: document.getElementById('uploadSound'),
    uploadStatus: document.getElementById('uploadStatus'),
    audioState: document.getElementById('audioState'),
    obsStatus: document.getElementById('obsStatus'),
    refreshObs: document.getElementById('refreshObs'),
    ruleType: document.getElementById('ruleType'),
    ruleValue: document.getElementById('ruleValue'),
    ruleAction: document.getElementById('ruleAction'),
    ruleScene: document.getElementById('ruleScene'),
    ruleSource: document.getElementById('ruleSource'),
    ruleFilter: document.getElementById('ruleFilter'),
    ruleSbAction: document.getElementById('ruleSbAction'),
    saveRule: document.getElementById('saveRule'),
    rulesList: document.getElementById('rulesList'),
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

const buildTestEvent = (giftName = 'Heart Me', repeatCount = 1) => ({
    id: `test-${normalizeText(giftName) || 'gift'}`,
    platform: 'tiktok',
    eventType: 'gift',
    userId: 'test-user',
    username: 'test-user',
    giftName,
    giftId: normalizeText(giftName) || 'gift',
    coins: 1,
    giftType: repeatCount > 1 ? 1 : 0,
    repeatCount,
    repeatEnd: true,
    receivedAt: new Date().toISOString(),
});

const setupControls = () => {
    const enableAudio = () => {
        if (!audioEnabled) {
            setAudioState(true);
            void playSound('/sounds/heart-me.mp3');
        }
    };

    if (elements.enableAudio) {
        elements.enableAudio.addEventListener('click', enableAudio);
    }

    document.addEventListener('click', enableAudio, { once: true });
    document.addEventListener('keydown', enableAudio, { once: true });

    if (elements.testHeart) {
        elements.testHeart.addEventListener('click', () => {
            handleEvent(buildTestEvent());
        });
    }

    if (elements.testGift) {
        elements.testGift.addEventListener('click', () => {
            const giftName = elements.testGiftName?.value?.trim() || 'Gift';
            const countValue = Number(elements.testGiftCount?.value || 1);
            const repeatCount = Number.isFinite(countValue) && countValue > 0 ? countValue : 1;
            handleEvent(buildTestEvent(giftName, repeatCount));
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

const renderGiftList = (gifts) => {
    if (!elements.giftList) return;
    elements.giftList.innerHTML = '';
    gifts.forEach((gift) => {
        const option = document.createElement('option');
        option.value = gift.name;
        option.label = `${gift.name} (${gift.coins})`;
        elements.giftList.appendChild(option);
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
        elements.giftListStatus.textContent = `gifts: ${data.gifts?.length || 0}`;
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
        const status = data.connected ? 'sb: connected' : 'sb: disconnected';
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - ${status}`);
    } catch (err) {
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - sb status error`);
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
    rules.forEach((rule) => {
        const li = document.createElement('li');
        li.className = 'rule-item';
        const text = document.createElement('span');
        const matchLabel = `${rule.match?.type} ${rule.match?.value}`;
        const actionLabel = rule.action?.type === 'streamerbotAction'
            ? `streamer.bot: ${rule.action?.actionName || rule.action?.actionId || 'action'}`
            : `${rule.action?.type}`;
        text.textContent = `${matchLabel} -> ${actionLabel}`;
        const remove = document.createElement('button');
        remove.textContent = 'Delete';
        remove.className = 'button button-ghost';
        remove.addEventListener('click', async () => {
            await fetch(`/rules/${rule.id}`, { method: 'DELETE' });
            await fetchRules();
        });
        li.appendChild(text);
        li.appendChild(remove);
        elements.rulesList.appendChild(li);
    });
};

const fetchRules = async () => {
    try {
        const response = await fetch('/rules');
        const data = await response.json();
        renderRulesList(data);
    } catch (err) {
        appendItem(elements.log, `${new Date().toLocaleTimeString()} - rules fetch failed`);
    }
};

setConnectionState('connecting');
loadSoundMap();
setupControls();
setupStream();
fetchGiftList(false);
fetchObsStatus();
fetchObsScenes();
fetchRules();
fetchSbStatus();
fetchSbActions();

if (elements.refreshGifts) {
    elements.refreshGifts.addEventListener('click', () => {
        fetchGiftList(true);
    });
}

if (elements.refreshObs) {
    elements.refreshObs.addEventListener('click', async () => {
        await fetchObsStatus();
        await fetchObsScenes();
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

if (elements.saveRule) {
    elements.saveRule.addEventListener('click', async () => {
        const type = elements.ruleType?.value || 'gift';
        const value = elements.ruleValue?.value?.trim();
        const actionType = elements.ruleAction?.value;

        if (!value) {
            appendItem(elements.log, `${new Date().toLocaleTimeString()} - rule missing value`);
            return;
        }

        const match = {
            type,
            field: type === 'command' ? 'command' : 'giftName',
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
