// setting.js

/**
 * 全局配置管理器
 * 职责：存储和提供运行时配置参数
 * 特点：无依赖、无副作用、可动态更新
 */
export const Settings = {
  // ===== 默认配置值 =====
  mode: 'auto',           // 游戏模式: 'auto' | 'manual'
  sb: 50,                 // 小盲注 (Small Blind)
  bb: 100,                // 大盲注 (Big Blind)
  showHoleCards: true,    // 明牌模式：true = 所有底牌可见
  autoDelay: 1000,        // 自动模式下每步延时（毫秒）

  // ===== 配置更新接口 =====
  /**
   * 更新一个或多个配置项
   * @param {Object} newSettings - 键值对，如 { mode: 'manual', sb: 25 }
   */
  update(newSettings) {
    Object.assign(this, newSettings);
  },

  /**
   * 获取当前所有配置的副本（防止外部修改原始对象）
   * @returns {Object}
   */
  getAll() {
    return {
      mode: this.mode,
      sb: this.sb,
      bb: this.bb,
      showHoleCards: this.showHoleCards,
      autoDelay: this.autoDelay
    };
  },

  /**
   * 获取单个配置项
   * @param {string} key - 配置键名
   * @returns {*} 配置值
   */
  get(key) {
    if (key in this) {
      return this[key];
    }
    throw new Error(`Setting key "${key}" not found`);
  }
};