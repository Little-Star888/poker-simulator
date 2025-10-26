// main.js
import * as snapshotService from "./snapshot_api_service.js";
import { Settings } from "./setting.js";
import { PokerGame } from "./poker.js";
import { getDecision } from "./ai.js";
import { getSuggestion } from "./api_service.js";

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
  P8: { preflop: [], flop: [], turn: [], river: [] },
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
let modeSelect,
  playerCountInput,
  minStackInput,
  maxStackInput,
  potTypeSelect,
  p1RoleSelect;
let sbInput, bbInput, autoDelayInput;
let suggestPreflopCheckbox,
  suggestFlopCheckbox,
  suggestTurnCheckbox,
  suggestRiverCheckbox;
let startBtn, pauseBtn, consoleLog;
let usePresetHandsCheckbox,
  usePresetCommunityCheckbox,
  presetControls,
  presetPlayerHandsContainer,
  presetCommunityCardsContainer,
  cardPicker,
  gtoFilterPlayersContainer;

// ========== 工具函数 ==========
/**
 * 统一的时间格式化函数 - 使用中国时区（GMT+8）
 * @param {string|Date} dateInput 日期输入（字符串或Date对象）
 * @returns {string} 格式化后的时间字符串 "YYYY/MM/DD HH:mm:ss"
 */
function formatTimeChina(dateInput) {
  const date = new Date(dateInput);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 统一的安全事件绑定函数
 * @param {string} id 元素ID
 * @param {Function} handler 事件处理函数
 * @param {string} errorMsg 错误信息（可选）
 */
function safeBindEvent(id, handler, errorMsg) {
  const element = document.getElementById(id);
  if (element) {
    element.addEventListener("click", handler);
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
    console.log("[DEBUG] Game control debounce reset after delay");
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
      "mode-select",
      "player-count-input",
      "min-stack-input",
      "max-stack-input",
      "pot-type-select",
      "p1-role-select",
      "sb-input",
      "bb-input",
      "auto-delay",
      "suggest-preflop",
      "suggest-flop",
      "suggest-turn",
      "suggest-river",
      "start-btn",
      "pause-btn",
      "console-log",
      "use-preset-hands-checkbox",
      "use-preset-community-checkbox",
      "preset-controls",
      "preset-player-hands-container",
      "preset-community-cards-container",
      "card-picker",
      "gto-filter-players",
    ];

    const missingElements = criticalElements.filter(
      (id) => !document.getElementById(id),
    );
    if (missingElements.length > 0) {
      throw new Error(`缺少关键DOM元素: ${missingElements.join(", ")}`);
    }

    // --- DOM 元素获取（添加安全检查）---
    const safeGetElement = (id, name) => {
      const element = document.getElementById(id);
      if (!element) {
        throw new Error(`无法找到必需的DOM元素: ${name} (id: ${id})`);
      }
      return element;
    };

    modeSelect = safeGetElement("mode-select", "模式选择器");
    playerCountInput = safeGetElement("player-count-input", "玩家数量输入");
    minStackInput = safeGetElement("min-stack-input", "最小筹码输入");
    maxStackInput = safeGetElement("max-stack-input", "最大筹码输入");
    potTypeSelect = safeGetElement("pot-type-select", "底池类型选择");
    p1RoleSelect = safeGetElement("p1-role-select", "P1角色选择");
    sbInput = safeGetElement("sb-input", "小盲注输入");
    bbInput = safeGetElement("bb-input", "大盲注输入");
    autoDelayInput = safeGetElement("auto-delay", "自动延迟输入");
    suggestPreflopCheckbox = safeGetElement(
      "suggest-preflop",
      "翻前建议复选框",
    );
    suggestFlopCheckbox = safeGetElement("suggest-flop", "翻牌建议复选框");
    suggestTurnCheckbox = safeGetElement("suggest-turn", "转牌建议复选框");
    suggestRiverCheckbox = safeGetElement("suggest-river", "河牌建议复选框");
    startBtn = safeGetElement("start-btn", "开始按钮");
    pauseBtn = safeGetElement("pause-btn", "暂停按钮");
    consoleLog = safeGetElement("console-log", "控制台日志");
    usePresetHandsCheckbox = safeGetElement(
      "use-preset-hands-checkbox",
      "预设手牌复选框",
    );
    usePresetCommunityCheckbox = safeGetElement(
      "use-preset-community-checkbox",
      "预设公共牌复选框",
    );
    presetControls = safeGetElement("preset-controls", "预设控制器");
    presetPlayerHandsContainer = safeGetElement(
      "preset-player-hands-container",
      "预设玩家手牌容器",
    );
    presetCommunityCardsContainer = safeGetElement(
      "preset-community-cards-container",
      "预设公共牌容器",
    );
    cardPicker = safeGetElement("card-picker", "卡牌选择器");
    gtoFilterPlayersContainer = safeGetElement(
      "gto-filter-players",
      "GTO筛选玩家容器",
    );

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

    document.getElementById("preset-controls").style.display = "";

    function updatePotTypeSelectState() {
      const isManualMode = modeSelect.value === "manual";
      potTypeSelect.disabled = isManualMode;
      if (isManualMode) {
        potTypeSelect.style.backgroundColor = "#eee";
      } else {
        potTypeSelect.style.backgroundColor = "";
      }
    }
    updatePotTypeSelectState();

    modeSelect.addEventListener("change", () => {
      Settings.update({ mode: modeSelect.value });
      updatePotTypeSelectState();
      if (modeSelect.value === "auto") {
        isWaitingForManualInput = false;
        hideAllActionPopups();
      }
    });
    playerCountInput.addEventListener("change", () => {
      Settings.update({ playerCount: parseInt(playerCountInput.value) || 8 });
      updatePlayerDisplay();
      updateGtoFilterCheckboxes();
      updateP1RoleSelectOptions();
      if (Settings.usePresetHands) {
        buildPlayerSlots();
      }
      renderActionSheetTemplate();
    });
    minStackInput.addEventListener("change", () =>
      Settings.update({ minStack: parseInt(minStackInput.value) || 2000 }),
    );
    maxStackInput.addEventListener("change", () =>
      Settings.update({ maxStack: parseInt(maxStackInput.value) || 2000 }),
    );
    potTypeSelect.addEventListener("change", () =>
      Settings.update({ potType: potTypeSelect.value }),
    );
    p1RoleSelect.addEventListener("change", () =>
      Settings.update({ p1Role: p1RoleSelect.value }),
    );

    sbInput.addEventListener("input", () => {
      const sbValue = parseInt(sbInput.value) || 0;
      const newBbValue = sbValue * 2;
      bbInput.value = newBbValue;
      Settings.update({ sb: sbValue, bb: newBbValue });
    });

    autoDelayInput.addEventListener("change", () =>
      Settings.update({ autoDelay: parseInt(autoDelayInput.value) || 1000 }),
    );
    suggestPreflopCheckbox.addEventListener("change", () =>
      Settings.update({ suggestOnPreflop: suggestPreflopCheckbox.checked }),
    );
    suggestFlopCheckbox.addEventListener("change", () =>
      Settings.update({ suggestOnFlop: suggestFlopCheckbox.checked }),
    );
    suggestTurnCheckbox.addEventListener("change", () =>
      Settings.update({ suggestOnTurn: suggestTurnCheckbox.checked }),
    );
    suggestRiverCheckbox.addEventListener("change", () =>
      Settings.update({ suggestOnRiver: suggestRiverCheckbox.checked }),
    );

    startBtn.addEventListener("click", handleStartStopClick);
    pauseBtn.addEventListener("click", handlePauseResumeClick);

    usePresetHandsCheckbox.addEventListener("change", updatePresetVisibility);
    usePresetCommunityCheckbox.addEventListener(
      "change",
      updatePresetVisibility,
    );

    const playerElements = document.querySelectorAll(".player");
    if (playerElements.length === 0) {
      console.warn("未找到任何玩家元素，跳过玩家事件绑定");
    }

    playerElements.forEach((playerElement) => {
      const playerId = playerElement.dataset.player;
      const popup = playerElement.querySelector(".player-action-popup");
      if (!popup) {
        console.warn(`玩家 ${playerId} 缺少操作弹窗，跳过事件绑定`);
        return;
      }
      const sliderOverlay = popup.querySelector(".amount-slider-overlay");
      const sliderInput = sliderOverlay
        ? sliderOverlay.querySelector(".bet-slider-input")
        : null;
      const foldBtn = popup.querySelector(".main-action-btn.fold");
      const betRaiseBtn = popup.querySelector(".main-action-btn.bet-raise");
      const checkCallBtn = popup.querySelector(".main-action-btn.check-call");
      // 安全地绑定事件
      if (foldBtn) {
        foldBtn.addEventListener("click", () =>
          submitManualAction(playerId, "FOLD"),
        );
      } else {
        console.warn(`玩家 ${playerId} 缺少弃牌按钮`);
      }

      if (checkCallBtn) {
        checkCallBtn.addEventListener("click", () => {
          const action = checkCallBtn.dataset.action;
          submitManualAction(playerId, action);
        });
      } else {
        console.warn(`玩家 ${playerId} 缺少让牌/跟注按钮`);
      }

      if (betRaiseBtn) {
        betRaiseBtn.addEventListener("click", () => {
          const action = betRaiseBtn.dataset.action;
          if (action === "ALLIN") {
            const player = game.players.find((p) => p.id === playerId);
            if (player) {
              const amount = player.stack + player.bet;
              submitManualAction(playerId, "ALLIN", amount);
            }
          } else {
            showVerticalSlider(playerId, action);
          }
        });
      } else {
        console.warn(`玩家 ${playerId} 缺少下注/加注按钮`);
      }

      if (popup) {
        popup.querySelectorAll(".quick-bet-sizes button").forEach((btn) => {
          btn.addEventListener("click", () => {
            const amount = parseInt(btn.dataset.amount);
            if (amount > 0) {
              const action = betRaiseBtn ? betRaiseBtn.dataset.action : null;
              if (action) {
                submitManualAction(playerId, action, amount);
              }
            }
          });
        });

        popup.addEventListener("click", (e) => {
          if (e.target === popup) {
            hideAllActionPopups();
          }
        });
      }

      if (sliderOverlay && sliderInput) {
        const confirmBtn = sliderOverlay.querySelector(".confirm-bet");
        if (confirmBtn) {
          confirmBtn.addEventListener("click", () => {
            const amount = parseInt(sliderInput.dataset.finalAmount);
            const action = sliderInput.dataset.action;
            submitManualAction(playerId, action, amount);
          });
        }

        sliderInput.addEventListener("input", () =>
          updateSliderAmount(playerId, sliderInput),
        );

        sliderOverlay.addEventListener("click", (e) => {
          if (e.target === sliderOverlay) {
            e.stopPropagation();
            const actionPanel = popup.querySelector(".action-panel");
            if (actionPanel) {
              sliderOverlay.style.display = "none";
              actionPanel.style.display = "flex";
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
    log("德州扑克 AI 测试模拟器已加载");
    injectStyles();

    const configDrawer = document.getElementById("config-drawer");
    const configToggleBtn = document.getElementById("config-toggle-btn");
    const drawerCloseBtn = document.querySelector(".drawer-close-btn");
    const drawerOverlay = document.querySelector(".drawer-overlay");

    if (configDrawer && configToggleBtn) {
      function openDrawer() {
        if (configDrawer) configDrawer.classList.add("is-open");
      }
      function closeDrawer() {
        if (configDrawer) configDrawer.classList.remove("is-open");
      }
      configToggleBtn.addEventListener("click", openDrawer);
      if (drawerCloseBtn) drawerCloseBtn.addEventListener("click", closeDrawer);
      if (drawerOverlay) drawerOverlay.addEventListener("click", closeDrawer);
    } else {
      console.warn("配置抽屉相关元素未找到，抽屉功能将不可用");
    }

    const table = document.querySelector(".poker-table");
    if (table) {
      const resizeObserver = new ResizeObserver(() => {
        updatePlayerLayout();
      });
      resizeObserver.observe(table);
    } else {
      console.warn("未找到扑克桌元素，布局自适应功能将不可用");
    }

    initSnapshotModalListeners();
    renderSnapshotList();
    updatePresetVisibility();

    const snapshotList = document.getElementById("snapshot-list");
    if (snapshotList) {
      snapshotList.addEventListener("click", (e) => {
        if (e.target && e.target.classList.contains("snapshot-name-display")) {
          if (document.querySelector(".snapshot-name-edit")) {
            document.querySelector(".snapshot-name-edit").blur();
          }
          makeSnapshotNameEditable(e.target);
        }
      });
    } else {
      console.warn("未找到快照列表元素");
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
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentName;
  input.className = "snapshot-name-edit";
  nameElement.parentNode.replaceChild(input, nameElement);
  input.focus();
  input.select();

  const saveChanges = async () => {
    const newName = input.value.trim();
    const finalName = newName || currentName;

    // 更新UI
    const newNameElement = document.createElement("strong");
    newNameElement.className = "snapshot-name-display";
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

  input.addEventListener("blur", saveChanges);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveChanges();
    } else if (e.key === "Escape") {
      const originalNameElement = document.createElement("strong");
      originalNameElement.className = "snapshot-name-display";
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
    document
      .querySelectorAll("#preset-community-cards-container .preset-card-slot")
      .forEach((slot) => sequence.push(slot));
  }
  if (Settings.usePresetHands) {
    document
      .querySelectorAll("#preset-player-hands-container .preset-card-slot")
      .forEach((slot) => sequence.push(slot));
  }
  return sequence;
}

function activateNextEmptySlot() {
  if (activeSelectionSlot) {
    activeSelectionSlot.classList.remove("active-selection");
    activeSelectionSlot = null;
  }
  const sequence = getSlotSequence();
  for (const slot of sequence) {
    if (!slot.dataset.card) {
      activeSelectionSlot = slot;
      activeSelectionSlot.classList.add("active-selection");
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
  const anyPresetEnabled =
    Settings.usePresetHands || Settings.usePresetCommunity;
  if (anyPresetEnabled && !isPresetUIInitialized) {
    initPresetUI();
  }
  if (!anyPresetEnabled && isPresetUIInitialized) {
    resetPresetData();
  }
  if (Settings.usePresetHands) {
    buildPlayerSlots();
  } else {
    presetPlayerHandsContainer.innerHTML = "";
  }
  presetControls.classList.toggle("hidden-by-js", !anyPresetEnabled);
  presetPlayerHandsContainer.classList.toggle(
    "hidden-by-js",
    !Settings.usePresetHands,
  );
  presetCommunityCardsContainer.classList.toggle(
    "hidden-by-js",
    !Settings.usePresetCommunity,
  );
  activateNextEmptySlot();
}

function initPresetUI() {
  if (isPresetUIInitialized) return;
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = [
    "A",
    "K",
    "Q",
    "J",
    "10",
    "9",
    "8",
    "7",
    "6",
    "5",
    "4",
    "3",
    "2",
  ];
  const deck = suits.flatMap((suit) => ranks.map((rank) => `${suit}${rank}`));
  deck.forEach((cardText) => {
    const cardEl = document.createElement("div");
    cardEl.classList.add("picker-card");
    cardEl.dataset.card = cardText;
    cardEl.style.backgroundImage = `url(${getCardImagePath(cardText)})`;
    cardEl.addEventListener("click", handleCardPickerClick);
    cardPicker.appendChild(cardEl);
  });
  document
    .querySelectorAll("#preset-community-cards-container .preset-card-slot")
    .forEach((slot) => {
      slot.addEventListener("click", handleSlotClick);
    });
  isPresetUIInitialized = true;
}

function buildPlayerSlots() {
  presetPlayerHandsContainer.innerHTML = "<h4>玩家手牌:</h4>";
  Settings.presetCards.players = {};
  for (let i = 1; i <= Settings.playerCount; i++) {
    const playerId = `P${i}`;
    Settings.presetCards.players[playerId] = [null, null];
    const playerHandDiv = document.createElement("div");
    playerHandDiv.classList.add("player-hand-preset");
    playerHandDiv.innerHTML = `<strong>${playerId}:</strong>`;
    for (let j = 0; j < 2; j++) {
      const slot = document.createElement("div");
      slot.classList.add("preset-card-slot");
      slot.dataset.type = "player";
      slot.dataset.playerId = playerId;
      slot.dataset.cardIndex = j;
      slot.addEventListener("click", handleSlotClick);
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
  document.querySelectorAll(".preset-card-slot").forEach((slot) => {
    slot.style.backgroundImage = "";
    delete slot.dataset.card;
  });
  document.querySelectorAll(".picker-card").forEach((card) => {
    card.classList.remove("dimmed");
  });
  if (activeSelectionSlot) {
    activeSelectionSlot.classList.remove("active-selection");
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
    activeSelectionSlot.classList.remove("active-selection");
    activeSelectionSlot = null;
    return;
  }
  if (activeSelectionSlot) {
    activeSelectionSlot.classList.remove("active-selection");
  }
  activeSelectionSlot = clickedSlot;
  activeSelectionSlot.classList.add("active-selection");
}

function animateCardToSlot(pickerCard, destinationElement, cardText) {
  const startRect = pickerCard.getBoundingClientRect();
  const endRect = destinationElement.getBoundingClientRect();
  if (endRect.width === 0 || endRect.height === 0) {
    console.warn(
      "Destination element for card animation is not visible or has zero dimensions. Skipping animation for this target.",
    );
    return;
  }
  const movingCard = document.createElement("div");
  movingCard.style.position = "fixed";
  movingCard.style.zIndex = "2001";
  movingCard.style.left = `${startRect.left}px`;
  movingCard.style.top = `${startRect.top}px`;
  movingCard.style.width = `${startRect.width}px`;
  movingCard.style.height = `${endRect.height}px`;
  movingCard.style.backgroundImage = `url(${getCardImagePath(cardText)})`;
  movingCard.style.backgroundSize = "contain";
  movingCard.style.backgroundRepeat = "no-repeat";
  movingCard.style.backgroundPosition = "center";
  movingCard.style.borderRadius = "4px";
  movingCard.style.transition = "all 0.4s ease-in-out";
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
    log("正在处理上一张牌的选择，请稍候...");
    return;
  }

  const pickerCard = event.currentTarget;
  const cardText = pickerCard.dataset.card;
  if (pickerCard.classList.contains("dimmed")) {
    log(`这张牌 (${cardText}) 已经被使用了。请先点击已分配的卡槽来取消选择。`);
    return;
  }
  if (!activeSelectionSlot) {
    log("没有可用的空卡槽来放置扑克牌，或所有卡槽已满。");
    return;
  }

  // 立即设置处理状态
  isProcessingCardSelection = true;

  // 立即标记牌为已使用，防止重复选择
  pickerCard.classList.add("dimmed");
  usedCards.add(cardText);

  // 立即更新槽位数据，防止重复分配
  const currentSlot = activeSelectionSlot;
  const { type, playerId, cardIndex } = currentSlot.dataset;

  let animationsInitiated = 0;
  animateCardToSlot(pickerCard, currentSlot, cardText);
  animationsInitiated++;
  if (type === "player" && Settings.usePresetHands) {
    const playerOnTable = document.querySelector(
      `.player[data-player="${playerId}"]`,
    );
    if (playerOnTable) {
      const cardOnTable =
        playerOnTable.querySelectorAll(".hole-card")[parseInt(cardIndex)];
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
  if (type === "player") {
    Settings.presetCards.players[playerId][parseInt(cardIndex)] = cardText;
    const playerOnTable = document.querySelector(
      `.player[data-player="${playerId}"]`,
    );
    if (playerOnTable) {
      const cardOnTable =
        playerOnTable.querySelectorAll(".hole-card")[parseInt(cardIndex)];
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
  if (type === "player") {
    const playerOnTable = document.querySelector(
      `.player[data-player="${playerId}"]`,
    );
    if (playerOnTable) {
      cardOnTable =
        playerOnTable.querySelectorAll(".hole-card")[parseInt(cardIndex)];
      if (cardOnTable) elementsToAnimate.push(cardOnTable);
    }
  }
  elementsToAnimate.forEach((el) => el.classList.add("card-unassigned"));
  setTimeout(() => {
    if (type === "player") {
      Settings.presetCards.players[playerId][parseInt(cardIndex)] = null;
    } else {
      Settings.presetCards[stage][parseInt(cardIndex)] = null;
    }
    usedCards.delete(cardText);
    const pickerCard = cardPicker.querySelector(
      `.picker-card[data-card="${cardText.replace('"', '"')}"]`,
    );
    if (pickerCard) {
      pickerCard.classList.remove("dimmed");
    }
    elementsToAnimate.forEach((el) => {
      el.style.backgroundImage = "";
      el.classList.remove("card-unassigned");
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
      if (
        !players[playerId] ||
        players[playerId].filter((c) => c).length !== 2
      ) {
        log(`❌ 预设错误: 玩家 ${playerId} 的手牌未设置完整 (需要2张).`);
        return false;
      }
    }
  }
  if (Settings.usePresetCommunity) {
    if (flop.filter((c) => c).length !== 3) {
      log(`❌ 预设错误: Flop牌未设置完整 (需要3张).`);
      return false;
    }
    if (turn.filter((c) => c).length !== 1) {
      log(`❌ 预设错误: Turn牌未设置 (需要1张).`);
      return false;
    }
    if (river.filter((c) => c).length !== 1) {
      log(`❌ 预设错误: River牌未设置 (需要1张).`);
      return false;
    }
  }
  log("✅ 预设卡牌验证通过。");
  return true;
}

// ========== 游戏控制 ==========

function handleStartStopClick() {
  // 添加调试日志
  console.log(
    `[DEBUG] handleStartStopClick called - isProcessingGameControl: ${isProcessingGameControl}, btnText: ${startBtn.textContent}`,
  );

  // 统一的防抖检查：在函数开始就检查
  if (isProcessingGameControl) {
    log("正在处理游戏控制操作，请稍候...");
    console.log("[DEBUG] Start/Stop action blocked by debounce");
    return;
  }

  if (startBtn.textContent.includes("开始牌局")) {
    startNewGame();
  } else {
    stopGame();
  }
}

function handlePauseResumeClick() {
  // 添加调试日志
  console.log(
    `[DEBUG] handlePauseResumeClick called - isGameRunning: ${isGameRunning}, isProcessingGameControl: ${isProcessingGameControl}, isGamePaused: ${isGamePaused}`,
  );

  if (!isGameRunning) {
    console.log("[DEBUG] Pause/Resume ignored - game not running");
    return;
  }

  // 统一的防抖检查：在函数开始就检查
  if (isProcessingGameControl) {
    log("正在处理游戏控制操作，请稍候...");
    console.log("[DEBUG] Pause/Resume action blocked by debounce");
    return;
  }

  // 立即设置防抖状态
  isProcessingGameControl = true;
  console.log("[DEBUG] Pause/Resume debounce set to true");

  if (isGamePaused) {
    isGamePaused = false;
    log("▶️ 牌局继续");
    pauseBtn.textContent = "⏸️ 暂停";
    if (Settings.mode === "auto") {
      processNextAction();
    }
  } else {
    isGamePaused = true;
    log("⏸️ 牌局暂停");
    pauseBtn.textContent = "▶️ 继续";
  }

  // 使用统一的延迟重置（300ms后）
  resetGameControlDebounce(300);
}

function startNewGame() {
  // 立即设置防抖状态
  isProcessingGameControl = true;
  console.log("[DEBUG] Start new game debounce set to true");

  currentSuggestionsCache = []; // 清空GTO建议缓存
  handActionHistory = []; // 重置单局动作历史
  document.getElementById("suggestion-display").innerHTML = "等待玩家行动...";
  if (isGameRunning && !isGamePaused) {
    log("游戏已在运行中");
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
      type: "initialState",
      players: JSON.parse(JSON.stringify(game.players)), // 深拷贝
    });
    game.startNewRound("preflop");
    isGameRunning = true;
    const presetSection = document.getElementById("preset-section");
    if (presetSection) {
      presetSection.style.opacity = "0.5";
      presetSection.style.pointerEvents = "none";
      presetSection
        .querySelectorAll("input, select")
        .forEach((el) => (el.disabled = true));
    }
    const runtimeConfigSection = document.getElementById(
      "runtime-config-section",
    );
    if (runtimeConfigSection) {
      runtimeConfigSection.querySelectorAll(".form-row").forEach((row) => {
        const isGtoFilterRow = row.querySelector("#gto-filter-players");
        if (!isGtoFilterRow) {
          // Disable all other rows
          row.style.opacity = "0.5";
          row.style.pointerEvents = "none";
          row
            .querySelectorAll("input, select")
            .forEach((el) => (el.disabled = true));
        } else {
          // Ensure the GTO filter row is fully enabled (just in case)
          row.style.opacity = "1";
          row.style.pointerEvents = "auto";
          row
            .querySelectorAll("input, select")
            .forEach((el) => (el.disabled = false));
        }
      });
    }
    updateActionSheet(game.players[game.sbIndex].id, "BET", Settings.sb);
    updateActionSheet(game.players[game.bbIndex].id, "BET", Settings.bb);
    log("✅ 新牌局开始！盲注: SB=" + Settings.sb + ", BB=" + Settings.bb);
    log(
      `[SYSTEM] ${game.players[game.sbIndex].id} posts Small Blind ${Settings.sb}`,
    );
    log(
      `[SYSTEM] ${game.players[game.bbIndex].id} posts Big Blind ${Settings.bb}`,
    );
    updateUI({ isInitialDeal: true });
    startBtn.textContent = "🛑 停止牌局";
    startBtn.disabled = false;
    pauseBtn.disabled = Settings.mode === "manual";
    pauseBtn.textContent = "⏸️ 暂停";
    if (Settings.mode === "auto") {
      setTimeout(processNextAction, Settings.autoDelay);
    } else {
      processNextAction();
    }

    // 使用统一的延迟重置（300ms后）
    resetGameControlDebounce();
  } catch (e) {
    log("❌ 启动失败: " + e.message);
    console.error(e);
    isGameRunning = false;
    // 使用统一的延迟重置（300ms后）
    resetGameControlDebounce();
  }
}

function updatePlayerLayout() {
  const table = document.querySelector(".poker-table");
  if (!table) return;
  const tableRect = table.getBoundingClientRect();
  const centerX = tableRect.width / 2;
  const centerY = tableRect.height / 2;
  const radiusX = tableRect.width / 2 - 70;
  const radiusY = tableRect.height / 2 - 60;
  const players = Array.from(document.querySelectorAll(".player")).filter(
    (p) => p.style.display !== "none",
  );
  const playerCount = players.length;
  if (playerCount === 0) return;

  // 动态角度计算 - 参照Vue版本的实现
  // P1 固定在最下方（90°），其他玩家平均分配角度
  const angleStep = 360 / playerCount;

  // 先淡出所有玩家，为重新布局做准备
  players.forEach((player) => {
    player.classList.add("changing-position");
    player.style.opacity = "0";
  });

  // 延迟后重新定位并淡入玩家，创造平滑的过渡效果
  setTimeout(() => {
    players.forEach((player, index) => {
      const playerId = player.dataset.player;
      const playerNum = parseInt(playerId.substring(1));

      // 计算每个玩家的角度
      let angleDeg;
      if (playerNum === 1) {
        angleDeg = 90; // P1 固定在最下方
      } else {
        // 其他玩家平均分配剩余角度
        angleDeg = 90 + angleStep * (playerNum - 1);
      }

      const angleRad = angleDeg * (Math.PI / 180);
      const x = centerX + radiusX * Math.cos(angleRad);
      const y = centerY + radiusY * Math.sin(angleRad);

      // 更新位置
      player.style.left = `${x}px`;
      player.style.top = `${y}px`;
      player.style.transform = "translate(-50%, -50%)";
      player.style.bottom = "";
      player.style.right = "";

      // 依次淡入玩家，创造波浪般的动画效果
      setTimeout(() => {
        player.style.opacity = "1";
        // 移除动画状态类，恢复默认过渡
        setTimeout(() => {
          player.classList.remove("changing-position");
        }, 500); // 等待位置变化动画完成
      }, index * 40); // 每个玩家延迟40ms，形成更快的波浪效果
    });
  }, 50); // 50ms后开始重新定位，让动画更快响应
}

function updatePlayerDisplay() {
  const playerCount = Settings.playerCount;
  for (let i = 1; i <= 8; i++) {
    const playerElement = document.querySelector(
      `.player[data-player="P${i}"]`,
    );
    if (playerElement) {
      playerElement.style.display = i <= playerCount ? "flex" : "none";
    }
  }
  updatePlayerLayout();
}

function updateGtoFilterCheckboxes() {
  gtoFilterPlayersContainer.innerHTML = "";
  gtoSuggestionFilter.clear();
  // 清空筛选器，然后添加所有玩家
  for (let i = 1; i <= Settings.playerCount; i++) {
    const playerId = `P${i}`;
    gtoSuggestionFilter.add(playerId);
  }
  for (let i = 1; i <= Settings.playerCount; i++) {
    const playerId = `P${i}`;
    const isChecked = true; // 所有玩家都默认勾选
    const label = document.createElement("label");
    label.style.marginRight = "10px";
    label.style.width = "auto";
    label.style.cursor = "pointer";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = playerId;
    checkbox.checked = isChecked;
    checkbox.id = `gto-filter-${playerId}`;
    checkbox.style.marginRight = "4px";
    checkbox.addEventListener("change", (event) => {
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
  document
    .querySelectorAll(".gto-suggestion-for-player")
    .forEach((suggestionEl) => {
      const elPlayerId = suggestionEl.dataset.playerId;
      if (gtoSuggestionFilter.has(elPlayerId)) {
        suggestionEl.style.display = "block";
      } else {
        suggestionEl.style.display = "none";
      }
    });
}

function getRoleOrder(playerCount) {
  switch (playerCount) {
    case 2:
      return ["SB", "BTN"];
    case 3:
      return ["SB", "BB", "BTN"];
    case 4:
      return ["SB", "BB", "CO", "BTN"];
    case 5:
      return ["SB", "BB", "UTG", "CO", "BTN"];
    case 6:
      return ["SB", "BB", "UTG", "HJ", "CO", "BTN"];
    case 7:
      return ["SB", "BB", "UTG", "MP1", "HJ", "CO", "BTN"];
    case 8:
      return ["SB", "BB", "UTG", "UTG+1", "MP1", "HJ", "CO", "BTN"];
    default:
      const baseRoles = [
        "SB",
        "BB",
        "UTG",
        "UTG+1",
        "UTG+2",
        "MP1",
        "MP2",
        "HJ",
        "CO",
      ];
      return baseRoles.slice(0, playerCount - 1).concat("BTN");
  }
}

function updateP1RoleSelectOptions() {
  const playerCount = Settings.playerCount;
  const availableRoles = getRoleOrder(playerCount);
  const currentP1Role = Settings.p1Role;
  p1RoleSelect.innerHTML = '<option value="random">随机</option>';
  availableRoles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    p1RoleSelect.appendChild(option);
  });
  if (availableRoles.includes(currentP1Role)) {
    p1RoleSelect.value = currentP1Role;
  } else {
    p1RoleSelect.value = "random";
    Settings.update({ p1Role: "random" });
  }
}

function stopGame() {
  // ✅ 统一的防抖检查：在函数开始就检查
  if (isProcessingGameControl) {
    log("正在处理游戏控制操作，请稍候...");
    return;
  }

  // 立即设置防抖状态
  isProcessingGameControl = true;
  console.log("[DEBUG] Stop game debounce set to true");

  log("🛑 牌局已手动停止，重置到初始状态。");
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
  document.getElementById("suggestion-display").innerHTML = "等待玩家行动...";
  startBtn.textContent = "▶️ 开始牌局";
  startBtn.disabled = false;
  pauseBtn.textContent = "⏸️ 暂停";
  pauseBtn.disabled = true;
  const presetSection = document.getElementById("preset-section");
  if (presetSection) {
    presetSection.style.opacity = "1";
    presetSection.style.pointerEvents = "auto";
    presetSection
      .querySelectorAll("input, select")
      .forEach((el) => (el.disabled = false));
  }
  const runtimeConfigSection = document.getElementById(
    "runtime-config-section",
  );
  if (runtimeConfigSection) {
    runtimeConfigSection.querySelectorAll(".form-row").forEach((row) => {
      row.style.opacity = "";
      row.style.pointerEvents = "";
      row
        .querySelectorAll("input, select")
        .forEach((el) => (el.disabled = false));
    });
    // 重新根据模式设置底池类型选择框的状态
    const isManualMode = modeSelect.value === "manual";
    potTypeSelect.disabled = isManualMode;
    if (isManualMode) {
      potTypeSelect.style.backgroundColor = "#eee";
    } else {
      potTypeSelect.style.backgroundColor = "";
    }
  }
}

async function processNextAction() {
  if (!isGameRunning || isGamePaused) return;
  const currentPlayerId = game.getCurrentPlayerId();
  if (!currentPlayerId) {
    if (game.isShowdown()) {
      log("所有剩余玩家均已All-in，进入自动摊牌流程。");
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
    if (round === "preflop" && Settings.suggestOnPreflop) shouldSuggest = true;
    if (round === "flop" && Settings.suggestOnFlop) shouldSuggest = true;
    if (round === "turn" && Settings.suggestOnTurn) shouldSuggest = true;
    if (round === "river" && Settings.suggestOnRiver) shouldSuggest = true;
    if (shouldSuggest) {
      try {
        const result = await getSuggestion(
          gameState,
          currentPlayerId,
          actionRecords,
        );
        console.log("[DEBUG] Raw result from getSuggestion:", result);

        // 增加代码健壮性，处理 getSuggestion 可能返回不一致结果的情况
        const isWrapper =
          result &&
          result.response !== undefined &&
          result.request !== undefined;
        const suggestion = isWrapper ? result.response : result;
        const request = isWrapper ? result.request : null;

        if (!isWrapper) {
          console.warn(
            `[WARN] For player ${currentPlayerId}, getSuggestion did not return a wrapper object. Snapshots for this action will be incomplete.`,
          );
        }

        currentSuggestionsCache.push({
          playerId: currentPlayerId,
          suggestion: suggestion,
          request: request,
          phase: round, // 添加阶段信息，与Vue版本保持一致
        });
        renderSuggestion(suggestion, currentPlayerId, round);
      } catch (apiError) {
        const display = document.getElementById("suggestion-display");
        if (display.textContent.includes("等待玩家行动...")) {
          display.innerHTML = "";
        }
        display.innerHTML += `<div style="color: #ff6b6b;">获取 ${currentPlayerId} 的建议失败: ${apiError.message}</div>`;
        display.scrollTop = 0; // 滚动到顶部显示最新内容
        log(`获取GTO建议时出错: ${apiError.message}`);
      }
    }
    if (Settings.mode === "manual") {
      showPlayerActionPopup(currentPlayerId);
      return;
    }
    const decision = await getDecision(
      gameState,
      currentPlayerId,
      gtoSuggestionFilter,
    );
    game.executeAction(currentPlayerId, decision.action, decision.amount);
    log(
      `[${game.currentRound}] ${currentPlayerId} ${decision.action}${decision.amount ? " " + decision.amount : ""}`,
    );
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
  const activePlayers = game.players.filter((p) => !p.isFolded);
  if (activePlayers.length <= 1) {
    setTimeout(endGame, 500);
    return;
  }
  const currentRound = game.currentRound;
  if (currentRound === "river") {
    endGame();
    return;
  }
  if (currentRound === "preflop") {
    game.dealFlop();
    handActionHistory.push({
      type: "dealCommunity",
      round: "flop",
      cards: game.communityCards.slice(0, 3),
    });
  } else {
    game.dealTurnOrRiver();
    handActionHistory.push({
      type: "dealCommunity",
      round: game.currentRound === "flop" ? "turn" : "river",
      cards: [...game.communityCards],
    });
  }
  const nextRound = getNextRound(currentRound);
  game.startNewRound(nextRound);
  log(`➡️ 进入 ${nextRound} 阶段 | 公共牌: ${game.communityCards.join(" ")}`);
  updateUI();
  setTimeout(processNextAction, Settings.autoDelay);
}

function getNextRound(currentRound) {
  const rounds = ["preflop", "flop", "turn", "river"];
  const idx = rounds.indexOf(currentRound);
  return idx !== -1 && idx < rounds.length - 1 ? rounds[idx + 1] : "river";
}

async function showdown() {
  isGameRunning = false;
  log("进入摊牌流程，自动发完公共牌...");
  while (game.currentRound !== "river" && game.communityCards.length < 5) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (game.currentRound === "preflop") {
      game.dealFlop();
      game.setCurrentRound("flop");
    } else if (game.currentRound === "flop") {
      game.dealTurnOrRiver();
      game.setCurrentRound("turn");
    } else if (game.currentRound === "turn") {
      game.dealTurnOrRiver();
      game.setCurrentRound("river");
    }
    log(
      `➡️ 发出 ${game.currentRound} 牌 | 公共牌: ${game.communityCards.join(" ")}`,
    );
    updateUI();
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  endGame();
}

// ========== 快照功能 V3 (自定义截图 + 自定义确认 + Bug修复) ==========

// --- 自定义截图相关全局变量 ---
let isSelecting = false;
let selectionStartX, selectionStartY;

// 新增一个函数来处理ESC键按下事件，以便可以正确地添加和移除监听器
function handleSnapshotEscape(e) {
  if (e.key === "Escape") {
    // 传递一个特殊标记来表明这是由ESC键触发的取消操作
    endSelection({ forceCancel: true });
  }
}

/**
 * 启动截图选择流程的通用函数
 */
function initiateSnapshotProcess() {
  // Mac兼容性调试
  if (navigator.platform.indexOf("Mac") !== -1) {
    console.log("🖥️ Mac系统检测 - 开始截图流程");
    console.log("浏览器信息:", navigator.userAgent);
    console.log("html2canvas可用性:", typeof html2canvas !== "undefined");
  }

  log("🖱️ 请在页面上拖拽以选择截图区域...");
  const overlay = document.getElementById("screenshot-selection-overlay");
  const prompt = document.getElementById("screenshot-prompt-overlay"); // 获取提示元素

  if (!overlay || !prompt) {
    log("❌ 错误：无法找到截图覆盖层或提示元素。");
    return;
  }

  // 显示提示
  prompt.style.top = "20px";
  prompt.style.opacity = "1";

  overlay.style.display = "block";
  document.body.style.userSelect = "none";

  overlay.addEventListener("mousedown", startSelection);
  overlay.addEventListener("mousemove", dragSelection);
  window.addEventListener("mouseup", endSelection);
  document.addEventListener("keydown", handleSnapshotEscape); // 监听ESC键
}

/**
 * “保存快照”按钮的点击事件处理程序。
 */
function handleSnapshotButtonClick() {
  if (!isGameRunning) {
    log("⚠️ 游戏未开始，无法保存快照。");
    return;
  }
  initiateSnapshotProcess();
}

/**
 * 截图选择：鼠标按下事件
 */
function startSelection(e) {
  if (e.button !== 0) return;

  // Mac兼容性检查
  if (navigator.platform.indexOf("Mac") !== -1 && !e.isTrusted) {
    log("⚠️ Mac安全策略阻止了事件");
    return;
  }

  isSelecting = true;
  selectionStartX = e.clientX;
  selectionStartY = e.clientY;
  const selectionBox = document.getElementById("selection-box");
  if (!selectionBox) return;

  selectionBox.style.left = `${selectionStartX}px`;
  selectionBox.style.top = `${selectionStartY}px`;
  selectionBox.style.width = "0px";
  selectionBox.style.height = "0px";
  selectionBox.style.display = "block";
}

/**
 * 截图选择：鼠标移动事件，绘制选框
 */
function dragSelection(e) {
  if (!isSelecting) return;
  const selectionBox = document.getElementById("selection-box");
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
  const overlay = document.getElementById("screenshot-selection-overlay");
  const prompt = document.getElementById("screenshot-prompt-overlay"); // 获取提示元素

  if (!overlay || overlay.style.display === "none") {
    // 如果覆盖层已经不可见（可能已被ESC取消），确保监听器被移除
    window.removeEventListener("mouseup", endSelection);
    document.removeEventListener("keydown", handleSnapshotEscape);
    return;
  }

  isSelecting = false;

  // 隐藏覆盖层和提示
  overlay.style.display = "none";
  if (prompt) {
    prompt.style.top = "-100px";
    prompt.style.opacity = "0";
  }
  document.body.style.userSelect = "auto";

  // 移除所有监听器
  overlay.removeEventListener("mousedown", startSelection);
  overlay.removeEventListener("mousemove", dragSelection);
  window.removeEventListener("mouseup", endSelection);
  document.removeEventListener("keydown", handleSnapshotEscape);

  // 如果是强制取消（例如按了ESC）
  if (e && e.forceCancel) {
    log("截图操作已取消。");
    if (postSnapshotAction) {
      postSnapshotAction();
      postSnapshotAction = null;
    }
    return;
  }

  const selectionBox = document.getElementById("selection-box");
  if (!selectionBox) return;

  selectionBox.style.display = "none";
  const finalWidth = parseFloat(selectionBox.style.width);
  const finalHeight = parseFloat(selectionBox.style.height);

  selectionBox.style.width = "0px";
  selectionBox.style.height = "0px";

  if (finalWidth < 20 || finalHeight < 20) {
    log("截图区域太小，操作已取消。");
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
 * 预处理图片元素，为截图做准备
 */
async function preprocessImagesForCapture() {
  return new Promise((resolve) => {
    const images = document.querySelectorAll("img");
    let loadedCount = 0;
    let failedCount = 0;

    if (images.length === 0) {
      resolve();
      return;
    }

    console.log(`🖼️ 预处理 ${images.length} 个图片元素...`);

    images.forEach((img, index) => {
      // 检查图片是否已经加载完成
      if (img.complete && img.naturalWidth > 0) {
        loadedCount++;
        console.log(`✅ 图片 ${index + 1} 已加载:`, img.src);
        checkAllImages();
        return;
      }

      // 为未加载的图片添加事件监听器
      const onLoad = () => {
        loadedCount++;
        console.log(`✅ 图片 ${index + 1} 加载成功:`, img.src);
        cleanup();
        checkAllImages();
      };

      const onError = (error) => {
        failedCount++;
        console.warn(`❌ 图片 ${index + 1} 加载失败:`, img.src, error);
        // 对失败的图片进行隐藏处理
        img.style.visibility = "hidden";
        cleanup();
        checkAllImages();
      };

      const cleanup = () => {
        img.removeEventListener("load", onLoad);
        img.removeEventListener("error", onError);
      };

      img.addEventListener("load", onLoad);
      img.addEventListener("error", onError);

      // 如果图片还没有src，触发加载
      if (!img.src || img.src === window.location.href) {
        console.warn(`⚠️ 图片 ${index + 1} 无有效src:`, img);
        failedCount++;
        checkAllImages();
      }
    });

    function checkAllImages() {
      if (loadedCount + failedCount === images.length) {
        console.log(
          `🖼️ 图片预处理完成: 成功 ${loadedCount}, 失败 ${failedCount}`,
        );
        // 给失败的图片一些时间隐藏
        setTimeout(resolve, 100);
      }
    }

    // 设置超时，避免无限等待
    setTimeout(() => {
      console.log("⏰ 图片预处理超时，继续截图流程");
      resolve();
    }, 5000);
  });
}

/**
 * 创建配置区域的克隆版本，确保在截图时完全可见
 * @param {HTMLElement} originalElement - 要克隆的原始元素
 * @returns {Promise<HTMLElement>} 克隆后的元素
 */
async function createVisibleClone(originalElement) {
  const clone = originalElement.cloneNode(true);

  // 创建临时容器来放置克隆元素
  const tempContainer = document.createElement("div");
  tempContainer.id = "temp-screenshot-container";
  tempContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    z-index: 9999;
    visibility: visible;
    opacity: 1;
    transform: none;
    width: ${originalElement.offsetWidth}px;
    height: ${originalElement.offsetHeight}px;
    pointer-events: none;
    background: white;
    overflow: hidden;
  `;

  // 确保克隆元素完全可见
  clone.style.cssText = `
    position: relative;
    top: 0;
    left: 0;
    transform: none;
    visibility: visible;
    opacity: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
  `;

  // 复制所有计算样式到克隆元素
  const computedStyles = window.getComputedStyle(originalElement);
  const importantStyles = [
    "font-family",
    "font-size",
    "font-weight",
    "color",
    "background-color",
    "border",
    "padding",
    "margin",
    "width",
    "height",
    "display",
    "position",
  ];

  importantStyles.forEach((style) => {
    clone.style.setProperty(
      style,
      computedStyles.getPropertyValue(style),
      "important",
    );
  });

  tempContainer.appendChild(clone);
  document.body.appendChild(tempContainer);

  // 等待克隆元素完全渲染
  await new Promise((resolve) => {
    // 强制重排
    tempContainer.offsetHeight;
    setTimeout(resolve, 200);
  });

  return { clone, tempContainer };
}

/**
 * 清理克隆元素和临时容器
 * @param {HTMLElement} tempContainer - 临时容器
 */
function cleanupClone(tempContainer) {
  if (tempContainer && tempContainer.parentNode) {
    tempContainer.parentNode.removeChild(tempContainer);
  }
}

/**
 * 使用DOM克隆方法进行智能截图
 * @param {Object} cropOptions - 裁剪选项
 * @returns {Promise<HTMLCanvasElement>} 截图画布
 */
async function smartCloneCapture(cropOptions) {
  const configDrawer = document.getElementById("config-drawer");

  // 统一配置：强制使用 DPR=1 确保坐标一致性
  const snapdomOptions = {
    dpr: 1, // 强制使用设备像素比为1，与CSS像素坐标保持一致
    scale: 1, // 强制缩放为1
    backgroundColor: null, // 保持透明背景
    fast: true
  };

  // 添加调试信息
  console.log("[DEBUG] cropOptions:", cropOptions);
  console.log("[DEBUG] devicePixelRatio:", window.devicePixelRatio);

  if (!configDrawer) {
    // 如果配置抽屉不存在，使用原来的方法
    log("📸 未找到配置区域，使用标准截图方法...");
    const result = await snapdom(document.documentElement, snapdomOptions);
    const fullPageCanvas = await result.toCanvas();
    console.log("[DEBUG] fullPageCanvas size:", fullPageCanvas.width, "x", fullPageCanvas.height);
    return cropCanvas(fullPageCanvas, cropOptions);
  }

  const configRect = configDrawer.getBoundingClientRect();

  // 判断截图区域是否包含配置区域
  const includesConfigArea =
    cropOptions.x < configRect.right &&
    cropOptions.x + cropOptions.width > configRect.left &&
    cropOptions.y < configRect.bottom &&
    cropOptions.y + cropOptions.height > configRect.top;

  if (!includesConfigArea) {
    // 如果截图区域不包含配置区域，使用原来的方法
    log("📸 截图区域不包含配置区域，使用标准截图方法...");
    const result = await snapdom(document.documentElement, snapdomOptions);
    const fullPageCanvas = await result.toCanvas();
    return cropCanvas(fullPageCanvas, cropOptions);
  }

  log("📸 截图区域包含配置区域，使用DOM克隆方法...");

  // 创建配置区域的克隆
  const { tempContainer } = await createVisibleClone(configDrawer);

  try {
    // 等待克隆完全渲染
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 截图整个页面（现在配置区域已经是可见的克隆版本）
    const result = await snapdom(document.documentElement, snapdomOptions);
    const fullPageCanvas = await result.toCanvas();

    // 裁剪到指定区域
    const resultCanvas = cropCanvas(fullPageCanvas, cropOptions);

    return resultCanvas;
  } finally {
    // 清理克隆元素
    cleanupClone(tempContainer);
  }
}

/**
 * 裁剪画布到指定区域
 * @param {HTMLCanvasElement} sourceCanvas - 源画布
 * @param {Object} cropOptions - 裁剪选项
 * @returns {HTMLCanvasElement} 裁剪后的画布
 */
function cropCanvas(sourceCanvas, cropOptions) {
  console.log("[DEBUG] cropCanvas called with:", cropOptions);
  console.log("[DEBUG] sourceCanvas size:", sourceCanvas.width, "x", sourceCanvas.height);
  console.log("[DEBUG] scroll position:", window.scrollX || window.pageXOffset, window.scrollY || window.pageYOffset);

  const croppedCanvas = document.createElement("canvas");
  const ctx = croppedCanvas.getContext("2d");

  // 设置新画布的尺寸
  croppedCanvas.width = cropOptions.width;
  croppedCanvas.height = cropOptions.height;

  console.log("[DEBUG] croppedCanvas size:", croppedCanvas.width, "x", croppedCanvas.height);

  // 计算裁剪区域的绝对坐标（考虑页面滚动）
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;
  const sourceX = cropOptions.x + scrollX;
  const sourceY = cropOptions.y + scrollY;

  console.log("[DEBUG] calculated sourceX/Y:", sourceX, sourceY);

  // 使用 drawImage 将完整截图的指定区域绘制到新的小 canvas 上
  ctx.drawImage(
    sourceCanvas, // 源 canvas (完整截图)
    sourceX, // 源 canvas 的裁剪起始点 X
    sourceY, // 源 canvas 的裁剪起始点 Y
    cropOptions.width, // 裁剪区域的宽度
    cropOptions.height, // 裁剪区域的高度
    0, // 目标 canvas 的绘制起始点 X
    0, // 目标 canvas 的绘制起始点 Y
    cropOptions.width, // 绘制到目标 canvas 的宽度
    cropOptions.height // 绘制到目标 canvas 的高度
  );

  return croppedCanvas;
}

/**
 * 根据选定区域截图，并执行后续流程（获取GTO、显示确认框）
 */
async function captureAndProceed(cropOptions) {
  log("📸 正在根据选定区域生成快照 (使用DOM克隆方案)...");

  // 在截图前：隐藏 textarea，显示备用 div
  const consoleTextarea = document.getElementById("console-log");
  const consoleFallback = document.getElementById("console-log-fallback");

  if (consoleTextarea && consoleFallback) {
    consoleFallback.innerHTML = consoleTextarea.value.replace(/\n/g, '<br>'); // Copy content
    consoleTextarea.style.display = "none";
    consoleFallback.style.display = "block";
  }

  // 给控制台一些时间完成渲染
  await new Promise(resolve => setTimeout(resolve, 200));

  try {
    // 步骤 1: 预处理图片
    await preprocessImagesForCapture();

    // 步骤 2: 使用智能克隆截图方法
    const croppedCanvas = await smartCloneCapture(cropOptions);

    // 步骤 3: 从处理完成的画布获取图像数据
    const imageData = croppedCanvas.toDataURL("image/png");
    log("✅ 截图已生成。正在整理当前GTO建议...");

    const gameState = game.getGameState();

    const allGtoSuggestions = currentSuggestionsCache.map((item) => {
      return {
        playerId: item.playerId,
        suggestion: item.suggestion,
        request: item.request,
        phase: item.phase, // 保留阶段信息，与Vue版本保持一致
        notes: "",
      };
    });

    log("✅ 所有当前GTO建议已整理。请在弹窗中确认保存。");

    // 统一使用中国时区显示时间
    const timestamp = formatTimeChina(new Date());

    window.pendingSnapshotData = {
      timestamp: timestamp,
      gameState: gameState,
      imageData: imageData,
      allGtoSuggestions: allGtoSuggestions,
    };

    showSnapshotModal();
  } catch (error) {
    log("❌ 截图失败: " + (error.message || error.type || "未知错误"));
    console.error("截图失败:", error);
    alert(
      "截图失败，请检查控制台以获取详细错误信息。\n\n错误信息: " +
        (error.message || error.type || "未知错误"),
    );
    window.pendingSnapshotData = null;
  } finally {
    // 恢复控制台显示：显示 textarea，隐藏备用 div
    if (consoleTextarea && consoleFallback) {
      consoleTextarea.style.display = "block";
      consoleFallback.style.display = "none";
    }
  }
}

/**
 * 显示快照确认模态框
 */
function showSnapshotModal() {
  const modal = document.getElementById("snapshot-modal");
  const preview = document.getElementById("snapshot-preview");
  const nameInput = document.getElementById("snapshot-name-input"); // 获取输入框

  if (window.pendingSnapshotData && window.pendingSnapshotData.imageData) {
    preview.src = window.pendingSnapshotData.imageData;
  } else {
    preview.src = "";
  }
  if (modal) {
    modal.classList.add("is-visible");
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
  const modal = document.getElementById("snapshot-modal");
  if (modal) modal.classList.remove("is-visible");
  window.pendingSnapshotData = null;
}

/**
 * 初始化所有快照相关的事件监听器
 */
function initSnapshotModalListeners() {
  // 使用统一的安全绑定函数
  safeBindEvent(
    "save-snapshot-btn",
    handleSnapshotButtonClick,
    "未找到保存快照按钮",
  );
  safeBindEvent(
    "save-snapshot-confirm-btn",
    savePendingSnapshot,
    "未找到保存快照确认按钮",
  );
  safeBindEvent(
    "close-view-snapshot-modal-btn",
    () => {
      const modal = document.getElementById("view-snapshot-modal");
      if (modal) modal.classList.remove("is-visible");
    },
    "未找到关闭查看快照模态框按钮",
  );
  safeBindEvent(
    "save-snapshot-remarks-btn",
    saveSnapshotRemarks,
    "未找到保存快照批注按钮",
  );

  // 特殊绑定的按钮（带复杂逻辑）
  safeBindEvent(
    "cancel-snapshot-btn",
    () => {
      hideSnapshotModal();
      if (postSnapshotAction) {
        postSnapshotAction();
        postSnapshotAction = null;
      }
    },
    "未找到取消快照按钮",
  );

  safeBindEvent(
    "recapture-snapshot-btn",
    () => {
      hideSnapshotModal();
      setTimeout(initiateSnapshotProcess, 100); // 延迟以确保弹窗消失
    },
    "未找到重新截取按钮",
  );

  // 为牌局结束弹窗绑定事件
  safeBindEvent(
    "eoh-confirm-save",
    () => {
      hideEndOfHandModal();
      postSnapshotAction = stopGame; // 设置快照结束后的回调
      initiateSnapshotProcess(); // 启动快照流程
    },
    "未找到牌局结束确认保存按钮",
  );

  safeBindEvent(
    "eoh-cancel-save",
    () => {
      hideEndOfHandModal();
      stopGame(); // 直接重置游戏
    },
    "未找到牌局结束取消保存按钮",
  );

  // 为删除确认按钮绑定事件
  safeBindEvent(
    "delete-confirm-yes",
    () => {
      const popover = document.getElementById("delete-confirm-popover");
      if (popover) {
        const snapshotId = popover.dataset.snapshotId;
        if (snapshotId) {
          deleteSnapshot(snapshotId);
        }
        popover.style.display = "none";
      }
    },
    "未找到删除确认是按钮",
  );

  safeBindEvent(
    "delete-confirm-no",
    () => {
      const popover = document.getElementById("delete-confirm-popover");
      if (popover) {
        popover.style.display = "none";
      }
    },
    "未找到删除确认否按钮",
  );

  // 全局点击事件（关闭删除确认框）
  document.addEventListener("click", (e) => {
    const popover = document.getElementById("delete-confirm-popover");
    if (
      popover &&
      popover.style.display === "block" &&
      !popover.contains(e.target) &&
      !e.target.classList.contains("delete-btn")
    ) {
      popover.style.display = "none";
    }
  });

  // 新增：图片灯箱功能 - 添加安全检查
  const snapshotImage = document.getElementById("view-snapshot-image");
  const lightboxOverlay = document.getElementById("image-lightbox-overlay");
  const lightboxImage = document.getElementById("lightbox-image");

  if (snapshotImage && lightboxOverlay && lightboxImage) {
    snapshotImage.addEventListener("click", () => {
      // 确保图片src有效再打开灯箱
      if (snapshotImage.src && snapshotImage.src !== window.location.href) {
        lightboxImage.src = snapshotImage.src;
        lightboxOverlay.style.display = "flex";
      }
    });

    lightboxOverlay.addEventListener("click", () => {
      lightboxOverlay.style.display = "none";
      lightboxImage.src = ""; // 清空src，避免闪现旧图
    });
  } else {
    console.warn("图片灯箱相关元素缺失，灯箱功能将不可用");
    if (!snapshotImage) console.warn("- 缺少: view-snapshot-image");
    if (!lightboxOverlay) console.warn("- 缺少: image-lightbox-overlay");
    if (!lightboxImage) console.warn("- 缺少: lightbox-image");
  }
}

/**
 * 保存当前暂存的快照到 localStorage
 */
async function savePendingSnapshot() {
  const pendingData = window.pendingSnapshotData;
  if (!pendingData) {
    log("❌ 无法保存快照：没有待处理的快照数据。");
    hideSnapshotModal();
    return;
  }

  const nameInput = document.getElementById("snapshot-name-input");
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
    settings: JSON.stringify(Settings), // 添加牌局设置
  };

  try {
    log(`💾 正在保存快照到数据库...`);
    const savedSnapshot = await snapshotService.createSnapshot(snapshotData);
    log(
      `✅ 快照 "${savedSnapshot.name}" (ID: ${savedSnapshot.id}) 已成功保存。`,
    );

    nameInput.value = "";
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
  const snapshotListUl = document.getElementById("snapshot-list");
  if (!snapshotListUl) return;

  // 使用新的居中加载动画
  snapshotListUl.innerHTML = `
        <li class="snapshot-loading">
            <div class="snapshot-loading-spinner"></div>
            <div class="snapshot-loading-text">加载中</div>
        </li>
    `;

  try {
    const pageData = await snapshotService.getSnapshots(page, 5);
    const savedSnapshots = pageData.content;

    snapshotCurrentPage = pageData.number;
    snapshotTotalPages = pageData.totalPages;

    snapshotListUl.innerHTML = "";

    if (!savedSnapshots || savedSnapshots.length === 0) {
      snapshotListUl.innerHTML = `
                <li class="snapshot-status empty">
                    <div class="snapshot-status-icon">📷</div>
                    <div class="snapshot-status-text">暂无快照<br><small>使用保存快照功能创建第一个快照</small></div>
                </li>
            `;
      renderSnapshotPagination(null); // 清空分页
      return;
    }

    savedSnapshots.forEach((snapshot) => {
      const li = document.createElement("li");
      li.dataset.snapshotId = snapshot.id;
      // 统一使用中国时区显示快照时间
      const formattedTime = formatTimeChina(snapshot.timestamp);

      li.innerHTML = `
                <div class="snapshot-info">
                    <strong class="snapshot-name-display" data-snapshot-id="${snapshot.id}" title="${snapshot.name}">${snapshot.name}</strong><br>
                    <small>${formattedTime}</small>
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
    snapshotListUl.querySelectorAll(".view-btn").forEach((button) => {
      button.addEventListener("click", (e) => {
        const snapshotId = e.target.closest("li").dataset.snapshotId;
        showViewSnapshotModal(snapshotId);
      });
    });

    snapshotListUl.querySelectorAll(".replay-btn").forEach((button) => {
      button.addEventListener("click", (e) => {
        const snapshotId = e.target.closest("li").dataset.snapshotId;
        startReplay(snapshotId);
      });
    });

    snapshotListUl.querySelectorAll(".delete-btn").forEach((button) => {
      button.addEventListener("click", (e) => {
        const snapshotId = e.target.closest("li").dataset.snapshotId;
        showDeleteConfirmation(snapshotId, e.target);
      });
    });

    renderSnapshotPagination(pageData);
  } catch (error) {
    log(`❌ 加载快照列表失败: ${error.message}`);
    snapshotListUl.innerHTML = `
            <li class="snapshot-status error">
                <div class="snapshot-status-icon">⚠️</div>
                <div class="snapshot-status-text">列表加载失败<br><small>${error.message}</small></div>
            </li>
        `;
    renderSnapshotPagination(null); // 清空分页
  }
}

/**
 * 渲染快照列表的分页控件
 * @param {object | null} pageData 从后端获取的分页对象
 */
function renderSnapshotPagination(pageData) {
  const paginationContainer = document.getElementById(
    "snapshot-pagination-controls",
  );
  if (!paginationContainer) return;

  if (!pageData || pageData.totalPages <= 1) {
    paginationContainer.innerHTML = "";
    return;
  }

  const isFirst = pageData.first;
  const isLast = pageData.last;
  const currentPage = pageData.number; // 0-based
  const totalPages = pageData.totalPages;

  paginationContainer.innerHTML = `
        <button id="snapshot-prev-btn" class="game-control-btn secondary-btn" ${isFirst ? "disabled" : ""}>上一页</button>
        <span style="font-size: 14px; color: #555;">第 ${currentPage + 1} / ${totalPages} 页</span>
        <button id="snapshot-next-btn" class="game-control-btn secondary-btn" ${isLast ? "disabled" : ""}>下一页</button>
    `;

  if (!isFirst) {
    document
      .getElementById("snapshot-prev-btn")
      .addEventListener("click", () => {
        renderSnapshotList(currentPage - 1);
      });
  }

  if (!isLast) {
    document
      .getElementById("snapshot-next-btn")
      .addEventListener("click", () => {
        renderSnapshotList(currentPage + 1);
      });
  }
}

/**
 * 为查看快照模态框构建单个建议的HTML元素
 */
function buildSuggestionElement(suggestion, playerId, phase) {
  const suggestionWrapper = document.createElement("div");
  const title = document.createElement("h4");
  title.innerHTML = `给 ${playerId} 的建议 <span style="color: #fd971f;">[${phase.toUpperCase()}]</span>:`;
  title.style.margin = "0 0 8px 0";
  title.style.color = "#66d9ef";
  suggestionWrapper.appendChild(title);
  if (suggestion && suggestion.error) {
    suggestionWrapper.innerHTML += `<div style="color: #ff6b6b;">获取建议失败: ${suggestion.error}</div>`;
    return suggestionWrapper;
  }
  if (!suggestion) {
    suggestionWrapper.innerHTML += `<div style="color: #ff6b6b;">建议数据为空。</div>`;
    return suggestionWrapper;
  }
  if (
    (phase === "preflop" ||
      phase === "flop" ||
      phase === "turn" ||
      phase === "river") &&
    suggestion.localResult
  ) {
    try {
      const container = document.createElement("div");
      const local = suggestion.localResult;
      const createRow = (label, value) => {
        if (value === null || value === undefined || value === "") return;
        const row = document.createElement("div");
        row.style.marginBottom = "4px";
        const labelEl = document.createElement("strong");
        labelEl.textContent = `${label}: `;
        labelEl.style.color = "#a6e22e";
        row.appendChild(labelEl);
        row.appendChild(document.createTextNode(value));
        container.appendChild(row);
      };
      const createSection = (title) => {
        const titleEl = document.createElement("h5");
        titleEl.textContent = title;
        titleEl.style.color = "#f92672";
        titleEl.style.marginTop = "12px";
        titleEl.style.marginBottom = "8px";
        titleEl.style.borderBottom = "1px solid #555";
        titleEl.style.paddingBottom = "4px";
        container.appendChild(titleEl);
      };
      createSection("牌局信息");
      createRow("手牌", suggestion.myCards?.join(", "));
      if (phase !== "preflop") {
        createRow("公共牌", suggestion.boardCards?.join(", "));
        createRow("牌面", local.boardType);
        createRow("牌型", local.handType);
      }
      createSection("局势分析");
      if (phase !== "preflop") {
        createRow("位置", local.hasPosition ? "有利位置" : "不利位置");
      }
      createRow("行动场景", local.scenarioDescription);
      if (phase !== "preflop") {
        createSection("数据参考");
        if (local.equity) {
          const parts = [];
          if (local.equity.winRate !== null)
            parts.push(`胜率: ${local.equity.winRate}%`);
          if (local.equity.potOdds !== null)
            parts.push(`底池赔率: ${local.equity.potOdds}%`);
          if (local.action !== null) parts.push(`建议: ${local.action}`);
          createRow("本地计算", parts.join("， "));
        }
        if (suggestion.thirdPartyResult && suggestion.thirdPartyResult.equity) {
          const treys = suggestion.thirdPartyResult.equity;
          const parts = [];
          if (treys.winRate !== null) parts.push(`胜率: ${treys.winRate}%`);
          if (treys.potOdds !== null) parts.push(`底池赔率: ${treys.potOdds}%`);
          if (treys.action) parts.push(`建议: ${treys.action}`);
          createRow("Treys (仅作对比参考)", parts.join("， "));
        }
      }
      createSection("最终建议");
      const actionRow = document.createElement("div");
      actionRow.style.marginBottom = "4px";
      const actionLabelEl = document.createElement("strong");
      actionLabelEl.textContent = `行动: `;
      actionLabelEl.style.color = "#a6e22e";
      actionRow.appendChild(actionLabelEl);
      const actionValueEl = document.createElement("strong");
      actionValueEl.textContent = local.action;
      actionValueEl.style.color = "#e6db74";
      actionValueEl.style.fontSize = "1.2em";
      actionRow.appendChild(actionValueEl);
      container.appendChild(actionRow);
      const reasonRow = document.createElement("div");
      reasonRow.style.lineHeight = "1.6";
      reasonRow.style.marginTop = "4px";
      const reasonLabelEl = document.createElement("strong");
      reasonLabelEl.textContent = "理由: ";
      reasonLabelEl.style.color = "#a6e22e";
      reasonRow.appendChild(reasonLabelEl);
      const reasoningText =
        phase === "preflop"
          ? local.reasoning || local.description || ""
          : `(以本地计算为准) ${local.reasoning || ""}`;
      reasonRow.appendChild(document.createTextNode(reasoningText));
      container.appendChild(reasonRow);
      suggestionWrapper.appendChild(container);
    } catch (e) {
      console.error(`Error formatting ${phase} suggestion:`, e, suggestion);
      const pre = document.createElement("pre");
      pre.style.margin = "0";
      pre.style.whiteSpace = "pre-wrap";
      pre.style.wordBreak = "break-all";
      pre.textContent = JSON.stringify(suggestion, null, 2);
      suggestionWrapper.appendChild(pre);
    }
  } else {
    const pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.wordBreak = "break-all";
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
    snapshot.allGtoSuggestions = JSON.parse(snapshot.gtoSuggestions || "[]");

    const modal = document.getElementById("view-snapshot-modal");
    const titleEl = document.getElementById("view-snapshot-title");
    const imageEl = document.getElementById("view-snapshot-image");
    const suggestionsListEl = document.getElementById(
      "view-snapshot-suggestions-list",
    );
    const filterContainer = document.getElementById(
      "snapshot-suggestion-filter-container",
    );

    // 更新标题
    if (titleEl) {
      titleEl.textContent = `${snapshot.name}`;
    }

    // 清空旧内容
    suggestionsListEl.innerHTML = "";
    filterContainer.innerHTML = "";
    modal.dataset.snapshotId = snapshotId;
    imageEl.src = snapshot.imageData;

    if (snapshot.allGtoSuggestions && snapshot.allGtoSuggestions.length > 0) {
      const playerIdsInSnapshot = [
        ...new Set(snapshot.allGtoSuggestions.map((s) => s.playerId)),
      ].sort();
      const snapshotFilterState = new Set(playerIdsInSnapshot);

      const filterTitle = document.createElement("strong");
      filterTitle.textContent = "筛选:";
      filterTitle.style.marginRight = "10px";
      filterContainer.appendChild(filterTitle);

      playerIdsInSnapshot.forEach((playerId) => {
        const label = document.createElement("label");
        label.style.cursor = "pointer";
        label.style.userSelect = "none";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = playerId;
        checkbox.checked = true;
        checkbox.style.marginRight = "4px";

        checkbox.addEventListener("change", (event) => {
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

      // 按阶段分组建议
      const phaseSuggestions = new Map();

      // 遍历建议数组，按阶段组织
      snapshot.allGtoSuggestions.forEach((suggestionData, index) => {
        const { playerId, suggestion, notes } = suggestionData;

        // 获取阶段信息，优先使用存储的phase信息
        let phase = "unknown";
        if (suggestionData.phase) {
          phase = suggestionData.phase; // 优先使用存储的phase信息
        } else {
          const phaseStr =
            suggestion?.localResult?.strategyPhase?.toLowerCase() ||
            suggestion?.phase?.toLowerCase() ||
            suggestion?.response?.gameState?.currentRound?.toLowerCase() ||
            "unknown";
          phase = phaseStr.replace("_", "");
        }

        if (!phaseSuggestions.has(phase)) {
          phaseSuggestions.set(phase, []);
        }

        phaseSuggestions.get(phase).push({
          playerId,
          suggestion,
          notes,
          index,
        });
      });

      // 按阶段顺序创建容器
      const phaseOrder = ["river", "turn", "flop", "preflop"]; // 最新阶段在前

      phaseOrder.forEach((phase) => {
        if (phaseSuggestions.has(phase)) {
          const suggestions = phaseSuggestions.get(phase);

          // 创建阶段容器
          const phaseContainer = document.createElement("div");
          phaseContainer.className = "snapshot-phase-container";
          phaseContainer.dataset.phase = phase;

          // 添加阶段标题
          const phaseTitle = document.createElement("h3");
          phaseTitle.className = "snapshot-phase-title";
          phaseTitle.textContent = phase.toUpperCase();
          phaseContainer.appendChild(phaseTitle);

          // 添加该阶段的所有建议
          suggestions.forEach((suggestionData) => {
            const { playerId, suggestion, notes, index } = suggestionData;
            const itemWrapper = document.createElement("div");
            itemWrapper.className = "snapshot-suggestion-item";
            itemWrapper.dataset.playerId = playerId;

            const suggestionContent = document.createElement("div");
            suggestionContent.className = "snapshot-suggestion-content";
            const suggestionElement = buildSuggestionElement(
              suggestion,
              playerId,
              phase,
            );
            suggestionContent.appendChild(suggestionElement);

            const notesContainer = document.createElement("div");
            notesContainer.className = "snapshot-suggestion-notes";
            const notesTextarea = document.createElement("textarea");
            notesTextarea.placeholder = `关于 ${playerId} 建议的批注...`;
            notesTextarea.value = notes || "";
            notesTextarea.dataset.playerId = playerId;
            notesTextarea.dataset.suggestionIndex = index;
            notesContainer.appendChild(notesTextarea);

            itemWrapper.appendChild(suggestionContent);
            itemWrapper.appendChild(notesContainer);
            phaseContainer.appendChild(itemWrapper);
          });

          suggestionsListEl.appendChild(phaseContainer);
        }
      });

      // 处理其他未知阶段的建议
      for (const [phase, suggestions] of phaseSuggestions) {
        if (!phaseOrder.includes(phase)) {
          const phaseContainer = document.createElement("div");
          phaseContainer.className = "snapshot-phase-container";
          phaseContainer.dataset.phase = phase;

          const phaseTitle = document.createElement("h3");
          phaseTitle.className = "snapshot-phase-title";
          phaseTitle.textContent = phase.toUpperCase();
          phaseContainer.appendChild(phaseTitle);

          suggestions.forEach((suggestionData) => {
            const { playerId, suggestion, notes, index } = suggestionData;
            const itemWrapper = document.createElement("div");
            itemWrapper.className = "snapshot-suggestion-item";
            itemWrapper.dataset.playerId = playerId;

            const suggestionContent = document.createElement("div");
            suggestionContent.className = "snapshot-suggestion-content";
            const suggestionElement = buildSuggestionElement(
              suggestion,
              playerId,
              phase,
            );
            suggestionContent.appendChild(suggestionElement);

            const notesContainer = document.createElement("div");
            notesContainer.className = "snapshot-suggestion-notes";
            const notesTextarea = document.createElement("textarea");
            notesTextarea.placeholder = `关于 ${playerId} 建议的批注...`;
            notesTextarea.value = notes || "";
            notesTextarea.dataset.playerId = playerId;
            notesTextarea.dataset.suggestionIndex = index;
            notesContainer.appendChild(notesTextarea);

            itemWrapper.appendChild(suggestionContent);
            itemWrapper.appendChild(notesContainer);
            phaseContainer.appendChild(itemWrapper);
          });

          suggestionsListEl.appendChild(phaseContainer);
        }
      }

      const updateVisibility = () => {
        suggestionsListEl
          .querySelectorAll(".snapshot-suggestion-item")
          .forEach((item) => {
            const itemPlayerId = item.dataset.playerId;
            item.style.display = snapshotFilterState.has(itemPlayerId)
              ? "flex"
              : "none";
          });
      };
    } else {
      suggestionsListEl.innerHTML =
        '<p style="text-align: center; padding: 20px;">此快照没有保存GTO建议。</p>';
    }

    modal.classList.add("is-visible");
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
  const existingToast = document.querySelector(".toast-notification");
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement("div");
  toast.className = "toast-notification";
  if (isError) {
    toast.classList.add("error");
  }
  toast.textContent = message;

  document.body.appendChild(toast);

  // 触发 "show" 动画
  setTimeout(() => {
    toast.classList.add("show");
  }, 10); // 短暂延迟以确保CSS过渡生效

  // 在指定时长后隐藏并移除 toast
  setTimeout(() => {
    toast.classList.remove("show");
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
  const modal = document.getElementById("view-snapshot-modal");
  const snapshotId = modal.dataset.snapshotId;
  const saveBtn = document.getElementById("save-snapshot-remarks-btn");

  if (!snapshotId) {
    log("❌ 保存批注失败：无法识别快照ID。");
    showToast("保存失败：无快照ID", 3000, true);
    return;
  }

  // 创建保存动画的函数
  const createSavingAnimation = () => {
    const spinner = document.createElement("span");
    spinner.className = "saving-spinner";
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
  saveBtn.innerHTML = `${originalText.split("保存")[0]}保存中...`;
  saveBtn.appendChild(createSavingAnimation());

  // 添加保存中样式类
  saveBtn.classList.add("saving");

  // 获取所有文本区域并添加保存中的视觉效果
  const textareas = modal.querySelectorAll(
    "#view-snapshot-suggestions-list textarea",
  );
  textareas.forEach((textarea) => {
    textarea.style.backgroundColor = "#f0f8ff"; // 淡蓝色背景
    textarea.style.border = "1px solid #007bff"; // 蓝色边框
    textarea.style.cursor = "not-allowed";
    textarea.disabled = true; // 禁用编辑
  });

  try {
    // 1. 获取最新的快照数据
    const snapshot = await snapshotService.getSnapshotById(snapshotId);
    const allGtoSuggestions = JSON.parse(snapshot.gtoSuggestions || "[]");

    // 2. 根据索引更新批注
    let remarksChanged = false;
    textareas.forEach((textarea) => {
      const index = parseInt(textarea.dataset.suggestionIndex, 10);
      if (!isNaN(index) && allGtoSuggestions[index]) {
        if ((allGtoSuggestions[index].notes || "") !== textarea.value) {
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
      const dotsContainer = saveBtn.querySelector(".saving-dots");
      dotsContainer.style.cssText = `
                display: inline-block;
                margin-left: 4px;
            `;

      // 创建点点动画
      let dotCount = 0;
      const dotsInterval = setInterval(() => {
        dotCount = (dotCount + 1) % 4;
        dotsContainer.textContent = ".".repeat(dotCount);
      }, 500);

      const updateData = { gtoSuggestions: JSON.stringify(allGtoSuggestions) };
      await snapshotService.updateSnapshot(snapshotId, updateData);

      // 清除点点动画
      clearInterval(dotsInterval);

      // 清除保存中状态，显示成功动画
      saveBtn.classList.remove("saving");
      saveBtn.style.backgroundColor = "#28a745";
      saveBtn.style.color = "white";
      saveBtn.style.animation = "success-bounce 1s ease";
      saveBtn.innerHTML = "✅ 保存成功";

      log(`✅ 快照 (ID: ${snapshotId}) 的批注已保存。`);
      showToast("批注保存成功！");

      // 1.5秒后恢复按钮状态
      setTimeout(() => {
        restoreButtonState();
      }, 1500);
    } else {
      log("ℹ️ 批注没有变化。");
      saveBtn.classList.remove("saving");
      saveBtn.innerHTML = "ℹ️ 无变化";
      saveBtn.style.backgroundColor = "#ffc107";
      saveBtn.style.color = "black";
      showToast("批注没有变化", 1500);

      // 1秒后恢复按钮状态
      setTimeout(() => {
        restoreButtonState();
      }, 1000);
    }
  } catch (error) {
    log(`❌ 保存批注失败: ${error.message}`);

    // 显示错误动画
    saveBtn.classList.remove("saving");
    saveBtn.innerHTML = "❌ 保存失败";
    saveBtn.style.backgroundColor = "#dc3545";
    saveBtn.style.color = "white";
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
    saveBtn.style.backgroundColor = "";
    saveBtn.style.color = "";
    saveBtn.style.animation = "";
    saveBtn.classList.remove("saving");

    // 恢复文本区域的状态
    textareas.forEach((textarea) => {
      textarea.style.backgroundColor = "";
      textarea.style.border = "";
      textarea.style.cursor = "";
      textarea.disabled = false;
    });
  }
}

/**
 * 显示删除快照的自定义确认框
 */
function showDeleteConfirmation(snapshotId, buttonElement) {
  const popover = document.getElementById("delete-confirm-popover");
  if (!popover) return;
  popover.dataset.snapshotId = snapshotId;
  const btnRect = buttonElement.getBoundingClientRect();
  popover.style.display = "block";
  let top = btnRect.top - popover.offsetHeight - 10;
  let left = btnRect.left + btnRect.width / 2 - popover.offsetWidth / 2;
  if (top < 0) top = btnRect.bottom + 10;
  if (left < 0) left = 5;
  if (left + popover.offsetWidth > window.innerWidth)
    left = window.innerWidth - popover.offsetWidth - 5;
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
  const display = document.getElementById("suggestion-display");
  if (display.textContent.includes("等待玩家行动...")) {
    display.innerHTML = "";
  }
  let phaseContainer = document.getElementById(`phase-container-${phase}`);
  if (!phaseContainer) {
    phaseContainer = document.createElement("div");
    phaseContainer.id = `phase-container-${phase}`;
    phaseContainer.style.marginBottom = "20px";
    const phaseTitle = document.createElement("h3");
    phaseTitle.textContent = phase.toUpperCase();
    phaseTitle.style.color = "#fd971f";
    phaseTitle.style.borderBottom = "1px solid #fd971f";
    phaseTitle.style.paddingBottom = "5px";
    phaseTitle.style.marginBottom = "10px";
    phaseContainer.appendChild(phaseTitle);
    // 将新阶段容器插入到最前面，让最新阶段显示在顶部
    display.insertBefore(phaseContainer, display.firstChild);
  }
  if (!suggestion) {
    phaseContainer.innerHTML += `<div style="color: #ff6b6b; margin-left: 10px;">为 ${playerId} 获取建议失败或建议为空。</div>`;
    display.scrollTop = 0; // 滚动到顶部显示最新内容
    return;
  }
  const suggestionWrapper = document.createElement("div");
  suggestionWrapper.classList.add("gto-suggestion-for-player");
  suggestionWrapper.dataset.playerId = playerId;
  suggestionWrapper.style.marginBottom = "15px";
  suggestionWrapper.style.borderBottom = "1px solid #444";
  suggestionWrapper.style.paddingBottom = "10px";
  suggestionWrapper.style.marginLeft = "10px";
  if (!gtoSuggestionFilter.has(playerId)) {
    suggestionWrapper.style.display = "none";
  }
  const title = document.createElement("h4");
  title.innerHTML = `给 ${playerId} 的建议 (${new Date().toLocaleTimeString()}) <span style="color: #fd971f;">[${phase.toUpperCase()}]</span>:`;
  title.style.margin = "0 0 5px 0";
  title.style.color = "#66d9ef";
  suggestionWrapper.appendChild(title);
  if (
    (phase === "preflop" ||
      phase === "flop" ||
      phase === "turn" ||
      phase === "river") &&
    suggestion.localResult
  ) {
    try {
      const container = document.createElement("div");
      const local = suggestion.localResult;
      const createRow = (label, value) => {
        if (value === null || value === undefined || value === "") return;
        const row = document.createElement("div");
        row.style.marginBottom = "4px";
        const labelEl = document.createElement("strong");
        labelEl.textContent = `${label}: `;
        labelEl.style.color = "#a6e22e";
        row.appendChild(labelEl);
        row.appendChild(document.createTextNode(value));
        container.appendChild(row);
      };
      const createSection = (title) => {
        const titleEl = document.createElement("h5");
        titleEl.textContent = title;
        titleEl.style.color = "#f92672";
        titleEl.style.marginTop = "12px";
        titleEl.style.marginBottom = "8px";
        titleEl.style.borderBottom = "1px solid #555";
        titleEl.style.paddingBottom = "4px";
        container.appendChild(titleEl);
      };
      createSection("牌局信息");
      createRow("手牌", suggestion.myCards?.join(", "));
      if (phase !== "preflop") {
        createRow("公共牌", suggestion.boardCards?.join(", "));
        createRow("牌面", local.boardType);
        createRow("牌型", local.handType);
      }
      createSection("局势分析");
      if (phase !== "preflop") {
        createRow("位置", local.hasPosition ? "有利位置" : "不利位置");
      }
      createRow("行动场景", local.scenarioDescription);
      if (phase !== "preflop") {
        createSection("数据参考");
        if (local.equity) {
          const parts = [];
          if (local.equity.winRate !== null)
            parts.push(`胜率: ${local.equity.winRate}%`);
          if (local.equity.potOdds !== null)
            parts.push(`底池赔率: ${local.equity.potOdds}%`);
          if (local.action !== null) parts.push(`建议: ${local.action}`);
          createRow("本地计算", parts.join("， "));
        }
        if (suggestion.thirdPartyResult && suggestion.thirdPartyResult.equity) {
          const treys = suggestion.thirdPartyResult.equity;
          const parts = [];
          if (treys.winRate !== null) parts.push(`胜率: ${treys.winRate}%`);
          if (treys.potOdds !== null) parts.push(`底池赔率: ${treys.potOdds}%`);
          if (treys.action) parts.push(`建议: ${treys.action}`);
          createRow("Treys (仅作对比参考)", parts.join("， "));
        }
      }
      createSection("最终建议");
      const actionRow = document.createElement("div");
      actionRow.style.marginBottom = "4px";
      const actionLabelEl = document.createElement("strong");
      actionLabelEl.textContent = `行动: `;
      actionLabelEl.style.color = "#a6e22e";
      actionRow.appendChild(actionLabelEl);
      const actionValueEl = document.createElement("strong");
      actionValueEl.textContent = local.action;
      actionValueEl.style.color = "#e6db74";
      actionValueEl.style.fontSize = "1.2em";
      actionRow.appendChild(actionValueEl);
      container.appendChild(actionRow);
      const reasonRow = document.createElement("div");
      reasonRow.style.lineHeight = "1.6";
      reasonRow.style.marginTop = "4px";
      const reasonLabelEl = document.createElement("strong");
      reasonLabelEl.textContent = "理由: ";
      reasonLabelEl.style.color = "#a6e22e";
      reasonRow.appendChild(reasonLabelEl);
      const reasoningText =
        phase === "preflop"
          ? local.reasoning || local.description || ""
          : `(以本地计算为准) ${local.reasoning || ""}`;
      reasonRow.appendChild(document.createTextNode(reasoningText));
      container.appendChild(reasonRow);
      suggestionWrapper.appendChild(container);
    } catch (e) {
      console.error(`Error formatting ${phase} suggestion:`, e, suggestion);
      const pre = document.createElement("pre");
      pre.style.margin = "0";
      pre.style.whiteSpace = "pre-wrap";
      pre.style.wordBreak = "break-all";
      pre.textContent = JSON.stringify(suggestion, null, 2);
      suggestionWrapper.appendChild(pre);
    }
  } else {
    const pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.wordBreak = "break-all";
    pre.textContent = JSON.stringify(suggestion, null, 2);
    suggestionWrapper.appendChild(pre);
  }
  phaseContainer.appendChild(suggestionWrapper);

  // 将新建议插入到阶段容器的最前面，让最新建议显示在顶部
  const firstSuggestion = phaseContainer.querySelector(
    ".gto-suggestion-for-player",
  );
  if (firstSuggestion && firstSuggestion !== suggestionWrapper) {
    phaseContainer.insertBefore(suggestionWrapper, firstSuggestion);
  }

  display.scrollTop = 0; // 滚动到顶部显示最新内容
}

/**
 * 显示牌局结束的确认弹窗
 */
function showEndOfHandModal() {
  const modal = document.getElementById("end-of-hand-modal");
  if (modal) modal.classList.add("is-visible");
}

/**
 * 隐藏牌局结束的确认弹窗
 */
function hideEndOfHandModal() {
  const modal = document.getElementById("end-of-hand-modal");
  if (modal) modal.classList.remove("is-visible");
}

// 显示全局加载动画
function showLoader() {
  const loader = document.getElementById("global-loader-overlay");
  if (loader) {
    loader.style.display = "flex";
  }
}

// 隐藏全局加载动画
function hideLoader() {
  const loader = document.getElementById("global-loader-overlay");
  if (loader) {
    loader.style.display = "none";
  }
}

function endGame() {
  log("🎉 牌局结束！");
  // Use a timeout to allow the final UI updates to render before showing the modal.
  setTimeout(showEndOfHandModal, 500);
}

// ========== 新手动模式功能 V2 ==========

function hideAllActionPopups() {
  document.querySelectorAll(".player-action-popup").forEach((p) => {
    p.style.display = "none";
    const sliderOverlay = p.querySelector(".amount-slider-overlay");
    if (sliderOverlay) {
      sliderOverlay.style.display = "none";
    }
  });
  isWaitingForManualInput = false;
}

function adjustPopupPosition(popup) {
  const table = document.querySelector(".poker-table");
  if (!table || !popup) return;
  requestAnimationFrame(() => {
    popup.style.margin = "0";
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
  const playerElement = document.querySelector(
    `.player[data-player="${playerId}"]`,
  );
  if (!playerElement) return;
  const popup = playerElement.querySelector(".player-action-popup");
  const actionPanel = popup.querySelector(".action-panel");
  const sliderOverlay = popup.querySelector(".amount-slider-overlay");
  popup.style.transform = "translate(-50%, -50%)";
  const betRaiseBtn = popup.querySelector(".bet-raise");
  const checkCallBtn = popup.querySelector(".check-call");
  const foldBtn = popup.querySelector(".fold");
  const quickBetContainer = popup.querySelector(".quick-bet-sizes");
  const mainButtonsContainer = popup.querySelector(".main-action-buttons");
  const quickBetBtns = popup.querySelectorAll(".quick-bet-sizes button");
  const gameState = game.getGameState();
  const player = gameState.players.find((p) => p.id === playerId);
  const toCall = gameState.highestBet - player.bet;
  quickBetContainer.style.display = "block";
  mainButtonsContainer.style.justifyContent = "center";
  betRaiseBtn.style.display = "block";
  checkCallBtn.style.display = "block";
  foldBtn.style.display = "block";
  if (toCall > 0 && player.stack < toCall) {
    quickBetContainer.style.display = "none";
    betRaiseBtn.style.display = "none";
    checkCallBtn.textContent = "ALL-IN";
    checkCallBtn.dataset.action = "ALLIN";
    mainButtonsContainer.style.justifyContent = "space-around";
  } else if (toCall === 0) {
    checkCallBtn.textContent = "让牌";
    checkCallBtn.dataset.action = "CHECK";
    if (gameState.highestBet > 0) {
      betRaiseBtn.textContent = "加注";
      betRaiseBtn.dataset.action = "RAISE";
    } else {
      betRaiseBtn.textContent = "下注";
      betRaiseBtn.dataset.action = "BET";
    }
  } else {
    checkCallBtn.textContent = "跟注";
    checkCallBtn.dataset.action = "CALL";
    const minRaiseToAmount = gameState.highestBet + gameState.lastRaiseAmount;
    const playerTotalChips = player.stack + player.bet;
    if (playerTotalChips <= minRaiseToAmount) {
      betRaiseBtn.textContent = "ALL-IN";
      betRaiseBtn.dataset.action = "ALLIN";
      quickBetContainer.style.display = "none";
    } else {
      betRaiseBtn.textContent = "加注";
      betRaiseBtn.dataset.action = "RAISE";
    }
  }
  if (quickBetContainer.style.display !== "none") {
    const pot = gameState.pot;
    const actionForQuickBet = toCall === 0 ? "BET" : "RAISE";
    const playerTotalChips = player.stack + player.bet;
    quickBetBtns.forEach((btn) => {
      const multiplier = parseFloat(btn.dataset.sizeMultiplier);
      let idealAmount = 0;
      if (actionForQuickBet === "BET") {
        idealAmount = Math.round(pot * multiplier);
      } else {
        // RAISE
        const potAfterCall = pot + toCall;
        idealAmount = toCall + Math.round(potAfterCall * multiplier);
      }
      const minBet = Settings.bb;
      const minRaiseTo = gameState.highestBet + gameState.lastRaiseAmount;
      const validatedIdealAmount =
        actionForQuickBet === "BET"
          ? Math.max(idealAmount, minBet)
          : Math.max(idealAmount, minRaiseTo);
      btn.querySelector("small").textContent =
        validatedIdealAmount > 0 ? validatedIdealAmount : "-";
      if (validatedIdealAmount > playerTotalChips) {
        btn.disabled = true;
        btn.dataset.amount = playerTotalChips;
      } else {
        btn.disabled = false;
        btn.dataset.amount = validatedIdealAmount;
      }
    });
  }
  actionPanel.style.display = "flex";
  sliderOverlay.style.display = "none";
  popup.style.display = "flex";
  adjustPopupPosition(popup);
  isWaitingForManualInput = true;
}

function showVerticalSlider(playerId, action) {
  const playerElement = document.querySelector(
    `.player[data-player="${playerId}"]`,
  );
  const popup = playerElement.querySelector(".player-action-popup");
  const actionPanel = popup.querySelector(".action-panel");
  const sliderOverlay = popup.querySelector(".amount-slider-overlay");
  const slider = sliderOverlay.querySelector(".bet-slider-input");
  actionPanel.style.display = "none";
  sliderOverlay.style.display = "flex";
  slider.dataset.action = action;
  const gameState = game.getGameState();
  const player = gameState.players.find((p) => p.id === playerId);
  let minAmount, maxAmount;
  if (action === "BET") {
    minAmount = Math.min(Settings.bb, player.stack);
    maxAmount = player.stack;
  } else {
    // RAISE
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
  const playerElement = document.querySelector(
    `.player[data-player="${playerId}"]`,
  );
  const popup = playerElement.querySelector(".player-action-popup");
  const amountLabel = popup.querySelector(".slider-value-display");
  const confirmBtn = popup.querySelector(".confirm-bet");
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
    const rawAmount = min + range * (percentage / 100);
    finalAmount = Math.round(rawAmount / 10) * 10;
  }
  finalAmount = Math.max(min, Math.min(finalAmount, max));
  slider.dataset.finalAmount = finalAmount;
  if (finalAmount === max) {
    amountLabel.textContent = `ALL-IN ${finalAmount}`;
    confirmBtn.textContent = "ALL-IN";
  } else {
    amountLabel.textContent = finalAmount;
    confirmBtn.textContent = "确定";
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
    const player = game.players.find((p) => p.id === playerId);
    let displayAction = action;
    let actionAmount =
      action === "CALL" || action === "CHECK" || action === "FOLD"
        ? undefined
        : amount;
    if (player && actionAmount !== undefined) {
      if (player.stack + player.bet === actionAmount) {
        displayAction = "ALLIN";
      }
    } else if (player && action === "ALLIN" && actionAmount === undefined) {
      actionAmount = player.stack + player.bet;
    }
    game.executeAction(currentPlayerId, action, amount);
    log(
      `[${game.currentRound}] ${currentPlayerId} ${displayAction}${actionAmount ? " " + actionAmount : ""}`,
    );
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
  const tableBody = document.getElementById("action-sheet-body");
  tableBody.innerHTML = "";
  const playerCount = Settings.playerCount;
  for (let i = 0; i < playerCount; i++) {
    const playerId = `P${i + 1}`;
    const row = document.createElement("tr");
    let rowHtml = `<td style="border: 1px solid #ddd; padding: 6px; text-align: center; font-weight: bold;">${playerId}</td>`;
    const stages = ["preflop", "flop", "turn", "river"];
    stages.forEach((stage) => {
      for (let j = 0; j < 4; j++) {
        rowHtml += `<td style="border: 1px solid #ddd; padding: 6px; text-align: center;">-</td>`;
      }
    });
    row.innerHTML = rowHtml;
    tableBody.appendChild(row);
  }
}

function renderActionSheet() {
  const tableBody = document.getElementById("action-sheet-body");
  tableBody.innerHTML = "";
  const playerCount = Settings.playerCount;
  const players = game.players;
  const sbIndex = game.sbIndex;
  actionRecords = {};
  players.forEach((player) => {
    actionRecords[player.id] = { preflop: [], flop: [], turn: [], river: [] };
  });
  for (let i = 0; i < playerCount; i++) {
    const playerIndex = (sbIndex + i) % playerCount;
    const player = players[playerIndex];
    const playerId = player.id;
    const playerRole = player.role || "";
    const row = document.createElement("tr");
    let rowHtml = `<td style="border: 1px solid #ddd; padding: 6px; text-align: center; font-weight: bold;">${playerId} (${playerRole})</td>`;
    const stages = ["preflop", "flop", "turn", "river"];
    stages.forEach((stage) => {
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
    round: game.currentRound,
  });
}

/**
 * (重构) 仅将动作更新到 UI 的行动表上
 */
function updateActionSheetUI(playerId, action, amount) {
  const currentStage = (game.currentRound || "").toLowerCase();
  if (!actionRecords[playerId] || !actionRecords[playerId][currentStage])
    return;
  let actionText = action;
  if (
    (action === "CALL" || action === "RAISE" || action === "BET") &&
    amount !== undefined &&
    amount !== null
  ) {
    actionText += ` ${amount}`;
  }
  const actionCount = actionRecords[playerId][currentStage].length;
  if (actionCount >= 4) return;
  actionRecords[playerId][currentStage].push(actionText);
  const cell = document.getElementById(
    `${playerId}-${currentStage}-${actionCount}`,
  );
  if (cell) {
    cell.textContent = actionText;
  }
}

function getCardImagePath(cardText) {
  if (!cardText) return "";
  const suit = cardText[0];
  const rank = cardText.slice(1);
  const suitMap = { "♠": "S", "♥": "H", "♦": "D", "♣": "C" };
  const suitLetter = suitMap[suit] || "";
  return `cards/${rank}${suitLetter}.png`;
}

function setCardImage(cardElement, cardText) {
  if (!cardElement) return;
  cardElement.style.backgroundImage = cardText
    ? `url(${getCardImagePath(cardText)})`
    : "";
}

function updateUI(options = {}) {
  const isInitialDeal = options.isInitialDeal || false;
  const gameState = game.getGameState();
  document.querySelectorAll(".player").forEach((el) => {
    const playerId = el.dataset.player;
    const player = gameState.players.find((p) => p.id === playerId);
    if (!player) return;
    el.classList.toggle("active", playerId === gameState.currentPlayerId);
    el.classList.toggle("folded", player.isFolded);
    const cardEls = el.querySelectorAll(".hole-card");
    if (cardEls.length >= 2) {
      const shouldAnimate = isInitialDeal && !Settings.usePresetHands;
      if (shouldAnimate) {
        [cardEls[0], cardEls[1]].forEach((cardEl, index) => {
          const cardText = player.holeCards[index];
          if (cardText) {
            setCardImage(cardEl, cardText);
            cardEl.classList.add("card-dealt-anim");
            setTimeout(() => cardEl.classList.remove("card-dealt-anim"), 500);
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
    const stackEl = el.querySelector(".stack");
    if (stackEl) stackEl.textContent = player.stack;
    const betEl = el.querySelector(".player-bet");
    if (betEl) {
      betEl.textContent = player.bet > 0 ? `Bet: ${player.bet}` : "";
      betEl.style.display = player.bet > 0 ? "block" : "none";
    }
    const roleEl = el.querySelector(".player-role");
    if (roleEl) roleEl.textContent = player.role || "";
  });
  const communityCardEls = document.querySelectorAll(".community-card");
  communityCardEls.forEach((el, i) => {
    const cardText = gameState.communityCards[i];
    const shouldAnimate = !el.style.backgroundImage && cardText;
    setCardImage(el, cardText);
    if (shouldAnimate) {
      el.classList.add("card-dealt-anim");
      setTimeout(() => el.classList.remove("card-dealt-anim"), 500);
    }
  });
  document.getElementById("pot-amount").textContent = gameState.pot;
}

function showActionBubble(playerId, action, amount) {
  const playerEl = document.querySelector(`.player[data-player="${playerId}"]`);
  if (!playerEl) return;
  const bubble = playerEl.querySelector(".action-bubble");
  if (!bubble) return;
  let text = action;
  if (amount) {
    text += ` ${amount}`;
  }
  bubble.textContent = text;
  bubble.classList.remove("show", "fade-out");
  void bubble.offsetWidth; // Trigger reflow
  bubble.classList.add("show");
  setTimeout(() => {
    bubble.classList.add("fade-out");
  }, 1500);
}

function log(message) {
  const time = new Date().toLocaleTimeString();
  consoleLog.value += `[${time}] ${message}\n`;
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

function injectStyles() {
  const style = document.createElement("style");
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

        /* 快照建议阶段分组样式 */
        .snapshot-phase-container {
            margin-bottom: 20px;
            background: #f9f9f9;
            border-radius: 4px;
            padding: 10px;
        }

        .snapshot-phase-title {
            color: #fd971f !important;
            border-bottom: 1px solid #fd971f !important;
            padding-bottom: 5px;
            margin-bottom: 10px;
            margin-top: 0;
            font-size: 1.2em;
            font-weight: bold;
            background: #f9f9f9;
        }

        .snapshot-suggestion-item {
            margin-left: 10px;
            margin-bottom: 10px;
        }
    `;
  document.head.appendChild(style);
}

// ========== Main Execution ==========
// 统一的初始化入口，确保只执行一次
(function () {
  let isInitialized = false;

  function initWhenReady() {
    if (isInitialized) {
      console.warn("初始化已执行，跳过重复调用");
      return;
    }

    isInitialized = true;

    // 调试信息
    console.log("Init started at:", new Date().toISOString());
    console.log("Document ready state:", document.readyState);
    console.log("Body children count:", document.body.children.length);

    init();
  }

  // 针对QQ浏览器的延迟优化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
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
  // 播放/暂停、重置、退出按钮直接绑定
  safeBindEvent(
    "replay-play-pause-btn",
    playPauseReplay,
    "未找到播放/暂停按钮",
  );
  safeBindEvent("replay-reset-btn", resetReplay, "未找到重置按钮");
  safeBindEvent("replay-exit-btn", exitReplay, "未找到退出按钮");

  // 上一步/下一步按钮需要包装为手动点击
  safeBindEvent(
    "replay-next-btn",
    () => nextReplayStep(true),
    "未找到下一步按钮",
  );
  safeBindEvent("replay-prev-btn", prevReplayStep, "未找到上一步按钮");
}

/**
 * 更新回放控制按钮的启用/禁用状态
 * @param {Object} options - 按钮状态配置
 */
function updateReplayButtonStates(options = {}) {
  const playPauseBtn = document.getElementById("replay-play-pause-btn");
  const nextBtn = document.getElementById("replay-next-btn");
  const prevBtn = document.getElementById("replay-prev-btn");
  const resetBtn = document.getElementById("replay-reset-btn");
  const exitBtn = document.getElementById("replay-exit-btn");

  if (!playPauseBtn || !nextBtn || !prevBtn || !resetBtn || !exitBtn) return;

  // 播放/暂停按钮总是可用
  playPauseBtn.disabled = false;

  // 根据选项设置其他按钮状态
  nextBtn.disabled = options.disableNext || false;
  prevBtn.disabled = options.disablePrev || false;
  resetBtn.disabled = options.disableReset || false;
  exitBtn.disabled = options.disableExit || false;

  // 自动播放时禁用手动控制按钮
  if (options.isPlaying) {
    nextBtn.disabled = true;
    prevBtn.disabled = true;
    resetBtn.disabled = true;
  }

  // 根据回放位置禁用相应按钮
  if (options.atBeginning) {
    prevBtn.disabled = true;
  }
  if (options.atEnd) {
    nextBtn.disabled = true;
  }

  console.log("[DEBUG] Replay button states updated:", {
    isPlaying: options.isPlaying,
    disableNext: nextBtn.disabled,
    disablePrev: prevBtn.disabled,
    disableReset: resetBtn.disabled,
    disableExit: exitBtn.disabled,
    atBeginning: options.atBeginning,
    atEnd: options.atEnd,
    nextBtnClass: nextBtn.className,
    prevBtnClass: prevBtn.className,
    resetBtnClass: resetBtn.className,
    exitBtnClass: exitBtn.className,
  });
}

/**
 * 开始回放
 * @param {number} snapshotId
 */
async function startReplay(snapshotId) {
  if (isGameRunning) {
    log("⚠️ 请先停止当前牌局，再开始回放。");
    return;
  }
  log(`[REPLAY] 开始加载快照 #${snapshotId} 用于回放...`);
  showLoader(); // 显示加载动画
  try {
    const snapshot = await snapshotService.getSnapshotById(snapshotId);
    if (!snapshot.settings || !snapshot.actionHistory) {
      log("❌ 回放失败：此快照缺少回放所需的 settings 或 actionHistory 数据。");
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
  document.getElementById("game-controls").style.display = "none";
  document.getElementById("replay-controls").style.display = "flex";

  // 禁用配置区
  const configDrawer = document.getElementById("config-drawer");
  if (configDrawer) {
    configDrawer.style.pointerEvents = "none";
    configDrawer.style.opacity = "0.6";
    // Robustly disable all form controls within the drawer
    configDrawer
      .querySelectorAll("input, select")
      .forEach((el) => (el.disabled = true));
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

  document.getElementById("game-controls").style.display = "flex";
  document.getElementById("replay-controls").style.display = "none";

  // 恢复配置区
  const configDrawer = document.getElementById("config-drawer");
  if (configDrawer) {
    configDrawer.style.pointerEvents = "auto";
    configDrawer.style.opacity = "1";
    // Robustly re-enable all form controls
    configDrawer
      .querySelectorAll("input, select")
      .forEach((el) => (el.disabled = false));
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
  const initialStateEvent = replayData.actions.find(
    (e) => e.type === "initialState",
  );
  if (initialStateEvent) {
    game.players = JSON.parse(JSON.stringify(initialStateEvent.players));
  } else {
    log("❌ [REPLAY] 无法开始回放：未找到initialState事件。");
    return;
  }

  // 3. 开始翻前回合，这将自动处理盲注并设置正确的第一个行动者
  game.startNewRound("preflop");

  // 4. 渲染UI
  renderActionSheet();
  updateUI({ isInitialDeal: true });

  document.getElementById("replay-play-pause-btn").textContent = "▶️ 播放";

  // 重置按钮状态：回到开始位置
  updateReplayButtonStates({
    isPlaying: false,
    atBeginning: true,
    atEnd: false,
  });

  log("[REPLAY] 回放已重置，准备就绪。");
}

/**
 * 执行回放的下一步
 * @param {boolean} isManual - 是否为手动点击（默认为false，即自动播放）
 */
function nextReplayStep(isManual = false) {
  if (!isInReplayMode) return;

  if (currentReplayStep >= replayData.actions.length) {
    if (replayInterval) {
      clearInterval(replayInterval);
      replayInterval = null;
      document.getElementById("replay-play-pause-btn").textContent = "▶️ 播放";

      // 回放结束，恢复所有按钮状态
      updateReplayButtonStates({
        isPlaying: false,
        atBeginning: false,
        atEnd: true,
      });
    }
    log("[REPLAY] 回放结束。");
    return;
  }

  const event = replayData.actions[currentReplayStep];
  const isSbPost =
    event.round === "preflop" &&
    event.action === "BET" &&
    event.playerId === game.players[game.sbIndex].id &&
    event.amount === replayData.settings.sb;
  const isBbPost =
    event.round === "preflop" &&
    event.action === "BET" &&
    event.playerId === game.players[game.bbIndex].id &&
    event.amount === replayData.settings.bb;

  // 修正日志记录，使其能同时处理系统事件和玩家动作
  const actionOrType = event.type || event.action;
  const actor = event.playerId || "System";

  // 增加详细的调试日志
  const enginePlayerIndex = game.currentPlayerIndex;
  const enginePlayerId =
    enginePlayerIndex >= 0 && game.players[enginePlayerIndex]
      ? game.players[enginePlayerIndex].id
      : "N/A";
  log(
    `[REPLAY] Step ${currentReplayStep + 1}: Event is '${actionOrType}' by '${actor}'. Engine awaits '${enginePlayerId}' (idx: ${enginePlayerIndex})`,
  );

  // 如果是盲注事件，只播放动画和更新UI，不执行动作（因为引擎已处理）
  if (isSbPost || isBbPost) {
    showActionBubble(event.playerId, event.action, event.amount);
    updateActionSheetUI(event.playerId, event.action, event.amount);
  } else {
    // 对于所有真实玩家动作，正常执行
    switch (event.type) {
      case "initialState":
        // 创世状态已在 resetReplay 中处理完毕，此处无需任何操作
        break;
      case "dealCommunity":
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
          console.log(
            "--- Before moveToNextPlayer ---",
            game.players.map((p) => ({ id: p.id, isFolded: p.isFolded })),
          );

          game.moveToNextPlayer(); // 核心修复：执行动作后，将指针移到下一位玩家
        } catch (e) {
          log(`❌ [REPLAY] 回放动作失败: ${e.message}`);
          // 停止播放
          clearInterval(replayInterval);
          replayInterval = null;
          document.getElementById("replay-play-pause-btn").textContent =
            "▶️ 播放";
          return; // 中断执行
        }
        break;
    }
  }

  currentReplayStep++;

  // 如果是手动操作，更新按钮状态
  if (isManual && !replayInterval) {
    updateReplayButtonStates({
      isPlaying: false,
      atBeginning: currentReplayStep === 0,
      atEnd: currentReplayStep >= replayData.actions.length,
    });
  }
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
    document.getElementById("replay-play-pause-btn").textContent = "▶️ 播放";

    // 恢复手动控制按钮状态
    updateReplayButtonStates({
      isPlaying: false,
      atBeginning: false,
      atEnd: false,
    });
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
    nextReplayStep(false); // 使用false表示是程序化执行，不是手动点击
  }

  // 手动上一步操作完成，更新按钮状态
  updateReplayButtonStates({
    isPlaying: false,
    atBeginning: currentReplayStep === 0,
    atEnd: currentReplayStep >= replayData.actions.length,
  });
}

/**
 * 播放或暂停回放
 */
function playPauseReplay() {
  if (!isInReplayMode) return;

  const btn = document.getElementById("replay-play-pause-btn");

  if (replayInterval) {
    // 正在播放 -> 暂停
    clearInterval(replayInterval);
    replayInterval = null;
    btn.textContent = "▶️ 播放";
    log("[REPLAY] 暂停。");

    // 恢复手动控制按钮
    updateReplayButtonStates({
      isPlaying: false,
      atBeginning: currentReplayStep === 0,
      atEnd: currentReplayStep >= replayData.actions.length,
    });
  } else {
    // 已暂停 -> 播放
    if (currentReplayStep >= replayData.actions.length) {
      resetReplay();
    }
    btn.textContent = "⏸️ 暂停";
    log("[REPLAY] 播放...");

    // 禁用手动控制按钮，启用自动播放
    updateReplayButtonStates({
      isPlaying: true,
      atBeginning: false,
      atEnd: false,
    });

    // 立即执行一步，然后开始定时
    nextReplayStep(false); // 自动播放，不是手动点击
    replayInterval = setInterval(() => nextReplayStep(false), 1500);
  }
}
