// main.js
import * as snapshotService from './snapshot_api_service.js';
import { Settings } from './setting.js';
import { PokerGame } from './poker.js';
import { getDecision } from './ai.js';
import { getSuggestion } from './api_service.js';

// ========== 全局状态 ==========
let game = new PokerGame();
let isGameRunning = false;
let isWaitingForManualInput = false;
let isGamePaused = false;
let isProcessingGameControl = false; // 游戏控制按钮防抖标记

let gtoSuggestionFilter = new Set();
let currentSuggestionsCache = {}; // 用于缓存当前牌局的GTO建议
let handActionHistory = []; // 新增：用于存储单局所有动作的有序列表

// ========== 回放功能状态 ==========
let isInReplayMode = false;
let replayData = { settings: null, actions: [], gameState: null };
let currentReplayStep = 0;
let replayInterval = null;

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
let postSnapshotAction = null;
let isProcessingCardSelection = false; // 防抖标记

// ========== 快照分页状态 ==========
let snapshotCurrentPage = 0;
let snapshotTotalPages = 0;

// --- DOM 元素变量 (在 init 函数中初始化) ---
let modeSelect, playerCountInput, minStackInput, maxStackInput, potTypeSelect, p1RoleSelect;
let sbInput, bbInput, autoDelayInput;
let suggestPreflopCheckbox, suggestFlopCheckbox, suggestTurnCheckbox, suggestRiverCheckbox;
let startBtn, pauseBtn, consoleLog;
let usePresetHandsCheckbox, usePresetCommunityCheckbox, presetControls, presetPlayerHandsContainer, presetCommunityCardsContainer, cardPicker, gtoFilterPlayersContainer;

// ========== 工具函数 ==========
/**
 * 统一的安全事件绑定函数
 * @param {string} id 元素ID
 * @param {Function} handler 事件处理函数
 * @param {string} errorMsg 错误信息（可选）
 */
function safeBindEvent(id, handler, errorMsg) {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener('click', handler);
    } else {
        console.warn(errorMsg || `未找到元素: ${id}`);
    }
}

/**
 * 统一的防抖重置函数
 * @param {number} delay 延迟时间，默认300ms
 */
function resetGameControlDebounce(delay = 300) {
    setTimeout(() => {
        isProcessingGameControl = false;
        console.log('[DEBUG] Game control debounce reset after delay');
    }, delay);
}

/**
 * 立即重置所有防抖状态（用于重置场景）
 */
function resetAllDebounceStates() {
    isProcessingGameControl = false;
    isProcessingCardSelection = false;
}

// ========== 初始化 ==========
function init() {
  try {
    // 重置所有防抖状态，确保页面刷新后状态正确
    resetAllDebounceStates();

    // 验证关键DOM元素是否存在
    const criticalElements = [
      'mode-select', 'player-count-input', 'min-stack-input', 'max-stack-input',
      'pot-type-select', 'p1-role-select', 'sb-input', 'bb-input', 'auto-delay',
      'suggest-preflop', 'suggest-flop', 'suggest-turn', 'suggest-river',
      'start-btn', 'pause-btn', 'console-log', 'use-preset-hands-checkbox',
      'use-preset-community-checkbox', 'preset-controls', 'preset-player-hands-container',
      'preset-community-cards-container', 'card-picker', 'gto-filter-players'
    ];

    const missingElements = criticalElements.filter(id => !document.getElementById(id));
    if (missingElements.length > 0) {
      throw new Error(`缺少关键DOM元素: ${missingElements.join(', ')}`);
    }

    // --- DOM 元素获取（添加安全检查）---
    const safeGetElement = (id, name) => {
      const element = document.getElementById(id);
      if (!element) {
        throw new Error(`无法找到必需的DOM元素: ${name} (id: ${id})`);
      }
      return element;
    };

    modeSelect = safeGetElement('mode-select', '模式选择器');
    playerCountInput = safeGetElement('player-count-input', '玩家数量输入');
    minStackInput = safeGetElement('min-stack-input', '最小筹码输入');
    maxStackInput = safeGetElement('max-stack-input', '最大筹码输入');
    potTypeSelect = safeGetElement('pot-type-select', '底池类型选择');
    p1RoleSelect = safeGetElement('p1-role-select', 'P1角色选择');
    sbInput = safeGetElement('sb-input', '小盲注输入');
    bbInput = safeGetElement('bb-input', '大盲注输入');
    autoDelayInput = safeGetElement('auto-delay', '自动延迟输入');
    suggestPreflopCheckbox = safeGetElement('suggest-preflop', '翻前建议复选框');
    suggestFlopCheckbox = safeGetElement('suggest-flop', '翻牌建议复选框');
    suggestTurnCheckbox = safeGetElement('suggest-turn', '转牌建议复选框');
    suggestRiverCheckbox = safeGetElement('suggest-river', '河牌建议复选框');
    startBtn = safeGetElement('start-btn', '开始按钮');
    pauseBtn = safeGetElement('pause-btn', '暂停按钮');
    consoleLog = safeGetElement('console-log', '控制台日志');
    usePresetHandsCheckbox = safeGetElement('use-preset-hands-checkbox', '预设手牌复选框');
    usePresetCommunityCheckbox = safeGetElement('use-preset-community-checkbox', '预设公共牌复选框');
    presetControls = safeGetElement('preset-controls', '预设控制器');
    presetPlayerHandsContainer = safeGetElement('preset-player-hands-container', '预设玩家手牌容器');
    presetCommunityCardsContainer = safeGetElement('preset-community-cards-container', '预设公共牌容器');
    cardPicker = safeGetElement('card-picker', '卡牌选择器');
    gtoFilterPlayersContainer = safeGetElement('gto-filter-players', 'GTO筛选玩家容器');

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

    const playerElements = document.querySelectorAll('.player');
    if (playerElements.length === 0) {
      console.warn('未找到任何玩家元素，跳过玩家事件绑定');
    }

    playerElements.forEach(playerElement => {
      const playerId = playerElement.dataset.player;
      const popup = playerElement.querySelector('.player-action-popup');
      if (!popup) {
        console.warn(`玩家 ${playerId} 缺少操作弹窗，跳过事件绑定`);
        return;
      }
      const sliderOverlay = popup.querySelector('.amount-slider-overlay');
      const sliderInput = sliderOverlay ? sliderOverlay.querySelector('.bet-slider-input') : null;
      const foldBtn = popup.querySelector('.main-action-btn.fold');
      const betRaiseBtn = popup.querySelector('.main-action-btn.bet-raise');
      const checkCallBtn = popup.querySelector('.main-action-btn.check-call');
      // 安全地绑定事件
      if (foldBtn) {
        foldBtn.addEventListener('click', () => submitManualAction(playerId, 'FOLD'));
      } else {
        console.warn(`玩家 ${playerId} 缺少弃牌按钮`);
      }

      if (checkCallBtn) {
        checkCallBtn.addEventListener('click', () => {
            const action = checkCallBtn.dataset.action;
            submitManualAction(playerId, action);
        });
      } else {
        console.warn(`玩家 ${playerId} 缺少让牌/跟注按钮`);
      }

      if (betRaiseBtn) {
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
      } else {
        console.warn(`玩家 ${playerId} 缺少下注/加注按钮`);
      }

      if (popup) {
        popup.querySelectorAll('.quick-bet-sizes button').forEach(btn => {
            btn.addEventListener('click', () => {
                const amount = parseInt(btn.dataset.amount);
                if (amount > 0) {
                    const action = betRaiseBtn ? betRaiseBtn.dataset.action : null;
                    if (action) {
                        submitManualAction(playerId, action, amount);
                    }
                }
            });
        });

        popup.addEventListener('click', (e) => {
            if (e.target === popup) {
                hideAllActionPopups();
            }
        });
      }

      if (sliderOverlay && sliderInput) {
        const confirmBtn = sliderOverlay.querySelector('.confirm-bet');
        if (confirmBtn) {
          confirmBtn.addEventListener('click', () => {
              const amount = parseInt(sliderInput.dataset.finalAmount);
              const action = sliderInput.dataset.action;
              submitManualAction(playerId, action, amount);
          });
        }

        sliderInput.addEventListener('input', () => updateSliderAmount(playerId, sliderInput));

        sliderOverlay.addEventListener('click', (e) => {
            if (e.target === sliderOverlay) {
                e.stopPropagation();
                const actionPanel = popup.querySelector('.action-panel');
                if (actionPanel) {
                  sliderOverlay.style.display = 'none';
                  actionPanel.style.display = 'flex';
                }
            }
        });
      } else {
        console.warn(`玩家 ${playerId} 缺少滑块控件`);
      }
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

    if (configDrawer && configToggleBtn) {
      function openDrawer() {
        if (configDrawer) configDrawer.classList.add('is-open');
      }
      function closeDrawer() {
        if (configDrawer) configDrawer.classList.remove('is-open');
      }
      configToggleBtn.addEventListener('click', openDrawer);
      if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeDrawer);
      if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);
    } else {
      console.warn('配置抽屉相关元素未找到，抽屉功能将不可用');
    }

    const table = document.querySelector('.poker-table');
    if (table) {
      const resizeObserver = new ResizeObserver(() => {
        updatePlayerLayout();
      });
      resizeObserver.observe(table);
    } else {
      console.warn('未找到扑克桌元素，布局自适应功能将不可用');
    }

    initSnapshotModalListeners();
    renderSnapshotList();
    updatePresetVisibility();

    const snapshotList = document.getElementById('snapshot-list');
    if (snapshotList) {
      snapshotList.addEventListener('click', (e) => {
          if (e.target && e.target.classList.contains('snapshot-name-display')) {
              if (document.querySelector('.snapshot-name-edit')) {
                  document.querySelector('.snapshot-name-edit').blur();
              }
              makeSnapshotNameEditable(e.target);
          }
      });
    } else {
      console.warn('未找到快照列表元素');
    }

    setupReplayControls(); // 绑定回放按钮事件

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

    const saveChanges = async () => {
        const newName = input.value.trim();
        const finalName = newName || currentName;

        // 更新UI
        const newNameElement = document.createElement('strong');
        newNameElement.className = 'snapshot-name-display';
        newNameElement.dataset.snapshotId = snapshotId;
        newNameElement.textContent = finalName;
        if (input.parentNode) {
            input.parentNode.replaceChild(newNameElement, input);
        }

        // 如果名称有变化，则调用API更新并刷新列表
        if (newName && newName !== currentName) {
            try {
                log(`💾 正在更新快照名称 (ID: ${snapshotId})...`);
                await snapshotService.updateSnapshot(snapshotId, { name: finalName });
                log(`✅ 快照名称已更新为 "${finalName}"`);
            } catch (error) {
                log(`❌ 更新名称失败: ${error.message}`);
            }
            // 刷新列表以确保与数据库完全同步
            renderSnapshotList();
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
    // 如果所有槽位都满了，重置处理状态
    isProcessingCardSelection = false;
}

function updatePresetVisibility() {
    if (isInReplayMode) return; // 在回放模式下禁用
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
    // 重置防抖状态
    isProcessingCardSelection = false;
    isProcessingGameControl = false; // 重置游戏控制防抖状态
}

function handleSlotClick(event) {
  if (isInReplayMode) return; // 在回放模式下禁用
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
  if (isInReplayMode) return; // 在回放模式下禁用

  // 防抖：如果正在处理其他选择，直接返回
  if (isProcessingCardSelection) {
    log('正在处理上一张牌的选择，请稍候...');
    return;
  }

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

  // 立即设置处理状态
  isProcessingCardSelection = true;

  // 立即标记牌为已使用，防止重复选择
  pickerCard.classList.add('dimmed');
  usedCards.add(cardText);

  // 立即更新槽位数据，防止重复分配
  const currentSlot = activeSelectionSlot;
  const { type, playerId, cardIndex } = currentSlot.dataset;

  let animationsInitiated = 0;
  animateCardToSlot(pickerCard, currentSlot, cardText);
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
          assignCard(currentSlot, cardText);
          activateNextEmptySlot();
          // 动画完成后重置处理状态
          isProcessingCardSelection = false;
      }, 420);
  } else {
      // 如果没有动画，立即重置状态
      isProcessingCardSelection = false;
  }
}

function assignCard(slot, cardText) {
  slot.style.backgroundImage = `url(${getCardImagePath(cardText)})`;
  slot.dataset.card = cardText;
  // 注意：pickerCard的dimmed和usedCards的添加已经在handleCardPickerClick中完成
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
    // 添加调试日志
    console.log(`[DEBUG] handleStartStopClick called - isProcessingGameControl: ${isProcessingGameControl}, btnText: ${startBtn.textContent}`);

    // 统一的防抖检查：在函数开始就检查
    if (isProcessingGameControl) {
        log('正在处理游戏控制操作，请稍候...');
        console.log('[DEBUG] Start/Stop action blocked by debounce');
        return;
    }

    if (startBtn.textContent.includes('开始牌局')) {
        startNewGame();
    } else {
        stopGame();
    }
}

function handlePauseResumeClick() {
    // 添加调试日志
    console.log(`[DEBUG] handlePauseResumeClick called - isGameRunning: ${isGameRunning}, isProcessingGameControl: ${isProcessingGameControl}, isGamePaused: ${isGamePaused}`);

    if (!isGameRunning) {
        console.log('[DEBUG] Pause/Resume ignored - game not running');
        return;
    }

    // 统一的防抖检查：在函数开始就检查
    if (isProcessingGameControl) {
        log('正在处理游戏控制操作，请稍候...');
        console.log('[DEBUG] Pause/Resume action blocked by debounce');
        return;
    }

    // 立即设置防抖状态
    isProcessingGameControl = true;
    console.log('[DEBUG] Pause/Resume debounce set to true');

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

    // 使用统一的延迟重置（300ms后）
    resetGameControlDebounce(300);
}

function startNewGame() {
  // 立即设置防抖状态
  isProcessingGameControl = true;
  console.log('[DEBUG] Start new game debounce set to true');

  currentSuggestionsCache = []; // 清空GTO建议缓存
  handActionHistory = []; // 重置单局动作历史
  document.getElementById('suggestion-display').innerHTML = '等待玩家行动...';
  if (isGameRunning && !isGamePaused) {
    log('游戏已在运行中');
    isProcessingGameControl = false; // 立即重置防抖状态
    return;
  }
  if (Settings.usePresetHands || Settings.usePresetCommunity) {
    if (!validatePresetCards()) {
      isProcessingGameControl = false; // 立即重置防抖状态
      return;
    }
  }
  game.reset(Settings);
  isGamePaused = false;
  try {
    updatePlayerDisplay();
    renderActionSheet();
    game.dealHoleCards();
    // 为回放记录包含初始筹码和手牌的“创世”状态
    handActionHistory.push({ 
        type: 'initialState', 
        players: JSON.parse(JSON.stringify(game.players)) // 深拷贝
    });
    game.startNewRound('preflop');
    isGameRunning = true;
    const presetSection = document.getElementById('preset-section');
    if (presetSection) {
        presetSection.style.opacity = '0.5';
        presetSection.style.pointerEvents = 'none';
        presetSection.querySelectorAll('input, select').forEach(el => el.disabled = true);
    }
    const runtimeConfigSection = document.getElementById('runtime-config-section');
    if (runtimeConfigSection) {
        runtimeConfigSection.querySelectorAll('.form-row').forEach(row => {
            const isGtoFilterRow = row.querySelector('#gto-filter-players');
            if (!isGtoFilterRow) {
                // Disable all other rows
                row.style.opacity = '0.5';
                row.style.pointerEvents = 'none';
                row.querySelectorAll('input, select').forEach(el => el.disabled = true);
            } else {
                // Ensure the GTO filter row is fully enabled (just in case)
                row.style.opacity = '1';
                row.style.pointerEvents = 'auto';
                row.querySelectorAll('input, select').forEach(el => el.disabled = false);
            }
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

    // 使用统一的延迟重置（300ms后）
    resetGameControlDebounce();
  } catch (e) {
    log('❌ 启动失败: ' + e.message);
    console.error(e);
    isGameRunning = false;
    // 使用统一的延迟重置（300ms后）
    resetGameControlDebounce();
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
  // ✅ 统一的防抖检查：在函数开始就检查
  if (isProcessingGameControl) {
    log('正在处理游戏控制操作，请稍候...');
    return;
  }

  // 立即设置防抖状态
  isProcessingGameControl = true;
  console.log('[DEBUG] Stop game debounce set to true');

  log('🛑 牌局已手动停止，重置到初始状态。');
  isGameRunning = false;
  isGamePaused = false;
  isWaitingForManualInput = false;

  // 使用统一的延迟重置（300ms后）
  resetGameControlDebounce(300);
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
  const presetSection = document.getElementById('preset-section');
  if (presetSection) {
      presetSection.style.opacity = '1';
      presetSection.style.pointerEvents = 'auto';
      presetSection.querySelectorAll('input, select').forEach(el => el.disabled = false);
  }
        const runtimeConfigSection = document.getElementById('runtime-config-section');
        if (runtimeConfigSection) {
            runtimeConfigSection.querySelectorAll('.form-row').forEach(row => {
                row.style.opacity = '';
                row.style.pointerEvents = '';
                row.querySelectorAll('input, select').forEach(el => el.disabled = false);
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
        const result = await getSuggestion(gameState, currentPlayerId, actionRecords);
        console.log("[DEBUG] Raw result from getSuggestion:", result);

        // 增加代码健壮性，处理 getSuggestion 可能返回不一致结果的情况
        const isWrapper = result && result.response !== undefined && result.request !== undefined;
        const suggestion = isWrapper ? result.response : result;
        const request = isWrapper ? result.request : null;

        if (!isWrapper) {
            console.warn(`[WARN] For player ${currentPlayerId}, getSuggestion did not return a wrapper object. Snapshots for this action will be incomplete.`);
        }

        currentSuggestionsCache.push({ 
            playerId: currentPlayerId, 
            suggestion: suggestion, 
            request: request 
        });
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
    handActionHistory.push({ type: 'dealCommunity', round: 'flop', cards: game.communityCards.slice(0, 3) });
  } else {
    game.dealTurnOrRiver();
    handActionHistory.push({ type: 'dealCommunity', round: game.currentRound === 'flop' ? 'turn' : 'river', cards: [...game.communityCards] });
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
 * 启动截图选择流程的通用函数
 */
function initiateSnapshotProcess() {
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
 * “保存快照”按钮的点击事件处理程序。
 */
function handleSnapshotButtonClick() {
    if (!isGameRunning) {
        log('⚠️ 游戏未开始，无法保存快照。');
        return;
    }
    initiateSnapshotProcess();
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
        if (postSnapshotAction) {
            postSnapshotAction();
            postSnapshotAction = null;
        }
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
                request: item.request, // 包含请求DTO
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
    const nameInput = document.getElementById('snapshot-name-input'); // 获取输入框

    if (window.pendingSnapshotData && window.pendingSnapshotData.imageData) {
        preview.src = window.pendingSnapshotData.imageData;
    } else {
        preview.src = '';
    }
    if(modal) {
        modal.classList.add('is-visible');
        // 确保模态框可见后再聚焦，使用一个短暂的延时
        setTimeout(() => {
            if (nameInput) {
                nameInput.focus();
            }
        }, 100);
    }
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
    // 使用统一的安全绑定函数
    safeBindEvent('save-snapshot-btn', handleSnapshotButtonClick, '未找到保存快照按钮');
    safeBindEvent('save-snapshot-confirm-btn', savePendingSnapshot, '未找到保存快照确认按钮');
    safeBindEvent('close-view-snapshot-modal-btn', () => {
        const modal = document.getElementById('view-snapshot-modal');
        if(modal) modal.classList.remove('is-visible');
    }, '未找到关闭查看快照模态框按钮');
    safeBindEvent('save-snapshot-remarks-btn', saveSnapshotRemarks, '未找到保存快照批注按钮');

    // 特殊绑定的按钮（带复杂逻辑）
    safeBindEvent('cancel-snapshot-btn', () => {
        hideSnapshotModal();
        if (postSnapshotAction) {
            postSnapshotAction();
            postSnapshotAction = null;
        }
    }, '未找到取消快照按钮');

    safeBindEvent('recapture-snapshot-btn', () => {
        hideSnapshotModal();
        setTimeout(initiateSnapshotProcess, 100); // 延迟以确保弹窗消失
    }, '未找到重新截取按钮');

    // 为牌局结束弹窗绑定事件
    safeBindEvent('eoh-confirm-save', () => {
        hideEndOfHandModal();
        postSnapshotAction = stopGame; // 设置快照结束后的回调
        initiateSnapshotProcess(); // 启动快照流程
    }, '未找到牌局结束确认保存按钮');

    safeBindEvent('eoh-cancel-save', () => {
        hideEndOfHandModal();
        stopGame(); // 直接重置游戏
    }, '未找到牌局结束取消保存按钮');

    // 为删除确认按钮绑定事件
    safeBindEvent('delete-confirm-yes', () => {
        const popover = document.getElementById('delete-confirm-popover');
        if (popover) {
            const snapshotId = popover.dataset.snapshotId;
            if (snapshotId) {
                deleteSnapshot(snapshotId);
            }
            popover.style.display = 'none';
        }
    }, '未找到删除确认是按钮');

    safeBindEvent('delete-confirm-no', () => {
        const popover = document.getElementById('delete-confirm-popover');
        if (popover) {
            popover.style.display = 'none';
        }
    }, '未找到删除确认否按钮');

    // 全局点击事件（关闭删除确认框）
    document.addEventListener('click', (e) => {
        const popover = document.getElementById('delete-confirm-popover');
        if (popover && popover.style.display === 'block' && !popover.contains(e.target) && !e.target.classList.contains('delete-btn')) {
            popover.style.display = 'none';
        }
    });

    // 新增：图片灯箱功能 - 添加安全检查
    const snapshotImage = document.getElementById('view-snapshot-image');
    const lightboxOverlay = document.getElementById('image-lightbox-overlay');
    const lightboxImage = document.getElementById('lightbox-image');

    if (snapshotImage && lightboxOverlay && lightboxImage) {
        snapshotImage.addEventListener('click', () => {
            // 确保图片src有效再打开灯箱
            if (snapshotImage.src && snapshotImage.src !== window.location.href) {
                lightboxImage.src = snapshotImage.src;
                lightboxOverlay.style.display = 'flex';
            }
        });

        lightboxOverlay.addEventListener('click', () => {
            lightboxOverlay.style.display = 'none';
            lightboxImage.src = ''; // 清空src，避免闪现旧图
        });
    } else {
        console.warn('图片灯箱相关元素缺失，灯箱功能将不可用');
        if (!snapshotImage) console.warn('- 缺少: view-snapshot-image');
        if (!lightboxOverlay) console.warn('- 缺少: image-lightbox-overlay');
        if (!lightboxImage) console.warn('- 缺少: lightbox-image');
    }
}

/**
 * 保存当前暂存的快照到 localStorage
 */
async function savePendingSnapshot() {
    const pendingData = window.pendingSnapshotData;
    if (!pendingData) {
        log('❌ 无法保存快照：没有待处理的快照数据。');
        hideSnapshotModal();
        return;
    }

    const nameInput = document.getElementById('snapshot-name-input');
    let snapshotName = nameInput.value.trim();

    if (!snapshotName) {
        snapshotName = `快照 ${new Date().toLocaleString()}`;
    }

    // 为后端准备数据，将对象字符串化
    const snapshotData = {
        name: snapshotName,
        gameState: JSON.stringify(pendingData.gameState),
        imageData: pendingData.imageData,
        gtoSuggestions: JSON.stringify(pendingData.allGtoSuggestions),
        actionHistory: JSON.stringify(handActionHistory), // 使用新的、有序的动作历史记录
        settings: JSON.stringify(Settings) // 添加牌局设置
    };

    try {
        log(`💾 正在保存快照到数据库...`);
        const savedSnapshot = await snapshotService.createSnapshot(snapshotData);
        log(`✅ 快照 "${savedSnapshot.name}" (ID: ${savedSnapshot.id}) 已成功保存。`);
        
        nameInput.value = '';
        hideSnapshotModal();

        // 修复：执行在牌局结束后设置的回调函数（例如 stopGame）
        if (postSnapshotAction) {
            postSnapshotAction();
            postSnapshotAction = null;
        }

        await renderSnapshotList(); // 从后端刷新列表

        // 自动打开新创建的快照详情
        log(`自动打开快照详情...`);
        showViewSnapshotModal(savedSnapshot.id);

    } catch (error) {
        log(`❌ 保存快照失败: ${error.message}`);
        // 可以在此添加UI提示，告知用户保存失败
    }
}

/**
 * 渲染快照列表到UI
 */
async function renderSnapshotList(page = 0) {
    const snapshotListUl = document.getElementById('snapshot-list');
    if (!snapshotListUl) return;
    snapshotListUl.innerHTML = '<li style="text-align: center; color: #888; padding: 20px 0;">加载中...</li>';

    try {
        const pageData = await snapshotService.getSnapshots(page, 5);
        const savedSnapshots = pageData.content;

        snapshotCurrentPage = pageData.number;
        snapshotTotalPages = pageData.totalPages;

        snapshotListUl.innerHTML = '';

        if (!savedSnapshots || savedSnapshots.length === 0) {
            snapshotListUl.innerHTML = '<li style="text-align: center; color: #888; padding: 20px 0;">暂无快照</li>';
            renderSnapshotPagination(null); // 清空分页
            return;
        }

        savedSnapshots.forEach(snapshot => {
            const li = document.createElement('li');
            li.dataset.snapshotId = snapshot.id;
            li.innerHTML = `
                <div class="snapshot-info">
                    <strong class="snapshot-name-display" data-snapshot-id="${snapshot.id}" title="${snapshot.name}">${snapshot.name}</strong><br>
                    <small>${new Date(snapshot.timestamp).toLocaleString()}</small>
                </div>
                <div class="snapshot-actions">
                    <button class="view-btn">查看快照</button>
                    <button class="replay-btn">回放</button>
                    <button class="delete-btn">删除快照</button>
                </div>
            `;
            snapshotListUl.appendChild(li);
        });

        // 为新渲染的按钮绑定事件
        snapshotListUl.querySelectorAll('.view-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const snapshotId = e.target.closest('li').dataset.snapshotId;
                showViewSnapshotModal(snapshotId);
            });
        });

        snapshotListUl.querySelectorAll('.replay-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const snapshotId = e.target.closest('li').dataset.snapshotId;
                startReplay(snapshotId);
            });
        });

        snapshotListUl.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const snapshotId = e.target.closest('li').dataset.snapshotId;
                showDeleteConfirmation(snapshotId, e.target);
            });
        });

        renderSnapshotPagination(pageData);

    } catch (error) {
        log(`❌ 加载快照列表失败: ${error.message}`);
        snapshotListUl.innerHTML = `<li style="text-align: center; color: #ff6b6b; padding: 20px 0;">列表加载失败</li>`;
        renderSnapshotPagination(null); // 清空分页
    }
}

/**
 * 渲染快照列表的分页控件
 * @param {object | null} pageData 从后端获取的分页对象
 */
function renderSnapshotPagination(pageData) {
    const paginationContainer = document.getElementById('snapshot-pagination-controls');
    if (!paginationContainer) return;

    if (!pageData || pageData.totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }

    const isFirst = pageData.first;
    const isLast = pageData.last;
    const currentPage = pageData.number; // 0-based
    const totalPages = pageData.totalPages;

    paginationContainer.innerHTML = `
        <button id="snapshot-prev-btn" class="game-control-btn secondary-btn" ${isFirst ? 'disabled' : ''}>&lt; 上一页</button>
        <span style="font-size: 14px; color: #555;">第 ${currentPage + 1} / ${totalPages} 页</span>
        <button id="snapshot-next-btn" class="game-control-btn secondary-btn" ${isLast ? 'disabled' : ''}>下一页 &gt;</button>
    `;

    if (!isFirst) {
        document.getElementById('snapshot-prev-btn').addEventListener('click', () => {
            renderSnapshotList(currentPage - 1);
        });
    }

    if (!isLast) {
        document.getElementById('snapshot-next-btn').addEventListener('click', () => {
            renderSnapshotList(currentPage + 1);
        });
    }
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
    log(`正在从数据库加载快照 (ID: ${snapshotId})...`);
    showLoader(); // 显示加载动画
    try {
        const snapshot = await snapshotService.getSnapshotById(snapshotId);

        // 后端返回的JSON字段是字符串，需要解析成对象
        snapshot.allGtoSuggestions = JSON.parse(snapshot.gtoSuggestions || '[]');

        const modal = document.getElementById('view-snapshot-modal');
        const titleEl = document.getElementById('view-snapshot-title');
        const imageEl = document.getElementById('view-snapshot-image');
        const suggestionsListEl = document.getElementById('view-snapshot-suggestions-list');
        const filterContainer = document.getElementById('snapshot-suggestion-filter-container');

        // 更新标题
        if (titleEl) {
            titleEl.textContent = `${snapshot.name}`;
        }

        // 清空旧内容
        suggestionsListEl.innerHTML = '';
        filterContainer.innerHTML = '';
        modal.dataset.snapshotId = snapshotId;
        imageEl.src = snapshot.imageData;

        if (snapshot.allGtoSuggestions && snapshot.allGtoSuggestions.length > 0) {
            const playerIdsInSnapshot = [...new Set(snapshot.allGtoSuggestions.map(s => s.playerId))].sort();
            const snapshotFilterState = new Set(playerIdsInSnapshot);

            const filterTitle = document.createElement('strong');
            filterTitle.textContent = '筛选:';
            filterTitle.style.marginRight = '10px';
            filterContainer.appendChild(filterTitle);

            playerIdsInSnapshot.forEach(playerId => {
                const label = document.createElement('label');
                label.style.cursor = 'pointer';
                label.style.userSelect = 'none';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = playerId;
                checkbox.checked = true;
                checkbox.style.marginRight = '4px';
                
                checkbox.addEventListener('change', (event) => {
                    if (event.target.checked) {
                        snapshotFilterState.add(playerId);
                    } else {
                        snapshotFilterState.delete(playerId);
                    }
                    updateVisibility();
                });

                label.appendChild(checkbox);
                label.appendChild(document.createTextNode(playerId));
                filterContainer.appendChild(label);
            });

            snapshot.allGtoSuggestions.forEach((suggestionData, index) => {
                const { playerId, suggestion, notes } = suggestionData;
                const itemWrapper = document.createElement('div');
                itemWrapper.className = 'snapshot-suggestion-item';
                itemWrapper.dataset.playerId = playerId;

                const suggestionContent = document.createElement('div');
                suggestionContent.className = 'snapshot-suggestion-content';
                const phaseStr = suggestion?.localResult?.strategyPhase?.toLowerCase() || suggestion?.phase?.toLowerCase() || 'unknown';
                const phase = phaseStr.replace('_', '');
                const suggestionElement = buildSuggestionElement(suggestion, playerId, phase);
                suggestionContent.appendChild(suggestionElement);

                const notesContainer = document.createElement('div');
                notesContainer.className = 'snapshot-suggestion-notes';
                const notesTextarea = document.createElement('textarea');
                notesTextarea.placeholder = `关于 ${playerId} 建议的批注...`;
                notesTextarea.value = notes || '';
                notesTextarea.dataset.playerId = playerId;
                notesTextarea.dataset.suggestionIndex = index;
                notesContainer.appendChild(notesTextarea);

                itemWrapper.appendChild(suggestionContent);
                itemWrapper.appendChild(notesContainer);
                suggestionsListEl.appendChild(itemWrapper);
            });

            const updateVisibility = () => {
                suggestionsListEl.querySelectorAll('.snapshot-suggestion-item').forEach(item => {
                    const itemPlayerId = item.dataset.playerId;
                    item.style.display = snapshotFilterState.has(itemPlayerId) ? 'flex' : 'none';
                });
            };

        } else {
            suggestionsListEl.innerHTML = '<p style="text-align: center; padding: 20px;">此快照没有保存GTO建议。</p>';
        }

        modal.classList.add('is-visible');

    } catch (error) {
        log(`❌ 加载快照详情失败: ${error.message}`);
    } finally {
        hideLoader(); // 隐藏加载动画
    }
}


/**
 * 显示一个短暂的提示消息 (Toast) 
 * @param {string} message 要显示的消息
 * @param {number} duration 显示时长 (毫秒)
 * @param {boolean} isError 是否为错误消息 (红色背景)
 */
function showToast(message, duration = 2000, isError = false) {
    // 移除任何已存在的toast
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    if (isError) {
        toast.classList.add('error');
    }
    toast.textContent = message;

    document.body.appendChild(toast);

    // 触发 "show" 动画
    setTimeout(() => {
        toast.classList.add('show');
    }, 10); // 短暂延迟以确保CSS过渡生效

    // 在指定时长后隐藏并移除 toast
    setTimeout(() => {
        toast.classList.remove('show');
        // 在渐隐动画结束后从DOM中移除
        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 300); // 匹配CSS过渡时间
    }, duration);
}

/**
 * 保存快照中修改的批注
 */
async function saveSnapshotRemarks() {
    const modal = document.getElementById('view-snapshot-modal');
    const snapshotId = modal.dataset.snapshotId;
    const saveBtn = document.getElementById('save-snapshot-remarks-btn');

    if (!snapshotId) {
        log('❌ 保存批注失败：无法识别快照ID。');
        showToast('保存失败：无快照ID', 3000, true);
        return;
    }

    // 创建保存动画的函数
    const createSavingAnimation = () => {
        const spinner = document.createElement('span');
        spinner.className = 'saving-spinner';
        spinner.style.cssText = `
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid transparent;
            border-top: 2px solid white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-left: 8px;
            vertical-align: middle;
        `;
        return spinner;
    };

    // 保存原始按钮状态
    const originalText = saveBtn.textContent;
    const originalDisabled = saveBtn.disabled;

    // 设置保存中的按钮状态
    saveBtn.disabled = true;
    saveBtn.innerHTML = `${originalText.split('保存')[0]}保存中...`;
    saveBtn.appendChild(createSavingAnimation());

    // 添加保存中样式类
    saveBtn.classList.add('saving');

    // 获取所有文本区域并添加保存中的视觉效果
    const textareas = modal.querySelectorAll('#view-snapshot-suggestions-list textarea');
    textareas.forEach(textarea => {
        textarea.style.backgroundColor = '#f0f8ff'; // 淡蓝色背景
        textarea.style.border = '1px solid #007bff'; // 蓝色边框
        textarea.style.cursor = 'not-allowed';
        textarea.disabled = true; // 禁用编辑
    });

    try {
        // 1. 获取最新的快照数据
        const snapshot = await snapshotService.getSnapshotById(snapshotId);
        const allGtoSuggestions = JSON.parse(snapshot.gtoSuggestions || '[]');

        // 2. 根据索引更新批注
        let remarksChanged = false;
        textareas.forEach(textarea => {
            const index = parseInt(textarea.dataset.suggestionIndex, 10);
            if (!isNaN(index) && allGtoSuggestions[index]) {
                if ((allGtoSuggestions[index].notes || '') !== textarea.value) {
                    allGtoSuggestions[index].notes = textarea.value;
                    remarksChanged = true;
                }
            }
        });

        // 3. 如果有变动，则调用API更新
        if (remarksChanged) {
            log(`💾 正在更新批注 (ID: ${snapshotId})...`);

            // 显示进度动画
            saveBtn.innerHTML = `保存中<span class="saving-dots"></span>`;
            const dotsContainer = saveBtn.querySelector('.saving-dots');
            dotsContainer.style.cssText = `
                display: inline-block;
                margin-left: 4px;
            `;

            // 创建点点动画
            let dotCount = 0;
            const dotsInterval = setInterval(() => {
                dotCount = (dotCount + 1) % 4;
                dotsContainer.textContent = '.'.repeat(dotCount);
            }, 500);

            const updateData = { gtoSuggestions: JSON.stringify(allGtoSuggestions) };
            await snapshotService.updateSnapshot(snapshotId, updateData);

            // 清除点点动画
            clearInterval(dotsInterval);

            // 清除保存中状态，显示成功动画
            saveBtn.classList.remove('saving');
            saveBtn.style.backgroundColor = '#28a745';
            saveBtn.style.color = 'white';
            saveBtn.style.animation = 'success-bounce 1s ease';
            saveBtn.innerHTML = '✅ 保存成功';

            log(`✅ 快照 (ID: ${snapshotId}) 的批注已保存。`);
            showToast('批注保存成功！');

            // 1.5秒后恢复按钮状态
            setTimeout(() => {
                restoreButtonState();
            }, 1500);
        } else {
            log('ℹ️ 批注没有变化。');
            saveBtn.classList.remove('saving');
            saveBtn.innerHTML = 'ℹ️ 无变化';
            saveBtn.style.backgroundColor = '#ffc107';
            saveBtn.style.color = 'black';
            showToast('批注没有变化', 1500);

            // 1秒后恢复按钮状态
            setTimeout(() => {
                restoreButtonState();
            }, 1000);
        }
    } catch (error) {
        log(`❌ 保存批注失败: ${error.message}`);

        // 显示错误动画
        saveBtn.classList.remove('saving');
        saveBtn.innerHTML = '❌ 保存失败';
        saveBtn.style.backgroundColor = '#dc3545';
        saveBtn.style.color = 'white';
        showToast(`保存失败: ${error.message}`, 3000, true);

        // 2秒后恢复按钮状态
        setTimeout(() => {
            restoreButtonState();
        }, 2000);
    }

    // 恢复按钮状态的函数
    function restoreButtonState() {
        saveBtn.disabled = originalDisabled;
        saveBtn.textContent = originalText;
        saveBtn.style.backgroundColor = '';
        saveBtn.style.color = '';
        saveBtn.style.animation = '';
        saveBtn.classList.remove('saving');

        // 恢复文本区域的状态
        textareas.forEach(textarea => {
            textarea.style.backgroundColor = '';
            textarea.style.border = '';
            textarea.style.cursor = '';
            textarea.disabled = false;
        });
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
async function deleteSnapshot(snapshotId) {
    try {
        log(`🗑️ 正在从数据库删除快照 (ID: ${snapshotId})...`);
        await snapshotService.deleteSnapshotById(snapshotId);
        log(`✅ 快照 (ID: ${snapshotId}) 已成功删除。`);
        await renderSnapshotList(); // 从后端刷新列表
    } catch (error) {
        log(`❌ 删除快照失败: ${error.message}`);
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

/**
 * 显示牌局结束的确认弹窗
 */
function showEndOfHandModal() {
    const modal = document.getElementById('end-of-hand-modal');
    if (modal) modal.classList.add('is-visible');
}

/**
 * 隐藏牌局结束的确认弹窗
 */
function hideEndOfHandModal() {
    const modal = document.getElementById('end-of-hand-modal');
    if (modal) modal.classList.remove('is-visible');
}

// 显示全局加载动画
function showLoader() {
    const loader = document.getElementById('global-loader-overlay');
    if (loader) {
        loader.style.display = 'flex';
    }
}

// 隐藏全局加载动画
function hideLoader() {
    const loader = document.getElementById('global-loader-overlay');
    if (loader) {
        loader.style.display = 'none';
    }
}

function endGame() {
  log('🎉 牌局结束！');
  // Use a timeout to allow the final UI updates to render before showing the modal.
  setTimeout(showEndOfHandModal, 500);
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
  logActionToHistory(playerId, action, amount);
  updateActionSheetUI(playerId, action, amount);
}

/**
 * (重构) 仅将动作记录到 history 数组中
 */
function logActionToHistory(playerId, action, amount) {
  handActionHistory.push({
    playerId: playerId,
    action: action,
    amount: amount,
    round: game.currentRound
  });
}

/**
 * (重构) 仅将动作更新到 UI 的行动表上
 */
function updateActionSheetUI(playerId, action, amount) {
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
    void bubble.offsetWidth; // Trigger reflow
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
// 统一的初始化入口，确保只执行一次
(function() {
    let isInitialized = false;

    function initWhenReady() {
        if (isInitialized) {
            console.warn('初始化已执行，跳过重复调用');
            return;
        }

        isInitialized = true;

        // 调试信息
        console.log('Init started at:', new Date().toISOString());
        console.log('Document ready state:', document.readyState);
        console.log('Body children count:', document.body.children.length);

        init();
    }

    // 针对QQ浏览器的延迟优化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // 给QQ浏览器额外时间渲染DOM，增加到150ms
            setTimeout(initWhenReady, 150);
        });
    } else {
        // DOM 已经加载完成，延迟100ms确保稳定性
        setTimeout(initWhenReady, 100);
    }
})();

// ========== 回放功能 (Replay V1) ==========

/**
 * 初始化回放功能的事件监听
 */
function setupReplayControls() {
    // 使用统一的安全绑定函数绑定回放控制按钮事件
    const replayButtons = {
        'replay-play-pause-btn': playPauseReplay,
        'replay-next-btn': nextReplayStep,
        'replay-prev-btn': prevReplayStep,
        'replay-reset-btn': resetReplay,
        'replay-exit-btn': exitReplay
    };

    Object.entries(replayButtons).forEach(([id, handler]) => {
        safeBindEvent(id, handler, `未找到回放按钮: ${id}`);
    });
}

/**
 * 开始回放
 * @param {number} snapshotId 
 */
async function startReplay(snapshotId) {
    if (isGameRunning) {
        log('⚠️ 请先停止当前牌局，再开始回放。');
        return;
    }
    log(`[REPLAY] 开始加载快照 #${snapshotId} 用于回放...`);
    showLoader(); // 显示加载动画
    try {
        const snapshot = await snapshotService.getSnapshotById(snapshotId);
        if (!snapshot.settings || !snapshot.actionHistory) {
            log('❌ 回放失败：此快照缺少回放所需的 settings 或 actionHistory 数据。');
            return;
        }

        replayData.settings = JSON.parse(snapshot.settings);
        replayData.actions = JSON.parse(snapshot.actionHistory);
        replayData.gameState = JSON.parse(snapshot.gameState);

        stopGame(); // 确保游戏停止，UI干净
        enterReplayMode();

    } catch (error) {
        log(`❌ 加载快照失败: ${error.message}`);
    } finally {
        hideLoader(); // 隐藏加载动画
    }
}

/**
 * 进入回放模式，设置UI和状态
 */
function enterReplayMode() {
    isInReplayMode = true;
    document.getElementById('game-controls').style.display = 'none';
    document.getElementById('replay-controls').style.display = 'flex';
    
    // 禁用配置区
    const configDrawer = document.getElementById('config-drawer');
    if (configDrawer) {
        configDrawer.style.pointerEvents = 'none';
        configDrawer.style.opacity = '0.6';
        // Robustly disable all form controls within the drawer
        configDrawer.querySelectorAll('input, select').forEach(el => el.disabled = true);
    }

    resetReplay();
}

/**
 * 退出回放模式
 */
function exitReplay() {
    isInReplayMode = false;
    clearInterval(replayInterval);
    replayInterval = null;

    document.getElementById('game-controls').style.display = 'flex';
    document.getElementById('replay-controls').style.display = 'none';

    // 恢复配置区
    const configDrawer = document.getElementById('config-drawer');
    if (configDrawer) {
        configDrawer.style.pointerEvents = 'auto';
        configDrawer.style.opacity = '1';
        // Robustly re-enable all form controls
        configDrawer.querySelectorAll('input, select').forEach(el => el.disabled = false);
    }

    stopGame(); // 调用stopGame以确保完全重置到初始状态
    log("[REPLAY] 已退出回放模式。");
}

/**
 * 将回放重置到初始状态
 */
function resetReplay() {
    currentReplayStep = 0;
    clearInterval(replayInterval);
    replayInterval = null;

    // 1. 使用快照中的设置重置游戏引擎，并强制使用原始的庄家位置
    game.reset(replayData.settings, replayData.gameState.dealerIndex);

    // 2. 找到创世事件，并用它来覆盖玩家状态（初始筹码和手牌）
    const initialStateEvent = replayData.actions.find(e => e.type === 'initialState');
    if (initialStateEvent) {
        game.players = JSON.parse(JSON.stringify(initialStateEvent.players));
    } else {
        log('❌ [REPLAY] 无法开始回放：未找到initialState事件。');
        return;
    }

    // 3. 开始翻前回合，这将自动处理盲注并设置正确的第一个行动者
    game.startNewRound('preflop');

    // 4. 渲染UI
    renderActionSheet(); 
    updateUI({ isInitialDeal: true }); 
    
    document.getElementById('replay-play-pause-btn').textContent = '▶️ 播放';
    log("[REPLAY] 回放已重置，准备就绪。");
}

/**
 * 执行回放的下一步
 */
function nextReplayStep() {
    if (!isInReplayMode) return;

    if (currentReplayStep >= replayData.actions.length) {
        if (replayInterval) {
            clearInterval(replayInterval);
            replayInterval = null;
            document.getElementById('replay-play-pause-btn').textContent = '▶️ 播放';
        }
        log('[REPLAY] 回放结束。');
        return;
    }

    const event = replayData.actions[currentReplayStep];
    const isSbPost = event.round === 'preflop' && event.action === 'BET' && event.playerId === game.players[game.sbIndex].id && event.amount === replayData.settings.sb;
    const isBbPost = event.round === 'preflop' && event.action === 'BET' && event.playerId === game.players[game.bbIndex].id && event.amount === replayData.settings.bb;

    // 修正日志记录，使其能同时处理系统事件和玩家动作
    const actionOrType = event.type || event.action;
    const actor = event.playerId || 'System';
    
    // 增加详细的调试日志
    const enginePlayerIndex = game.currentPlayerIndex;
    const enginePlayerId = (enginePlayerIndex >= 0 && game.players[enginePlayerIndex]) ? game.players[enginePlayerIndex].id : 'N/A';
    log(`[REPLAY] Step ${currentReplayStep + 1}: Event is '${actionOrType}' by '${actor}'. Engine awaits '${enginePlayerId}' (idx: ${enginePlayerIndex})`);

    // 如果是盲注事件，只播放动画和更新UI，不执行动作（因为引擎已处理）
    if (isSbPost || isBbPost) {
        showActionBubble(event.playerId, event.action, event.amount);
        updateActionSheetUI(event.playerId, event.action, event.amount);
    } else {
        // 对于所有真实玩家动作，正常执行
        switch (event.type) {
            case 'initialState':
                // 创世状态已在 resetReplay 中处理完毕，此处无需任何操作
                break;
            case 'dealCommunity':
                game.communityCards = event.cards;
                game.startNewRound(event.round); // 核心修复：开始新一轮，重置行动顺序
                updateUI();
                break;
            default: // Player Action
                try {
                    game.executeAction(event.playerId, event.action, event.amount);
                    updateUI();
                    showActionBubble(event.playerId, event.action, event.amount);
                    updateActionSheetUI(event.playerId, event.action, event.amount); // 使用只更新UI的函数
                    
                    // 深度调试：在移动指针前，打印所有玩家的折叠状态
                    console.log('--- Before moveToNextPlayer ---', game.players.map(p => ({id: p.id, isFolded: p.isFolded})));

                    game.moveToNextPlayer(); // 核心修复：执行动作后，将指针移到下一位玩家
                } catch (e) {
                    log(`❌ [REPLAY] 回放动作失败: ${e.message}`);
                    // 停止播放
                    clearInterval(replayInterval);
                    replayInterval = null;
                    document.getElementById('replay-play-pause-btn').textContent = '▶️ 播放';
                    return; // 中断执行
                }
                break;
        }
    }

    currentReplayStep++;
}

/**
 * 执行回放的上一步
 */
function prevReplayStep() {
    if (!isInReplayMode) return;

    // 暂停播放
    if (replayInterval) {
        clearInterval(replayInterval);
        replayInterval = null;
        document.getElementById('replay-play-pause-btn').textContent = '▶️ 播放';
    }

    const targetStep = currentReplayStep - 2; // 因为要回到上一步的“开始”状态
    if (targetStep < 0) {
        resetReplay();
        return;
    }

    log(`[REPLAY] 回到步骤 ${targetStep + 1}...`);
    resetReplay();

    // 快速执行到目标步骤
    for (let i = 0; i <= targetStep; i++) {
        nextReplayStep();
    }
}

/**
 * 播放或暂停回放
 */
function playPauseReplay() {
    if (!isInReplayMode) return;

    const btn = document.getElementById('replay-play-pause-btn');

    if (replayInterval) { // 正在播放 -> 暂停
        clearInterval(replayInterval);
        replayInterval = null;
        btn.textContent = '▶️ 播放';
        log('[REPLAY] 暂停。');
    } else { // 已暂停 -> 播放
        if (currentReplayStep >= replayData.actions.length) {
            resetReplay();
        }
        btn.textContent = '⏸️ 暂停';
        log('[REPLAY] 播放...');
        // 立即执行一步，然后开始定时
        nextReplayStep();
        replayInterval = setInterval(nextReplayStep, 1500);
    }
}

