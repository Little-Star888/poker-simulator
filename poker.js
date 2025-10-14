// poker.js
import { Settings } from './setting.js';

/**
 * 德州扑克核心引擎
 * 职责：管理牌局状态、执行动作、提供状态查询
 * 不负责：UI 更新、AI 决策、流程自动推进
 */
export class PokerGame {
  constructor() {
    this.handCount = 0; // 新增：手牌计数器
    this.reset();
  }

  /**
   * 重置整个牌局（新游戏开始前调用）
   */
  reset() {
    const playerCount = Settings.playerCount;
    // 玩家状态：根据设置创建
    this.players = Array.from({ length: playerCount }, (_, i) => ({
      id: `P${i + 1}`,
      stack: 2000,          // 初始筹码（可配置）
      holeCards: [],        // 底牌 [card1, card2]
      bet: 0,               // 当前下注轮已投入
      totalInvested: 0,     // 本局总投入（用于摊牌后结算，当前未使用）
      isFolded: false,
      isAllIn: false,
      role: null,           // 新增：玩家角色
    }));

    this.communityCards = [];     // 公共牌（最多5张）
    this.pot = 0;                 // 当前底池（本版本不用于逻辑，仅状态）
    this.currentRound = null;     // 'preflop', 'flop', 'turn', 'river'
    this.currentPlayerIndex = -1; // 当前应行动的玩家索引
    this.highestBet = 0;          // 当前下注轮最高下注额
    this.minRaise = Settings.bb;  // 最小加注额（初始为大盲）
    this.deck = [];
    this.lastAggressorIndex = -1; // 新增：最后一位攻击性玩家的索引

    // 动态确定位置
    this.dealerIndex = (this.handCount) % playerCount; // 庄家位置轮换
    this.sbIndex = (this.dealerIndex + 1) % playerCount;
    this.bbIndex = (this.dealerIndex + 2) % playerCount;
    this.handCount++; // 为下一手牌做准备

    this._assignPlayerRoles(); // 分配角色
  }

  /**
   * 根据玩家人数和庄家位置分配角色
   */
  _assignPlayerRoles() {
    const playerCount = this.players.length;
    const roles = this._getRoleOrder(playerCount);

    this.players.forEach(player => player.role = null); // 重置所有角色

    for (let i = 0; i < playerCount; i++) {
      const playerIndex = (this.dealerIndex + i + 1) % playerCount;
      this.players[playerIndex].role = roles[i];
    }
  }

  /**
   * 根据玩家人数获取角色顺序 (参考Java代码)
   */
  _getRoleOrder(playerCount) {
    // 顺序：SB, BB, UTG, UTG+1, ..., CO, BTN(Dealer)
    const baseRoles = ['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP1', 'MP2', 'HJ', 'CO', 'BTN'];
    switch (playerCount) {
      case 2: return ['SB', 'BTN'];
      case 3: return ['SB', 'BB', 'BTN'];
      case 4: return ['SB', 'BB', 'CO', 'BTN'];
      case 5: return ['SB', 'BB', 'UTG', 'CO', 'BTN'];
      case 6: return ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];
      case 7: return ['SB', 'BB', 'UTG', 'MP1', 'HJ', 'CO', 'BTN'];
      case 8: return ['SB', 'BB', 'UTG', 'UTG+1', 'MP1', 'HJ', 'CO', 'BTN'];
      default: return baseRoles.slice(0, playerCount - 1).concat('BTN');
    }
  }

  /**
   * 设置当前游戏阶段并记录日志
   */
  setCurrentRound(round) {
    this.currentRound = round;
    console.log(`游戏阶段已更改为: ${round}`);
  }

  /**
   * 创建一副标准52张牌
   */
  createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    return suits.flatMap(suit => ranks.map(rank => `${suit}${rank}`));
  }

  /**
   * 洗牌（Fisher-Yates）
   */
  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  /**
   * 发底牌给所有玩家
   */
  dealHoleCards() {
    this.deck = this.createDeck();
    this.shuffleDeck();
    this.players.forEach(player => {
      player.holeCards = [this.deck.pop(), this.deck.pop()];
    });
  }

  /**
   * 发Flop（3张公共牌）
   */
  dealFlop() {
    if (this.deck.length < 4) throw new Error('Not enough cards to deal flop');
    this.deck.pop(); // burn card
    this.communityCards = [
      this.deck.pop(),
      this.deck.pop(),
      this.deck.pop()
    ];
  }

  /**
   * 发Turn或River（1张公共牌）
   */
  dealTurnOrRiver() {
    if (this.deck.length < 2) throw new Error('Not enough cards to deal turn/river');
    this.deck.pop(); // burn card
    this.communityCards.push(this.deck.pop());
  }

  /**
   * 初始化一个新的下注轮
   * @param {string} roundName - 'preflop', 'flop', 'turn', 'river'
   */
  startNewRound(roundName) {
    if (!['preflop', 'flop', 'turn', 'river'].includes(roundName)) {
      throw new Error(`Invalid round name: ${roundName}`);
    }

    this.setCurrentRound(roundName);
    this.highestBet = 0;
    this.minRaise = Settings.bb;
    this.lastAggressorIndex = -1; // 重置最后攻击者

    // 重置每轮下注，但保留preflop时的盲注
    this.players.forEach(p => {
      if (roundName !== 'preflop') {
        p.bet = 0;
      }
    });

    const playerCount = this.players.length;

    // 设置起始行动玩家
    if (roundName === 'preflop') {
      // Pre-flop: UTG (大盲下家) 开始
      // 2人局特殊处理，SB行动
      this.currentPlayerIndex = playerCount === 2 ? this.sbIndex : (this.bbIndex + 1) % playerCount;
      this.lastAggressorIndex = this.bbIndex; // 大盲是最初的“攻击者”
      // 设置盲注
      this._postBlinds();
    } else {
      // Post-flop: 庄家左边的第一个未弃牌玩家开始
      this.currentPlayerIndex = (this.dealerIndex + 1) % playerCount;
    }

    // 确保起始行动玩家是有效的（未弃牌且未全入）
    let attempts = 0;
    while (attempts < playerCount && 
           (this.players[this.currentPlayerIndex].isFolded || this.players[this.currentPlayerIndex].isAllIn)) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % playerCount;
      attempts++;
    }
  }

  /**
   * 内部：放置小盲和大盲
   */
  _postBlinds() {
    const playerCount = this.players.length;
    if (playerCount < 2) return;

    const sbPlayer = this.players[this.sbIndex];
    const bbPlayer = this.players[this.bbIndex];
    
    // 2人局特殊处理，庄家是小盲
    const sbAmount = (playerCount === 2) ? Settings.sb : Settings.sb;
    const bbAmount = Settings.bb;

    const sb = Math.min(sbAmount, sbPlayer.stack);
    const bb = Math.min(bbAmount, bbPlayer.stack);

    sbPlayer.bet = sb;
    sbPlayer.stack -= sb;
    sbPlayer.totalInvested += sb;
    if (sbPlayer.stack === 0) sbPlayer.isAllIn = true;

    bbPlayer.bet = bb;
    bbPlayer.stack -= bb;
    bbPlayer.totalInvested += bb;
    if (bbPlayer.stack === 0) bbPlayer.isAllIn = true;

    this.highestBet = bb;
  }

  /**
   * 执行玩家动作
   * @param {string} playerId - 如 'P3'
   * @param {string} action - 'FOLD', 'CALL', 'RAISE'
   * @param {number} amount - RAISE 时的总下注额（非加注额）
   */
  executeAction(playerId, action, amount = 0) {
    const playerIndex = this._getPlayerIndexById(playerId);
    if (playerIndex === -1) throw new Error(`Player ${playerId} not found`);
    if (playerIndex !== this.currentPlayerIndex) {
      throw new Error(`It's not ${playerId}'s turn`);
    }

    const player = this.players[playerIndex];
    if (player.isFolded || player.isAllIn) {
      throw new Error(`${playerId} cannot act (folded or all-in)`);
    }

    const currentBet = player.bet;
    const stack = player.stack;

    switch (action) {
      case 'FOLD':
        player.isFolded = true;
        break;

      case 'CALL':
        const callAmount = this.highestBet - currentBet;
        const actualCall = Math.min(callAmount, stack);
        player.bet += actualCall;
        player.stack -= actualCall;
        player.totalInvested += actualCall;
        if (player.stack === 0) player.isAllIn = true;
        break;

      case 'RAISE':
        if (amount < this.highestBet + this.minRaise) {
          throw new Error(`Raise must be at least ${this.highestBet + this.minRaise}`);
        }
        const totalRaise = Math.min(amount, player.stack + currentBet);
        const raiseDiff = totalRaise - currentBet;
        player.bet = totalRaise;
        player.stack -= raiseDiff;
        player.totalInvested += raiseDiff;
        if (player.stack === 0) player.isAllIn = true;
        this.highestBet = totalRaise;
        this.lastAggressorIndex = playerIndex; // 更新最后攻击者
        break;

      case 'BET': // 新增BET动作处理
        if (this.highestBet > 0) {
            throw new Error('Cannot BET, there is already a bet. Action should be RAISE.');
        }
        const betAmount = Math.min(amount, player.stack);
        if (betAmount < this.minRaise) {
            throw new Error(`Bet must be at least ${this.minRaise}`);
        }
        player.bet = betAmount;
        player.stack -= betAmount;
        player.totalInvested += betAmount;
        if (player.stack === 0) player.isAllIn = true;
        this.highestBet = betAmount;
        this.lastAggressorIndex = playerIndex; // 更新最后攻击者
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // 推进到下一位有效玩家（由 main.js 控制，此处仅标记）
    // 注意：此处不自动推进 currentPlayerIndex，由外部调用 moveToNextPlayer()
  }

  /**
   * 推进到下一位需要行动的玩家（跳过 FOLD/ALL-IN）
   * 由 main.js 在需要时调用
   */
  moveToNextPlayer() {
    let attempts = 0;
    const totalPlayers = this.players.length;
    do {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % totalPlayers;
      const currentPlayer = this.players[this.currentPlayerIndex];
      if (!currentPlayer.isFolded && !currentPlayer.isAllIn) {
        return; // 找到有效玩家
      }
      attempts++;
    } while (attempts < totalPlayers);

    // 如果所有玩家都 FOLD/ALL-IN，currentPlayerIndex 可能无效，由外部处理
  }

  /**
   * 判断当前下注轮是否结束（平注）
   * 条件：所有未弃牌且未全入的玩家下注额等于 highestBet
   * @returns {boolean}
   */
  isBettingRoundComplete() {
    const activePlayers = this.players.filter(p => !p.isFolded);
    if (activePlayers.length <= 1) {
      return true; // 只剩一人，轮次结束
    }

    const bettingPlayers = activePlayers.filter(p => !p.isAllIn);
    if (bettingPlayers.length === 0) {
      return true; // 所有人都全下，轮次结束
    }

    // 检查当前行动玩家是否是最后的攻击者
    const actionClosed = this.currentPlayerIndex === this.lastAggressorIndex;

    // 检查是否所有人都跟注了
    const allBetsEqual = bettingPlayers.every(p => p.bet === this.highestBet);

    // 翻前大盲选项的特殊情况
    if (this.currentRound === 'preflop' && this.lastAggressorIndex === this.bbIndex && this.highestBet === Settings.bb) {
        // 如果行动回到大盲，且无人加注，大盲有行动权，轮次未结束
        if (this.currentPlayerIndex === this.bbIndex) {
            return false;
        }
    }

    if (actionClosed && allBetsEqual) {
        return true;
    }

    // 如果所有人都过牌
    const allChecked = activePlayers.every(p => p.bet === 0) && this.highestBet === 0;
    // 需要一个方法来追踪是否所有人都行动过，这里简化处理：如果当前玩家是最后一个行动者，且所有人都check，则结束
    if (allChecked && this.currentPlayerIndex === this.sbIndex) { // 假设行动一圈后回到小盲
        return true;
    }

    return false;
  }

  /**
   * 获取当前行动玩家 ID，确保返回的是有效的未弃牌玩家
   */
  getCurrentPlayerId() {
    if (this.currentPlayerIndex === -1) return null;
    
    // 检查当前玩家是否有效（未弃牌且未全押）
    const currentPlayer = this.players[this.currentPlayerIndex];
    if (currentPlayer && !currentPlayer.isFolded && !currentPlayer.isAllIn) {
      return currentPlayer.id;
    }
    
    // 如果当前玩家无效，尝试找到下一个有效玩家
    let attempts = 0;
    const totalPlayers = this.players.length;
    let tempIndex = this.currentPlayerIndex;
    
    do {
      tempIndex = (tempIndex + 1) % totalPlayers;
      const player = this.players[tempIndex];
      if (player && !player.isFolded && !player.isAllIn) {
        this.currentPlayerIndex = tempIndex; // 更新当前玩家索引
        return player.id;
      }
      attempts++;
    } while (attempts < totalPlayers);
    
    // 如果所有玩家都无效
    return null;
  }

  /**
   * 获取完整游戏状态（供 AI 和 UI 使用）
   * 返回深拷贝，避免外部修改内部状态
   */
  getGameState() {
    return {
      players: this.players.map(p => ({ ...p })), // 浅拷贝对象（holeCards 是字符串数组，安全）
      communityCards: [...this.communityCards],
      currentRound: this.currentRound,
      currentPlayerId: this.getCurrentPlayerId(),
      pot: this.pot, // 本版本未精确计算，可后续完善
      highestBet: this.highestBet
    };
  }

  // --- 工具方法 ---

  _getPlayerIndexById(playerId) {
    return this.players.findIndex(p => p.id === playerId);
  }
}