/**
 * GTO 相关逻辑计算模块
 * 移植自 HandContext.java
 */

// 德州扑克中，翻后行动顺序是固定的，此对象用于给每个角色（位置）一个数值，值越大表示行动越靠后
const ROLE_ORDER_VALUE = {
    'SB': 0,
    'BB': 1,
    'UTG': 2,
    'UTG+1': 3,
    'UTG+2': 4,
    'MP1': 5,
    'MP2': 6,
    'HJ': 7, // Hijack
    'CO': 8, // Cut-off
    'BTN': 9, // Button (Dealer)
};

/**
 * 计算当前玩家是否拥有“位置优势” (hasPosition)
 * @param {object} gameState - 游戏状态
 * @param {string} currentPlayerId - 当前行动的玩家ID
 * @returns {boolean} - 是否有位置
 */
export function calculateHasPosition(gameState, currentPlayerId) {
    const { players, currentRound } = gameState;

    // 翻前逻辑简化：通常认为只有BTN和CO有绝对位置优势
    if (currentRound === 'preflop') {
        const currentPlayer = players.find(p => p.id === currentPlayerId);
        return currentPlayer.role === 'BTN' || currentPlayer.role === 'CO';
    }

    // 翻后逻辑：判断自己是否是当前牌局中，最后一个行动的人
    const activePlayers = players.filter(p => !p.isFolded);
    if (activePlayers.length <= 1) {
        return true; // 如果只剩自己，相当于有位置
    }

    let lastToActPlayer = null;
    let maxOrderValue = -1;

    for (const player of activePlayers) {
        const orderValue = ROLE_ORDER_VALUE[player.role] || -1;
        if (orderValue > maxOrderValue) {
            maxOrderValue = orderValue;
            lastToActPlayer = player;
        }
    }

    return lastToActPlayer && lastToActPlayer.id === currentPlayerId;
}

/**
 * 分析当前玩家在翻牌圈面临的局势 (flopActionSituation)
 * @param {object} gameState - 游戏状态
 * @param {string} currentPlayerId - 当前行动的玩家ID
 * @param {object} actionHistory - 所有玩家的历史行动记录
 * @returns {string} - FIRST_TO_ACT, FACING_BET, 或 AFTER_CHECK
 */
export function calculateFlopActionSituation(gameState, currentPlayerId, actionHistory) {
    if (gameState.currentRound !== 'flop') {
        return null; // 此参数仅用于翻牌圈
    }

    const flopActions = [];
    // 收集翻牌圈的所有行动
    for (const playerId in actionHistory) {
        const playerActions = actionHistory[playerId].flop;
        if (playerActions && playerActions.length > 0) {
            // 这里简化处理，只考虑每个玩家的第一次行动
            flopActions.push({ playerId, action: playerActions[0] });
        }
    }

    // 如果翻牌圈还没有任何人行动，那么当前玩家就是第一个行动的人
    if (flopActions.length === 0) {
        return 'FIRST_TO_ACT';
    }

    // 检查在自己行动之前，是否有其他玩家已经下注或加注
    const hasOpponentBet = flopActions.some(a => 
        a.playerId !== currentPlayerId && 
        (a.action.startsWith('BET') || a.action.startsWith('RAISE'))
    );

    if (hasOpponentBet) {
        return 'FACING_BET';
    }

    // 如果既不是第一个行动，也没面临下注，那说明是有人Check之后轮到自己
    return 'AFTER_CHECK';
}
