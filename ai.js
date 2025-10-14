// ai.js
import { Settings } from './setting.js';

/**
 * AI 决策代理模块
 * 职责：根据当前游戏状态，返回玩家应采取的动作
 * 当前为 Mock 实现（带权重的随机），未来可替换为真实 AI API
 */

// 定义不同动作的权重，数值越大，被随机到的概率越高
// 定义不同动作的权重，数值越大，被随机到的概率越高
const ACTION_WEIGHTS = {
  CHECK: 5, // 过牌/让牌，最高概率
  CALL: 4,  // 跟注
  FOLD: 3,  // 弃牌
  BET: 2,   // 主动下注
  RAISE: 1, // 加注
  ALLIN: 0, // 全下，最低概率
};

/**
 * 获取玩家的决策建议
 * @param {Object} gameState - 来自 poker.js 的游戏状态快照
 * @param {string} playerId - 当前行动玩家 ID，如 'P3'
 * @returns {Promise<{ action: string, amount?: number }>}
 */
export async function getDecision(gameState, playerId) {
  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 200));

  const player = gameState.players.find(p => p.id === playerId);
  if (!player) {
    throw new Error(`Player ${playerId} not found in game state`);
  }

  const { stack, bet: currentBet } = player;
  const { highestBet, lastRaiseAmount } = gameState;
  const toCall = highestBet - currentBet;

  // 新增逻辑：如果筹码过少，则强制执行特定动作
  if (stack < 100) {
    // 如果可以免费看牌，就CHECK
    if (toCall === 0) {
      return { action: 'CHECK' };
    }
    // 否则，强制弃牌
    return { action: 'FOLD' };
  }

  // 1. 根据德州扑克规则，确定所有合法的动作类型
  const possibleActions = [];
  if (toCall === 0) {
    possibleActions.push('CHECK');
    if (stack > 0) {
      possibleActions.push('BET');
      possibleActions.push('ALLIN'); // 在可以下注时，总可以All-in
    }
  } else {
    possibleActions.push('FOLD');

    if (stack >= toCall) {
      possibleActions.push('CALL');
      if (stack > toCall) {
        possibleActions.push('RAISE');
        possibleActions.push('ALLIN'); // 在可以加注时，总可以All-in
      }
    } else {
      // 筹码不足以跟注，此时 CALL 或 ALLIN 都会是 all-in
      possibleActions.push('CALL');
      possibleActions.push('ALLIN');
    }
  }

  // 2. 根据权重创建一个“动作池”
  const weightedActions = [];
  for (const action of possibleActions) {
    const weight = ACTION_WEIGHTS[action] || 1; // 如果没定义权重，默认为1
    for (let i = 0; i < weight; i++) {
      weightedActions.push(action);
    }
  }

  // 3. 从“动作池”中随机选择一个动作
  if (weightedActions.length === 0) {
    return { action: 'CHECK' }; // Fallback
  }
  const selectedAction = weightedActions[Math.floor(Math.random() * weightedActions.length)];

  // 4. 如果是下注或加注，计算一个合法的随机金额
  switch (selectedAction) {
    case 'BET': {
      const minBet = Math.min(Settings.bb, stack);
      const reasonableMaxBet = Math.max(minBet, Math.floor(stack / 2));
      let betAmount = Math.floor(Math.random() * (reasonableMaxBet - minBet + 1)) + minBet;
      betAmount = Math.min(betAmount, stack);
      return { action: 'BET', amount: betAmount };
    }
    case 'RAISE': {
      const minRaiseTarget = highestBet + lastRaiseAmount;
      const maxRaiseTarget = stack + currentBet;
      if (minRaiseTarget >= maxRaiseTarget) {
        return { action: 'RAISE', amount: maxRaiseTarget };
      }
      let raiseAmount = Math.floor(Math.random() * (maxRaiseTarget - minRaiseTarget + 1)) + minRaiseTarget;
      return { action: 'RAISE', amount: raiseAmount };
    }
    case 'ALLIN': {
        return { action: 'ALLIN', amount: stack + currentBet };
    }
    default:
      // FOLD, CALL, CHECK 不需要金额
      return { action: selectedAction };
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