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
    'LJ': 5, // Lowjack
    'HJ': 6, // Hijack
    'CO': 7, // Cut-off
    'BTN': 8, // Button (Dealer)
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
 * 根据行动历史计算在当前玩家行动前已经入池的对手数量
 * 参照Java HandContext.java中的calculateActiveOpponentsInPot方法逻辑
 * @param {Array} handActionHistory - 整个手牌的有序行动历史
 * @param {string} currentPlayerId - 当前玩家的ID
 * @returns {number} - 在当前玩家行动前，已经入池的对手数量
 */
export function calculateActiveOpponentsInPot(handActionHistory, currentPlayerId, bigBlind) {
    const preflopActions = handActionHistory.filter(event => event.round === 'preflop' && event.action && event.playerId);

    if (preflopActions.length === 0 || !bigBlind || bigBlind <= 0) {
        return 0;
    }

    const smallBlind = bigBlind / 2;
    const activePlayerIds = new Set();
    let sbPostFound = false;
    let bbPostFound = false;
    const VPIP_ACTIONS = ['CALL', 'RAISE', 'BET', 'ALL_IN']; // 主动入池动作

    for (const event of preflopActions) {
        const action = event.action;
        const playerId = event.playerId;
        const amount = event.amount || 0;

        // 只关心对手
        if (playerId === 'PUB' || playerId === currentPlayerId) {
            continue;
        }

        // 识别并跳过盲注的 "BET"
        if (action === 'BET') {
            // 检查是否为小盲注的自动下注
            if (!sbPostFound && Math.abs(amount - smallBlind) < 0.01) {
                sbPostFound = true;
                continue; // 跳过，因为这是SB的自动下注
            }
            // 检查是否为大盲注的自动下注
            if (!bbPostFound && Math.abs(amount - bigBlind) < 0.01) {
                bbPostFound = true;
                continue; // 跳过，因为这是BB的自动下注
            }
        }

        // 如果是其他VPIP动作，则计入
        if (VPIP_ACTIONS.includes(action)) {
            activePlayerIds.add(playerId);
        }
    }

    return activePlayerIds.size;
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

/**
 * 分析翻前的动态，找出是否存在跛入玩家（limpers）和加注者信息
 * 参照Java HandContext.java中的updateLimpersAndRaiserIncremental方法逻辑
 * @param {Array} handActionHistory - 整个手牌的有序行动历史
 * @param {Array} players - 包含玩家角色信息的玩家列表
 * @param {string} currentPlayerId - 当前玩家的ID，用于判断是否是翻前进攻者
 * @returns {{hasLimpers: boolean, limperCount: number, openRaiserPosition: string|null, threeBetPosition: string|null, fourBetPosition: string|null,
 *          wasPreFlopAggressor: boolean, openRaiserRaiseAmount: number, threeBetAmount: number, fourBetAmount: number,
 *          lastAggressorPosition: string|null, lastAggressorPositionRaiseAmount: number, lastAggressorPositionStack: number,
 *          heroIsLimper: boolean, heroIsIsoRaiser: boolean, threeBettorIsLimper: boolean}}
 */
export function calculatePreflopDynamics(handActionHistory, players, currentPlayerId) {
    let hasLimpers = false;
    let limperCount = 0;
    let heroIsLimper = false;
    let heroIsIsoRaiser = false; // 新增：自己是否是隔离加注者（用于iso_vs_limp3bet场景判断）
    let threeBettorIsLimper = false; // 新增：3bet者是否是原limper（用于iso_vs_limp3bet场景判断）
    let openRaiserPosition = null;
    let threeBetPosition = null;
    let fourBetPosition = null;
    let openRaiserRaiseAmount = 0;
    let threeBetAmount = 0;
    let fourBetAmount = 0;
    let lastAggressorPosition = null;
    let lastAggressorPositionRaiseAmount = 0;
    let lastAggressorPositionStack = 0;

    // 新增：用于记录具体的limper座位列表（用于精确判断3bet者是否是原limper）
    const limperSeats = [];

    const playerRoles = {};
    const playerStacks = {};
    players.forEach(p => {
        playerRoles[p.id] = p.role;
        playerStacks[p.id] = p.stack;
    });

    // 记录已弃牌的玩家
    const hasFolded = {};

    // 只分析翻前动作
    const preflopActions = handActionHistory.filter(event => event.round === 'preflop' && event.action && event.playerId);

    let raiseCount = 0;
    let lastRaiserId = null;

    // 统计加注次数并识别各个加注者
    for (const event of preflopActions) {
        const playerId = event.playerId;
        const action = event.action;

        // 记录弃牌
        if (action === 'FOLD') {
            hasFolded[playerId] = true;
            continue;
        }

        // 跳过已弃牌玩家的动作
        if (hasFolded[playerId]) {
            continue;
        }

        // 检测Limp：第一个RAISE之前的CALL大盲注
        if (raiseCount === 0 && action === 'CALL') {
            hasLimpers = true;
            limperCount++;

            // 记录具体的limper座位（用于精确判断3bet者是否是原limper）
            limperSeats.push(playerId);

            // 检测是否是当前玩家limp
            if (playerId === currentPlayerId && !heroIsLimper) {
                heroIsLimper = true;
                console.log(`[GTO Logic] 检测到当前玩家 ${currentPlayerId} 是limper，已标记`);
            }
            continue;
        }

        // 检测加注动作
        if (action === 'RAISE' || action === 'ALL_IN') {
            raiseCount++;
            lastRaiserId = playerId;

            switch (raiseCount) {
                case 1:
                    // 第一个加注者（Open Raiser）
                    openRaiserPosition = playerRoles[playerId] || null;
                    openRaiserRaiseAmount = event.amount || 0;

                    // 检测是否是Hero的隔离加注（在有limper的情况下）
                    if (hasLimpers && playerId === currentPlayerId && !heroIsIsoRaiser) {
                        heroIsIsoRaiser = true;
                        console.log(`[GTO Logic] 检测到Hero ${currentPlayerId} 是隔离加注者（iso_vs_limp3bet），已标记`);
                    }
                    break;
                case 2:
                    // 第二个加注者（3bet）
                    threeBetPosition = playerRoles[playerId] || null;
                    threeBetAmount = event.amount || 0;

                    // 检测3bet者是否是原limper（使用更精确的判断）
                    if (hasLimpers) {
                        // 使用更精确的判断：3bet者必须是原limper之一
                        threeBettorIsLimper = limperSeats.includes(playerId);
                        if (threeBettorIsLimper) {
                            console.log(`[GTO Logic] 检测到3bet玩家 ${playerId} 是原limper，iso_vs_limp3bet场景成立`);
                        } else {
                            console.log(`[GTO Logic] 检测到3bet玩家 ${playerId} 不是原limper，不是iso_vs_limp3bet场景`);
                        }
                    }
                    break;
                case 3:
                    // 第三个加注者（4bet）
                    fourBetPosition = playerRoles[playerId] || null;
                    fourBetAmount = event.amount || 0;
                    break;
                // 更多加注暂不处理，因为后端模型只支持到4bet
            }

            // 更新最后一个进攻者信息
            lastAggressorPosition = playerRoles[playerId] || null;
            lastAggressorPositionRaiseAmount = event.amount || 0;
            lastAggressorPositionStack = event.leftChips || playerStacks[playerId] || 0;
        }
    }

    // 判断当前玩家是否是翻前进攻者
    const wasPreFlopAggressor = lastRaiserId === currentPlayerId;

    return {
        hasLimpers,
        limperCount,
        heroIsLimper,
        heroIsIsoRaiser, // 新增：自己是否是隔离加注者（用于iso_vs_limp3bet场景判断）
        threeBettorIsLimper, // 新增：3bet者是否是原limper（用于iso_vs_limp3bet场景判断）
        openRaiserPosition,
        threeBetPosition,
        fourBetPosition,
        wasPreFlopAggressor,
        openRaiserRaiseAmount,
        threeBetAmount,
        fourBetAmount,
        lastAggressorPosition,
        lastAggressorPositionRaiseAmount,
        lastAggressorPositionStack
    };
}
