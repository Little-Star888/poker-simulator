import { Settings } from './setting.js';
import { calculateHasPosition, calculateFlopActionSituation, calculatePreflopDynamics, calculateActiveOpponentsInPot } from './gto_logic.js';

/**
 * 调用后端GTO建议API的服务模块
 */

// --- Mappings to match backend enum integer values ---
const ROLE_MAP = {
    'BTN': 0, 'SB': 1, 'BB': 2, 'UTG': 3, 'UTG+1': 4, 
    'UTG+2': 5, 'LJ': 6, 'HJ': 7, 'CO': 8,
};

const POT_TYPE_MAP = {
    'unopened': 0,      // UNOPENED_POT - 翻前无人入池
    'limped': 1,        // LIMPED_POT - 有人limp但无人加注
    'single_raised': 2, // OPEN_RAISED_POT - 有首次加注
    '3bet': 3,          // THREE_BET_POT - 有3bet
    '4bet': 4           // FOUR_BET_POT - 有4bet
};

const PHASE_MAP = {
    'PREFLOP': 1,
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
    if (!cardString || cardString.length < 2) return '';

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

    // 当不处于翻牌圈时，计算结果为null，但API需要一个值，我们提供一个默认值0
    const flopSitString = calculateFlopActionSituation(gameState, currentPlayerId, actionHistory);
    const flopSitInt = flopSitString ? FLOP_ACTION_SITUATION_MAP[flopSitString] : 0;

    // 计算翻前动态信息，包括limpers和加注者位置信息
    const preflopDynamics = calculatePreflopDynamics(handActionHistory, gameState.players, currentPlayerId);

    // 使用计算出的hasLimpers信息来动态计算potType
    const calculatedPotType = calculatePotType(gameState.preflopRaiseCount, preflopDynamics.hasLimpers);

    // 计算活跃对手数量，并传入BB金额以排除盲注
    const activeOpponents = calculateActiveOpponentsInPot(handActionHistory, currentPlayerId, Settings.bb);

    const requestDto = {
        phase: PHASE_MAP[gameState.currentRound.toUpperCase()],
        myRole: ROLE_MAP[player.role],
        myCards: player.holeCards.map(formatCardForAPI),
        boardCards: gameState.communityCards.map(formatCardForAPI),
        opponents: gameState.players.filter(p => !p.isFolded && p.id !== currentPlayerId).length,
        bigBlind: Settings.bb,
        hasPosition: calculateHasPosition(gameState, currentPlayerId),
        potChips: gameState.pot,
        toCall: Math.max(0, gameState.highestBet - player.bet),
        myStack: player.stack,
        potType: calculatedPotType, // 使用动态计算的值（考虑hasLimpers）
        openRaiserPosition: preflopDynamics.openRaiserPosition ? ROLE_MAP[preflopDynamics.openRaiserPosition] : null,
        threeBetPosition: preflopDynamics.threeBetPosition ? ROLE_MAP[preflopDynamics.threeBetPosition] : null,
        fourBetPosition: preflopDynamics.fourBetPosition ? ROLE_MAP[preflopDynamics.fourBetPosition] : null,
        hasLimpers: preflopDynamics.hasLimpers,
        limperCount: preflopDynamics.limperCount, // 新增：limp玩家具体人数
        flopActionSituation: flopSitInt, // 使用处理过的整数值
        preFlopRaisers: gameState.preflopRaiseCount, // 补充参数
        // 新增字段：翻前进攻者相关信息
        wasPreFlopAggressor: preflopDynamics.wasPreFlopAggressor,
        openRaiserRaiseAmount: preflopDynamics.openRaiserRaiseAmount,
        threeBetAmount: preflopDynamics.threeBetAmount,
        fourBetAmount: preflopDynamics.fourBetAmount,
        // 最后一个进攻者信息
        lastAggressorPosition: preflopDynamics.lastAggressorPosition ? ROLE_MAP[preflopDynamics.lastAggressorPosition] : null,
        lastAggressorPositionRaiseAmount: preflopDynamics.lastAggressorPositionRaiseAmount,
        lastAggressorPositionStack: preflopDynamics.lastAggressorPositionStack,
        activeOpponentsInPot: activeOpponents, // 新增：已入池的对手数量
    };

    // 构建URL查询参数
    const params = new URLSearchParams();
    for (const key in requestDto) {
        const value = requestDto[key];
        if (value === null || value === undefined) continue;

        if (Array.isArray(value)) {
            value.forEach(v => params.append(key, v));
        } else {
            params.append(key, value);
        }
    }

    console.log(`[DEBUG] For ${currentPlayerId} (preflopRaiseCount: ${gameState.preflopRaiseCount}) -> Sending potType: ${calculatedPotType}`);
    console.log(`Requesting suggestion for ${currentPlayerId}: /poker/suggestion?${params.toString()}`);

    const response = await fetch(`/poker/suggestion?${params.toString()}`);

    if (!response.ok) {
        const errorText = await response.text();
        console.error('GTO suggestion API error:', errorText);
        throw new Error(`API请求失败: ${response.status} ${errorText}`);
    }

    const suggestionResponse = await response.json();

    // 同时返回请求和响应，以便保存快照
    return { request: requestDto, response: suggestionResponse };
}