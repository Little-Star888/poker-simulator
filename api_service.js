import { Settings } from './setting.js';
import { calculateHasPosition, calculateFlopActionSituation, calculatePreflopDynamics } from './gto_logic.js';

/**
 * 调用后端GTO建议API的服务模块
 */

// --- Mappings to match backend enum integer values ---
const ROLE_MAP = {
    'BTN': 0, 'SB': 1, 'BB': 2, 'UTG': 3, 'UTG+1': 4, 
    'UTG+2': 5, 'LJ': 6, 'HJ': 7, 'CO': 8,
};

const POT_TYPE_MAP = {
    'single_raised': 0,
    '3bet': 2,
    '4bet': 3,
    'unrestricted': 4, // Maps to UNOPENED_POT
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
 * 根据翻前加注次数，动态计算后端API所需的potType
 * @param {number} preflopRaiseCount - 翻前加注次数
 * @returns {number} - 对应后端的potType枚举值
 */
function calculatePotType(preflopRaiseCount) {
    switch (preflopRaiseCount) {
        case 0:
            return 4; // UNOPENED_POT (前端叫 unrestricted)
        case 1:
            return 0; // single_raised
        case 2:
            return 2; // 3bet
        default:
            return 3; // 4bet and higher
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
    // 动态计算potType，而不是从Settings中写死
    const calculatedPotType = calculatePotType(gameState.preflopRaiseCount);

    const { hasLimpers, openRaiserPosition } = calculatePreflopDynamics(handActionHistory, gameState.players);

    const requestDto = {
        myCards: player.holeCards.map(formatCardForAPI),
        boardCards: gameState.communityCards.map(formatCardForAPI),
        myRole: ROLE_MAP[player.role],
        myStack: player.stack,
        potChips: gameState.pot,
        toCall: Math.max(0, gameState.highestBet - player.bet),
        opponents: gameState.players.filter(p => !p.isFolded && p.id !== currentPlayerId).length,
        preFlopRaisers: gameState.preflopRaiseCount, // 补充参数
        potType: calculatedPotType, // 使用动态计算的值
        hasPosition: calculateHasPosition(gameState, currentPlayerId),
        flopActionSituation: flopSitInt, // 使用处理过的整数值
        phase: PHASE_MAP[gameState.currentRound.toUpperCase()],
        bigBlind: Settings.bb,
        hasLimpers: hasLimpers,
        openRaiserPosition: openRaiserPosition ? ROLE_MAP[openRaiserPosition] : null,
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