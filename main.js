// main.js
import { Settings } from './setting.js';
import { PokerGame } from './poker.js';
import { getDecision } from './ai.js';

// ========== 全局状态 ==========
let game = new PokerGame();
let isGameRunning = false;
let isWaitingForManualInput = false;

// 存储玩家行动记录 - 改为数组结构以支持同一阶段多次操作
let actionRecords = {
  P1: { preflop: [], flop: [], turn: [], river: [] },
  P2: { preflop: [], flop: [], turn: [], river: [] },
  P3: { preflop: [], flop: [], turn: [], river: [] },
  P4: { preflop: [], flop: [], turn: [], river: [] },
  P5: { preflop: [], flop: [], turn: [], river: [] },
  P6: { preflop: [], flop: [], turn: [], river: [] },
  P7: { preflop: [], flop: [], turn: [], river: [] },
  P8: { preflop: [], flop: [], turn: [], river: [] }
};

// 每个阶段默认4列（不再需要跟踪操作次数）
let stageActionCounts = {
  preflop: 4,
  flop: 4,
  turn: 4,
  river: 4
};

// ========== DOM 元素引用 ==========
// 左侧桌面区域
const manualActionArea = document.getElementById('manual-action-area');
const manualPlayerLabel = document.getElementById('manual-player-label');
const raiseInput = document.getElementById('raise-amount');
const foldBtn = document.getElementById('fold-btn');
const callBtn = document.getElementById('call-btn');
const raiseBtn = document.getElementById('raise-btn');
const confirmBtn = document.getElementById('confirm-action-btn');

// 右侧控制面板
const modeSelect = document.getElementById('mode-select');
const playerCountInput = document.getElementById('player-count-input');
const sbInput = document.getElementById('sb-input');
const bbInput = document.getElementById('bb-input');
const showHoleCardsCheckbox = document.getElementById('show-hole-cards');
const autoDelayInput = document.getElementById('auto-delay');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const consoleLog = document.getElementById('console-log');

// ========== 初始化 ==========
function init() {
  // 绑定配置变更
  modeSelect.value = Settings.mode;
  playerCountInput.value = Settings.playerCount;
  sbInput.value = Settings.sb;
  bbInput.value = Settings.bb;
  showHoleCardsCheckbox.checked = Settings.showHoleCards;
  autoDelayInput.value = Settings.autoDelay;

  modeSelect.addEventListener('change', () => {
    Settings.update({ mode: modeSelect.value });
    console.log(Settings.mode)
    isWaitingForManualInput = modeSelect.value === 'manual';
    toggleManualActionArea(modeSelect.value === 'manual'); // 切换模式时隐藏手动区
  });
  playerCountInput.addEventListener('change', () => {
    Settings.update({ playerCount: parseInt(playerCountInput.value) || 8 });
    updatePlayerDisplay(); // 更新牌桌上的玩家显示
  });
  sbInput.addEventListener('change', () => Settings.update({ sb: parseInt(sbInput.value) || 50 }));
  bbInput.addEventListener('change', () => Settings.update({ bb: parseInt(bbInput.value) || 100 }));
  showHoleCardsCheckbox.addEventListener('change', () => Settings.update({ showHoleCards: showHoleCardsCheckbox.checked }));
  autoDelayInput.addEventListener('change', () => Settings.update({ autoDelay: parseInt(autoDelayInput.value) || 1000 }));

  // 绑定按钮
  startBtn.addEventListener('click', startNewGame);
  restartBtn.addEventListener('click', restartGame);

  // 手动操作按钮
  foldBtn.addEventListener('click', () => submitManualAction('FOLD'));
  callBtn.addEventListener('click', () => {
      const gameState = game.getGameState();
      const player = gameState.players.find(p => p.id === game.getCurrentPlayerId());
      const toCall = gameState.highestBet - player.bet;
      submitManualAction(toCall === 0 ? 'CHECK' : 'CALL');
  });
  raiseBtn.addEventListener('click', handleRaiseClick);

  updatePlayerDisplay(); // 初始化时根据默认玩家数量更新显示
  log('德州扑克 AI 测试模拟器已加载');
}

// ========== 游戏控制 ==========
function startNewGame() {
  console.log('startNewGame 被调用');
  if (isGameRunning) {
    log('游戏已在运行中');
    return;
  }

  try {
    // 重置游戏状态
    game.reset();
    console.log('游戏重置完成，currentRound:', game.currentRound);

    // 渲染UI组件
    updatePlayerDisplay();
    renderActionSheet();

    game.dealHoleCards();

    console.log('开始preflop阶段前');
    game.startNewRound('preflop');
    console.log('开始preflop阶段后，currentRound:', game.currentRound);
    isGameRunning = true;

    // 手动记录小盲和大盲的BET动作
    console.log('记录小盲和大盲的BET动作');
    updateActionSheet(game.players[game.sbIndex].id, 'BET', Settings.sb);
    updateActionSheet(game.players[game.bbIndex].id, 'BET', Settings.bb);

    log('✅ 新牌局开始！盲注: SB=' + Settings.sb + ', BB=' + Settings.bb);
    log(`[SYSTEM] ${game.players[game.sbIndex].id} posts Small Blind ${Settings.sb}`);
    log(`[SYSTEM] ${game.players[game.bbIndex].id} posts Big Blind ${Settings.bb}`);
    updateUI();
    console.log('UI已更新');

    // 自动模式下立即开始
    if (Settings.mode === 'auto') {
      console.log('自动模式开始，调用processNextAction');
      setTimeout(processNextAction, Settings.autoDelay);
    }
  } catch (e) {
    log('❌ 启动失败: ' + e.message);
    isGameRunning = false;
  }
}

function updatePlayerDisplay() {
  const playerCount = Settings.playerCount;
  for (let i = 1; i <= 8; i++) {
    const playerElement = document.querySelector(`.player[data-player="P${i}"]`);
    if (playerElement) {
      playerElement.style.display = i <= playerCount ? 'block' : 'none';
    }
  }
}

function restartGame() {
  isGameRunning = false;
  isWaitingForManualInput = false;
  toggleManualActionArea(false);
  startNewGame();
}

// ========== 主流程引擎 ==========
async function processNextAction() {
  const TAG = 'processNextAction '
  if (!isGameRunning) return;

  const currentPlayerId = game.getCurrentPlayerId();
  log(`调试: 处理下一个动作，当前玩家: ${currentPlayerId}`);
  if (!currentPlayerId) {
    // 无有效玩家，结束牌局
    log(`调试: 无有效玩家，结束牌局`);
    endGame();
    return;
  }

  try {
    console.log(TAG + Settings.mode)
    if (Settings.mode === 'manual') {
      // 手动模式：显示操作面板，等待用户输入
      log(`调试: 手动模式，等待 ${currentPlayerId} 输入`);
      showManualActionPanel(currentPlayerId);
      isWaitingForManualInput = true;
      return;
    }

    // 自动模式：调用 AI 获取决策
    const gameState = game.getGameState();
    const decision = await getDecision(gameState, currentPlayerId);

    // 执行动作
    game.executeAction(currentPlayerId, decision.action, decision.amount);
    log(`[${game.currentRound}] ${currentPlayerId} ${decision.action}${decision.amount ? ' ' + decision.amount : ''}`);
    showActionBubble(currentPlayerId, decision.action, decision.amount);

    // 调试信息：显示当前游戏阶段
    console.log(`当前游戏阶段: ${game.currentRound}, 当前玩家: ${currentPlayerId}, 动作: ${decision.action}`);

    // 更新行动记录
    updateActionSheet(currentPlayerId, decision.action, decision.amount);

    // 检查当前下注轮是否结束
    if (game.isBettingRoundComplete()) {
      advanceToNextStage();
    } else {
      // 推进到下一位玩家
      game.moveToNextPlayer();
      updateUI();
      // 继续自动流程
      setTimeout(processNextAction, Settings.autoDelay);
    }
  } catch (e) {
    log(`❌ ${currentPlayerId} 行动出错: ${e.message}`);
    // 可选：跳过该玩家或结束游戏
  }
}

function handleRaiseClick() {
  if (raiseInput.style.display === 'none' || raiseInput.style.display === '') {
    // 显示输入框
    raiseInput.style.display = 'inline';
    raiseInput.value = ''; // 清空
    raiseInput.focus();
    raiseBtn.textContent = '确认 RAISE';
  } else {
    // 提交 RAISE
    const amount = parseInt(raiseInput.value);
    if (isNaN(amount) || amount <= 0) {
      log('请输入有效的加注金额');
      return;
    }
    submitManualAction('RAISE', amount);
  }
}

function advanceToNextStage() {
  const currentRound = game.currentRound;
  if (currentRound === 'river') {
    endGame();
    return;
  }

  // 发下一张公共牌
  if (currentRound === 'preflop') {
    game.dealFlop();
  } else {
    game.dealTurnOrRiver();
  }

  // 进入下一轮，使用内置的startNewRound方法
  const nextRound = getNextRound(currentRound);
  game.startNewRound(nextRound);

  log(`➡️ 进入 ${nextRound} 阶段 | 公共牌: ${game.communityCards.join(' ')}`);

  // 添加调试信息：显示新轮次的起始玩家
  const newCurrentPlayerId = game.getCurrentPlayerId();
  log(`调试: 新阶段起始玩家: ${newCurrentPlayerId}`);

  updateUI();

  // 继续游戏流程
  setTimeout(processNextAction, Settings.autoDelay);
}

function getNextRound(currentRound) {
  const rounds = ['preflop', 'flop', 'turn', 'river'];
  const idx = rounds.indexOf(currentRound);
  return idx !== -1 && idx < rounds.length - 1 ? rounds[idx + 1] : 'river';
}

function endGame() {
  isGameRunning = false;
  isWaitingForManualInput = false;
  toggleManualActionArea(false);
  log('🎉 牌局结束！（本版本不计算胜负）');
}

// ========== 手动模式交互 ==========
function showManualActionPanel(playerId) {
  const gameState = game.getGameState();
  const player = gameState.players.find(p => p.id === playerId);
  const toCall = gameState.highestBet - player.bet;

  manualPlayerLabel.textContent = `轮到 ${playerId} 行动`;
  callBtn.textContent = toCall === 0 ? 'CHECK' : `CALL (${toCall})`;
  raiseInput.value = gameState.highestBet + Settings.bb; // 默认加注额
  raiseInput.style.display = 'none';

  toggleManualActionArea(true);
}

function submitManualAction(action, amount) {
  const TAG = 'submitManualAction '
  console.log(TAG + isWaitingForManualInput)
  console.log(TAG + action + ' ' + amount + ' ' + game.getCurrentPlayerId())
  if (!isWaitingForManualInput) return;

  const currentPlayerId = game.getCurrentPlayerId();
  try {
    // 执行动作
    game.executeAction(currentPlayerId, action, amount);
    log(`[${game.currentRound}] ${currentPlayerId} ${action}${amount ? ' ' + amount : ''}`);
    showActionBubble(currentPlayerId, action, amount);

    // 更新行动记录
    updateActionSheet(currentPlayerId, action, amount);

    // 添加调试信息：显示所有玩家的状态
    const activePlayers = game.players.filter(p => !p.isFolded).map(p => p.id).join(', ');
    log(`调试: 活跃玩家: ${activePlayers}`);

    // 隐藏手动区
    toggleManualActionArea(false);
    isWaitingForManualInput = false;

    // 恢复 RAISE 按钮文本
    raiseBtn.textContent = 'RAISE';
    raiseInput.style.display = 'none';

    // 检查轮次是否结束...
    const isRoundComplete = game.isBettingRoundComplete();
    log(`调试: 下注轮是否结束: ${isRoundComplete}`);

    if (isRoundComplete) {
      log(`调试: 进入下一阶段，当前阶段: ${game.currentRound}`);
      advanceToNextStage();
    } else {
      game.moveToNextPlayer();
      const nextPlayerId = game.getCurrentPlayerId();
      log(`调试: 推进到下一位玩家: ${nextPlayerId}`);
      updateUI();
      if (Settings.mode === 'manual') {
        processNextAction(); // 继续等待下一位玩家
      }
    }
  } catch (e) {
    log(`❌ 无效操作: ${e.message}`);
  }
}

function toggleManualActionArea(show) {
  manualActionArea.style.display = show ? 'block' : 'none';
}

// ========== ActionSheet 相关函数 ==========
function renderActionSheet() {
  const tableBody = document.getElementById('action-sheet-body');
  tableBody.innerHTML = ''; // 清空现有内容

  const playerCount = Settings.playerCount;
  const players = game.players;
  const sbIndex = game.sbIndex;

  // 重置行动记录数据
  actionRecords = {};
  players.forEach(player => {
    actionRecords[player.id] = {
      preflop: [],
      flop: [],
      turn: [],
      river: []
    };
  });

  // 从SB开始，按顺序创建表格行
  for (let i = 0; i < playerCount; i++) {
    const playerIndex = (sbIndex + i) % playerCount;
    const player = players[playerIndex];
    const playerId = player.id;
    const playerRole = player.role || '';
    const row = document.createElement('tr');
    
    let rowHtml = `<td style="border: 1px solid #ddd; padding: 8px; text-align: center; font-weight: bold;">${playerId} (${playerRole})</td>`;
    
    const stages = ['preflop', 'flop', 'turn', 'river'];
    stages.forEach(stage => {
      for (let j = 0; j < 4; j++) {
        rowHtml += `<td id="${playerId}-${stage}-${j}" style="border: 1px solid #ddd; padding: 8px; text-align: center;">-</td>`;
      }
    });

    row.innerHTML = rowHtml;
    tableBody.appendChild(row);
  }
}

function updateActionSheet(playerId, action, amount) {
  console.log(`updateActionSheet 被调用: playerId=${playerId}, action=${action}, amount=${amount}, currentRound=${game.currentRound}`);

  // 获取当前阶段并确保是小写形式
  const currentStage = (game.currentRound || '').toLowerCase();

  // 验证阶段名称是否有效
  const validStages = ['preflop', 'flop', 'turn', 'river'];
  if (!validStages.includes(currentStage)) {
    console.log(`无效的游戏阶段: ${currentStage}`);
    return;
  }

  // 确保玩家ID有效
  if (!actionRecords[playerId]) {
    console.log(`无效的玩家ID: ${playerId}`);
    return;
  }

  // 格式化动作文本（使用完整名称）
  let actionText = '';
  switch (action) {
    case 'FOLD':
      actionText = 'FOLD';
      break;
    case 'CALL':
      actionText = amount !== undefined && amount !== null ? `CALL ${amount}` : 'CALL';
      break;
    case 'CHECK':
      actionText = 'CHECK';
      break;
    case 'RAISE':
      actionText = amount !== undefined && amount !== null ? `RAISE ${amount}` : 'RAISE';
      break;
    case 'BET':
      actionText = amount !== undefined && amount !== null ? `BET ${amount}` : 'BET';
      break;
    default:
      actionText = action;
  }

  // 获取该玩家在当前阶段的操作次数
  const actionCount = actionRecords[playerId][currentStage].length;

  // 添加新的操作记录
  actionRecords[playerId][currentStage].push(actionText);
  console.log(`更新行动记录: ${playerId}.${currentStage}[${actionCount}] = ${actionText}`);

  // 确保操作次数不超过4次（因为每个阶段只有4列）
  if (actionCount >= 4) {
    console.log(`警告: ${currentStage}阶段操作次数已达4次上限`);
    return;
  }

  // 更新UI - 使用统一的ID格式: 玩家ID-阶段-索引
  const cellId = `${playerId}-${currentStage}-${actionCount}`;

  console.log(`尝试更新单元格: ${cellId}`);
  const cell = document.getElementById(cellId);
  if (cell) {
    console.log(`找到单元格 ${cellId}，更新内容为: ${actionText}`);
    cell.textContent = actionText;
  } else {
    console.log(`未找到单元格: ${cellId}`);
  }
}

// ========== 工具函数 ==========
/**
 * 将卡牌文本转换为对应的图片路径
 * @param {string} cardText - 卡牌文本，如 '♠A', '♥10' 等
 * @returns {string} 图片路径
 */
function getCardImagePath(cardText) {
  if (!cardText) return '';

  // 提取花色和点数
  const suit = cardText[0]; // 第一个字符是花色
  const rank = cardText.slice(1); // 剩余部分是点数

  // 花色映射
  const suitMap = {
    '♠': 'S', // Spade
    '♥': 'H', // Heart
    '♦': 'D', // Diamond
    '♣': 'C'  // Club
  };

  // 获取对应的花色字母
  const suitLetter = suitMap[suit] || '';

  // 返回图片路径
  return `cards/${rank}${suitLetter}.png`;
}

/**
 * 设置卡牌元素的背景图片
 * @param {HTMLElement} cardElement - 卡牌DOM元素
 * @param {string} cardText - 卡牌文本，如 '♠A', '♥10' 等
 */
function setCardImage(cardElement, cardText) {
  if (!cardElement) return;

  if (cardText) {
    const imagePath = getCardImagePath(cardText);
    console.log(`Setting card image for ${cardText} to ${imagePath}`); // DEBUG LOG
    cardElement.style.backgroundImage = `url(${imagePath})`;
  } else {
    console.log('Clearing card image because cardText is empty.'); // DEBUG LOG
    cardElement.style.backgroundImage = '';
  }
}

// ========== UI 更新与日志 ==========
function updateUI() {
  const gameState = game.getGameState();
  console.log('Inside updateUI. showHoleCards:', Settings.showHoleCards); // DEBUG

  // 更新玩家状态（简化：仅更新高亮和折叠）
  document.querySelectorAll('.player').forEach(el => {
    const playerId = el.dataset.player;
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return;

    // 高亮当前玩家
    el.classList.toggle('active', playerId === gameState.currentPlayerId);
    // 置灰 FOLD 玩家
    el.classList.toggle('folded', player.isFolded);

    // 更新底牌（P1始终显示，其他玩家根据明牌模式）
    if (playerId === 'P1' || Settings.showHoleCards) {
      const cardEls = el.querySelectorAll('.hole-card');
      console.log(`Player ${playerId}: found ${cardEls.length} hole-card elements.`); // DEBUG
      if (cardEls.length >= 2) {
        // 设置第一张牌
        setCardImage(cardEls[0], player.holeCards[0]);
        // 设置第二张牌
        setCardImage(cardEls[1], player.holeCards[1]);
      }
    } else {
      // 如果不是P1且不是明牌模式，清空卡牌图片
      const cardEls = el.querySelectorAll('.hole-card');
      cardEls.forEach(cardEl => {
        cardEl.style.backgroundImage = '';
      });
    }

    // 更新筹码（可选）
    const stackEl = el.querySelector('.stack');
    if (stackEl) stackEl.textContent = `S: ${player.stack}`;

    const betEl = el.querySelector('.player-bet');
    if (betEl) {
        betEl.textContent = player.bet > 0 ? `B: ${player.bet}` : '';
    }

    // 更新角色显示

    // 更新角色显示
    const roleEl = el.querySelector('.player-role');
    if (roleEl) {
      roleEl.textContent = player.role || '';
    }
  });

  // 更新公共牌
  const communityCardEls = document.querySelectorAll('.community-card');
  communityCardEls.forEach((el, i) => {
    if (i < gameState.communityCards.length) {
      const imagePath = getCardImagePath(gameState.communityCards[i]);
      el.style.backgroundImage = `url(${imagePath})`;
    } else {
      // 如果没有公共牌，清空背景图片
      el.style.backgroundImage = '';
    }
  });
}

function log(message) {
  const now = new Date().toLocaleTimeString();
  consoleLog.value += `[${now}] ${message}\n`;
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

function showActionBubble(playerId, action, amount) {
    const playerElement = document.querySelector(`.player[data-player="${playerId}"]`);
    if (!playerElement) return;

    const bubble = playerElement.querySelector('.action-bubble');
    if (!bubble) return;

    let text = action;
    if (action === 'CALL' || action === 'RAISE' || action === 'BET') {
        if (amount > 0) {
            text += ` ${amount}`;
        }
    }

    // 强制重置动画和内容
    bubble.classList.remove('show', 'fade-out');
    bubble.style.animation = 'none';
    bubble.offsetHeight; /* 触发浏览器重绘 */
    bubble.style.animation = null;

    // 更新内容并显示
    bubble.textContent = text;
    bubble.classList.add('show');

    // 动画结束后隐藏
    setTimeout(() => {
        bubble.classList.add('fade-out');
    }, 1500); // 气泡显示1.5秒
}

// ========== 启动 ==========
document.addEventListener('DOMContentLoaded', init);