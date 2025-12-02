import { Settings } from './setting.js';
import { calculateHasPosition, calculateFlopActionSituation, calculatePreflopDynamics, calculateActiveOpponentsInPot } from './gto_logic.js';

/**
 * 调用后端GTO建议API的服务模块
 */

// --- Mappings to match backend enum values ---
const ROLE_MAP = {
    'BTN': 0,      // DEALER
    'SB': 1,       // SMALL_BLIND
    'BB': 2,       // BIG_BLIND
    'UTG': 3,      // UNDER_THE_GUN
    'UTG+1': 4,    // UNDER_THE_GUN_PLUS_1
    'UTG+2': 5,    // UNDER_THE_GUN_PLUS_2
    'LJ': 6,       // LOW_JACK
    'HJ': 7,       // HIJACK
    'CO': 8,       // CUT_OFF
};

const POT_TYPE_MAP = {
    'unopened': 0,      // UNOPENED_POT - 翻前无人入池
    'limped': 1,        // LIMPED_POT - 有人limp但无人加注
    'single_raised': 2, // OPEN_RAISED_POT - 有首次加注
    '3bet': 3,          // THREE_BET_POT - 有3bet
    '4bet': 4           // FOUR_BET_POT - 有4bet
};

const PHASE_MAP = {
    'PREFLOP': 1,  // PRE_FLOP - 确保与后端 StrategyPhase 枚举值匹配 (1-4)
    'FLOP': 2,
    'TURN': 3,
    'RIVER': 4,
};

const FLOP_ACTION_SITUATION_MAP = {
    'FIRST_TO_ACT': 0,
    'FACING_BET': 1,
    'AFTER_CHECK': 2,
};

/**
 * 将前端模拟器的牌张格式，转换为后端API要求的格式
 * e.g. '♠A' -> 'As', '♥10' -> 'Th'
 * @param {string} cardString - 前端格式的牌
 * @returns {string} - 后端API格式的牌
 */
function formatCardForAPI(cardString) {
    if (!cardString || cardString.length < 2) return "";

    const suitSymbol = cardString[0];
    let rank = cardString.slice(1);

    const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
    const suit = suitMap[suitSymbol];

    // 后端通常使用 'T' 代表 10
    if (rank === '10') {
        rank = 'T';
    }

    return rank + suit;
}


/**
 * 根据翻前加注次数和是否有limper，动态计算后端API所需的potType
 * @param {number} preflopRaiseCount - 翻前加注次数
 * @param {boolean} hasLimpers - 是否有limper玩家
 * @returns {number} - 对应后端的potType枚举值
 */
function calculatePotType(preflopRaiseCount, hasLimpers = false) {
    switch (preflopRaiseCount) {
        case 0:
            return hasLimpers ? 1 : 0; // 有limper返回LIMPED_POT(1)，无limper返回UNOPENED_POT(0)
        case 1:
            return 2; // OPEN_RAISED_POT
        case 2:
            return 3; // THREE_BET_POT
        default:
            return preflopRaiseCount >= 3 ? 4 : 0; // 4bet及以上返回FOUR_BET_POT(4)
    }
}

/**
 * 转换 actionHistory 为新的 DTO 结构
 * @param {Array} handActionHistory - 手牌动作历史
 * @param {Array} players - 玩家信息
 * @returns {Map} - 按阶段分组的动作历史
 */
function convertActionHistoryToDto(handActionHistory, players) {
    const actionHistoryMap = {};

    // 初始化各阶段的动作历史 - 使用后端枚举的数值作为键
    [1, 2, 3, 4].forEach(phase => {
        actionHistoryMap[phase] = [];
    });

    // 过滤并转换动作历史
    handActionHistory.forEach(event => {
        if (!event.action || !event.playerId || event.type === 'initialState' || event.type === 'dealCommunity') {
            return;
        }

        const player = players.find(p => p.id === event.playerId);
        if (!player) return;

        // 添加调试日志
        if (event.action === 'CALL') {
            console.log(`[DEBUG] CALL动作转换: 玩家=${event.playerId}, 原始amount=${event.amount}, 转换后amount=${event.amount || 0}`);
        }

        // 使用数值映射阶段 - 对应后端 StrategyPhase 枚举值
        const phaseMap = {
            'preflop': 1,  // PRE_FLOP
            'flop': 2,     // FLOP
            'turn': 3,     // TURN
            'river': 4     // RIVER
        };

        const targetPhase = phaseMap[event.round];
        if (targetPhase === undefined) return;

        // 映射动作到后端枚举数值 - 对应后端 Action.java 中的枚举值 (0-5)
        const actionMap = {
            'fold': 0,    // FOLD
            'check': 1,   // CHECK
            'call': 2,    // CALL
            'bet': 3,     // BET
            'raise': 4,   // RAISE
            'allin': 5    // ALL_IN
        };

        const action = actionMap[event.action.toLowerCase()];
        if (action === undefined) return;

        // 获取角色枚举值 (0-8)
        const roleValue = ROLE_MAP[player.role || ''];
        if (roleValue === undefined) return;

        actionHistoryMap[targetPhase].push({
            role: roleValue,
            action: action,
            amount: event.amount || 0,
            stack: player.stack || 0,
            imageName: '', // 前端暂不需要图片名
            timestamp: event.timestamp || Date.now()
        });
    });

    return actionHistoryMap;
}

/**
 * 获取GTO建议
 * @param {object} gameState
 * @param {string} currentPlayerId
 * @param {object} actionHistory
 * @param {Array} handActionHistory
 * @returns {Promise<object>} - API返回的建议
 */
export async function getSuggestion(gameState, currentPlayerId, actionHistory, handActionHistory) {
    console.log(`[DEBUG] getSuggestion called for ${currentPlayerId}. Received preflopRaiseCount: ${gameState.preflopRaiseCount}`);
    const player = gameState.players.find(p => p.id === currentPlayerId);
    if (!player) throw new Error('Player not found for suggestion');

    // 注意：以下变量在新 DTO 中不再需要，暂时注释保留以备后用
    // const flopSitString = calculateFlopActionSituation(gameState, currentPlayerId, actionHistory);
    // const flopSitInt = flopSitString ? FLOP_ACTION_SITUATION_MAP[flopSitString] : 0;
    // const preflopDynamics = calculatePreflopDynamics(handActionHistory, gameState.players, currentPlayerId);
    // const calculatedPotType = calculatePotType(gameState.preflopRaiseCount, preflopDynamics.hasLimpers);
    // const activeOpponents = calculateActiveOpponentsInPot(handActionHistory, currentPlayerId, Settings.bb);

    const requestDto = {
        handId: gameState.handId || `hand_${Date.now()}`, // 添加 handId
        phase: PHASE_MAP[gameState.currentRound?.toUpperCase() || 'PREFLOP'],
        myRole: ROLE_MAP[player.role || ''],
        myCards: player.holeCards.map(formatCardForAPI),
        boardCards: gameState.communityCards.map(formatCardForAPI),
        bigBlind: Settings.bb,
        ante: Settings.ante || 0, // 添加 ante 字段，默认为 0
        opponents: gameState.players.filter(p => !p.isFolded && p.id !== currentPlayerId).length,
        myStack: player.stack,
        potChips: gameState.pot,
        toCall: Math.max(0, gameState.highestBet - player.bet),
        actionHistory: convertActionHistoryToDto(handActionHistory, gameState.players) // 转换为新的 DTO 格式
    };

    // 移除 URL 参数构建，改用 POST JSON body 请求

    console.log(`[DEBUG] For ${currentPlayerId} (preflopRaiseCount: ${gameState.preflopRaiseCount}) -> Sending new DTO format via POST`);
    console.log(`Requesting suggestion for ${currentPlayerId}: /poker/suggestion`);
    console.log('Request body:', JSON.stringify(requestDto, null, 2));

    const response = await fetch(`/poker/suggestion`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestDto)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('GTO suggestion API error:', errorText);
        throw new Error(`API请求失败: ${response.status} ${errorText}`);
    }

    const suggestionResponse = await response.json();

    // 同时返回请求和响应，以便保存快照
    return { request: requestDto, response: suggestionResponse };
}