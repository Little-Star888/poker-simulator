// main.js
import { Settings } from './setting.js';
import { PokerGame } from './poker.js';
import { getDecision } from './ai.js';
import { getSuggestion } from './api_service.js';

// ========== 全局状态 ==========
let game = new PokerGame();
let isGameRunning = false;
let isWaitingForManualInput = false;
let isGamePaused = false;

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

// 预设功能相关状态
let activeSelectionSlot = null;
let usedCards = new Set();
let isPresetUIInitialized = false;

// ========== DOM 元素引用 ==========
const manualActionArea = document.getElementById('manual-action-area');
const manualPlayerLabel = document.getElementById('manual-player-label');
const raiseInput = document.getElementById('raise-amount');
const foldBtn = document.getElementById('fold-btn');
const callBtn = document.getElementById('call-btn');
const raiseBtn = document.getElementById('raise-btn');

const modeSelect = document.getElementById('mode-select');
const playerCountInput = document.getElementById('player-count-input');
const minStackInput = document.getElementById('min-stack-input');
const maxStackInput = document.getElementById('max-stack-input');
const potTypeSelect = document.getElementById('pot-type-select');
const sbInput = document.getElementById('sb-input');
const bbInput = document.getElementById('bb-input');
const showHoleCardsCheckbox = document.getElementById('show-hole-cards');
const autoDelayInput = document.getElementById('auto-delay');
const suggestPreflopCheckbox = document.getElementById('suggest-preflop');
const suggestFlopCheckbox = document.getElementById('suggest-flop');
const suggestTurnCheckbox = document.getElementById('suggest-turn');
const suggestRiverCheckbox = document.getElementById('suggest-river');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const consoleLog = document.getElementById('console-log');

const usePresetHandsCheckbox = document.getElementById('use-preset-hands-checkbox');
const usePresetCommunityCheckbox = document.getElementById('use-preset-community-checkbox');
const presetControls = document.getElementById('preset-controls');
const presetPlayerHandsContainer = document.getElementById('preset-player-hands-container');
const presetCommunityCardsContainer = document.getElementById('preset-community-cards-container');
const cardPicker = document.getElementById('card-picker');

// ========== 初始化 ==========
function init() {
  // 绑定配置变更
  modeSelect.addEventListener('change', () => {
    Settings.update({ mode: modeSelect.value });
    isWaitingForManualInput = modeSelect.value === 'manual';
    toggleManualActionArea(modeSelect.value === 'manual');
  });
  playerCountInput.addEventListener('change', () => {
    Settings.update({ playerCount: parseInt(playerCountInput.value) || 8 });
    updatePlayerDisplay();
    if (Settings.usePresetHands) {
      buildPlayerSlots();
    }
  });
  minStackInput.addEventListener('change', () => Settings.update({ minStack: parseInt(minStackInput.value) || 2000 }));
  maxStackInput.addEventListener('change', () => Settings.update({ maxStack: parseInt(maxStackInput.value) || 2000 }));
  potTypeSelect.addEventListener('change', () => Settings.update({ potType: potTypeSelect.value }));

  sbInput.addEventListener('input', () => {
    const sbValue = parseInt(sbInput.value) || 0;
    const newBbValue = sbValue * 2;
    bbInput.value = newBbValue;
    Settings.update({ sb: sbValue, bb: newBbValue });
  });

  showHoleCardsCheckbox.addEventListener('change', () => Settings.update({ showHoleCards: showHoleCardsCheckbox.checked }));
  autoDelayInput.addEventListener('change', () => Settings.update({ autoDelay: parseInt(autoDelayInput.value) || 1000 }));
  suggestPreflopCheckbox.addEventListener('change', () => Settings.update({ suggestOnPreflop: suggestPreflopCheckbox.checked }));
  suggestFlopCheckbox.addEventListener('change', () => Settings.update({ suggestOnFlop: suggestFlopCheckbox.checked }));
  suggestTurnCheckbox.addEventListener('change', () => Settings.update({ suggestOnTurn: suggestTurnCheckbox.checked }));
  suggestRiverCheckbox.addEventListener('change', () => Settings.update({ suggestOnRiver: suggestRiverCheckbox.checked }));

  startBtn.addEventListener('click', handleStartOrRestartClick);
  pauseBtn.addEventListener('click', handlePauseResumeClick);

  // 绑定牌局预设功能
  usePresetHandsCheckbox.addEventListener('change', updatePresetVisibility);
  usePresetCommunityCheckbox.addEventListener('change', updatePresetVisibility);

  foldBtn.addEventListener('click', () => submitManualAction('FOLD'));
  callBtn.addEventListener('click', () => {
      const gameState = game.getGameState();
      const player = gameState.players.find(p => p.id === game.getCurrentPlayerId());
      const toCall = gameState.highestBet - player.bet;
      submitManualAction(toCall === 0 ? 'CHECK' : 'CALL');
  });
  raiseBtn.addEventListener('click', handleRaiseClick);

  updatePlayerDisplay();
  log('德州扑克 AI 测试模拟器已加载');
}

// ========== 牌局预设功能 ==========

function updatePresetVisibility() {
    Settings.update({
        usePresetHands: usePresetHandsCheckbox.checked,
        usePresetCommunity: usePresetCommunityCheckbox.checked,
    });

    const anyPresetEnabled = Settings.usePresetHands || Settings.usePresetCommunity;

    if (anyPresetEnabled && !isPresetUIInitialized) {
        initPresetUI();
    }

    if (!anyPresetEnabled && isPresetUIInitialized) {
        resetPresetData();
    }

    presetControls.style.display = anyPresetEnabled ? 'block' : 'none';
    presetPlayerHandsContainer.style.display = Settings.usePresetHands ? 'block' : 'none';
    presetCommunityCardsContainer.style.display = Settings.usePresetCommunity ? 'block' : 'none';
}

function initPresetUI() {
  if (isPresetUIInitialized) return;

  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
  const deck = suits.flatMap(suit => ranks.map(rank => `${suit}${rank}`));

  deck.forEach(cardText => {
    const cardEl = document.createElement('div');
    cardEl.classList.add('picker-card');
    cardEl.dataset.card = cardText;
    cardEl.style.backgroundImage = `url(${getCardImagePath(cardText)})`;
    cardEl.addEventListener('click', handleCardPickerClick);
    cardPicker.appendChild(cardEl);
  });

  document.querySelectorAll('#preset-community-cards-container .preset-card-slot').forEach(slot => {
      slot.addEventListener('click', handleSlotClick);
  });

  buildPlayerSlots();
  isPresetUIInitialized = true;
}

function buildPlayerSlots() {
    presetPlayerHandsContainer.innerHTML = '<h4>玩家手牌:</h4>';
    Settings.presetCards.players = {};

    for (let i = 1; i <= Settings.playerCount; i++) {
        const playerId = `P${i}`;
        Settings.presetCards.players[playerId] = [null, null];

        const playerHandDiv = document.createElement('div');
        playerHandDiv.classList.add('player-hand-preset');
        playerHandDiv.innerHTML = `<strong>${playerId}:</strong>`;

        for (let j = 0; j < 2; j++) {
            const slot = document.createElement('div');
            slot.classList.add('preset-card-slot');
            slot.dataset.type = 'player';
            slot.dataset.playerId = playerId;
            slot.dataset.cardIndex = j;
            slot.addEventListener('click', handleSlotClick);
            playerHandDiv.appendChild(slot);
        }
        presetPlayerHandsContainer.appendChild(playerHandDiv);
    }
}

function resetPresetData() {
    usedCards.clear();
    Settings.presetCards.flop.fill(null);
    Settings.presetCards.turn.fill(null);
    Settings.presetCards.river.fill(null);
    Settings.presetCards.players = {};

    document.querySelectorAll('.preset-card-slot').forEach(slot => {
        slot.style.backgroundImage = '';
        delete slot.dataset.card;
    });
    document.querySelectorAll('.picker-card').forEach(card => {
        card.classList.remove('dimmed');
    });
    activeSelectionSlot = null;
}

function handleSlotClick(event) {
  const clickedSlot = event.currentTarget;

  if (clickedSlot.dataset.card) {
    unassignCard(clickedSlot);
    return;
  }

  if (activeSelectionSlot === clickedSlot) {
    activeSelectionSlot.classList.remove('active-selection');
    activeSelectionSlot = null;
    return;
  }

  if (activeSelectionSlot) {
    activeSelectionSlot.classList.remove('active-selection');
  }

  activeSelectionSlot = clickedSlot;
  activeSelectionSlot.classList.add('active-selection');
}

function handleCardPickerClick(event) {
  const pickerCard = event.currentTarget;
  const cardText = pickerCard.dataset.card;

  if (pickerCard.classList.contains('dimmed')) {
    log(`这张牌 (${cardText}) 已经被使用了。请先点击已分配的卡槽来取消选择。`);
    return;
  }
  
  if (!activeSelectionSlot) {
    log('请先点击一个空的卡槽以指定要放置的位置。');
    return;
  }

  assignCard(activeSelectionSlot, cardText);

  activeSelectionSlot.classList.remove('active-selection');
  activeSelectionSlot = null;
}

function assignCard(slot, cardText) {
  slot.style.backgroundImage = `url(${getCardImagePath(cardText)})`;
  slot.dataset.card = cardText;

  const pickerCard = cardPicker.querySelector(`.picker-card[data-card="${cardText.replace('"', '"')}"]`);
  if (pickerCard) {
    pickerCard.classList.add('dimmed');
  }

  usedCards.add(cardText);

  const { type, playerId, cardIndex, stage } = slot.dataset;
  if (type === 'player') {
    Settings.presetCards.players[playerId][parseInt(cardIndex)] = cardText;
  } else {
    Settings.presetCards[stage][parseInt(cardIndex)] = cardText;
  }
}

function unassignCard(slot) {
  const cardText = slot.dataset.card;
  if (!cardText) return;

  slot.style.backgroundImage = '';
  delete slot.dataset.card;

  const pickerCard = cardPicker.querySelector(`.picker-card[data-card="${cardText.replace('"', '"')}"]`);
  if (pickerCard) {
    pickerCard.classList.remove('dimmed');
  }

  usedCards.delete(cardText);

  const { type, playerId, cardIndex, stage } = slot.dataset;
  if (type === 'player') {
    Settings.presetCards.players[playerId][parseInt(cardIndex)] = null;
  } else {
    Settings.presetCards[stage][parseInt(cardIndex)] = null;
  }
}

function validatePresetCards() {
  const { players, flop, turn, river } = Settings.presetCards;

  if (Settings.usePresetHands) {
    for (let i = 1; i <= Settings.playerCount; i++) {
      const playerId = `P${i}`;
      if (!players[playerId] || players[playerId].filter(c => c).length !== 2) {
        log(`❌ 预设错误: 玩家 ${playerId} 的手牌未设置完整 (需要2张).`);
        return false;
      }
    }
  }

  if (Settings.usePresetCommunity) {

    if (flop.filter(c => c).length !== 3) {
      log(`❌ 预设错误: Flop牌未设置完整 (需要3张).`);
      return false;
    }
    if (turn.filter(c => c).length !== 1) {
      log(`❌ 预设错误: Turn牌未设置 (需要1张).`);
      return false;
    }
    if (river.filter(c => c).length !== 1) {
      log(`❌ 预设错误: River牌未设置 (需要1张).`);
      return false;
    }
  }

  log('✅ 预设卡牌验证通过。');
  return true;
}

// ========== 游戏控制 ==========

function handleStartOrRestartClick() {
    if (this.textContent === '开始牌局') {
        startNewGame();
    } else {
        restartGame();
    }
}

function handlePauseResumeClick() {
    if (!isGameRunning) return;

    if (isGamePaused) {
        isGamePaused = false;
        log('▶️ 牌局继续');
        pauseBtn.textContent = '暂停';
        startBtn.textContent = '开始牌局';
        startBtn.disabled = true;
        if (Settings.mode === 'auto') {
            processNextAction(); 
        }
    } else {
        isGamePaused = true;
        log('⏸️ 牌局暂停');
        pauseBtn.textContent = '继续';
        startBtn.textContent = '重新开始';
        startBtn.disabled = false;
    }
}

function startNewGame() {
  if (isGameRunning && !isGamePaused) {
    log('游戏已在运行中');
    return;
  }

  if (Settings.usePresetHands || Settings.usePresetCommunity) {
    if (!validatePresetCards()) {
      return;
    }
  }
  
  const settingsForGame = {
      usePresetHands: Settings.usePresetHands,
      usePresetCommunity: Settings.usePresetCommunity,
      presetCards: Settings.presetCards
  };
  game.reset(settingsForGame);

  isGamePaused = false;

  try {
    updatePlayerDisplay();
    renderActionSheet();
    game.dealHoleCards();
    game.startNewRound('preflop');
    isGameRunning = true;

    updateActionSheet(game.players[game.sbIndex].id, 'BET', Settings.sb);
    updateActionSheet(game.players[game.bbIndex].id, 'BET', Settings.bb);

    log('✅ 新牌局开始！盲注: SB=' + Settings.sb + ', BB=' + Settings.bb);
    log(`[SYSTEM] ${game.players[game.sbIndex].id} posts Small Blind ${Settings.sb}`);
    log(`[SYSTEM] ${game.players[game.bbIndex].id} posts Big Blind ${Settings.bb}`);
    updateUI();

    startBtn.textContent = '开始牌局';
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    pauseBtn.textContent = '暂停';

    if (Settings.mode === 'auto') {
      setTimeout(processNextAction, Settings.autoDelay);
    }
  } catch (e) {
    log('❌ 启动失败: ' + e.message);
    console.error(e);
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

async function processNextAction() {
  if (!isGameRunning || isGamePaused) return;

  const currentPlayerId = game.getCurrentPlayerId();
  if (!currentPlayerId) {
    if (game.isShowdown()) {
      log('所有剩余玩家均已All-in，进入自动摊牌流程。');
      showdown();
    } else {
      endGame();
    }
    return;
  }

  try {
    const gameState = game.getGameState();

    const round = game.currentRound;
    let shouldSuggest = false;
    if (round === 'preflop' && Settings.suggestOnPreflop) shouldSuggest = true;
    if (round === 'flop' && Settings.suggestOnFlop) shouldSuggest = true;
    if (round === 'turn' && Settings.suggestOnTurn) shouldSuggest = true;
    if (round === 'river' && Settings.suggestOnRiver) shouldSuggest = true;

    if (shouldSuggest) {
      try {
        const suggestion = await getSuggestion(gameState, currentPlayerId, actionRecords);
        renderSuggestion(suggestion, currentPlayerId, round);
      } catch (apiError) {
        const display = document.getElementById('suggestion-display');
        if (display.textContent.includes('等待玩家行动...')) {
          display.innerHTML = '';
        }
        display.innerHTML += `<div style="color: #ff6b6b;">获取 ${currentPlayerId} 的建议失败: ${apiError.message}</div>`;
        display.scrollTop = display.scrollHeight;
        log(`获取GTO建议时出错: ${apiError.message}`);
      }
    }

    if (Settings.mode === 'manual') {
      showManualActionPanel(currentPlayerId);
      isWaitingForManualInput = true;
      return;
    }

    const decision = await getDecision(gameState, currentPlayerId);
    game.executeAction(currentPlayerId, decision.action, decision.amount);
    log(`[${game.currentRound}] ${currentPlayerId} ${decision.action}${decision.amount ? ' ' + decision.amount : ''}`);
    showActionBubble(currentPlayerId, decision.action, decision.amount);
    updateActionSheet(currentPlayerId, decision.action, decision.amount);

    if (game.isBettingRoundComplete()) {
      advanceToNextStage();
    } else {
      game.moveToNextPlayer();
      updateUI();
      setTimeout(processNextAction, Settings.autoDelay);
    }
  } catch (e) {
    log(`❌ ${currentPlayerId} 行动出错: ${e.message}`);
  }
}

function handleRaiseClick() {
  if (raiseInput.style.display === 'none' || raiseInput.style.display === '') {
    raiseInput.style.display = 'inline';
    raiseInput.value = '';
    raiseInput.focus();
    raiseBtn.textContent = '确认 RAISE';
  } else {
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

  if (currentRound === 'preflop') {
    game.dealFlop();
  } else {
    game.dealTurnOrRiver();
  }

  const nextRound = getNextRound(currentRound);
  game.startNewRound(nextRound);

  log(`➡️ 进入 ${nextRound} 阶段 | 公共牌: ${game.communityCards.join(' ')}`);
  updateUI();
  setTimeout(processNextAction, Settings.autoDelay);
}

function getNextRound(currentRound) {
  const rounds = ['preflop', 'flop', 'turn', 'river'];
  const idx = rounds.indexOf(currentRound);
  return idx !== -1 && idx < rounds.length - 1 ? rounds[idx + 1] : 'river';
}

async function showdown() {
  isGameRunning = false;
  log('进入摊牌流程，自动发完公共牌...');
  
  while (game.currentRound !== 'river' && game.communityCards.length < 5) {
    await new Promise(resolve => setTimeout(resolve, 1200));

    if (game.currentRound === 'preflop') {
      game.dealFlop();
      game.setCurrentRound('flop');
    } else if (game.currentRound === 'flop') {
      game.dealTurnOrRiver();
      game.setCurrentRound('turn');
    } else if (game.currentRound === 'turn') {
      game.dealTurnOrRiver();
      game.setCurrentRound('river');
    }
    
    log(`➡️ 发出 ${game.currentRound} 牌 | 公共牌: ${game.communityCards.join(' ')}`);
    updateUI();
  }

  await new Promise(resolve => setTimeout(resolve, 1000));
  endGame();
}

function renderSuggestion(suggestion, playerId, phase) {
    const display = document.getElementById('suggestion-display');
    
    if (display.textContent.includes('等待玩家行动...')) {
        display.innerHTML = '';
    }

    let phaseContainer = document.getElementById(`phase-container-${phase}`);
    if (!phaseContainer) {
        phaseContainer = document.createElement('div');
        phaseContainer.id = `phase-container-${phase}`;
        phaseContainer.style.marginBottom = '20px';
        
        const phaseTitle = document.createElement('h3');
        phaseTitle.textContent = phase.toUpperCase();
        phaseTitle.style.color = '#fd971f';
        phaseTitle.style.borderBottom = '1px solid #fd971f';
        phaseTitle.style.paddingBottom = '5px';
        phaseTitle.style.marginBottom = '10px';
        
        phaseContainer.appendChild(phaseTitle);
        display.appendChild(phaseContainer);
    }

    if (!suggestion) {
        phaseContainer.innerHTML += `<div style="color: #ff6b6b; margin-left: 10px;">为 ${playerId} 获取建议失败或建议为空。</div>`;
        display.scrollTop = display.scrollHeight;
        return;
    }

    const suggestionWrapper = document.createElement('div');
    suggestionWrapper.style.marginBottom = '15px';
    suggestionWrapper.style.borderBottom = '1px solid #444';
    suggestionWrapper.style.paddingBottom = '10px';
    suggestionWrapper.style.marginLeft = '10px';

    const title = document.createElement('h4');
    title.innerHTML = `给 ${playerId} 的建议 (${new Date().toLocaleTimeString()}) <span style="color: #fd971f;">[${phase.toUpperCase()}]</span>:`
    title.style.margin = '0 0 5px 0';
    title.style.color = '#66d9ef';
    suggestionWrapper.appendChild(title);

    const pre = document.createElement('pre');
    pre.style.margin = '0';
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-all';
    pre.textContent = JSON.stringify(suggestion, null, 2);
    suggestionWrapper.appendChild(pre);

    phaseContainer.appendChild(suggestionWrapper);
    display.scrollTop = display.scrollHeight;
}

function endGame() {
  isGameRunning = false;
  isGamePaused = false;
  isWaitingForManualInput = false;
  toggleManualActionArea(false);
  log('🎉 牌局结束！（本版本不计算胜负）');

  startBtn.textContent = '开始牌局';
  startBtn.disabled = false;
  pauseBtn.textContent = '暂停';
  pauseBtn.disabled = true;
}

function showManualActionPanel(playerId) {
  const gameState = game.getGameState();
  const player = gameState.players.find(p => p.id === playerId);
  const toCall = gameState.highestBet - player.bet;

  manualPlayerLabel.textContent = `轮到 ${playerId} 行动`;
  callBtn.textContent = toCall === 0 ? 'CHECK' : `CALL (${toCall})`;
  raiseInput.value = gameState.highestBet + Settings.bb;
  raiseInput.style.display = 'none';

  toggleManualActionArea(true);
}

function submitManualAction(action, amount) {
  if (!isWaitingForManualInput) return;

  const currentPlayerId = game.getCurrentPlayerId();
  try {
    game.executeAction(currentPlayerId, action, amount);
    log(`[${game.currentRound}] ${currentPlayerId} ${action}${amount ? ' ' + amount : ''}`);
    showActionBubble(currentPlayerId, action, amount);
    updateActionSheet(currentPlayerId, action, amount);

    toggleManualActionArea(false);
    isWaitingForManualInput = false;
    raiseBtn.textContent = 'RAISE';
    raiseInput.style.display = 'none';

    if (game.isBettingRoundComplete()) {
      advanceToNextStage();
    } else {
      game.moveToNextPlayer();
      updateUI();
      if (Settings.mode === 'manual') {
        processNextAction();
      }
    }
  } catch (e) {
    log(`❌ 无效操作: ${e.message}`);
  }
}

function toggleManualActionArea(show) {
  manualActionArea.style.display = show ? 'block' : 'none';
}

function renderActionSheet() {
  const tableBody = document.getElementById('action-sheet-body');
  tableBody.innerHTML = '';

  const playerCount = Settings.playerCount;
  const players = game.players;
  const sbIndex = game.sbIndex;

  actionRecords = {};
  players.forEach(player => {
    actionRecords[player.id] = { preflop: [], flop: [], turn: [], river: [] };
  });

  for (let i = 0; i < playerCount; i++) {
    const playerIndex = (sbIndex + i) % playerCount;
    const player = players[playerIndex];
    const playerId = player.id;
    const playerRole = player.role || '';
    const row = document.createElement('tr');
    
    let rowHtml = `<td style="border: 1px solid #ddd; padding: 6px; text-align: center; font-weight: bold;">${playerId} (${playerRole})</td>`;
    
    const stages = ['preflop', 'flop', 'turn', 'river'];
    stages.forEach(stage => {
      for (let j = 0; j < 4; j++) {
        rowHtml += `<td id="${playerId}-${stage}-${j}" style="border: 1px solid #ddd; padding: 6px; text-align: center;">-</td>`;
      }
    });

    row.innerHTML = rowHtml;
    tableBody.appendChild(row);
  }
}

function updateActionSheet(playerId, action, amount) {
  const currentStage = (game.currentRound || '').toLowerCase();
  if (!actionRecords[playerId] || !actionRecords[playerId][currentStage]) return;

  let actionText = action;
  if ((action === 'CALL' || action === 'RAISE' || action === 'BET') && amount !== undefined && amount !== null) {
      actionText += ` ${amount}`;
  }

  const actionCount = actionRecords[playerId][currentStage].length;
  if (actionCount >= 4) return;

  actionRecords[playerId][currentStage].push(actionText);
  const cell = document.getElementById(`${playerId}-${currentStage}-${actionCount}`);
  if (cell) {
    cell.textContent = actionText;
  }
}

function getCardImagePath(cardText) {
  if (!cardText) return '';
  const suit = cardText[0];
  const rank = cardText.slice(1);
  const suitMap = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };
  const suitLetter = suitMap[suit] || '';
  return `cards/${rank}${suitLetter}.png`;
}

function setCardImage(cardElement, cardText) {
  if (!cardElement) return;
  cardElement.style.backgroundImage = cardText ? `url(${getCardImagePath(cardText)})` : '';
}

function updateUI() {
  const gameState = game.getGameState();

  document.querySelectorAll('.player').forEach(el => {
    const playerId = el.dataset.player;
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return;

    el.classList.toggle('active', playerId === gameState.currentPlayerId);
    el.classList.toggle('folded', player.isFolded);

    if (playerId === 'P1' || Settings.showHoleCards) {
      const cardEls = el.querySelectorAll('.hole-card');
      if (cardEls.length >= 2) {
        setCardImage(cardEls[0], player.holeCards[0]);
        setCardImage(cardEls[1], player.holeCards[1]);
      }
    } else {
      el.querySelectorAll('.hole-card').forEach(cardEl => setCardImage(cardEl, null));
    }

    const stackEl = el.querySelector('.stack');
    if (stackEl) stackEl.textContent = `S: ${player.stack}`;

    const betEl = el.querySelector('.player-bet');
    if (betEl) betEl.textContent = player.bet > 0 ? `B: ${player.bet}` : '';

    const roleEl = el.querySelector('.player-role');
    if (roleEl) roleEl.textContent = player.role || '';
  });

  const communityCardEls = document.querySelectorAll('.community-card');
  communityCardEls.forEach((el, i) => {
    setCardImage(el, gameState.communityCards[i]);
  });

  const potAmountEl = document.getElementById('pot-amount');
  if (potAmountEl) {
    potAmountEl.textContent = gameState.pot;
  }
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
    if (action === 'ALLIN') text = 'ALL-IN';
    else if ((action === 'CALL' || action === 'RAISE' || action === 'BET') && amount > 0) text += ` ${amount}`;

    bubble.classList.remove('show', 'fade-out');
    bubble.style.animation = 'none';
    bubble.offsetHeight;
    bubble.style.animation = null;

    bubble.textContent = text;
    bubble.classList.add('show');

    setTimeout(() => bubble.classList.add('fade-out'), 1500);
}

document.addEventListener('DOMContentLoaded', init);
