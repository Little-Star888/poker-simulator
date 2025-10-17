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

  // 为所有玩家的行动弹出窗口绑定事件监听器 (V2)
  document.querySelectorAll('.player').forEach(playerElement => {
    const playerId = playerElement.dataset.player;
    const popup = playerElement.querySelector('.player-action-popup');
    if (!popup) return;

    const sliderOverlay = popup.querySelector('.amount-slider-overlay');
    const sliderInput = sliderOverlay.querySelector('.bet-slider-input');

    // 1. 主行动按钮
    const foldBtn = popup.querySelector('.main-action-btn.fold');
    const betRaiseBtn = popup.querySelector('.main-action-btn.bet-raise');
    const checkCallBtn = popup.querySelector('.main-action-btn.check-call');

    foldBtn.addEventListener('click', () => submitManualAction(playerId, 'FOLD'));

    checkCallBtn.addEventListener('click', () => {
        const action = checkCallBtn.dataset.action; // 'CHECK' or 'CALL'
        submitManualAction(playerId, action);
    });

    betRaiseBtn.addEventListener('click', () => {
        const action = betRaiseBtn.dataset.action; // Can be 'BET', 'RAISE', or 'ALLIN'
        if (action === 'ALLIN') {
            // 当按钮被直接配置为ALLIN时（例如筹码不足以最小加注），直接提交
            const player = game.players.find(p => p.id === playerId);
            if (player) {
                const amount = player.stack + player.bet;
                submitManualAction(playerId, 'ALLIN', amount);
            }
        } else {
            // 否则，显示下注/加注滑块
            showVerticalSlider(playerId, action);
        }
    });

    // 2. 快捷下注按钮
    popup.querySelectorAll('.quick-bet-sizes button').forEach(btn => {
        btn.addEventListener('click', () => {
            const amount = parseInt(btn.dataset.amount);
            if (amount > 0) {
                const action = betRaiseBtn.dataset.action; // 'BET' or 'RAISE'
                submitManualAction(playerId, action, amount);
            }
        });
    });

    // 3. 滑块界面
    const confirmBtn = sliderOverlay.querySelector('.confirm-bet');
    confirmBtn.addEventListener('click', () => {
        const amount = parseInt(sliderInput.dataset.finalAmount);
        const action = sliderInput.dataset.action;
        submitManualAction(playerId, action, amount);
    });

    sliderInput.addEventListener('input', () => updateSliderAmount(playerId, sliderInput));

    // 4. 点击背景关闭
    popup.addEventListener('click', (e) => {
        if (e.target === popup) { // Clicked on the semi-transparent background
            hideAllActionPopups();
        }
    });
    sliderOverlay.addEventListener('click', (e) => {
        if (e.target === sliderOverlay) { // Clicked on the slider background
            e.stopPropagation(); // Prevent click from bubbling to parent popup
            // Go back to the action panel instead of closing the popup
            const actionPanel = popup.querySelector('.action-panel');
            sliderOverlay.style.display = 'none';
            actionPanel.style.display = 'flex';
        }
    });
  });


  updatePlayerDisplay();
  updateGtoFilterCheckboxes();
  renderActionSheetTemplate(); // Render initial action sheet
  log('德州扑克 AI 测试模拟器已加载');
  injectStyles(); // Workaround for CSS file modification issues

  // 控制配置抽屉的逻辑
  const configDrawer = document.getElementById('config-drawer');
  const configToggleBtn = document.getElementById('config-toggle-btn');
  const drawerCloseBtn = document.querySelector('.drawer-close-btn');
  const drawerOverlay = document.querySelector('.drawer-overlay');

  function openDrawer() {
    if (configDrawer) {
      configDrawer.classList.add('is-open');
    }
  }

  function closeDrawer() {
    if (configDrawer) {
      configDrawer.classList.remove('is-open');
    }
  }

  if (configToggleBtn) {
    configToggleBtn.addEventListener('click', openDrawer);
  }
  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener('click', closeDrawer);
  }
  if (drawerOverlay) {
    drawerOverlay.addEventListener('click', closeDrawer);
  }

  // 添加ResizeObserver以实现响应式布局
  const table = document.querySelector('.poker-table');
  if (table) {
    const resizeObserver = new ResizeObserver(() => {
      updatePlayerLayout();
    });
    resizeObserver.observe(table);
  }

  updatePresetVisibility(); // Ensure preset UI visibility is correct on load
}

// ========== 牌局预设功能 ==========


function getSlotSequence() {
    const sequence = [];

    if (Settings.usePresetCommunity) {
        // Flop, Turn, River slots in document order
        document.querySelectorAll('#preset-community-cards-container .preset-card-slot').forEach(slot => sequence.push(slot));
    }

    if (Settings.usePresetHands) {
        // Player hand slots in document order (P1, P2, ...)
        document.querySelectorAll('#preset-player-hands-container .preset-card-slot').forEach(slot => sequence.push(slot));
    }

    return sequence;
}

function activateNextEmptySlot() {
    // Deactivate current slot if any
    if (activeSelectionSlot) {
        activeSelectionSlot.classList.remove('active-selection');
        activeSelectionSlot = null;
    }

    const sequence = getSlotSequence();
    for (const slot of sequence) {
        if (!slot.dataset.card) { // Find the first slot without a card
            activeSelectionSlot = slot;
            activeSelectionSlot.classList.add('active-selection');
            return; // Stop after activating the first empty one
        }
    }
}

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

    if (Settings.usePresetHands) {
        buildPlayerSlots();
    } else {
        // 如果不使用预设手牌，请确保容器为空
        presetPlayerHandsContainer.innerHTML = '';
    }

    presetControls.classList.toggle('hidden-by-js', !anyPresetEnabled);
    presetPlayerHandsContainer.classList.toggle('hidden-by-js', !Settings.usePresetHands);
    presetCommunityCardsContainer.classList.toggle('hidden-by-js', !Settings.usePresetCommunity);

    activateNextEmptySlot();
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
    if (activeSelectionSlot) {
        activeSelectionSlot.classList.remove('active-selection');
    }
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

function animateCardToSlot(pickerCard, destinationElement, cardText) { // Removed originalSlot parameter
    const startRect = pickerCard.getBoundingClientRect();
    const endRect = destinationElement.getBoundingClientRect();

    // If destination element is not visible or has zero dimensions, skip animation.
    if (endRect.width === 0 || endRect.height === 0) {
        console.warn("Destination element for card animation is not visible or has zero dimensions. Skipping animation for this target.");
        return; // Just return, caller handles assignCard and activateNextEmptySlot
    }

    const movingCard = document.createElement('div');
    movingCard.style.position = 'fixed';
    movingCard.style.zIndex = '2001'; // 确保高于配置抽屉的 z-index (2000)
    movingCard.style.left = `${startRect.left}px`;
    movingCard.style.top = `${startRect.top}px`;
    movingCard.style.width = `${startRect.width}px`;
    movingCard.style.height = `${endRect.height}px`;
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

    // After the animation finishes, only remove the moving card.
    // The caller will handle assignCard and activateNextEmptySlot.
    setTimeout(() => {
        document.body.removeChild(movingCard);
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
    log('没有可用的空卡槽来放置扑克牌，或所有卡槽已满。');
    return;
  }

  const { type, playerId, cardIndex } = activeSelectionSlot.dataset;
  
  let animationsInitiated = 0; // Counter for initiated animations

  // 动画到抽屉中的预设卡槽
  animateCardToSlot(pickerCard, activeSelectionSlot, cardText);
  animationsInitiated++;

  // 如果是玩家手牌，并且启用了预设手牌，则同时动画到主牌桌上的底牌位置
  if (type === 'player' && Settings.usePresetHands) {
    const playerOnTable = document.querySelector(`.player[data-player="${playerId}"]`);
    if (playerOnTable) {
        const cardOnTable = playerOnTable.querySelectorAll('.hole-card')[parseInt(cardIndex)];
        if (cardOnTable) {
            animateCardToSlot(pickerCard, cardOnTable, cardText);
            animationsInitiated++;
        }
    }
  }

  // 在所有动画启动后，延迟执行数据更新和激活下一个槽位
  if (animationsInitiated > 0) {
      setTimeout(() => {
          assignCard(activeSelectionSlot, cardText); // originalSlot is activeSelectionSlot
          activateNextEmptySlot();
      }, 420); // 匹配动画持续时间
  }
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

    // 自动激活下一个（现在是当前这个）空槽位
    activateNextEmptySlot();

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

    // 禁用运行配置 (除了GTO筛选)
    const runtimeConfigSection = document.getElementById('runtime-config-section');
    if (runtimeConfigSection) {
        // 遍历所有直接子元素（form-row）
        Array.from(runtimeConfigSection.querySelectorAll('.form-row')).forEach(row => {
            // 如果当前行是GTO筛选行，则跳过
            if (row.contains(document.getElementById('gto-filter-players'))) {
                return;
            }
            // 否则，禁用它
            row.style.opacity = '0.5';
            row.style.pointerEvents = 'none';
        });
    }

    updateActionSheet(game.players[game.sbIndex].id, 'BET', Settings.sb);
    updateActionSheet(game.players[game.bbIndex].id, 'BET', Settings.bb);

    log('✅ 新牌局开始！盲注: SB=' + Settings.sb + ', BB=' + Settings.bb);
    log(`[SYSTEM] ${game.players[game.sbIndex].id} posts Small Blind ${Settings.sb}`);
    log(`[SYSTEM] ${game.players[game.bbIndex].id} posts Big Blind ${Settings.bb}`);
    updateUI({ isInitialDeal: true });

    startBtn.textContent = '🛑 停止牌局';
    startBtn.disabled = false;
    pauseBtn.disabled = Settings.mode === 'manual'; // 手动模式下禁用暂停
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

function updatePlayerLayout() {
    const table = document.querySelector('.poker-table');
    if (!table) return;

    const tableRect = table.getBoundingClientRect();
    const centerX = tableRect.width / 2;
    const centerY = tableRect.height / 2;

    // 半径减去一定像素作为内边距
    const radiusX = (tableRect.width / 2) - 70;
    const radiusY = (tableRect.height / 2) - 60;

    const players = Array.from(document.querySelectorAll('.player')).filter(p => p.style.display !== 'none');
    const playerCount = players.length;
    if (playerCount === 0) return;

    // 定义8个玩家的标准座位角度 (顺时针, 0度在右侧)
    // 这个顺序将P1放在底部，然后P2在左下，P3在左边...
    const seatAngles = [
        90,  // P1 (Bottom)
        135, // P2 (Bottom-left)
        180, // P3 (Left)
        225, // P4 (Top-left)
        270, // P5 (Top)
        315, // P6 (Top-right)
        0,   // P7 (Right)
        45   // P8 (Bottom-right)
    ];

    players.forEach(player => {
        const playerId = player.dataset.player;
        const playerNum = parseInt(playerId.substring(1)); // e.g., 1 for P1

        // 获取该玩家的预设角度
        const angleDeg = seatAngles[playerNum - 1];
        const angleRad = angleDeg * (Math.PI / 180);

        const x = centerX + radiusX * Math.cos(angleRad);
        const y = centerY + radiusY * Math.sin(angleRad);

        player.style.left = `${x}px`;
        player.style.top = `${y}px`;
        player.style.transform = 'translate(-50%, -50%)';
        // 清除旧的或冲突的样式
        player.style.bottom = '';
        player.style.right = '';
    });
}

function updatePlayerDisplay() {
  const playerCount = Settings.playerCount;
  for (let i = 1; i <= 8; i++) {
    const playerElement = document.querySelector(`.player[data-player="P${i}"]`);
    if (playerElement) {
      // 使用 'flex' 因为 .player 的 display 样式是 flex
      playerElement.style.display = i <= playerCount ? 'flex' : 'none';
    }
  }
  // 在更新玩家可见性后，重新计算布局
  updatePlayerLayout();
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

  // 重新启用运行配置
  const runtimeConfigSection = document.getElementById('runtime-config-section');
  if (runtimeConfigSection) {
      Array.from(runtimeConfigSection.querySelectorAll('.form-row')).forEach(row => {
          row.style.opacity = '';
          row.style.pointerEvents = '';
      });
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
  // 在进入下一轮之前，检查是否只剩一个玩家，如果是，则游戏直接结束
  const activePlayers = game.players.filter(p => !p.isFolded);
  if (activePlayers.length <= 1) {
    // 延迟一小段时间再结束，让玩家有时间看到最后一个动作
    setTimeout(endGame, 500);
    return;
  }

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
  const runtimeConfigSection = document.getElementById('runtime-config-section');
  if (runtimeConfigSection) {
      Array.from(runtimeConfigSection.querySelectorAll('.form-row')).forEach(row => {
          row.style.opacity = '';
          row.style.pointerEvents = '';
      });
  }
}

// ========== 新手动模式功能 V2 ==========

/**
 * 隐藏所有玩家行动弹出窗口。
 */
function hideAllActionPopups() {
    document.querySelectorAll('.player-action-popup').forEach(p => {
        p.style.display = 'none';
        const sliderOverlay = p.querySelector('.amount-slider-overlay');
        if (sliderOverlay) {
            sliderOverlay.style.display = 'none';
        }
    });
    isWaitingForManualInput = false;
}

function adjustPopupPosition(popup) {
    const table = document.querySelector('.poker-table');
    if (!table || !popup) return;

    requestAnimationFrame(() => {
        // Reset adjustments to get a clean calculation
        popup.style.margin = '0';

        const tableRect = table.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();

        let marginLeft = 0;
        let marginTop = 0;

        // Check for horizontal overflow
        const overflowLeft = tableRect.left - popupRect.left;
        if (overflowLeft > 0) {
            marginLeft += overflowLeft;
        }
        const overflowRight = popupRect.right - tableRect.right;
        if (overflowRight > 0) {
            marginLeft -= overflowRight;
        }

        // Check for vertical overflow
        const overflowTop = tableRect.top - popupRect.top;
        if (overflowTop > 0) {
            marginTop += overflowTop;
        }
        const overflowBottom = popupRect.bottom - tableRect.bottom;
        if (overflowBottom > 0) {
            marginTop -= overflowBottom;
        }
        
        // Apply adjustments via margin, which works alongside the centering transform
        if (marginLeft !== 0 || marginTop !== 0) {
            popup.style.margin = `${marginTop}px 0 0 ${marginLeft}px`;
        }
    });
}

/**
 * 为指定玩家显示行动弹出窗口。
 * @param {string} playerId
 */
function showPlayerActionPopup(playerId) {
    hideAllActionPopups();

    const playerElement = document.querySelector(`.player[data-player="${playerId}"]`);
    if (!playerElement) return;

    const popup = playerElement.querySelector('.player-action-popup');
    const actionPanel = popup.querySelector('.action-panel');
    const sliderOverlay = popup.querySelector('.amount-slider-overlay');

    // Reset transform before showing to ensure calculations are fresh
    popup.style.transform = 'translate(-50%, -50%)';

    // Get all UI elements inside the popup
    const betRaiseBtn = popup.querySelector('.bet-raise');
    const checkCallBtn = popup.querySelector('.check-call');
    const foldBtn = popup.querySelector('.fold');
    const quickBetContainer = popup.querySelector('.quick-bet-sizes');
    const mainButtonsContainer = popup.querySelector('.main-action-buttons');
    const quickBetBtns = popup.querySelectorAll('.quick-bet-sizes button');

    const gameState = game.getGameState();
    const player = gameState.players.find(p => p.id === playerId);
    const toCall = gameState.highestBet - player.bet;

    // Reset all buttons and containers to default visibility and layout
    quickBetContainer.style.display = 'block';
    mainButtonsContainer.style.justifyContent = 'center'; // default is center
    betRaiseBtn.style.display = 'block';
    checkCallBtn.style.display = 'block';
    foldBtn.style.display = 'block';


    // --- Configure buttons based on game state ---

    if (toCall > 0 && player.stack < toCall) {
        // ** SCENARIO: INSUFFICIENT STACK **
        // Player cannot afford to call, so options are FOLD or ALL-IN.
        quickBetContainer.style.display = 'none';
        betRaiseBtn.style.display = 'none'; // Hide the regular Bet/Raise button

        // Repurpose the Check/Call button to be the ALL-IN button
        checkCallBtn.textContent = 'ALL-IN';
        checkCallBtn.dataset.action = 'ALLIN';

        // The Fold button is already visible. We can adjust layout if needed.
        mainButtonsContainer.style.justifyContent = 'space-around'; // Space out Fold and All-in

    } else if (toCall === 0) {
        // ** SCENARIO: CHECK or BET/RAISE **
        checkCallBtn.textContent = '让牌';
        checkCallBtn.dataset.action = 'CHECK';

        // 如果场上最高下注额>0（例如，BB自己下的盲注），那么当前玩家的选择是“过牌”或“加注”
        // 否则，如果最高下注额为0，那么选择是“过牌”或“下注”
        if (gameState.highestBet > 0) {
            betRaiseBtn.textContent = '加注';
            betRaiseBtn.dataset.action = 'RAISE';
        } else {
            betRaiseBtn.textContent = '下注';
            betRaiseBtn.dataset.action = 'BET';
        }
    } else {
        // ** SCENARIO: FOLD, CALL, or RAISE **
        checkCallBtn.textContent = '跟注';
        checkCallBtn.dataset.action = 'CALL';

        // 检查玩家是否有足够筹码进行一次最小加注
        const minRaiseToAmount = gameState.highestBet + gameState.lastRaiseAmount;
        const playerTotalChips = player.stack + player.bet;

        // 如果玩家的总筹码小于或等于最小加注额，他们唯一的“加注”选项就是 all-in
        if (playerTotalChips <= minRaiseToAmount) {
            betRaiseBtn.textContent = 'ALL-IN';
            betRaiseBtn.dataset.action = 'ALLIN';
            quickBetContainer.style.display = 'none'; // 在此场景下隐藏快速按钮
        } else {
            betRaiseBtn.textContent = '加注';
            betRaiseBtn.dataset.action = 'RAISE';
        }
    }

    // --- Configure quick bet buttons (only if they are visible) ---
    if (quickBetContainer.style.display !== 'none') {
        const pot = gameState.pot;
        const actionForQuickBet = toCall === 0 ? 'BET' : 'RAISE';
        const playerTotalChips = player.stack + player.bet;

        quickBetBtns.forEach(btn => {
            const multiplier = parseFloat(btn.dataset.sizeMultiplier);
            let idealAmount = 0;
            if (actionForQuickBet === 'BET') {
                idealAmount = Math.round(pot * multiplier);
            } else { // RAISE
                // 标准加注算法：总下注额 = 跟注额 + (跟注后的底池 * 倍率)
                const potAfterCall = pot + toCall;
                idealAmount = toCall + Math.round(potAfterCall * multiplier);
            }

            // 金额必须有效 (Validate against min bet/raise)
            const minBet = Settings.bb;
            const minRaiseTo = gameState.highestBet + gameState.lastRaiseAmount;
            const validatedIdealAmount = (actionForQuickBet === 'BET') ? Math.max(idealAmount, minBet) : Math.max(idealAmount, minRaiseTo);

            // 按钮上显示理想金额
            btn.querySelector('small').textContent = validatedIdealAmount > 0 ? validatedIdealAmount : '-';

            // 检查玩家是否有足够筹码
            if (validatedIdealAmount > playerTotalChips) {
                // 筹码不足，禁用按钮
                btn.disabled = true;
                btn.dataset.amount = playerTotalChips; // 数据上设为 all-in 金额
            } else {
                // 筹码充足，启用按钮
                btn.disabled = false;
                btn.dataset.amount = validatedIdealAmount;
            }
        });
    }


    // --- 显示UI ---
    actionPanel.style.display = 'flex';
    sliderOverlay.style.display = 'none';
    popup.style.display = 'flex';

    // Adjust position to stay within the table
    adjustPopupPosition(popup);

    isWaitingForManualInput = true;
}

/**
 * 显示垂直滑块进行下注/加注
 * @param {string} playerId
 * @param {'BET' | 'RAISE'} action
 */
function showVerticalSlider(playerId, action) {
    const playerElement = document.querySelector(`.player[data-player="${playerId}"]`);
    const popup = playerElement.querySelector('.player-action-popup');
    const actionPanel = popup.querySelector('.action-panel');
    const sliderOverlay = popup.querySelector('.amount-slider-overlay');
    const slider = sliderOverlay.querySelector('.bet-slider-input');

    // 隐藏主操作盘,显示滑块
    actionPanel.style.display = 'none';
    sliderOverlay.style.display = 'flex';

    slider.dataset.action = action;

    // 根据动作和游戏状态设置滑块的范围
    const gameState = game.getGameState();
    const player = gameState.players.find(p => p.id === playerId);
    let minAmount, maxAmount;

    if (action === 'BET') {
        minAmount = Math.min(Settings.bb, player.stack);
        maxAmount = player.stack;
    } else { // RAISE
        minAmount = gameState.highestBet + gameState.lastRaiseAmount;
        maxAmount = player.stack + player.bet; // 这是总金额
    }

    slider.dataset.minAmount = minAmount;
    slider.dataset.maxAmount = maxAmount;

    // 重置滑块到最小值并更新标签
    slider.value = 0;
    updateSliderAmount(playerId, slider);

    // Adjust position AFTER the slider view is displayed and popup has resized
    adjustPopupPosition(popup);
}

/**
 * 当滑块移动时，更新显示的金额
 * @param {string} playerId
 * @param {HTMLInputElement} slider
 */
function updateSliderAmount(playerId, slider) {
    const playerElement = document.querySelector(`.player[data-player="${playerId}"]`);
    const popup = playerElement.querySelector('.player-action-popup');
    const amountLabel = popup.querySelector('.slider-value-display');
    const confirmBtn = popup.querySelector('.confirm-bet');

    const percentage = parseInt(slider.value);
    const action = slider.dataset.action;
    const min = parseInt(slider.dataset.minAmount);
    const max = parseInt(slider.dataset.maxAmount);

    let finalAmount;
    const range = max - min;

    if (percentage === 100) {
        finalAmount = max;
    } else if (range <= 0) { // 处理最小加注即为 all-in 的情况
        finalAmount = max;
    } else {
        // 标准线性插值
        const rawAmount = min + (range * (percentage / 100));
        // 四舍五入到最接近的10，以提供更清晰的用户体验
        finalAmount = Math.round(rawAmount / 10) * 10;
    }

    // 确保最终金额被限制在 [min, max] 区间内
    finalAmount = Math.max(min, Math.min(finalAmount, max));

    slider.dataset.finalAmount = finalAmount;

    if (finalAmount === max) {
        amountLabel.textContent = `ALL-IN ${finalAmount}`;
        confirmBtn.textContent = 'ALL-IN';
    } else {
        amountLabel.textContent = finalAmount;
        confirmBtn.textContent = '确定';
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

    try {
        const player = game.players.find(p => p.id === playerId);
        let displayAction = action;
        // 'CALL'等动作不需要金额，引擎会自动计算。对于UI显示，我们在这里处理金额。
        let actionAmount = (action === 'CALL' || action === 'CHECK' || action === 'FOLD') ? undefined : amount;

        // 如果提供了金额 (BET/RAISE)，检查这是否构成 all-in
        if (player && actionAmount !== undefined) {
            if ((player.stack + player.bet) === actionAmount) {
                displayAction = 'ALLIN';
            }
        }
        // 如果动作是 'ALLIN' 但没有提供金额 (例如来自快捷按钮), 为UI显示计算正确的 all-in 金额
        else if (player && action === 'ALLIN' && actionAmount === undefined) {
            actionAmount = player.stack + player.bet;
        }

        // 核心逻辑：执行动作。注意：传递原始的 action 和 amount 给游戏引擎
        game.executeAction(currentPlayerId, action, amount);
        
        // UI 更新：使用美化过的 displayAction 和计算出的 actionAmount
        log(`[${game.currentRound}] ${currentPlayerId} ${displayAction}${actionAmount ? ' ' + actionAmount : ''}`);
        showActionBubble(currentPlayerId, displayAction, actionAmount);
        updateActionSheet(currentPlayerId, displayAction, actionAmount);

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
    /* --- JS Helper Class to forcefully hide elements --- */
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
}

document.addEventListener('DOMContentLoaded', init);
