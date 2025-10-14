// poker.js
import { Settings } from './setting.js';

/**
 * 德州扑克核心引擎
 * 职责：管理牌局状态、执行动作、提供状态查询
 * 不负责：UI 更新、AI 决策、流程自动推进
 */
export class PokerGame {
  constructor() {
    this.reset();
  }

  /**
   * 重置整个牌局（新游戏开始前调用）
   */
  reset() {
    // 玩家状态：P1 ~ P8
    this.players = Array.from({ length: 8 }, (_, i) => ({
      id: `P${i + 1}`,
      stack: 2000,          // 初始筹码（可配置）
      holeCards: [],        // 底牌 [card1, card2]
      bet: 0,               // 当前下注轮已投入
      totalInvested: 0,     // 本局总投入（用于摊牌后结算，当前未使用）
      isFolded: false,
      isAllIn: false
    }));

    this.communityCards = [];     // 公共牌（最多5张）
    this.pot = 0;                 // 当前底池（本版本不用于逻辑，仅状态）
    this.currentRound = null;     // 'preflop', 'flop', 'turn', 'river'
    this.currentPlayerIndex = -1; // 当前应行动的玩家索引（0=P1）
    this.highestBet = 0;          // 当前下注轮最高下注额
    this.minRaise = Settings.bb;  // 最小加注额（初始为大盲）
    this.deck = [];
    this.dealerIndex = 7;         // P8 为庄（0-based index）
    this.sbIndex = 0;             // P1 为小盲
    this.bbIndex = 1;             // P2 为大盲
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

    // 使用setCurrentRound方法设置当前游戏阶段
    this.setCurrentRound(roundName);
    this.highestBet = 0;
    this.minRaise = Settings.bb;

    // 重置每轮下注
    this.players.forEach(p => {
      p.bet = 0;
    });

    // 设置起始行动玩家
    if (roundName === 'preflop') {
      // Pre-flop: UTG (大盲下家) 开始，即 P3 (index=2)
      this.currentPlayerIndex = 2;
      // 设置盲注
      this._postBlinds();
    } else {
      // Post-flop: 庄家下家开始 (dealerIndex + 1) % 8
      this.currentPlayerIndex = (this.dealerIndex + 1) % 8;
      
      // 确保起始行动玩家是有效的（未弃牌且未全入）
      // 如果当前玩家无效，寻找下一位有效玩家
      let attempts = 0;
      const totalPlayers = this.players.length;
      let currentPlayer = this.players[this.currentPlayerIndex];
      
      while (attempts < totalPlayers && 
             (currentPlayer.isFolded || currentPlayer.isAllIn)) {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % totalPlayers;
        currentPlayer = this.players[this.currentPlayerIndex];
        attempts++;
      }
    }
  }

  /**
   * 内部：放置小盲和大盲
   */
  _postBlinds() {
    const sbPlayer = this.players[this.sbIndex];
    const bbPlayer = this.players[this.bbIndex];
    const sb = Math.min(Settings.sb, sbPlayer.stack);
    const bb = Math.min(Settings.bb, bbPlayer.stack);

    sbPlayer.bet = sb;
    sbPlayer.stack -= sb;
    sbPlayer.totalInvested += sb;
    if (sbPlayer.stack === 0) sbPlayer.isAllIn = true;

    bbPlayer.bet = bb;
    bbPlayer.stack -= bb;
    bbPlayer.totalInvested += bb;
    if (bbPlayer.stack === 0) bbPlayer.isAllIn = true;

    this.highestBet = bb;
    
    // 记录盲注动作到ActionSheet
    // 注意：这里需要调用外部的updateActionSheet函数，所以会在main.js中处理
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
    // 获取所有未弃牌的玩家
    const activePlayers = this.players.filter(p => !p.isFolded);
    
    // 如果只剩一名活跃玩家，结束下注轮
    if (activePlayers.length <= 1) return true;
    
    // 获取所有未弃牌且未全入的玩家
    const bettingPlayers = activePlayers.filter(p => !p.isAllIn);
    
    // 如果没有可下注的玩家（所有人都全入），则结束下注轮
    if (bettingPlayers.length === 0) return true;

    // 特殊处理：在Post-flop阶段（flop, turn, river），如果highestBet为0（即没有玩家下注）
    // 则需要让所有玩家都至少进行一次CHECK操作，不能因为highestBet为0就直接结束下注轮
    if (this.currentRound !== 'preflop' && this.highestBet === 0) {
      // 检查是否所有未弃牌的玩家都已至少行动一次（通过检查他们的bet是否与初始值不同）
      // 在Post-flop阶段，所有玩家的初始bet都是0，所以这个检查不够准确
      // 更好的方法是添加一个hasActed标志，但为了不改变现有数据结构，我们采用变通方法
      // 在Post-flop阶段且最高注为0时，除非只剩一名玩家或所有人都全入，否则下注轮不结束
      return false;
    }

    // 检查所有可下注玩家是否已跟注到最高注
    // 这是判断下注轮结束的标准之一
    return bettingPlayers.every(p => p.bet === this.highestBet);
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