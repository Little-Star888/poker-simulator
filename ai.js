// ai.js

/**
 * AI 决策代理模块
 * 职责：根据当前游戏状态，返回玩家应采取的动作
 * 当前为 Mock 实现（随机 + 简单规则），未来可替换为真实 AI API
 */

/**
 * 获取玩家的决策建议
 * @param {Object} gameState - 来自 poker.js 的游戏状态快照
 * @param {string} playerId - 当前行动玩家 ID，如 'P3'
 * @returns {Promise<{ action: string, amount?: number }>} 
 *   - action: 'FOLD' | 'CALL' | 'RAISE'
 *   - amount: 仅 RAISE 时需要（总下注额）
 */
export async function getDecision(gameState, playerId) {
  // 模拟网络延迟（可选，让自动模式更真实）
  await new Promise(resolve => setTimeout(resolve, 200));

  const player = gameState.players.find(p => p.id === playerId);
  if (!player) {
    throw new Error(`Player ${playerId} not found in game state`);
  }

  const { holeCards, stack, bet: currentBet } = player;
  const { highestBet, currentRound, communityCards } = gameState;

  // 计算需要跟注的金额
  const toCall = highestBet - currentBet;
  const canRaise = stack > toCall; // 是否有足够筹码加注

  // 简单策略：根据牌力和轮次决定行为
  const handStrength = estimateHandStrength(holeCards, communityCards, currentRound);

  // 随机扰动（模拟不确定性）
  const randomFactor = Math.random();

  // 决策逻辑
  if (handStrength < 0.3) {
    // 弱牌：大概率弃牌，小概率跟注（看便宜牌）
    if (toCall === 0) {
      return { action: 'CALL' }; // 免费看牌
    } else if (toCall <= 10 && randomFactor < 0.3) {
      return { action: 'CALL' };
    } else {
      return { action: 'FOLD' };
    }
  } else if (handStrength < 0.6) {
    // 中等牌：跟注为主，偶尔加注
    if (toCall === 0) {
      // 无人下注：尝试偷池
      return randomFactor < 0.4 
        ? { action: 'RAISE', amount: Math.min(stack, Math.max(highestBet + 100, 200)) }
        : { action: 'CALL' };
    } else if (toCall <= stack * 0.3) {
      return { action: 'CALL' };
    } else {
      return randomFactor < 0.2 ? { action: 'CALL' } : { action: 'FOLD' };
    }
  } else {
    // 强牌：积极下注
    if (toCall === 0) {
      // 无人下注：下注
      const raiseAmount = Math.min(stack, Math.max(highestBet + 150, 300));
      return { action: 'RAISE', amount: raiseAmount };
    } else if (toCall <= stack * 0.5) {
      // 跟注或加注
      return randomFactor < 0.6 
        ? { action: 'CALL' }
        : { action: 'RAISE', amount: Math.min(stack + currentBet, highestBet * 2) };
    } else {
      // 大额下注：全下或跟注
      return randomFactor < 0.7 
        ? { action: 'CALL' }
        : { action: 'RAISE', amount: stack + currentBet }; // 全下
    }
  }
}

/**
 * 简单估算手牌强度（0.0 ~ 1.0）
 * 注意：这是非常简化的模拟，仅用于测试
 * @param {string[]} holeCards - 如 ['♠A', '♥K']
 * @param {string[]} communityCards - 公共牌
 * @param {string} round - 当前轮次
 * @returns {number} 0.0 (最弱) ~ 1.0 (最强)
 */
function estimateHandStrength(holeCards, communityCards, round) {
  if (!holeCards || holeCards.length !== 2) return 0.1;

  const [card1, card2] = holeCards;
  const rank1 = getRankValue(card1.slice(1));
  const rank2 = getRankValue(card2.slice(1));
  const suit1 = card1[0];
  const suit2 = card2[0];

  let strength = 0.2; // 基础值

  // 对子
  if (rank1 === rank2) {
    strength += 0.3;
    if (rank1 >= 10) strength += 0.2; // 高对
  }
  // 同花
  else if (suit1 === suit2) {
    strength += 0.15;
  }
  // 连张
  if (Math.abs(rank1 - rank2) === 1 || Math.abs(rank1 - rank2) === 12) {
    strength += 0.1;
  }

  // 高牌
  const highCard = Math.max(rank1, rank2);
  if (highCard >= 12) strength += 0.15; // A/K
  else if (highCard >= 10) strength += 0.1; // Q/J/10

  // 根据轮次调整（Flop 后更准确）
  if (round !== 'preflop' && communityCards.length >= 3) {
    // 简单：如果有公共牌，略微提升信心
    strength = Math.min(1.0, strength * 1.2);
  }

  return Math.min(1.0, Math.max(0.0, strength));
}

/**
 * 将牌面字符串转为数值（2=2, ..., A=14）
 */
function getRankValue(rankStr) {
  const map = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
    '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };
  return map[rankStr] || 2;
}