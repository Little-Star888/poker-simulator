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
    this.players = Array.from({ length: playerCount }, (_, i) => {
      const min = Math.min(Settings.minStack, Settings.maxStack);
      const max = Math.max(Settings.minStack, Settings.maxStack);
      const randomStack = Math.floor(Math.random() * (max - min + 1)) + min;

      return {
        id: `P${i + 1}`,
        stack: randomStack, // 初始筹码（随机范围）
        holeCards: [],        // 底牌 [card1, card2]
        bet: 0,               // 当前下注轮已投入
        totalInvested: 0,     // 本局总投入（用于摊牌后结算，当前未使用）
        isFolded: false,
        isAllIn: false,
        hasActed: false,      // 新增：本轮是否已行动
        role: null,           // 新增：玩家角色
      };
    });

    this.communityCards = [];     // 公共牌（最多5张）
    this.pot = 0;                 // 当前底池（本版本不用于逻辑，仅状态）
    this.currentRound = null;     // 'preflop', 'flop', 'turn', 'river'
    this.currentPlayerIndex = -1; // 当前应行动的玩家索引
    this.highestBet = 0;          // 当前下注轮最高下注额
    this.minRaise = Settings.bb;  // 最小加注额（初始为大盲）
    this.lastRaiseAmount = Settings.bb; // 新增：本轮最后的加注额
    this.deck = [];
    this.lastAggressorIndex = -1; // 新增：最后一位攻击性玩家的索引
    this.preflopRaiseCount = 0; // 新增：翻牌前加注次数计数器

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
    this.lastRaiseAmount = Settings.bb; // 重置最后的加注额
    this.lastAggressorIndex = -1; // 重置最后攻击者

    // 重置每轮状态
    this.players.forEach(p => {
      // 在新一轮开始前（翻牌、转牌、河牌），将上一轮的投注收集进主底池
      if (roundName !== 'preflop') {
        this.pot += p.bet;
        p.bet = 0;
      }
      // 为所有未弃牌的玩家重置行动状态
      if (!p.isFolded) {
        p.hasActed = false;
      }
    });

    const playerCount = this.players.length;

    // 设置起始行动玩家
    if (roundName === 'preflop') {
      this.currentPlayerIndex = playerCount === 2 ? this.sbIndex : (this.bbIndex + 1) % playerCount;
      this.lastAggressorIndex = this.bbIndex; // 大盲是最初的“攻击者”
      this._postBlinds();
    } else {
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
  }

  /**
   * 执行玩家动作
   * @param {string} playerId - 如 'P3'
   * @param {string} action - 'FOLD', 'CALL', 'RAISE', 'CHECK', 'BET'
   * @param {number} amount - RAISE 或 BET 时的总下注额
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

    // 如果动作是ALLIN，先将其转换为BET或RAISE，再进入switch处理
    if (action === 'ALLIN') {
        amount = player.stack + player.bet; // 计算出all-in的总金额
        action = this.highestBet > 0 ? 'RAISE' : 'BET'; // 根据场上情况判断是BET还是RAISE
    }

    const currentBet = player.bet;
    const stack = player.stack;
    player.hasActed = true; // 标记玩家已行动

    switch (action) {
      case 'FOLD':
        player.isFolded = true;
        break;

      case 'CHECK':
        if (player.bet < this.highestBet) {
            throw new Error(`Cannot check, must call ${this.highestBet} or fold.`);
        }
        break;

      case 'CALL':
        const callAmount = this.highestBet - currentBet;
        const actualCall = Math.min(callAmount, stack);
        player.bet += actualCall;
        player.stack -= actualCall;
        player.totalInvested += actualCall;
        if (player.stack === 0) player.isAllIn = true;
        break;

      case 'RAISE': {
        const raiseAmount = amount - this.highestBet;
        const isAllIn = (player.stack + player.bet) === amount;

        // DEBUGGING LOG
        console.log('--- RAISE DEBUG ---');
        console.log(`Player ID: ${player.id}`);
        console.log(`Player Stack: ${player.stack}, Player Bet: ${player.bet}`);
        console.log(`Total Chips: ${player.stack + player.bet}`);
        console.log(`Raise To Amount: ${amount}`);
        console.log(`Is All-In: ${isAllIn}`);
        console.log(`Raise Amount: ${raiseAmount}`);
        console.log(`Last Raise Amount: ${this.lastRaiseAmount}`);
        console.log('-------------------');


        // 检查加注额是否合法。一个加注如果小于最小加注额，那么只有在是All-In的情况下才被允许。
        if (raiseAmount < this.lastRaiseAmount && !isAllIn) {
          throw new Error(`Raise must be at least ${this.lastRaiseAmount}. Your raise of ${raiseAmount} is too small.`);
        }

        const totalBetAfterRaise = amount;
        if (player.stack + player.bet < totalBetAfterRaise) {
          throw new Error('Not enough stack to raise to this amount.');
        }

        const amountToPutInForRaise = totalBetAfterRaise - player.bet;
        player.bet += amountToPutInForRaise;
        player.stack -= amountToPutInForRaise;
        player.totalInvested += amountToPutInForRaise;

        if (player.stack === 0) {
          player.isAllIn = true;
        }

        this.highestBet = totalBetAfterRaise;

        // 只有当加注是一个“完整”的加注时（即加注量不小于上一个加注量），
        // 才更新 lastRaiseAmount 并重新开启这一轮的行动。
        if (raiseAmount >= this.lastRaiseAmount) {
          if (this.currentRound === 'preflop') {
            this.preflopRaiseCount++;
          }
          this.lastRaiseAmount = raiseAmount;
          this.lastAggressorIndex = playerIndex; // 更新最后攻击者
          this.players.forEach(p => { if (!p.isFolded && !p.isAllIn) p.hasActed = false; }); // 为其他玩家开启新一轮行动
        }

        player.hasActed = true; // 当前玩家总是被标记为已行动
        break;
      }

      case 'BET':
        if (this.highestBet > 0) {
            throw new Error('Cannot BET, there is already a bet. Action should be RAISE.');
        }
        const betAmount = Math.min(amount, player.stack);
        if (betAmount < this.minRaise && betAmount < player.stack) { // all-in is a valid bet
            throw new Error(`Bet must be at least ${this.minRaise}`);
        }
        player.bet = betAmount;
        player.stack -= betAmount;
        player.totalInvested += betAmount;
        if (player.stack === 0) player.isAllIn = true;
        this.highestBet = betAmount;
        this.lastRaiseAmount = betAmount;
        this.lastAggressorIndex = playerIndex; // 更新最后攻击者
        this.players.forEach(p => { if (!p.isFolded && !p.isAllIn) p.hasActed = false; }); // 新一轮行动
        player.hasActed = true;
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }
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
  }

  /**
   * 判断当前下注轮是否结束（平注）
   * @returns {boolean}
   */
  isBettingRoundComplete() {
    const activePlayers = this.players.filter(p => !p.isFolded);
    if (activePlayers.length <= 1) {
      return true;
    }

    const bettingPlayers = activePlayers.filter(p => !p.isAllIn);
    // 如果场上只剩一个或零个玩家可以下注
    if (bettingPlayers.length <= 1) {
      // 如果恰好还剩一个玩家
      if (bettingPlayers.length === 1) {
        const lastManStanding = bettingPlayers[0];
        // 如果这个玩家还需要跟注，那么牌局未结束
        if (lastManStanding.bet < this.highestBet) {
          return false;
        }
      }
      // 如果唯一的玩家不需跟注，或所有人都All-in了，则牌局结束
      return true;
    }

    // 检查所有可以下注的玩家是否都已经行动过
    const allHaveActed = bettingPlayers.every(p => p.hasActed);
    if (!allHaveActed) {
      return false;
    }

    // 检查所有可以下注的玩家的下注额是否一致
    const firstBet = bettingPlayers[0].bet;
    const allBetsEqual = bettingPlayers.every(p => p.bet === firstBet);

    return allBetsEqual;
  }

  /**
   * 检查是否进入摊牌（Showdown）阶段
   * 当所有未弃牌的玩家都已All-in时，即为摊牌
   * @returns {boolean}
   */
  isShowdown() {
    const activePlayers = this.players.filter(p => !p.isFolded);
    // 必须至少有2个玩家摊牌
    if (activePlayers.length < 2) {
      return false;
    }
    // 检查所有活跃玩家是否都已All-in
    const bettingPlayers = activePlayers.filter(p => !p.isAllIn);
    return bettingPlayers.length === 0;
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
    // 动态计算总底池：已收集的底池 + 当前下注轮的未收集投注
    const currentRoundBets = this.players.reduce((sum, p) => sum + p.bet, 0);
    const totalPot = this.pot + currentRoundBets;

    return {
      players: this.players.map(p => ({ ...p })), // 浅拷贝对象（holeCards 是字符串数组，安全）
      communityCards: [...this.communityCards],
      currentRound: this.currentRound,
      currentPlayerId: this.getCurrentPlayerId(),
      pot: totalPot, // 使用动态计算的底池
      highestBet: this.highestBet,
      lastRaiseAmount: this.lastRaiseAmount, // 新增
      preflopRaiseCount: this.preflopRaiseCount, // 新增
      minRaise: this.minRaise
    };
  }

  // --- 工具方法 ---

  _getPlayerIndexById(playerId) {
    return this.players.findIndex(p => p.id === playerId);
  }
}