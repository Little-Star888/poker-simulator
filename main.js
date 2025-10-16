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

let gtoSuggestionFilter = new Set();

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



const modeSelect = document.getElementById('mode-select');
const playerCountInput = document.getElementById('player-count-input');
const minStackInput = document.getElementById('min-stack-input');
const maxStackInput = document.getElementById('max-stack-input');
const potTypeSelect = document.getElementById('pot-type-select');
const p1RoleSelect = document.getElementById('p1-role-select');
const sbInput = document.getElementById('sb-input');
const bbInput = document.getElementById('bb-input');
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
const gtoFilterPlayersContainer = document.getElementById('gto-filter-players');

// ========== 初始化 ==========
function init() {
  // On initial load, populate UI controls with values from the Settings object.
  modeSelect.value = Settings.mode;
  playerCountInput.value = Settings.playerCount;
  minStackInput.value = Settings.minStack;
  maxStackInput.value = Settings.maxStack;
  potTypeSelect.value = Settings.potType;
  sbInput.value = Settings.sb;
  bbInput.value = Settings.bb;
  autoDelayInput.value = Settings.autoDelay;
  suggestPreflopCheckbox.checked = Settings.suggestOnPreflop;
  suggestFlopCheckbox.checked = Settings.suggestOnFlop;
  suggestTurnCheckbox.checked = Settings.suggestOnTurn;
  suggestRiverCheckbox.checked = Settings.suggestOnRiver;
  usePresetHandsCheckbox.checked = Settings.usePresetHands;
  usePresetCommunityCheckbox.checked = Settings.usePresetCommunity;

  updateP1RoleSelectOptions();

  // Remove inline style to allow CSS classes to control visibility
  document.getElementById('preset-controls').style.display = '';

  // Helper function to manage pot type select state
  function updatePotTypeSelectState() {
    const isManualMode = modeSelect.value === 'manual';
    potTypeSelect.disabled = isManualMode;
    if (isManualMode) {
        potTypeSelect.style.backgroundColor = '#eee'; // Visual cue for disabled
    } else {
        potTypeSelect.style.backgroundColor = '';
    }
  }
  updatePotTypeSelectState(); // Set initial state on load

  // 绑定配置变更
  modeSelect.addEventListener('change', () => {
    Settings.update({ mode: modeSelect.value });
    
    updatePotTypeSelectState(); // Update pot type select based on new mode

    // 如果切换到自动模式，确保手动输入标志为false并隐藏弹出窗口
    if (modeSelect.value === 'auto') {
        isWaitingForManualInput = false;
        hideAllActionPopups();
    }
  });
  playerCountInput.addEventListener('change', () => {
    Settings.update({ playerCount: parseInt(playerCountInput.value) || 8 });
    updatePlayerDisplay();
    updateGtoFilterCheckboxes();
    updateP1RoleSelectOptions();
    if (Settings.usePresetHands) {
      buildPlayerSlots();
    }
    renderActionSheetTemplate(); // Re-render action sheet on change
  });
  minStackInput.addEventListener('change', () => Settings.update({ minStack: parseInt(minStackInput.value) || 2000 }));
  maxStackInput.addEventListener('change', () => Settings.update({ maxStack: parseInt(maxStackInput.value) || 2000 }));
  potTypeSelect.addEventListener('change', () => Settings.update({ potType: potTypeSelect.value }));
  p1RoleSelect.addEventListener('change', () => Settings.update({ p1Role: p1RoleSelect.value }));

  sbInput.addEventListener('input', () => {
    const sbValue = parseInt(sbInput.value) || 0;
    const newBbValue = sbValue * 2;
    bbInput.value = newBbValue;
    Settings.update({ sb: sbValue, bb: newBbValue });
  });

  autoDelayInput.addEventListener('change', () => Settings.update({ autoDelay: parseInt(autoDelayInput.value) || 1000 }));
  suggestPreflopCheckbox.addEventListener('change', () => Settings.update({ suggestOnPreflop: suggestPreflopCheckbox.checked }));
  suggestFlopCheckbox.addEventListener('change', () => Settings.update({ suggestOnFlop: suggestFlopCheckbox.checked }));
  suggestTurnCheckbox.addEventListener('change', () => Settings.update({ suggestOnTurn: suggestTurnCheckbox.checked }));
  suggestRiverCheckbox.addEventListener('change', () => Settings.update({ suggestOnRiver: suggestRiverCheckbox.checked }));

  startBtn.addEventListener('click', handleStartStopClick);
  pauseBtn.addEventListener('click', handlePauseResumeClick);

  // 绑定牌局预设功能
  usePresetHandsCheckbox.addEventListener('change', updatePresetVisibility);
  usePresetCommunityCheckbox.addEventListener('change', updatePresetVisibility);

  // 为所有玩家的行动弹出窗口绑定事件监听器
  document.querySelectorAll('.player-action-popup').forEach(popup => {
    const playerElement = popup.closest('.player');
    const playerId = playerElement.dataset.player;

    popup.querySelector('[data-action="FOLD"]').addEventListener('click', () => submitManualAction(playerId, 'FOLD'));
    popup.querySelector('[data-action="CHECK"]').addEventListener('click', () => submitManualAction(playerId, 'CHECK'));
    popup.querySelector('[data-action="CALL"]').addEventListener('click', () => submitManualAction(playerId, 'CALL'));
    popup.querySelector('[data-action="ALLIN"]').addEventListener('click', () => submitManualAction(playerId, 'ALLIN'));

    popup.querySelector('[data-action="BET"]').addEventListener('click', () => showAmountSlider(playerId, 'BET'));
    popup.querySelector('[data-action="RAISE"]').addEventListener('click', () => showAmountSlider(playerId, 'RAISE'));

    popup.querySelector('.confirm-bet-btn').addEventListener('click', () => {
        const slider = popup.querySelector('.bet-slider-input');
        const amount = parseInt(slider.dataset.amount);
        const action = slider.dataset.action;
        submitManualAction(playerId, action, amount);
    });

    const slider = popup.querySelector('.bet-slider-input');
    slider.addEventListener('input', () => updateSliderAmount(playerId, slider));
    // 当用户释放滑块时，如果值为100%，则自动提交ALL IN
    slider.addEventListener('change', () => {
        if (slider.value === '100') {
            submitManualAction(playerId, 'ALLIN');
        }
    });
  });

  updatePlayerDisplay();
  updateGtoFilterCheckboxes();
  renderActionSheetTemplate(); // Render initial action sheet
  log('德州扑克 AI 测试模拟器已加载');
  injectStyles(); // Workaround for CSS file modification issues
  reorganizeLayout(); // Rearrange sections for 3-column layout
  updatePresetVisibility(); // Ensure preset UI visibility is correct on load
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

    presetControls.classList.toggle('hidden-by-js', !anyPresetEnabled);
    presetPlayerHandsContainer.classList.toggle('hidden-by-js', !Settings.usePresetHands);
    presetCommunityCardsContainer.classList.toggle('hidden-by-js', !Settings.usePresetCommunity);
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

function animateCardToSlot(pickerCard, destinationElement, cardText, originalSlot) {
    const startRect = pickerCard.getBoundingClientRect();
    const endRect = destinationElement.getBoundingClientRect();

    const movingCard = document.createElement('div');
    movingCard.style.position = 'fixed';
    movingCard.style.zIndex = '1000';
    movingCard.style.left = `${startRect.left}px`;
    movingCard.style.top = `${startRect.top}px`;
    movingCard.style.width = `${startRect.width}px`;
    movingCard.style.height = `${startRect.height}px`;
    movingCard.style.backgroundImage = `url(${getCardImagePath(cardText)})`;
    movingCard.style.backgroundSize = 'contain';
    movingCard.style.backgroundRepeat = 'no-repeat';
    movingCard.style.backgroundPosition = 'center';
    movingCard.style.borderRadius = '4px';
    movingCard.style.transition = 'all 0.4s ease-in-out'; // Animate all properties

    document.body.appendChild(movingCard);

    // Delay to allow the browser to apply initial styles before transitioning
    setTimeout(() => {
        movingCard.style.left = `${endRect.left}px`;
        movingCard.style.top = `${endRect.top}px`;
        movingCard.style.width = `${endRect.width}px`;
        movingCard.style.height = `${endRect.height}px`;
    }, 20);

    // After the animation finishes
    setTimeout(() => {
        document.body.removeChild(movingCard);
        // Call assignCard with the original preset slot
        assignCard(originalSlot, cardText);
    }, 420); // Slightly longer than the transition duration
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

  const { type, playerId, cardIndex } = activeSelectionSlot.dataset;
  let destinationElement = activeSelectionSlot; // Default to the slot itself for community cards

  if (type === 'player') {
    const playerOnTable = document.querySelector(`.player[data-player="${playerId}"]`);
    if (playerOnTable) {
        const cardOnTable = playerOnTable.querySelectorAll('.hole-card')[parseInt(cardIndex)];
        if (cardOnTable) {
            destinationElement = cardOnTable; // The animation's destination is the card on the table
        }
    }
  }

  // Pass the original slot `activeSelectionSlot` to the animation function
  // so it knows which preset slot to update after the animation.
  animateCardToSlot(pickerCard, destinationElement, cardText, activeSelectionSlot);

  activeSelectionSlot.classList.remove('active-selection');
  activeSelectionSlot = null;
}

function assignCard(slot, cardText) {

  slot.style.backgroundImage = `url(${getCardImagePath(cardText)})`;

  slot.dataset.card = cardText;



  const pickerCard = cardPicker.querySelector(`.picker-card[data-card="${cardText.replace('"', '"' )}"]`);
  if (pickerCard) {
    pickerCard.classList.add('dimmed');
  }

  usedCards.add(cardText);

  const { type, playerId, cardIndex, stage } = slot.dataset;
  if (type === 'player') {
    Settings.presetCards.players[playerId][parseInt(cardIndex)] = cardText;
    const playerOnTable = document.querySelector(`.player[data-player="${playerId}"]`);
    if (playerOnTable) {
        const cardOnTable = playerOnTable.querySelectorAll('.hole-card')[parseInt(cardIndex)];
        setCardImage(cardOnTable, cardText);
    }
  } else {
    Settings.presetCards[stage][parseInt(cardIndex)] = cardText;
  }
}

function unassignCard(slot) {

  const cardText = slot.dataset.card;

  if (!cardText) return;



  const { type, playerId, cardIndex, stage } = slot.dataset;



  // 1. Find all UI elements related to this card

  const elementsToAnimate = [slot];

  let cardOnTable = null;

  if (type === 'player') {

    const playerOnTable = document.querySelector(`.player[data-player="${playerId}"]`);

    if (playerOnTable) {

        cardOnTable = playerOnTable.querySelectorAll('.hole-card')[parseInt(cardIndex)];

        if (cardOnTable) elementsToAnimate.push(cardOnTable);

    }

  }



  // 2. Trigger animation on all elements

  elementsToAnimate.forEach(el => el.classList.add('card-unassigned'));



  // 3. After animation, update data and clean up UI

  setTimeout(() => {

    // Update data model

    if (type === 'player') {

      Settings.presetCards.players[playerId][parseInt(cardIndex)] = null;

    } else {

      Settings.presetCards[stage][parseInt(cardIndex)] = null;

    }

    usedCards.delete(cardText);



    // Update UI state

    const pickerCard = cardPicker.querySelector(`.picker-card[data-card="${cardText.replace('"', '"' )}"]`);

    if (pickerCard) {

      pickerCard.classList.remove('dimmed');

    }

    

    // Reset the animated elements' appearance and remove animation class

    elementsToAnimate.forEach(el => {

        el.style.backgroundImage = '';

        el.classList.remove('card-unassigned');

    });

    delete slot.dataset.card;



  }, 300); // Must match animation duration

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

function handleStartStopClick() {
    if (startBtn.textContent.includes('开始牌局')) {
        startNewGame();
    } else {
        stopGame();
    }
}

function handlePauseResumeClick() {
    if (!isGameRunning) return;

    if (isGamePaused) {
        isGamePaused = false;
        log('▶️ 牌局继续');
        pauseBtn.textContent = '⏸️ 暂停';
        // startBtn remains "停止牌局" and enabled
        if (Settings.mode === 'auto') {
            processNextAction(); 
        }
    } else {
        isGamePaused = true;
        log('⏸️ 牌局暂停');
        pauseBtn.textContent = '▶️ 继续';
        // startBtn remains "停止牌局" and enabled
    }
}

function startNewGame() {
  document.getElementById('suggestion-display').innerHTML = '等待玩家行动...';

  if (isGameRunning && !isGamePaused) {
    log('游戏已在运行中');
    return;
  }

  if (Settings.usePresetHands || Settings.usePresetCommunity) {
    if (!validatePresetCards()) {
      return;
    }
  }
  
  // Pass the entire live Settings object to the game engine.
  game.reset(Settings);

  isGamePaused = false;

  try {
    updatePlayerDisplay();
    renderActionSheet();
    game.dealHoleCards();
    game.startNewRound('preflop');
    isGameRunning = true;

    // Disable preset controls during the game
    document.getElementById('preset-section').style.opacity = '0.5';
    document.getElementById('preset-section').style.pointerEvents = 'none';

    // 禁用运行配置
    document.getElementById('runtime-config-section').style.opacity = '0.5';
    document.getElementById('runtime-config-section').style.pointerEvents = 'none';

    // 但保持GTO建议筛选区域可用，以便在游戏中动态过滤
    const gtoFilterRow = document.getElementById('gto-filter-players').parentElement;
    if (gtoFilterRow) {
        gtoFilterRow.style.opacity = '1';
        gtoFilterRow.style.pointerEvents = 'auto';
    }

    updateActionSheet(game.players[game.sbIndex].id, 'BET', Settings.sb);
    updateActionSheet(game.players[game.bbIndex].id, 'BET', Settings.bb);

    log('✅ 新牌局开始！盲注: SB=' + Settings.sb + ', BB=' + Settings.bb);
    log(`[SYSTEM] ${game.players[game.sbIndex].id} posts Small Blind ${Settings.sb}`);
    log(`[SYSTEM] ${game.players[game.bbIndex].id} posts Big Blind ${Settings.bb}`);
    updateUI({ isInitialDeal: true });

    startBtn.textContent = '🛑 停止牌局';
    startBtn.disabled = false;
    pauseBtn.disabled = false;
    pauseBtn.textContent = '⏸️ 暂停';

    if (Settings.mode === 'auto') {
      setTimeout(processNextAction, Settings.autoDelay);
    } else {
      // 在手动模式下，立即为第一个玩家显示操作
      processNextAction();
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

function updateGtoFilterCheckboxes() {
    gtoFilterPlayersContainer.innerHTML = '';
    gtoSuggestionFilter.clear();

    if (Settings.playerCount > 0) {
        gtoSuggestionFilter.add('P1'); // Default to only P1 selected
    }

    for (let i = 1; i <= Settings.playerCount; i++) {
        const playerId = `P${i}`;
        const isChecked = (playerId === 'P1');

        const label = document.createElement('label');
        label.style.marginRight = '10px';
        label.style.width = 'auto'; // prevent label from taking full width
        label.style.cursor = 'pointer';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = playerId;
        checkbox.checked = isChecked;
        checkbox.id = `gto-filter-${playerId}`;
        checkbox.style.marginRight = '4px';

        checkbox.addEventListener('change', (event) => {
            const changedPlayerId = event.target.value;
            if (event.target.checked) {
                gtoSuggestionFilter.add(changedPlayerId);
            } else {
                gtoSuggestionFilter.delete(changedPlayerId);
            }
            // 动态更新建议的可见性
            updateSuggestionVisibility();
        });

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(playerId));
        gtoFilterPlayersContainer.appendChild(label);
    }
}

function updateSuggestionVisibility() {
    document.querySelectorAll('.gto-suggestion-for-player').forEach(suggestionEl => {
        const elPlayerId = suggestionEl.dataset.playerId;
        if (gtoSuggestionFilter.has(elPlayerId)) {
            suggestionEl.style.display = 'block';
        } else {
            suggestionEl.style.display = 'none';
        }
    });
}

function getRoleOrder(playerCount) {
    // This is a copy of the logic from poker.js
    switch (playerCount) {
        case 2: return ['SB', 'BTN'];
        case 3: return ['SB', 'BB', 'BTN'];
        case 4: return ['SB', 'BB', 'CO', 'BTN'];
        case 5: return ['SB', 'BB', 'UTG', 'CO', 'BTN'];
        case 6: return ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];
        case 7: return ['SB', 'BB', 'UTG', 'MP1', 'HJ', 'CO', 'BTN'];
        case 8: return ['SB', 'BB', 'UTG', 'UTG+1', 'MP1', 'HJ', 'CO', 'BTN'];
        // Default case for 9 or more, though UI is limited to 8
        default:
            const baseRoles = ['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP1', 'MP2', 'HJ', 'CO'];
            return baseRoles.slice(0, playerCount - 1).concat('BTN');
    }
}

function updateP1RoleSelectOptions() {
    const playerCount = Settings.playerCount;
    const availableRoles = getRoleOrder(playerCount);
    const currentP1Role = Settings.p1Role;

    p1RoleSelect.innerHTML = '<option value="random">随机</option>'; // Start with random

    availableRoles.forEach(role => {
        const option = document.createElement('option');
        option.value = role;
        option.textContent = role;
        p1RoleSelect.appendChild(option);
    });

    // After repopulating, try to set the previously selected value.
    // If it's no longer valid, switch to 'random'.
    if (availableRoles.includes(currentP1Role)) {
        p1RoleSelect.value = currentP1Role;
    } else {
        p1RoleSelect.value = 'random';
        Settings.update({ p1Role: 'random' });
    }
}

function stopGame() {
  log('🛑 牌局已手动停止，重置到初始状态。');
  isGameRunning = false;
  isGamePaused = false;
  isWaitingForManualInput = false;
  hideAllActionPopups();

  // Reset game logic to a fresh state
  game.reset(Settings); 
  
  // Reset UI by re-reading the fresh game state
  updateUI(); 
  updatePlayerDisplay();
  renderActionSheet(); // Clears and rebuilds the action table
  document.getElementById('suggestion-display').innerHTML = '等待玩家行动...';

  // Update button states
  startBtn.textContent = '▶️ 开始牌局';
  startBtn.disabled = false;
  pauseBtn.textContent = '⏸️ 暂停';
  pauseBtn.disabled = true;

  // Re-enable config sections
  document.getElementById('preset-section').style.opacity = '1';
  document.getElementById('preset-section').style.pointerEvents = 'auto';
  document.getElementById('runtime-config-section').style.opacity = '1';
  document.getElementById('runtime-config-section').style.pointerEvents = 'auto';

  // 并重置GTO筛选区域的覆盖样式
  const gtoFilterRow = document.getElementById('gto-filter-players').parentElement;
  if (gtoFilterRow) {
      gtoFilterRow.style.opacity = '';
      gtoFilterRow.style.pointerEvents = '';
  }
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
      showPlayerActionPopup(currentPlayerId);
      return; // 等待用户输入
    }

    // 自动模式逻辑
    const decision = await getDecision(gameState, currentPlayerId, gtoSuggestionFilter);
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
    // 添加用于动态筛选的class和data属性
    suggestionWrapper.classList.add('gto-suggestion-for-player');
    suggestionWrapper.dataset.playerId = playerId;

    suggestionWrapper.style.marginBottom = '15px';
    suggestionWrapper.style.borderBottom = '1px solid #444';
    suggestionWrapper.style.paddingBottom = '10px';
    suggestionWrapper.style.marginLeft = '10px';

    // 根据筛选器设置初始可见性
    if (!gtoSuggestionFilter.has(playerId)) {
        suggestionWrapper.style.display = 'none';
    }

    const title = document.createElement('h4');
    title.innerHTML = `给 ${playerId} 的建议 (${new Date().toLocaleTimeString()}) <span style="color: #fd971f;">[${phase.toUpperCase()}]</span>:`
    title.style.margin = '0 0 5px 0';
    title.style.color = '#66d9ef';
    suggestionWrapper.appendChild(title);

    if ((phase === 'preflop' || phase === 'flop' || phase === 'turn' || phase === 'river') && suggestion.localResult) {
        try {
            const container = document.createElement('div');
            const local = suggestion.localResult;

            const createRow = (label, value) => {
                if (value === null || value === undefined || value === '') return;
                const row = document.createElement('div');
                row.style.marginBottom = '4px';
                const labelEl = document.createElement('strong');
                labelEl.textContent = `${label}: `;
                labelEl.style.color = '#a6e22e';
                row.appendChild(labelEl);
                row.appendChild(document.createTextNode(value));
                container.appendChild(row);
            };
            
            const createSection = (title) => {
                const titleEl = document.createElement('h5');
                titleEl.textContent = title;
                titleEl.style.color = '#f92672';
                titleEl.style.marginTop = '12px';
                titleEl.style.marginBottom = '8px';
                titleEl.style.borderBottom = '1px solid #555';
                titleEl.style.paddingBottom = '4px';
                container.appendChild(titleEl);
            };

            createSection('牌局信息');
            createRow('手牌', suggestion.myCards?.join(', '));
            if (phase !== 'preflop') {
                createRow('公共牌', suggestion.boardCards?.join(', '));
                createRow('牌面', local.boardType);
                createRow('牌型', local.handType);
            }

            createSection('局势分析');
            if (phase !== 'preflop') {
                createRow('位置', local.hasPosition ? '有利位置' : '不利位置');
            }
            createRow('行动场景', local.scenarioDescription);

            if (phase !== 'preflop') {
                createSection('数据参考');
                if (local.equity) {
                    const parts = [];
                    if (local.equity.winRate !== null) parts.push(`胜率: ${local.equity.winRate}%`);
                    if (local.equity.potOdds !== null) parts.push(`底池赔率: ${local.equity.potOdds}%`);
                    if (local.action !== null) parts.push(`建议: ${local.action}`);
                    createRow('本地计算', parts.join('， '));
                }
                if (suggestion.thirdPartyResult && suggestion.thirdPartyResult.equity) {
                    const treys = suggestion.thirdPartyResult.equity;
                    const parts = [];
                    if (treys.winRate !== null) parts.push(`胜率: ${treys.winRate}%`);
                    if (treys.potOdds !== null) parts.push(`底池赔率: ${treys.potOdds}%`);
                    if (treys.action) parts.push(`建议: ${treys.action}`);
                    createRow('Treys (仅作对比参考)', parts.join('， '));
                }
            }

            createSection('最终建议');
            const actionRow = document.createElement('div');
            actionRow.style.marginBottom = '4px';
            const actionLabelEl = document.createElement('strong');
            actionLabelEl.textContent = `行动: `;
            actionLabelEl.style.color = '#a6e22e';
            actionRow.appendChild(actionLabelEl);
            const actionValueEl = document.createElement('strong');
            actionValueEl.textContent = local.action;
            actionValueEl.style.color = '#e6db74';
            actionValueEl.style.fontSize = '1.2em';
            actionRow.appendChild(actionValueEl);
            container.appendChild(actionRow);

            const reasonRow = document.createElement('div');
            reasonRow.style.lineHeight = '1.6';
            reasonRow.style.marginTop = '4px';
            const reasonLabelEl = document.createElement('strong');
            reasonLabelEl.textContent = '理由: ';
            reasonLabelEl.style.color = '#a6e22e';
            reasonRow.appendChild(reasonLabelEl);
            const reasoningText = phase === 'preflop' ? (local.reasoning || local.description || '') : `(以本地计算为准) ${local.reasoning || ''}`;
            reasonRow.appendChild(document.createTextNode(reasoningText));
            container.appendChild(reasonRow);

            suggestionWrapper.innerHTML = '';
            const title = document.createElement('h4');
            title.innerHTML = `给 ${playerId} 的建议 (${new Date().toLocaleTimeString()}) <span style="color: #fd971f;">[${phase.toUpperCase()}]</span>:`;
            title.style.margin = '0 0 8px 0';
            title.style.color = '#66d9ef';
            suggestionWrapper.appendChild(title);
            suggestionWrapper.appendChild(container);

        } catch (e) {
            console.error(`Error formatting ${phase} suggestion:`, e, suggestion);
            const pre = document.createElement('pre');
            pre.style.margin = '0';
            pre.style.whiteSpace = 'pre-wrap';
            pre.style.wordBreak = 'break-all';
            pre.textContent = JSON.stringify(suggestion, null, 2);
            suggestionWrapper.appendChild(pre);
        }
    } else {
        const pre = document.createElement('pre');
        pre.style.margin = '0';
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordBreak = 'break-all';
        pre.textContent = JSON.stringify(suggestion, null, 2);
        suggestionWrapper.appendChild(pre);
    }

    phaseContainer.appendChild(suggestionWrapper);
    display.scrollTop = display.scrollHeight;
}

function endGame() {
  isGameRunning = false;
  isGamePaused = false;
  isWaitingForManualInput = false;
  hideAllActionPopups();
  log('🎉 牌局结束！（本版本不计算胜负）');

  startBtn.textContent = '▶️ 开始牌局';
  startBtn.disabled = false;
  pauseBtn.textContent = '⏸️ 暂停';
  pauseBtn.disabled = true;

  // Re-enable preset controls
  document.getElementById('preset-section').style.opacity = '1';
  document.getElementById('preset-section').style.pointerEvents = 'auto';

  // 重新启用运行配置
  document.getElementById('runtime-config-section').style.opacity = '1';
  document.getElementById('runtime-config-section').style.pointerEvents = 'auto';

  // 并重置GTO筛选区域的覆盖样式
  const gtoFilterRow = document.getElementById('gto-filter-players').parentElement;
  if (gtoFilterRow) {
      gtoFilterRow.style.opacity = '';
      gtoFilterRow.style.pointerEvents = '';
  }
}

// ========== 新手动模式功能 ==========

/**
 * 隐藏所有玩家行动弹出窗口。
 */
function hideAllActionPopups() {
    document.querySelectorAll('.player-action-popup').forEach(p => p.style.display = 'none');
    isWaitingForManualInput = false;
}

/**
 * 为指定玩家显示行动弹出窗口。
 * @param {string} playerId 
 */
function showPlayerActionPopup(playerId) {
    // 首先隐藏所有其他可能打开的弹出窗口
    hideAllActionPopups();

    const playerElement = document.querySelector(`.player[data-player="${playerId}"]`);
    if (!playerElement) return;

    const popup = playerElement.querySelector('.player-action-popup');
    const actionButtons = popup.querySelector('.action-buttons');
    const amountSliderContainer = popup.querySelector('.amount-slider');

    const gameState = game.getGameState();
    const player = gameState.players.find(p => p.id === playerId);
    const toCall = gameState.highestBet - player.bet;

    // 根据规则决定显示哪些按钮
    const canCheck = toCall === 0;
    actionButtons.querySelector('[data-action="CHECK"]').style.display = canCheck ? 'inline-block' : 'none';
    actionButtons.querySelector('[data-action="CALL"]').style.display = !canCheck ? 'inline-block' : 'none';
    if (!canCheck) {
        actionButtons.querySelector('[data-action="CALL"]').textContent = `Call (${toCall})`;
    }

    const canBet = gameState.highestBet === 0;
    actionButtons.querySelector('[data-action="BET"]').style.display = canBet ? 'inline-block' : 'none';
    actionButtons.querySelector('[data-action="RAISE"]').style.display = !canBet ? 'inline-block' : 'none';

    // 重置并隐藏滑块
    amountSliderContainer.style.display = 'none';
    actionButtons.style.display = 'block';

    popup.style.display = 'block';
    isWaitingForManualInput = true;
}

/**
 * 显示下注/加注的金额滑块
 * @param {string} playerId 
 * @param {'BET' | 'RAISE'} action 
 */
function showAmountSlider(playerId, action) {
    const playerElement = document.querySelector(`.player[data-player="${playerId}"]`);
    const popup = playerElement.querySelector('.player-action-popup');
    const actionButtons = popup.querySelector('.action-buttons');
    const amountSliderContainer = popup.querySelector('.amount-slider');
    const slider = popup.querySelector('.bet-slider-input');

    actionButtons.style.display = 'none';
    amountSliderContainer.style.display = 'block';
    slider.dataset.action = action;
    // 重置滑块到最小值并更新标签
    slider.value = slider.min;
    updateSliderAmount(playerId, slider);
}

/**
 * 当滑块移动时，更新显示的金额
 * @param {string} playerId 
 * @param {HTMLInputElement} slider 
 */
function updateSliderAmount(playerId, slider) {
    const gameState = game.getGameState();
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return;

    const popup = slider.closest('.player-action-popup');
    const amountLabel = popup.querySelector('.bet-amount-label');
    const confirmBtn = popup.querySelector('.confirm-bet-btn');
    const percentage = parseInt(slider.value);
    const action = slider.dataset.action;

    let amountToPutIn;
    // 100% 总是意味着 all-in
    if (percentage === 100) {
        amountToPutIn = player.stack;
    } else {
        amountToPutIn = Math.floor(player.stack * (percentage / 100));
    }

    let finalAmount; // 这是传递给 game.executeAction 的最终金额
    let labelText;

    if (action === 'BET') {
        const minBet = Math.min(Settings.bb, player.stack);
        // 确保下注额不小于最小下注，除非是all-in
        let betAmount = Math.max(amountToPutIn, minBet);
        if (betAmount >= player.stack) { // 如果计算出的金额大于或等于玩家筹码，则为all-in
            betAmount = player.stack;
        }
        finalAmount = betAmount;
        labelText = `${finalAmount} (${percentage}%)`;
    } else { // RAISE
        const minRaiseTo = gameState.highestBet + gameState.lastRaiseAmount;
        const maxRaiseTo = player.stack + player.bet;

        // 我们这里的 `amountToPutIn` 是指玩家额外要投入的钱
        let totalAfterRaise = player.bet + amountToPutIn;

        // 确保总金额不小于最小加注额，除非是all-in
        let finalRaiseTo = Math.max(totalAfterRaise, minRaiseTo);
        if (finalRaiseTo >= maxRaiseTo) { // 如果计算出的总额大于或等于玩家能付出的最大值，则为all-in
            finalRaiseTo = maxRaiseTo;
        }
        finalAmount = finalRaiseTo;
        labelText = `${finalAmount} (${percentage}%)`;
    }

    slider.dataset.amount = finalAmount;
    if (percentage === 100) {
        amountLabel.textContent = `ALL IN (${player.stack + player.bet})`;
        confirmBtn.textContent = '确认 ALL IN';
    } else {
        amountLabel.textContent = labelText;
        confirmBtn.textContent = '确认';
    }
}

/**
 * 提交手动操作
 * @param {string} playerId 
 * @param {string} action 
 * @param {number} [amount] 
 */
function submitManualAction(playerId, action, amount) {
    if (!isWaitingForManualInput) return;

    const currentPlayerId = game.getCurrentPlayerId();
    if (playerId !== currentPlayerId) {
        log(`错误: 不是 ${playerId} 的回合.`);
        return;
    }

    // 如果是100%的BET/RAISE，自动转为ALLIN
    if ((action === 'BET' || action === 'RAISE') && amount) {
        const player = game.getGameState().players.find(p => p.id === playerId);
        if (player && (player.stack + player.bet) === amount) {
            action = 'ALLIN';
            amount = undefined;
        }
    }

    try {
        game.executeAction(currentPlayerId, action, amount);
        log(`[${game.currentRound}] ${currentPlayerId} ${action}${amount ? ' ' + amount : ''}`);
        showActionBubble(currentPlayerId, action, amount);
        updateActionSheet(currentPlayerId, action, amount);

        hideAllActionPopups();

        if (game.isBettingRoundComplete()) {
            advanceToNextStage();
        } else {
            game.moveToNextPlayer();
            updateUI();
            // 在手动模式下，立即为下一位玩家处理行动
            processNextAction();
        }
    } catch (e) {
        log(`❌ 无效操作: ${e.message}`);
        // 如果操作无效，重新显示弹出窗口以供更正
        showPlayerActionPopup(playerId);
    }
}




function renderActionSheetTemplate() {
  const tableBody = document.getElementById('action-sheet-body');
  tableBody.innerHTML = ''; // Clear existing rows

  const playerCount = Settings.playerCount;

  for (let i = 0; i < playerCount; i++) {
    const playerId = `P${i + 1}`;
    const row = document.createElement('tr');
    
    // We don't know the role yet, so we'll leave it blank for now
    let rowHtml = `<td style="border: 1px solid #ddd; padding: 6px; text-align: center; font-weight: bold;">${playerId}</td>`;
    
    const stages = ['preflop', 'flop', 'turn', 'river'];
    stages.forEach(stage => {
      for (let j = 0; j < 4; j++) {
        // Use a generic style, specific IDs will be set when game starts
        rowHtml += `<td style="border: 1px solid #ddd; padding: 6px; text-align: center;">-</td>`;
      }
    });

    row.innerHTML = rowHtml;
    tableBody.appendChild(row);
  }
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

function updateUI(options = {}) {
  const isInitialDeal = options.isInitialDeal || false;
  const gameState = game.getGameState();

  document.querySelectorAll('.player').forEach(el => {
    const playerId = el.dataset.player;
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return;

    el.classList.toggle('active', playerId === gameState.currentPlayerId);
    el.classList.toggle('folded', player.isFolded);

    // 默认明牌模式，始终显示所有玩家的底牌
    const cardEls = el.querySelectorAll('.hole-card');
    if (cardEls.length >= 2) {
        const shouldAnimate = isInitialDeal && !Settings.usePresetHands;

        if (shouldAnimate) {
            [cardEls[0], cardEls[1]].forEach((cardEl, index) => {
                const cardText = player.holeCards[index];
                if (cardText) {
                    // Set image first, then trigger animation
                    setCardImage(cardEl, cardText);
                    cardEl.classList.add('card-dealt-anim');
                    setTimeout(() => cardEl.classList.remove('card-dealt-anim'), 500);
                } else {
                    setCardImage(cardEl, null);
                }
            });
        } else if (!isInitialDeal) {
            // On subsequent UI updates (not the initial deal), just set the image.
            // This is important for showdown or if state changes mid-game.
            setCardImage(cardEls[0], player.holeCards[0]);
            setCardImage(cardEls[1], player.holeCards[1]);
        }
        // If (isInitialDeal && usePresetHands), do nothing, as cards are already set by live-update.
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



function reorganizeLayout() {
  // This function rearranges the DOM to create the desired 3-column layout.
  // It moves the "Action Sheet" section from the left panel to the right panel.
  
  const actionSheetContainer = document.getElementById('action-sheet-container');
  if (!actionSheetContainer) return;
  
  // Find the whole section for the action sheet
  const actionSheetSection = actionSheetContainer.closest('.section');
  const controlPanelRight = document.querySelector('.control-panel-right');

  if (actionSheetSection && controlPanelRight) {
    // Move the action sheet to be the first child of the right-hand panel
    controlPanelRight.insertBefore(actionSheetSection, controlPanelRight.firstChild);
//    log('⚙️ 应用三列布局结构。');
  }
}

function injectStyles() {
  const css = `
    /* --- Layout Workaround Styles --- */

    /* Main 3-column layout */
    .control-panel {
      flex-direction: row !important;
    }
    .control-panel-left {
      flex: 2 !important;
    }
    .control-panel-right {
      flex: 3 !important;
      display: flex;
      flex-direction: column;
    }

    /* Player Preset Layout */
    #preset-player-hands-container {
      display: grid !important; /* Force grid layout */
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 15px;
      align-items: start;
    }
    #preset-player-hands-container > h4 {
      grid-column: 1 / -1;
      margin-bottom: 0;
    }
    .player-hand-preset {
      margin-bottom: 0;
    }

    /* JS Helper Class to forcefully hide elements */
    .hidden-by-js {
      display: none !important;
    }

    /* --- Preset Card Removal Animation --- */
    .card-unassigned {
      animation: card-unassign-anim 0.3s ease-in forwards;
    }
    @keyframes card-unassign-anim {
      from { transform: scale(1); opacity: 1; }
      to { transform: scale(0.5); opacity: 0; }
    }

    /* --- Card Dealing Animation --- */
    .hole-card.card-dealt-anim {
      animation: card-fade-in 0.5s ease-out;
    }
    @keyframes card-fade-in {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  const style = document.createElement('style');
  style.type = 'text/css';
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);
//  log('⚙️ 应用布局修复样式。');
}

document.addEventListener('DOMContentLoaded', init);
