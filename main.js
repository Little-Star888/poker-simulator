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
let currentSuggestionsCache = {}; // 用于缓存当前牌局的GTO建议

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

// --- DOM 元素变量 (在 init 函数中初始化) ---
let modeSelect, playerCountInput, minStackInput, maxStackInput, potTypeSelect, p1RoleSelect;
let sbInput, bbInput, autoDelayInput;
let suggestPreflopCheckbox, suggestFlopCheckbox, suggestTurnCheckbox, suggestRiverCheckbox;
let startBtn, pauseBtn, consoleLog;
let usePresetHandsCheckbox, usePresetCommunityCheckbox, presetControls, presetPlayerHandsContainer, presetCommunityCardsContainer, cardPicker, gtoFilterPlayersContainer;


// ========== 初始化 ==========
function init() {
  try {
    // --- DOM 元素获取 ---
    modeSelect = document.getElementById('mode-select');
    playerCountInput = document.getElementById('player-count-input');
    minStackInput = document.getElementById('min-stack-input');
    maxStackInput = document.getElementById('max-stack-input');
    potTypeSelect = document.getElementById('pot-type-select');
    p1RoleSelect = document.getElementById('p1-role-select');
    sbInput = document.getElementById('sb-input');
    bbInput = document.getElementById('bb-input');
    autoDelayInput = document.getElementById('auto-delay');
    suggestPreflopCheckbox = document.getElementById('suggest-preflop');
    suggestFlopCheckbox = document.getElementById('suggest-flop');
    suggestTurnCheckbox = document.getElementById('suggest-turn');
    suggestRiverCheckbox = document.getElementById('suggest-river');
    startBtn = document.getElementById('start-btn');
    pauseBtn = document.getElementById('pause-btn');
    consoleLog = document.getElementById('console-log');
    usePresetHandsCheckbox = document.getElementById('use-preset-hands-checkbox');
    usePresetCommunityCheckbox = document.getElementById('use-preset-community-checkbox');
    presetControls = document.getElementById('preset-controls');
    presetPlayerHandsContainer = document.getElementById('preset-player-hands-container');
    presetCommunityCardsContainer = document.getElementById('preset-community-cards-container');
    cardPicker = document.getElementById('card-picker');
    gtoFilterPlayersContainer = document.getElementById('gto-filter-players');

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

    document.getElementById('preset-controls').style.display = '';

    function updatePotTypeSelectState() {
      const isManualMode = modeSelect.value === 'manual';
      potTypeSelect.disabled = isManualMode;
      if (isManualMode) {
          potTypeSelect.style.backgroundColor = '#eee';
      } else {
          potTypeSelect.style.backgroundColor = '';
      }
    }
    updatePotTypeSelectState();

    modeSelect.addEventListener('change', () => {
      Settings.update({ mode: modeSelect.value });
      updatePotTypeSelectState();
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
      renderActionSheetTemplate();
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

    usePresetHandsCheckbox.addEventListener('change', updatePresetVisibility);
    usePresetCommunityCheckbox.addEventListener('change', updatePresetVisibility);

    document.querySelectorAll('.player').forEach(playerElement => {
      const playerId = playerElement.dataset.player;
      const popup = playerElement.querySelector('.player-action-popup');
      if (!popup) return;
      const sliderOverlay = popup.querySelector('.amount-slider-overlay');
      const sliderInput = sliderOverlay.querySelector('.bet-slider-input');
      const foldBtn = popup.querySelector('.main-action-btn.fold');
      const betRaiseBtn = popup.querySelector('.main-action-btn.bet-raise');
      const checkCallBtn = popup.querySelector('.main-action-btn.check-call');
      foldBtn.addEventListener('click', () => submitManualAction(playerId, 'FOLD'));
      checkCallBtn.addEventListener('click', () => {
          const action = checkCallBtn.dataset.action;
          submitManualAction(playerId, action);
      });
      betRaiseBtn.addEventListener('click', () => {
          const action = betRaiseBtn.dataset.action;
          if (action === 'ALLIN') {
              const player = game.players.find(p => p.id === playerId);
              if (player) {
                  const amount = player.stack + player.bet;
                  submitManualAction(playerId, 'ALLIN', amount);
              }
          } else {
              showVerticalSlider(playerId, action);
          }
      });
      popup.querySelectorAll('.quick-bet-sizes button').forEach(btn => {
          btn.addEventListener('click', () => {
              const amount = parseInt(btn.dataset.amount);
              if (amount > 0) {
                  const action = betRaiseBtn.dataset.action;
                  submitManualAction(playerId, action, amount);
              }
          });
      });
      const confirmBtn = sliderOverlay.querySelector('.confirm-bet');
      confirmBtn.addEventListener('click', () => {
          const amount = parseInt(sliderInput.dataset.finalAmount);
          const action = sliderInput.dataset.action;
          submitManualAction(playerId, action, amount);
      });
      sliderInput.addEventListener('input', () => updateSliderAmount(playerId, sliderInput));
      popup.addEventListener('click', (e) => {
          if (e.target === popup) {
              hideAllActionPopups();
          }
      });
      sliderOverlay.addEventListener('click', (e) => {
          if (e.target === sliderOverlay) {
              e.stopPropagation();
              const actionPanel = popup.querySelector('.action-panel');
              sliderOverlay.style.display = 'none';
              actionPanel.style.display = 'flex';
          }
      });
    });

    updatePlayerDisplay();
    updateGtoFilterCheckboxes();
    renderActionSheetTemplate();
    log('德州扑克 AI 测试模拟器已加载');
    injectStyles();

    const configDrawer = document.getElementById('config-drawer');
    const configToggleBtn = document.getElementById('config-toggle-btn');
    const drawerCloseBtn = document.querySelector('.drawer-close-btn');
    const drawerOverlay = document.querySelector('.drawer-overlay');
    function openDrawer() {
      if (configDrawer) configDrawer.classList.add('is-open');
    }
    function closeDrawer() {
      if (configDrawer) configDrawer.classList.remove('is-open');
    }
    if (configToggleBtn) configToggleBtn.addEventListener('click', openDrawer);
    if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeDrawer);
    if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);

    const table = document.querySelector('.poker-table');
    if (table) {
      const resizeObserver = new ResizeObserver(() => {
        updatePlayerLayout();
      });
      resizeObserver.observe(table);
    }

    initSnapshotModalListeners();
    renderSnapshotList();
    updatePresetVisibility();

    document.getElementById('snapshot-list').addEventListener('click', (e) => {
      if (e.target && e.target.classList.contains('snapshot-name-display')) {
          if (document.querySelector('.snapshot-name-edit')) {
              document.querySelector('.snapshot-name-edit').blur();
          }
          makeSnapshotNameEditable(e.target);
      }
    });

  } catch (error) {
    log(`❌ CRITICAL INIT ERROR: ${error.message}`);
    console.error("CRITICAL INIT ERROR:", error);
  }
}

function makeSnapshotNameEditable(nameElement) {
    const snapshotId = nameElement.dataset.snapshotId;
    const currentName = nameElement.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'snapshot-name-edit';
    nameElement.parentNode.replaceChild(input, nameElement);
    input.focus();
    input.select();
    const saveChanges = () => {
        const newName = input.value.trim();
        let savedSnapshots = JSON.parse(localStorage.getItem('pokerSnapshots') || '[]');
        const snapshotIndex = savedSnapshots.findIndex(s => s.id === snapshotId);
        const finalName = newName || currentName;
        if (snapshotIndex > -1 && newName && newName !== currentName) {
            savedSnapshots[snapshotIndex].name = finalName;
            localStorage.setItem('pokerSnapshots', JSON.stringify(savedSnapshots));
            log(`快照名称已更新为 "${finalName}"`);
        }
        const newNameElement = document.createElement('strong');
        newNameElement.className = 'snapshot-name-display';
        newNameElement.dataset.snapshotId = snapshotId;
        newNameElement.textContent = finalName;
        if (input.parentNode) {
            input.parentNode.replaceChild(newNameElement, input);
        }
    };
    input.addEventListener('blur', saveChanges);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveChanges();
        } else if (e.key === 'Escape') {
            const originalNameElement = document.createElement('strong');
            originalNameElement.className = 'snapshot-name-display';
            originalNameElement.dataset.snapshotId = snapshotId;
            originalNameElement.textContent = currentName;
            if (input.parentNode) {
                input.parentNode.replaceChild(originalNameElement, input);
            }
        }
    });
}

// ... (rest of the functions from previous correct versions) ...

// ========== 牌局预设功能 ==========

function getSlotSequence() {
    const sequence = [];
    if (Settings.usePresetCommunity) {
        document.querySelectorAll('#preset-community-cards-container .preset-card-slot').forEach(slot => sequence.push(slot));
    }
    if (Settings.usePresetHands) {
        document.querySelectorAll('#preset-player-hands-container .preset-card-slot').forEach(slot => sequence.push(slot));
    }
    return sequence;
}

function activateNextEmptySlot() {
    if (activeSelectionSlot) {
        activeSelectionSlot.classList.remove('active-selection');
        activeSelectionSlot = null;
    }
    const sequence = getSlotSequence();
    for (const slot of sequence) {
        if (!slot.dataset.card) {
            activeSelectionSlot = slot;
            activeSelectionSlot.classList.add('active-selection');
            return;
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

function animateCardToSlot(pickerCard, destinationElement, cardText) {
    const startRect = pickerCard.getBoundingClientRect();
    const endRect = destinationElement.getBoundingClientRect();
    if (endRect.width === 0 || endRect.height === 0) {
        console.warn("Destination element for card animation is not visible or has zero dimensions. Skipping animation for this target.");
        return;
    }
    const movingCard = document.createElement('div');
    movingCard.style.position = 'fixed';
    movingCard.style.zIndex = '2001';
    movingCard.style.left = `${startRect.left}px`;
    movingCard.style.top = `${startRect.top}px`;
    movingCard.style.width = `${startRect.width}px`;
    movingCard.style.height = `${endRect.height}px`;
    movingCard.style.backgroundImage = `url(${getCardImagePath(cardText)})`;
    movingCard.style.backgroundSize = 'contain';
    movingCard.style.backgroundRepeat = 'no-repeat';
    movingCard.style.backgroundPosition = 'center';
    movingCard.style.borderRadius = '4px';
    movingCard.style.transition = 'all 0.4s ease-in-out';
    document.body.appendChild(movingCard);
    setTimeout(() => {
        movingCard.style.left = `${endRect.left}px`;
        movingCard.style.top = `${endRect.top}px`;
        movingCard.style.width = `${endRect.width}px`;
        movingCard.style.height = `${endRect.height}px`;
    }, 20);
    setTimeout(() => {
        document.body.removeChild(movingCard);
    }, 420);
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
  let animationsInitiated = 0;
  animateCardToSlot(pickerCard, activeSelectionSlot, cardText);
  animationsInitiated++;
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
  if (animationsInitiated > 0) {
      setTimeout(() => {
          assignCard(activeSelectionSlot, cardText);
          activateNextEmptySlot();
      }, 420);
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
  const elementsToAnimate = [slot];
  let cardOnTable = null;
  if (type === 'player') {
    const playerOnTable = document.querySelector(`.player[data-player="${playerId}"]`);
    if (playerOnTable) {
        cardOnTable = playerOnTable.querySelectorAll('.hole-card')[parseInt(cardIndex)];
        if (cardOnTable) elementsToAnimate.push(cardOnTable);
    }
  }
  elementsToAnimate.forEach(el => el.classList.add('card-unassigned'));
  setTimeout(() => {
    if (type === 'player') {
      Settings.presetCards.players[playerId][parseInt(cardIndex)] = null;
    } else {
      Settings.presetCards[stage][parseInt(cardIndex)] = null;
    }
    usedCards.delete(cardText);
    const pickerCard = cardPicker.querySelector(`.picker-card[data-card="${cardText.replace('"', '"' )}"]`);
    if (pickerCard) {
      pickerCard.classList.remove('dimmed');
    }
    elementsToAnimate.forEach(el => {
        el.style.backgroundImage = '';
        el.classList.remove('card-unassigned');
    });
    delete slot.dataset.card;
    activateNextEmptySlot();
  }, 300);
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
        if (Settings.mode === 'auto') {
            processNextAction();
        }
    } else {
        isGamePaused = true;
        log('⏸️ 牌局暂停');
        pauseBtn.textContent = '▶️ 继续';
    }
}

function startNewGame() {
  currentSuggestionsCache = []; // 清空GTO建议缓存
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
  game.reset(Settings);
  isGamePaused = false;
  try {
    updatePlayerDisplay();
    renderActionSheet();
    game.dealHoleCards();
    game.startNewRound('preflop');
    isGameRunning = true;
    document.getElementById('preset-section').style.opacity = '0.5';
    document.getElementById('preset-section').style.pointerEvents = 'none';
    const runtimeConfigSection = document.getElementById('runtime-config-section');
    if (runtimeConfigSection) {
        Array.from(runtimeConfigSection.querySelectorAll('.form-row')).forEach(row => {
            if (row.contains(document.getElementById('gto-filter-players'))) {
                return;
            }
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
    pauseBtn.disabled = Settings.mode === 'manual';
    pauseBtn.textContent = '⏸️ 暂停';
    if (Settings.mode === 'auto') {
      setTimeout(processNextAction, Settings.autoDelay);
    } else {
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
    const radiusX = (tableRect.width / 2) - 70;
    const radiusY = (tableRect.height / 2) - 60;
    const players = Array.from(document.querySelectorAll('.player')).filter(p => p.style.display !== 'none');
    const playerCount = players.length;
    if (playerCount === 0) return;
    const seatAngles = [ 90, 135, 180, 225, 270, 315, 0, 45 ];
    players.forEach(player => {
        const playerId = player.dataset.player;
        const playerNum = parseInt(playerId.substring(1));
        const angleDeg = seatAngles[playerNum - 1];
        const angleRad = angleDeg * (Math.PI / 180);
        const x = centerX + radiusX * Math.cos(angleRad);
        const y = centerY + radiusY * Math.sin(angleRad);
        player.style.left = `${x}px`;
        player.style.top = `${y}px`;
        player.style.transform = 'translate(-50%, -50%)';
        player.style.bottom = '';
        player.style.right = '';
    });
}

function updatePlayerDisplay() {
  const playerCount = Settings.playerCount;
  for (let i = 1; i <= 8; i++) {
    const playerElement = document.querySelector(`.player[data-player="P${i}"]`);
    if (playerElement) {
      playerElement.style.display = i <= playerCount ? 'flex' : 'none';
    }
  }
  updatePlayerLayout();
}

function updateGtoFilterCheckboxes() {
    gtoFilterPlayersContainer.innerHTML = '';
    gtoSuggestionFilter.clear();
    if (Settings.playerCount > 0) {
        gtoSuggestionFilter.add('P1');
    }
    for (let i = 1; i <= Settings.playerCount; i++) {
        const playerId = `P${i}`;
        const isChecked = (playerId === 'P1');
        const label = document.createElement('label');
        label.style.marginRight = '10px';
        label.style.width = 'auto';
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
    switch (playerCount) {
        case 2: return ['SB', 'BTN'];
        case 3: return ['SB', 'BB', 'BTN'];
        case 4: return ['SB', 'BB', 'CO', 'BTN'];
        case 5: return ['SB', 'BB', 'UTG', 'CO', 'BTN'];
        case 6: return ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];
        case 7: return ['SB', 'BB', 'UTG', 'MP1', 'HJ', 'CO', 'BTN'];
        case 8: return ['SB', 'BB', 'UTG', 'UTG+1', 'MP1', 'HJ', 'CO', 'BTN'];
        default:
            const baseRoles = ['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP1', 'MP2', 'HJ', 'CO'];
            return baseRoles.slice(0, playerCount - 1).concat('BTN');
    }
}

function updateP1RoleSelectOptions() {
    const playerCount = Settings.playerCount;
    const availableRoles = getRoleOrder(playerCount);
    const currentP1Role = Settings.p1Role;
    p1RoleSelect.innerHTML = '<option value="random">随机</option>';
    availableRoles.forEach(role => {
        const option = document.createElement('option');
        option.value = role;
        option.textContent = role;
        p1RoleSelect.appendChild(option);
    });
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
  game.reset(Settings);
  updateUI();
  updatePlayerDisplay();
  renderActionSheet();
  document.getElementById('suggestion-display').innerHTML = '等待玩家行动...';
  startBtn.textContent = '▶️ 开始牌局';
  startBtn.disabled = false;
  pauseBtn.textContent = '⏸️ 暂停';
  pauseBtn.disabled = true;
  document.getElementById('preset-section').style.opacity = '1';
  document.getElementById('preset-section').style.pointerEvents = 'auto';
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
        currentSuggestionsCache.push({ playerId: currentPlayerId, suggestion: suggestion }); // 立即更新缓存
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
      return;
    }
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
  const activePlayers = game.players.filter(p => !p.isFolded);
  if (activePlayers.length <= 1) {
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

// ========== 快照功能 V3 (自定义截图 + 自定义确认 + Bug修复) ==========

// --- 自定义截图相关全局变量 ---
let isSelecting = false;
let selectionStartX, selectionStartY;

/**
 * “保存快照”按钮的点击事件处理程序。
 * 启动截图选择流程。
 */
function handleSnapshotButtonClick() {
    if (!isGameRunning) {
        log('⚠️ 游戏未开始，无法保存快照。');
        return;
    }
    log('🖱️ 请在页面上拖拽以选择截图区域...');
    const overlay = document.getElementById('screenshot-selection-overlay');
    if (!overlay) {
        log('❌ 错误：无法找到截图覆盖层元素。');
        return;
    }
    overlay.style.display = 'block';
    document.body.style.userSelect = 'none';

    overlay.addEventListener('mousedown', startSelection);
    overlay.addEventListener('mousemove', dragSelection);
    window.addEventListener('mouseup', endSelection);
}

/**
 * 截图选择：鼠标按下事件
 */
function startSelection(e) {
    if (e.button !== 0) return;
    isSelecting = true;
    selectionStartX = e.clientX;
    selectionStartY = e.clientY;
    const selectionBox = document.getElementById('selection-box');
    if (!selectionBox) return;
    
    selectionBox.style.left = `${selectionStartX}px`;
    selectionBox.style.top = `${selectionStartY}px`;
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block';
}

/**
 * 截图选择：鼠标移动事件，绘制选框
 */
function dragSelection(e) {
    if (!isSelecting) return;
    const selectionBox = document.getElementById('selection-box');
    if (!selectionBox) return;

    const currentX = e.clientX;
    const currentY = e.clientY;
    const width = Math.abs(currentX - selectionStartX);
    const height = Math.abs(currentY - selectionStartY);
    const newX = Math.min(currentX, selectionStartX);
    const newY = Math.min(currentY, selectionStartY);
    selectionBox.style.left = `${newX}px`;
    selectionBox.style.top = `${newY}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;
}

/**
 * 截图选择：鼠标释放事件，结束选择并触发截图
 */
function endSelection(e) {
    const overlay = document.getElementById('screenshot-selection-overlay');
    if (!overlay || overlay.style.display === 'none') {
        window.removeEventListener('mouseup', endSelection);
        return;
    }
    
    isSelecting = false;
    overlay.style.display = 'none';
    document.body.style.userSelect = 'auto';

    overlay.removeEventListener('mousedown', startSelection);
    overlay.removeEventListener('mousemove', dragSelection);
    window.removeEventListener('mouseup', endSelection);

    const selectionBox = document.getElementById('selection-box');
    if (!selectionBox) return;

    selectionBox.style.display = 'none';
    const finalWidth = parseFloat(selectionBox.style.width);
    const finalHeight = parseFloat(selectionBox.style.height);

    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';

    if (finalWidth < 20 || finalHeight < 20) {
        log('截图区域太小，操作已取消。');
        return;
    }

    const cropOptions = {
        x: parseFloat(selectionBox.style.left),
        y: parseFloat(selectionBox.style.top),
        width: finalWidth,
        height: finalHeight,
    };

    captureAndProceed(cropOptions);
}

/**
 * 根据选定区域截图，并执行后续流程（获取GTO、显示确认框）
 */
async function captureAndProceed(cropOptions) {
    log('📸 正在根据选定区域生成快照...');
    try {
        const canvas = await html2canvas(document.body, {
            useCORS: true,
            backgroundColor: null,
            scale: 2, 
            ...cropOptions
        });
        const imageData = canvas.toDataURL('image/png');
        log('✅ 截图已生成。正在整理当前GTO建议...');

        const gameState = game.getGameState(); // 重新加入这行来定义gameState

        // 直接从缓存数组映射，该数组包含本局所有已生成的建议
        const allGtoSuggestions = currentSuggestionsCache.map(item => {
            return {
                playerId: item.playerId,
                suggestion: item.suggestion,
                notes: ''
            };
        });

        log('✅ 所有当前GTO建议已整理。请在弹窗中确认保存。');

        window.pendingSnapshotData = {
            timestamp: new Date().toLocaleString(),
            gameState: gameState,
            imageData: imageData,
            allGtoSuggestions: allGtoSuggestions,
        };
        
        showSnapshotModal();

    } catch (error) {
        log('❌ 截图失败: ' + error.message);
        console.error('截图失败:', error);
        window.pendingSnapshotData = null;
    }
}

/**
 * 显示快照确认模态框
 */
function showSnapshotModal() {
    const modal = document.getElementById('snapshot-modal');
    const preview = document.getElementById('snapshot-preview');
    if (window.pendingSnapshotData && window.pendingSnapshotData.imageData) {
        preview.src = window.pendingSnapshotData.imageData;
    } else {
        preview.src = '';
    }
    if(modal) modal.classList.add('is-visible');
}

/**
 * 隐藏快照确认模态框，并清除暂存数据
 */
function hideSnapshotModal() {
    const modal = document.getElementById('snapshot-modal');
    if(modal) modal.classList.remove('is-visible');
    window.pendingSnapshotData = null;
}

/**
 * 初始化所有快照相关的事件监听器
 */
function initSnapshotModalListeners() {
    document.getElementById('save-snapshot-btn').addEventListener('click', handleSnapshotButtonClick);
    document.getElementById('save-snapshot-confirm-btn').addEventListener('click', savePendingSnapshot);
    document.getElementById('cancel-snapshot-btn').addEventListener('click', hideSnapshotModal);
    document.getElementById('close-view-snapshot-modal-btn').addEventListener('click', () => {
        const modal = document.getElementById('view-snapshot-modal');
        if(modal) modal.classList.remove('is-visible');
    });
    document.getElementById('save-snapshot-remarks-btn').addEventListener('click', saveSnapshotRemarks);

    document.getElementById('delete-confirm-yes').addEventListener('click', () => {
        const popover = document.getElementById('delete-confirm-popover');
        if (popover) {
            const snapshotId = popover.dataset.snapshotId;
            if (snapshotId) {
                deleteSnapshot(snapshotId);
            }
            popover.style.display = 'none';
        }
    });
    document.getElementById('delete-confirm-no').addEventListener('click', () => {
        const popover = document.getElementById('delete-confirm-popover');
        if (popover) {
            popover.style.display = 'none';
        }
    });
    document.addEventListener('click', (e) => {
        const popover = document.getElementById('delete-confirm-popover');
        if (popover && popover.style.display === 'block' && !popover.contains(e.target) && !e.target.classList.contains('delete-btn')) {
            popover.style.display = 'none';
        }
    });
}

/**
 * 保存当前暂存的快照到 localStorage
 */
function savePendingSnapshot() {
    const pendingData = window.pendingSnapshotData;
    if (!pendingData) {
        log('❌ 无法保存快照：没有待处理的快照数据。');
        hideSnapshotModal();
        return;
    }

    // 从输入框获取名称
    const nameInput = document.getElementById('snapshot-name-input');
    let snapshotName = nameInput.value.trim();

    // 如果名称为空，则使用时间戳作为默认名称
    if (!snapshotName) {
        snapshotName = `快照 ${pendingData.timestamp}`;
    }

    const snapshotId = `snapshot_${Date.now()}`;
    
    const snapshot = {
        id: snapshotId,
        name: snapshotName, // 添加 name 属性
        ...pendingData
    };

    let savedSnapshots = JSON.parse(localStorage.getItem('pokerSnapshots') || '[]');
    savedSnapshots.unshift(snapshot);
    localStorage.setItem('pokerSnapshots', JSON.stringify(savedSnapshots));

    log(`✅ 快照 "${snapshotName}" (ID: ${snapshotId}) 已保存。`);
    
    // 为下次使用清空输入框
    nameInput.value = '';

    hideSnapshotModal();
    renderSnapshotList();

    // 自动打开新创建的快照详情
    log(`自动打开快照详情...`);
    showViewSnapshotModal(snapshotId);
}

/**
 * 渲染快照列表到UI
 */
function renderSnapshotList() {
    const snapshotListUl = document.getElementById('snapshot-list');
    if (!snapshotListUl) return;
    snapshotListUl.innerHTML = '';
    const savedSnapshots = JSON.parse(localStorage.getItem('pokerSnapshots') || '[]');
    if (savedSnapshots.length === 0) {
        snapshotListUl.innerHTML = '<li style="text-align: center; color: #888; padding: 20px 0;">暂无快照</li>';
        return;
    }
    savedSnapshots.forEach(snapshot => {
        const li = document.createElement('li');
        li.dataset.snapshotId = snapshot.id;
        const firstNote = snapshot.allGtoSuggestions?.find(s => s.notes)?.notes || '暂无备注';
        li.innerHTML = `
            <div class="snapshot-info">
                <strong class="snapshot-name-display" data-snapshot-id="${snapshot.id}">${snapshot.name}</strong><br>
                <small>${snapshot.timestamp}</small>
            </div>
            <div class="snapshot-actions">
                <button class="view-btn">查看建议</button>
                <button class="delete-btn">删除快照</button>
            </div>
        `;
        snapshotListUl.appendChild(li);
    });
    snapshotListUl.querySelectorAll('.view-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const snapshotId = e.target.closest('li').dataset.snapshotId;
            showViewSnapshotModal(snapshotId);
        });
    });
    snapshotListUl.querySelectorAll('.delete-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const snapshotId = e.target.closest('li').dataset.snapshotId;
            showDeleteConfirmation(snapshotId, e.target);
        });
    });
}

/**
 * 为查看快照模态框构建单个建议的HTML元素
 */
function buildSuggestionElement(suggestion, playerId, phase) {
    const suggestionWrapper = document.createElement('div');
    const title = document.createElement('h4');
    title.innerHTML = `给 ${playerId} 的建议 <span style="color: #fd971f;">[${phase.toUpperCase()}]</span>:`
    title.style.margin = '0 0 8px 0';
    title.style.color = '#66d9ef';
    suggestionWrapper.appendChild(title);
    if (suggestion && suggestion.error) {
        suggestionWrapper.innerHTML += `<div style="color: #ff6b6b;">获取建议失败: ${suggestion.error}</div>`;
        return suggestionWrapper;
    }
    if (!suggestion) {
        suggestionWrapper.innerHTML += `<div style="color: #ff6b6b;">建议数据为空。</div>`;
        return suggestionWrapper;
    }
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
    return suggestionWrapper;
}

/**
 * 显示查看快照的模态框，并填充内容
 */
async function showViewSnapshotModal(snapshotId) {
    const savedSnapshots = JSON.parse(localStorage.getItem('pokerSnapshots') || '[]');
    const snapshot = savedSnapshots.find(s => s.id === snapshotId);
    if (!snapshot) {
        log(`❌ 无法找到快照: ${snapshotId}`);
        return;
    }
    const modal = document.getElementById('view-snapshot-modal');
    const imageEl = document.getElementById('view-snapshot-image');
    const suggestionsListEl = document.getElementById('view-snapshot-suggestions-list');
    suggestionsListEl.innerHTML = '';
    modal.dataset.snapshotId = snapshotId;
    imageEl.src = snapshot.imageData;
    if (snapshot.allGtoSuggestions && snapshot.allGtoSuggestions.length > 0) {
        snapshot.allGtoSuggestions.forEach(suggestionData => {
            const { playerId, suggestion, notes } = suggestionData;
            const itemWrapper = document.createElement('div');
            itemWrapper.className = 'snapshot-suggestion-item';
            const suggestionContent = document.createElement('div');
            suggestionContent.className = 'snapshot-suggestion-content';
            const phaseStr = suggestion?.localResult?.strategyPhase?.toLowerCase() || suggestion?.phase?.toLowerCase() || 'unknown';
            const phase = phaseStr.replace('_', ''); // 修复 API 返回的 "PRE_FLOP" 格式
            const suggestionElement = buildSuggestionElement(suggestion, playerId, phase);
            suggestionContent.appendChild(suggestionElement);
            const notesContainer = document.createElement('div');
            notesContainer.className = 'snapshot-suggestion-notes';
            const notesTextarea = document.createElement('textarea');
            notesTextarea.placeholder = `关于 ${playerId} 建议的备注...`;
            notesTextarea.value = notes || '';
            notesTextarea.dataset.playerId = playerId;
            notesContainer.appendChild(notesTextarea);
            itemWrapper.appendChild(suggestionContent);
            itemWrapper.appendChild(notesContainer);
            suggestionsListEl.appendChild(itemWrapper);
        });
    } else {
        suggestionsListEl.innerHTML = '<p style="text-align: center; padding: 20px;">此快照没有保存GTO建议。</p>';
    }
    modal.classList.add('is-visible');
}

/**
 * 保存快照中修改的备注
 */
function saveSnapshotRemarks() {
    const modal = document.getElementById('view-snapshot-modal');
    const snapshotId = modal.dataset.snapshotId;
    if (!snapshotId) {
        log('❌ 保存备注失败：无法识别快照ID。');
        return;
    }
    let savedSnapshots = JSON.parse(localStorage.getItem('pokerSnapshots') || '[]');
    const snapshotIndex = savedSnapshots.findIndex(s => s.id === snapshotId);
    if (snapshotIndex === -1) {
        log(`❌ 保存备注失败：找不到快照 ${snapshotId}。`);
        return;
    }
    const snapshotToUpdate = savedSnapshots[snapshotIndex];
    const textareas = modal.querySelectorAll('#view-snapshot-suggestions-list textarea');
    let remarksChanged = false;
    textareas.forEach(textarea => {
        const playerId = textarea.dataset.playerId;
        const suggestionToUpdate = snapshotToUpdate.allGtoSuggestions.find(s => s.playerId === playerId);
        if (suggestionToUpdate && suggestionToUpdate.notes !== textarea.value) {
            suggestionToUpdate.notes = textarea.value;
            remarksChanged = true;
        }
    });
    if (remarksChanged) {
        savedSnapshots[snapshotIndex] = snapshotToUpdate;
        localStorage.setItem('pokerSnapshots', JSON.stringify(savedSnapshots));
        log(`✅ 快照 "${snapshotId}" 的备注已保存。`);
        renderSnapshotList();
    } else {
        log('ℹ️ 备注没有变化。');
    }
}

/**
 * 显示删除快照的自定义确认框
 */
function showDeleteConfirmation(snapshotId, buttonElement) {
    const popover = document.getElementById('delete-confirm-popover');
    if (!popover) return;
    popover.dataset.snapshotId = snapshotId;
    const btnRect = buttonElement.getBoundingClientRect();
    popover.style.display = 'block';
    let top = btnRect.top - popover.offsetHeight - 10;
    let left = btnRect.left + (btnRect.width / 2) - (popover.offsetWidth / 2);
    if (top < 0) top = btnRect.bottom + 10;
    if (left < 0) left = 5;
    if (left + popover.offsetWidth > window.innerWidth) left = window.innerWidth - popover.offsetWidth - 5;
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
}

/**
 * 删除指定快照
 */
function deleteSnapshot(snapshotId) {
    let savedSnapshots = JSON.parse(localStorage.getItem('pokerSnapshots') || '[]');
    const initialLength = savedSnapshots.length;
    savedSnapshots = savedSnapshots.filter(s => s.id !== snapshotId);
    if (savedSnapshots.length < initialLength) {
        localStorage.setItem('pokerSnapshots', JSON.stringify(savedSnapshots));
        log(`🗑️ 快照 "${snapshotId}" 已删除。`);
        renderSnapshotList();
    } else {
        log(`❌ 无法找到快照: ${snapshotId} 进行删除。`);
    }
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
    suggestionWrapper.classList.add('gto-suggestion-for-player');
    suggestionWrapper.dataset.playerId = playerId;
    suggestionWrapper.style.marginBottom = '15px';
    suggestionWrapper.style.borderBottom = '1px solid #444';
    suggestionWrapper.style.paddingBottom = '10px';
    suggestionWrapper.style.marginLeft = '10px';
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
  document.getElementById('preset-section').style.opacity = '1';
  document.getElementById('preset-section').style.pointerEvents = 'auto';
  const runtimeConfigSection = document.getElementById('runtime-config-section');
  if (runtimeConfigSection) {
      Array.from(runtimeConfigSection.querySelectorAll('.form-row')).forEach(row => {
          row.style.opacity = '';
          row.style.pointerEvents = '';
      });
  }
}

// ========== 新手动模式功能 V2 ========== 

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
        popup.style.margin = '0';
        const tableRect = table.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        let marginLeft = 0;
        let marginTop = 0;
        const overflowLeft = tableRect.left - popupRect.left;
        if (overflowLeft > 0) {
            marginLeft += overflowLeft;
        }
        const overflowRight = popupRect.right - tableRect.right;
        if (overflowRight > 0) {
            marginLeft -= overflowRight;
        }
        const overflowTop = tableRect.top - popupRect.top;
        if (overflowTop > 0) {
            marginTop += overflowTop;
        }
        const overflowBottom = popupRect.bottom - tableRect.bottom;
        if (overflowBottom > 0) {
            marginTop -= overflowBottom;
        }
        if (marginLeft !== 0 || marginTop !== 0) {
            popup.style.margin = `${marginTop}px 0 0 ${marginLeft}px`;
        }
    });
}

function showPlayerActionPopup(playerId) {
    hideAllActionPopups();
    const playerElement = document.querySelector(`.player[data-player="${playerId}"]`);
    if (!playerElement) return;
    const popup = playerElement.querySelector('.player-action-popup');
    const actionPanel = popup.querySelector('.action-panel');
    const sliderOverlay = popup.querySelector('.amount-slider-overlay');
    popup.style.transform = 'translate(-50%, -50%)';
    const betRaiseBtn = popup.querySelector('.bet-raise');
    const checkCallBtn = popup.querySelector('.check-call');
    const foldBtn = popup.querySelector('.fold');
    const quickBetContainer = popup.querySelector('.quick-bet-sizes');
    const mainButtonsContainer = popup.querySelector('.main-action-buttons');
    const quickBetBtns = popup.querySelectorAll('.quick-bet-sizes button');
    const gameState = game.getGameState();
    const player = gameState.players.find(p => p.id === playerId);
    const toCall = gameState.highestBet - player.bet;
    quickBetContainer.style.display = 'block';
    mainButtonsContainer.style.justifyContent = 'center';
    betRaiseBtn.style.display = 'block';
    checkCallBtn.style.display = 'block';
    foldBtn.style.display = 'block';
    if (toCall > 0 && player.stack < toCall) {
        quickBetContainer.style.display = 'none';
        betRaiseBtn.style.display = 'none';
        checkCallBtn.textContent = 'ALL-IN';
        checkCallBtn.dataset.action = 'ALLIN';
        mainButtonsContainer.style.justifyContent = 'space-around';
    } else if (toCall === 0) {
        checkCallBtn.textContent = '让牌';
        checkCallBtn.dataset.action = 'CHECK';
        if (gameState.highestBet > 0) {
            betRaiseBtn.textContent = '加注';
            betRaiseBtn.dataset.action = 'RAISE';
        } else {
            betRaiseBtn.textContent = '下注';
            betRaiseBtn.dataset.action = 'BET';
        }
    } else {
        checkCallBtn.textContent = '跟注';
        checkCallBtn.dataset.action = 'CALL';
        const minRaiseToAmount = gameState.highestBet + gameState.lastRaiseAmount;
        const playerTotalChips = player.stack + player.bet;
        if (playerTotalChips <= minRaiseToAmount) {
            betRaiseBtn.textContent = 'ALL-IN';
            betRaiseBtn.dataset.action = 'ALLIN';
            quickBetContainer.style.display = 'none';
        } else {
            betRaiseBtn.textContent = '加注';
            betRaiseBtn.dataset.action = 'RAISE';
        }
    }
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
                const potAfterCall = pot + toCall;
                idealAmount = toCall + Math.round(potAfterCall * multiplier);
            }
            const minBet = Settings.bb;
            const minRaiseTo = gameState.highestBet + gameState.lastRaiseAmount;
            const validatedIdealAmount = (actionForQuickBet === 'BET') ? Math.max(idealAmount, minBet) : Math.max(idealAmount, minRaiseTo);
            btn.querySelector('small').textContent = validatedIdealAmount > 0 ? validatedIdealAmount : '-';
            if (validatedIdealAmount > playerTotalChips) {
                btn.disabled = true;
                btn.dataset.amount = playerTotalChips;
            } else {
                btn.disabled = false;
                btn.dataset.amount = validatedIdealAmount;
            }
        });
    }
    actionPanel.style.display = 'flex';
    sliderOverlay.style.display = 'none';
    popup.style.display = 'flex';
    adjustPopupPosition(popup);
    isWaitingForManualInput = true;
}

function showVerticalSlider(playerId, action) {
    const playerElement = document.querySelector(`.player[data-player="${playerId}"]`);
    const popup = playerElement.querySelector('.player-action-popup');
    const actionPanel = popup.querySelector('.action-panel');
    const sliderOverlay = popup.querySelector('.amount-slider-overlay');
    const slider = sliderOverlay.querySelector('.bet-slider-input');
    actionPanel.style.display = 'none';
    sliderOverlay.style.display = 'flex';
    slider.dataset.action = action;
    const gameState = game.getGameState();
    const player = gameState.players.find(p => p.id === playerId);
    let minAmount, maxAmount;
    if (action === 'BET') {
        minAmount = Math.min(Settings.bb, player.stack);
        maxAmount = player.stack;
    } else { // RAISE
        minAmount = gameState.highestBet + gameState.lastRaiseAmount;
        maxAmount = player.stack + player.bet;
    }
    slider.dataset.minAmount = minAmount;
    slider.dataset.maxAmount = maxAmount;
    slider.value = 0;
    updateSliderAmount(playerId, slider);
    adjustPopupPosition(popup);
}

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
    } else if (range <= 0) {
        finalAmount = max;
    } else {
        const rawAmount = min + (range * (percentage / 100));
        finalAmount = Math.round(rawAmount / 10) * 10;
    }
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
        let actionAmount = (action === 'CALL' || action === 'CHECK' || action === 'FOLD') ? undefined : amount;
        if (player && actionAmount !== undefined) {
            if ((player.stack + player.bet) === actionAmount) {
                displayAction = 'ALLIN';
            }
        } else if (player && action === 'ALLIN' && actionAmount === undefined) {
            actionAmount = player.stack + player.bet;
        }
        game.executeAction(currentPlayerId, action, amount);
        log(`[${game.currentRound}] ${currentPlayerId} ${displayAction}${actionAmount ? ' ' + actionAmount : ''}`);
        showActionBubble(currentPlayerId, displayAction, actionAmount);
        updateActionSheet(currentPlayerId, displayAction, actionAmount);
        hideAllActionPopups();
        if (game.isBettingRoundComplete()) {
            advanceToNextStage();
        } else {
            game.moveToNextPlayer();
            updateUI();
            processNextAction();
        }
    } catch (e) {
        log(`❌ 无效操作: ${e.message}`);
        showPlayerActionPopup(playerId);
    }
}

function renderActionSheetTemplate() {
  const tableBody = document.getElementById('action-sheet-body');
  tableBody.innerHTML = '';
  const playerCount = Settings.playerCount;
  for (let i = 0; i < playerCount; i++) {
    const playerId = `P${i + 1}`;
    const row = document.createElement('tr');
    let rowHtml = `<td style="border: 1px solid #ddd; padding: 6px; text-align: center; font-weight: bold;">${playerId}</td>`;
    const stages = ['preflop', 'flop', 'turn', 'river'];
    stages.forEach(stage => {
      for (let j = 0; j < 4; j++) {
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
    const cardEls = el.querySelectorAll('.hole-card');
    if (cardEls.length >= 2) {
        const shouldAnimate = isInitialDeal && !Settings.usePresetHands;
        if (shouldAnimate) {
            [cardEls[0], cardEls[1]].forEach((cardEl, index) => {
                const cardText = player.holeCards[index];
                if (cardText) {
                    setCardImage(cardEl, cardText);
                    cardEl.classList.add('card-dealt-anim');
                    setTimeout(() => cardEl.classList.remove('card-dealt-anim'), 500);
                } else {
                    setCardImage(cardEl, null);
                }
            });
        } else if (!isInitialDeal) {
            setCardImage(cardEls[0], player.holeCards[0]);
            setCardImage(cardEls[1], player.holeCards[1]);
        } else {
            setCardImage(cardEls[0], player.holeCards[0]);
            setCardImage(cardEls[1], player.holeCards[1]);
        }
    }
    const stackEl = el.querySelector('.stack');
    if (stackEl) stackEl.textContent = player.stack;
    const betEl = el.querySelector('.player-bet');
    if (betEl) {
      betEl.textContent = player.bet > 0 ? `Bet: ${player.bet}` : '';
      betEl.style.display = player.bet > 0 ? 'block' : 'none';
    }
    const roleEl = el.querySelector('.player-role');
    if (roleEl) roleEl.textContent = player.role || '';
  });
  const communityCardEls = document.querySelectorAll('.community-card');
  communityCardEls.forEach((el, i) => {
    const cardText = gameState.communityCards[i];
    const shouldAnimate = !el.style.backgroundImage && cardText;
    setCardImage(el, cardText);
    if (shouldAnimate) {
        el.classList.add('card-dealt-anim');
        setTimeout(() => el.classList.remove('card-dealt-anim'), 500);
    }
  });
  document.getElementById('pot-amount').textContent = gameState.pot;
}

function showActionBubble(playerId, action, amount) {
    const playerEl = document.querySelector(`.player[data-player="${playerId}"]`);
    if (!playerEl) return;
    const bubble = playerEl.querySelector('.action-bubble');
    if (!bubble) return;
    let text = action;
    if (amount) {
        text += ` ${amount}`;
    }
    bubble.textContent = text;
    bubble.classList.remove('show', 'fade-out');
    void bubble.offsetWidth;
    bubble.classList.add('show');
    setTimeout(() => {
        bubble.classList.add('fade-out');
    }, 1500);
}

function log(message) {
  const time = new Date().toLocaleTimeString();
  consoleLog.value += `[${time}] ${message}\n`;
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes card-dealt-anim {
            0% { transform: translateY(-200px) rotateX(-90deg); opacity: 0; }
            100% { transform: translateY(0) rotateX(0deg); opacity: 1; }
        }
        .card-dealt-anim {
            animation: card-dealt-anim 0.5s ease-out;
        }
        @keyframes card-unassigned-anim {
            from { transform: scale(1); opacity: 1; }
            to { transform: scale(0.5); opacity: 0; }
        }
        .card-unassigned {
            animation: card-unassigned-anim 0.3s ease-in;
        }
        .hidden-by-js {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
}


// ========== Main Execution ==========
init();
