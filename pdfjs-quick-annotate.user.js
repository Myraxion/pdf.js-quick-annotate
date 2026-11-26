// ==UserScript==
// @name         PDF.js & PdfDing 标注快捷键
// @namespace    https://github.com/Myraxion/pdf.js-quick-annotate
// @version      1.0.0
// @description  为 PdfDing 和 PDF.JS 提供可配置的标注快捷键（高亮、自由文本、画笔、快速换色、Esc 退出）与可视化设置面板
// @author       Myraxion
// @homepageURL  https://github.com/Myraxion/pdf.js-quick-annotate
// @supportURL   https://github.com/Myraxion/pdf.js-quick-annotate/issues
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function (root) {
  "use strict";

  const STORAGE_KEY = "pdfjs_quick_annotate_config_v1";

  // PDF.JS 默认 5 个高亮预设色值（当页面尚未渲染颜色按钮时作为兜底）
  const FALLBACK_COLORS = ["#FFFF98", "#53FFBC", "#80EBFF", "#FFCBE6", "#FF4F5F"];

  const EDITOR_MODE = {
    NONE: 0,
    FREETEXT: 3,
    HIGHLIGHT: 9,
    INK: 15,
  };

  const CURSOR_TOOL = {
    SELECT: 0,
    HAND: 1,
  };

  /**
   * 生成默认配置
   * @returns {object}
   */
  function createDefaultConfig() {
    return {
      domains: [],
      shortcuts: {
        highlight: {
          key: "h",
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
          enabled: true,
          label: "高亮 / 划词即高亮",
        },
        freeText: {
          key: "t",
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
          enabled: true,
          label: "自由文本批注",
        },
        ink: {
          key: "d",
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
          enabled: true,
          label: "画笔 / 涂鸦",
        },
        handTool: {
          key: "v",
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
          enabled: true,
          label: "按住临时抓手 (Hand Tool)",
        },
        escape: {
          key: "Escape",
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
          enabled: true,
          label: "退出标注模式",
        },
        color1: {
          key: "1",
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
          enabled: true,
          label: "预设颜色 1",
        },
        color2: {
          key: "2",
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
          enabled: true,
          label: "预设颜色 2",
        },
        color3: {
          key: "3",
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
          enabled: true,
          label: "预设颜色 3",
        },
        color4: {
          key: "4",
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
          enabled: true,
          label: "预设颜色 4",
        },
        color5: {
          key: "5",
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
          enabled: true,
          label: "预设颜色 5",
        },
        openSettings: {
          key: "",
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
          enabled: false,
          label: "打开设置面板",
        },
      },
    };
  }

  /**
   * 规范化按键名称（单字符转小写，兼容 Esc -> Escape）
   * @param {string} key
   * @returns {string}
   */
  function normalizeKey(key) {
    if (!key) return "";
    if (key === "Esc" || key === "Escape") return "Escape";
    if (key === " ") return "Space";
    if (key.length === 1) return key.toLowerCase();
    return key;
  }

  /**
   * 将物理键码 code 兜底转换为逻辑键名（用于输入法或特殊布局兜底）
   * @param {string} code
   * @returns {string}
   */
  function keyFromCode(code) {
    if (!code) return "";
    if (code.startsWith("Key") && code.length === 4) {
      return code.slice(3).toLowerCase();
    }
    if (code.startsWith("Digit") && code.length === 6) {
      return code.slice(5);
    }
    if (code === "Escape") return "Escape";
    if (code === "Space") return "Space";
    return "";
  }

  /**
   * 合并已保存配置与默认配置，确保字段完整
   * @param {object|null} raw
   * @returns {object}
   */
  function mergeConfig(raw) {
    const def = createDefaultConfig();
    if (!raw || typeof raw !== "object") return def;

    const domains = Array.isArray(raw.domains)
      ? raw.domains
          .filter((d) => d && typeof d.host === "string" && d.host.trim())
          .map((d) => ({
            host: d.host.trim().toLowerCase(),
            enabled: d.enabled !== false,
          }))
      : [];

    const shortcuts = { ...def.shortcuts };
    if (raw.shortcuts && typeof raw.shortcuts === "object") {
      for (const actionId of Object.keys(def.shortcuts)) {
        const saved = raw.shortcuts[actionId];
        if (saved && typeof saved === "object") {
          shortcuts[actionId] = {
            ...def.shortcuts[actionId],
            key: normalizeKey(saved.key ?? def.shortcuts[actionId].key),
            ctrl: Boolean(saved.ctrl),
            alt: Boolean(saved.alt),
            shift: Boolean(saved.shift),
            meta: Boolean(saved.meta),
            enabled: saved.enabled !== false,
          };
        }
      }
    }

    return { domains, shortcuts };
  }

  /**
   * 检查当前 host 是否命中已启用的精确白名单规则
   * @param {string} host
   * @param {Array<{host: string, enabled: boolean}>} domains
   * @returns {boolean}
   */
  function isHostAllowed(host, domains) {
    if (!host || !Array.isArray(domains)) return false;
    const normalized = host.trim().toLowerCase();
    return domains.some(
      (item) => item && item.enabled && item.host.trim().toLowerCase() === normalized
    );
  }

  /**
   * 判断键盘事件是否匹配指定的快捷键绑定
   * @param {KeyboardEvent|{key:string,code?:string,ctrlKey?:boolean,altKey?:boolean,shiftKey?:boolean,metaKey?:boolean,isComposing?:boolean}} event
   * @param {object} binding
   * @returns {boolean}
   */
  function matchShortcut(event, binding) {
    if (!binding || !binding.enabled || !binding.key) return false;
    if (event.isComposing) return false;

    const targetKey = normalizeKey(binding.key);
    let eventKey = normalizeKey(event.key);
    if (eventKey === "Process" || eventKey === "Unidentified" || !eventKey) {
      eventKey = keyFromCode(event.code);
    }

    if (eventKey !== targetKey) {
      // 若用户输入法或大小写导致 event.key 异常，尝试用物理键兜底（仅限无 Shift 或数字字母）
      const fallback = keyFromCode(event.code);
      if (!fallback || fallback !== targetKey) return false;
    }

    return (
      Boolean(event.ctrlKey) === Boolean(binding.ctrl) &&
      Boolean(event.altKey) === Boolean(binding.alt) &&
      Boolean(event.shiftKey) === Boolean(binding.shift) &&
      Boolean(event.metaKey) === Boolean(binding.meta)
    );
  }

  /**
   * 判断 keyup 事件是否释放了指定快捷键的主键（忽略修饰键变化，避免按住期间误触修饰键导致卡死）
   * @param {KeyboardEvent|{key:string,code?:string}} event
   * @param {object} binding
   * @returns {boolean}
   */
  function isKeyReleaseMatch(event, binding) {
    if (!binding || !binding.enabled || !binding.key) return false;
    const targetKey = normalizeKey(binding.key);
    const eventKey = normalizeKey(event?.key);
    if (eventKey && eventKey === targetKey) return true;
    const fallback = keyFromCode(event?.code);
    return Boolean(fallback && fallback === targetKey);
  }

  /**
   * 生成快捷键的唯一签名字符串，用于冲突检测
   * @param {object} binding
   * @returns {string}
   */
  function getShortcutSignature(binding) {
    if (!binding || !binding.enabled || !binding.key) return "";
    return [
      binding.ctrl ? "C" : "",
      binding.alt ? "A" : "",
      binding.shift ? "S" : "",
      binding.meta ? "M" : "",
      normalizeKey(binding.key),
    ].join("+");
  }

  /**
   * 检测启用的快捷键之间是否存在按键冲突
   * @param {Record<string, object>} shortcuts
   * @returns {Record<string, string[]>} 每个冲突 actionId 对应的其他冲突 actionId 列表
   */
  function detectShortcutConflicts(shortcuts) {
    const groups = new Map();
    for (const [id, binding] of Object.entries(shortcuts || {})) {
      const sig = getShortcutSignature(binding);
      if (!sig) continue;
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push(id);
    }

    const conflicts = {};
    for (const ids of groups.values()) {
      if (ids.length > 1) {
        for (const id of ids) {
          conflicts[id] = ids.filter((other) => other !== id);
        }
      }
    }
    return conflicts;
  }

  /**
   * 格式化快捷键为跨平台可读文本
   * @param {object} binding
   * @param {boolean} isMac
   * @returns {string}
   */
  function formatShortcut(binding, isMac = false) {
    if (!binding || !binding.key) return "未设置";
    const parts = [];
    if (binding.ctrl) parts.push(isMac ? "⌃" : "Ctrl");
    if (binding.alt) parts.push(isMac ? "⌥" : "Alt");
    if (binding.shift) parts.push(isMac ? "⇧" : "Shift");
    if (binding.meta) parts.push(isMac ? "⌘" : "Win");

    const k = normalizeKey(binding.key);
    const displayKey = k.length === 1 ? k.toUpperCase() : k === "Escape" ? "Esc" : k;
    parts.push(displayKey);
    return isMac ? parts.join("") : parts.join(" + ");
  }

  /**
   * 判断事件目标是否处于可输入元素中（防误触）
   * @param {EventTarget|null} target
   * @returns {boolean}
   */
  function isEditableTarget(target) {
    if (!target || typeof target !== "object") return false;
    const tag = (target.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (target.isContentEditable) return true;
    if (typeof target.closest === "function") {
      return Boolean(target.closest('[contenteditable="true"], [contenteditable=""]'));
    }
    return false;
  }

  const Core = {
    STORAGE_KEY,
    FALLBACK_COLORS,
    EDITOR_MODE,
    CURSOR_TOOL,
    createDefaultConfig,
    normalizeKey,
    keyFromCode,
    mergeConfig,
    isHostAllowed,
    matchShortcut,
    isKeyReleaseMatch,
    getShortcutSignature,
    detectShortcutConflicts,
    formatShortcut,
    isEditableTarget,
  };

  // 若处于 Node 测试环境，导出 Core 后直接返回
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Core;
    return;
  }

  // ==================== 浏览器运行环境 ====================

  const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const isMacPlatform = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || "");

  /**
   * 持久化存储封装（优先 GM_*，回退 localStorage）
   */
  const Storage = {
    load() {
      try {
        if (typeof GM_getValue === "function") {
          const raw = GM_getValue(STORAGE_KEY, null);
          return mergeConfig(typeof raw === "string" ? JSON.parse(raw) : raw);
        }
      } catch (e) {
        console.warn("[QuickAnnotate] 读取配置失败，使用默认配置:", e);
      }
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return mergeConfig(raw ? JSON.parse(raw) : null);
      } catch {
        return createDefaultConfig();
      }
    },
    save(config) {
      const normalized = mergeConfig(config);
      try {
        if (typeof GM_setValue === "function") {
          GM_setValue(STORAGE_KEY, normalized);
          return normalized;
        }
      } catch (e) {
        console.warn("[QuickAnnotate] 保存配置失败:", e);
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        // 忽略存储异常
      }
      return normalized;
    },
  };

  /**
   * PDF.JS / PdfDing 页面适配层
   */
  const PdfAdapter = {
    getApp() {
      return pageWindow.PDFViewerApplication || null;
    },

    isPdfViewerPage() {
      if (this.getApp()) return true;
      return Boolean(
        document.getElementById("editorHighlightButton") ||
          document.getElementById("viewerContainer")
      );
    },

    getButtons() {
      return {
        highlight: document.getElementById("editorHighlightButton"),
        freeText: document.getElementById("editorFreeTextButton"),
        ink: document.getElementById("editorInkButton"),
      };
    },

    isButtonActive(btn) {
      if (!btn) return false;
      return (
        btn.classList.contains("toggled") || btn.getAttribute("aria-pressed") === "true"
      );
    },

    getCurrentMode() {
      const btns = this.getButtons();
      if (this.isButtonActive(btns.highlight)) return "highlight";
      if (this.isButtonActive(btns.freeText)) return "freetext";
      if (this.isButtonActive(btns.ink)) return "ink";

      const mode = this.getApp()?.pdfViewer?.annotationEditorMode;
      if (mode === EDITOR_MODE.HIGHLIGHT) return "highlight";
      if (mode === EDITOR_MODE.FREETEXT) return "freetext";
      if (mode === EDITOR_MODE.INK) return "ink";
      return "none";
    },

    exitToNoneMode() {
      const current = this.getCurrentMode();
      if (current === "none") return;

      const app = this.getApp();
      if (app?.eventBus) {
        app.eventBus.dispatch("switchannotationeditormode", {
          source: app.toolbar || this,
          mode: EDITOR_MODE.NONE,
        });
        return;
      }

      const btns = this.getButtons();
      const map = {
        highlight: btns.highlight,
        freetext: btns.freeText,
        ink: btns.ink,
      };
      const activeBtn = map[current];
      if (activeBtn && !activeBtn.disabled) {
        activeBtn.click();
      }
    },

    toggleMode(targetMode) {
      const current = this.getCurrentMode();
      if (current === targetMode) {
        this.exitToNoneMode();
        return;
      }
      const btns = this.getButtons();
      const btnMap = {
        highlight: btns.highlight,
        freetext: btns.freeText,
        ink: btns.ink,
      };
      const btn = btnMap[targetMode];
      if (btn && !btn.disabled) {
        btn.click();
        return;
      }
      const modeMap = {
        highlight: EDITOR_MODE.HIGHLIGHT,
        freetext: EDITOR_MODE.FREETEXT,
        ink: EDITOR_MODE.INK,
      };
      const app = this.getApp();
      if (app?.eventBus && modeMap[targetMode] !== undefined) {
        app.eventBus.dispatch("switchannotationeditormode", {
          source: app.toolbar || this,
          mode: modeMap[targetMode],
        });
      }
    },

    hasValidPdfTextSelection() {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return false;
      const node = sel.anchorNode;
      const el = node && node.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return Boolean(el && el.closest(".textLayer"));
    },

    triggerHighlightAction() {
      if (this.hasValidPdfTextSelection()) {
        const app = this.getApp();
        const uiManager = app?.pdfViewer?._layerProperties?.annotationEditorUIManager;

        if (uiManager && typeof uiManager.highlightSelection === "function") {
          uiManager.highlightSelection("shortcut");
          // 高亮完成后立即恢复到普通阅读模式
          setTimeout(() => this.exitToNoneMode(), 0);
          return true;
        }

        // 兜底 1：尝试点击浮动高亮按钮
        const floatingBtn = document.querySelector(
          ".textLayer .editToolbar .highlightButton"
        );
        if (floatingBtn) {
          floatingBtn.click();
          setTimeout(() => this.exitToNoneMode(), 0);
          return true;
        }

        // 兜底 2：点击原生高亮按钮后再切回普通模式
        const btn = this.getButtons().highlight;
        if (btn && !btn.disabled) {
          btn.click();
          setTimeout(() => this.exitToNoneMode(), 30);
          return true;
        }
        return false;
      }

      // 无选中文本：切换高亮模式
      this.toggleMode("highlight");
      return true;
    },

    getHighlightPaletteColors() {
      const buttons = document.querySelectorAll(
        "#editorHighlightColorPicker .dropdown button[data-color]"
      );
      if (buttons.length > 0) {
        return Array.from(buttons)
          .slice(0, 5)
          .map((btn) => btn.getAttribute("data-color"))
          .filter(Boolean);
      }
      return FALLBACK_COLORS;
    },

    applyColor(index) {
      const mode = this.getCurrentMode();
      if (mode === "none") return false;

      if (mode === "highlight") {
        const buttons = document.querySelectorAll(
          "#editorHighlightColorPicker .dropdown button"
        );
        const target = buttons[index];
        if (target) {
          target.click();
          return true;
        }
        return false;
      }

      const palette = this.getHighlightPaletteColors();
      const color = palette[index];
      if (!color) return false;

      const inputId = mode === "freetext" ? "editorFreeTextColor" : "editorInkColor";
      const input = document.getElementById(inputId);
      if (!input) return false;

      input.value = color;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },

    isInsideFreeTextEditor() {
      const active = document.activeElement;
      if (!active) return false;
      return Boolean(active.isContentEditable && active.closest(".freeTextEditor"));
    },

    isHandToolActive() {
      const activeTool = this.getApp()?.pdfCursorTools?.activeTool;
      if (typeof activeTool === "number") {
        return activeTool === CURSOR_TOOL.HAND;
      }
      const handBtn = document.getElementById("cursorHandTool");
      if (!handBtn) return false;
      return (
        handBtn.classList.contains("toggled") ||
        handBtn.getAttribute("aria-checked") === "true" ||
        handBtn.getAttribute("aria-pressed") === "true"
      );
    },

    setHandTool(enabled) {
      const targetTool = enabled ? CURSOR_TOOL.HAND : CURSOR_TOOL.SELECT;
      const app = this.getApp();

      if (app?.eventBus) {
        app.eventBus.dispatch("switchcursortool", {
          source: app.toolbar || this,
          tool: targetTool,
        });
        return true;
      }

      if (app?.pdfCursorTools && typeof app.pdfCursorTools.switchTool === "function") {
        app.pdfCursorTools.switchTool(targetTool);
        return true;
      }

      const btn = document.getElementById(enabled ? "cursorHandTool" : "cursorSelectTool");
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
      return false;
    },
  };

  /**
   * 轻量 Toast 提示（挂载在 Shadow DOM 内或临时节点）
   */
  function showToast(message) {
    const existing = document.getElementById("pdfjs-qa-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "pdfjs-qa-toast";
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(24, 24, 27, 0.92)",
      color: "#fff",
      padding: "8px 16px",
      borderRadius: "8px",
      fontSize: "13px",
      fontFamily: "system-ui, -apple-system, sans-serif",
      zIndex: "2147483647",
      boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
      pointerEvents: "none",
      transition: "opacity 0.2s ease",
    });
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 220);
    }, 1800);
  }

  /**
   * 可视化设置面板（使用 Shadow DOM 隔离样式）
   */
  class SettingsPanel {
    constructor(getConfig, updateConfig) {
      this.getConfig = getConfig;
      this.updateConfig = updateConfig;
      this.hostEl = null;
      this.shadow = null;
      this.recordingActionId = null;
      this.editingDomainIndex = null;
      this._onRecordKeyDown = this._onRecordKeyDown.bind(this);
    }

    isOpen() {
      return Boolean(this.hostEl && this.hostEl.isConnected);
    }

    open() {
      if (this.isOpen()) return;
      this.hostEl = document.createElement("div");
      this.hostEl.id = "pdfjs-qa-settings-host";
      this.shadow = this.hostEl.attachShadow({ mode: "open" });
      this.render();
      document.documentElement.appendChild(this.hostEl);
    }

    close() {
      this.stopRecording();
      this.editingDomainIndex = null;
      if (this.hostEl) {
        this.hostEl.remove();
        this.hostEl = null;
        this.shadow = null;
      }
    }

    stopRecording() {
      if (this.recordingActionId) {
        this.recordingActionId = null;
        window.removeEventListener("keydown", this._onRecordKeyDown, true);
      }
    }

    startRecording(actionId) {
      this.stopRecording();
      this.recordingActionId = actionId;
      window.addEventListener("keydown", this._onRecordKeyDown, true);
      this.render();
    }

    _onRecordKeyDown(e) {
      e.preventDefault();
      e.stopPropagation();

      // 忽略纯修饰键按下
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
        return;
      }

      const actionId = this.recordingActionId;
      if (!actionId) return;

      const key = normalizeKey(e.key) || keyFromCode(e.code);
      if (!key) return;

      const cfg = this.getConfig();
      cfg.shortcuts[actionId] = {
        ...cfg.shortcuts[actionId],
        key,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey,
        enabled: true,
      };
      this.stopRecording();
      this.updateConfig(cfg);
      this.render();
    }

    render() {
      if (!this.shadow) return;
      const cfg = this.getConfig();
      const currentHost = location.host.toLowerCase();
      const currentEntry = cfg.domains.find((d) => d.host === currentHost);
      const conflicts = detectShortcutConflicts(cfg.shortcuts);

      this.shadow.innerHTML = `
        <style>
          :host {
            all: initial;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
          .backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(2px);
            z-index: 2147483646;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
          }
          .modal {
            width: 100%;
            max-width: 580px;
            max-height: 86vh;
            background: #ffffff;
            color: #18181b;
            border-radius: 12px;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-size: 14px;
            line-height: 1.5;
          }
          @media (prefers-color-scheme: dark) {
            .modal {
              background: #1e1e22;
              color: #f4f4f5;
              border: 1px solid #3f3f46;
            }
          }
          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid rgba(128, 128, 128, 0.2);
          }
          .title {
            font-size: 16px;
            font-weight: 600;
            margin: 0;
          }
          .close-btn {
            background: transparent;
            border: none;
            color: inherit;
            font-size: 20px;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 6px;
            opacity: 0.7;
          }
          .close-btn:hover { opacity: 1; background: rgba(128, 128, 128, 0.15); }
          .body {
            padding: 16px 20px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 20px;
          }
          .section-title {
            font-size: 13px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            opacity: 0.65;
            margin: 0 0 10px 0;
          }
          .card {
            background: rgba(128, 128, 128, 0.07);
            border-radius: 8px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
          }
          .current-host {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 13px;
            font-weight: 600;
            word-break: break-all;
          }
          .input-group {
            display: flex;
            gap: 8px;
          }
          input[type="text"] {
            flex: 1;
            padding: 6px 10px;
            border-radius: 6px;
            border: 1px solid rgba(128, 128, 128, 0.35);
            background: transparent;
            color: inherit;
            font-size: 13px;
            outline: none;
          }
          input[type="text"]:focus {
            border-color: #3b82f6;
          }
          button {
            font-family: inherit;
            cursor: pointer;
            border-radius: 6px;
            border: 1px solid rgba(128, 128, 128, 0.3);
            background: transparent;
            color: inherit;
            padding: 5px 10px;
            font-size: 12px;
            transition: background 0.15s, border-color 0.15s;
          }
          button:hover {
            background: rgba(128, 128, 128, 0.12);
          }
          button.primary {
            background: #2563eb;
            border-color: #2563eb;
            color: #fff;
          }
          button.primary:hover {
            background: #1d4ed8;
          }
          button.danger {
            color: #ef4444;
            border-color: rgba(239, 68, 68, 0.4);
          }
          button.danger:hover {
            background: rgba(239, 68, 68, 0.12);
          }
          .domain-list, .shortcut-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .domain-item, .shortcut-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 6px 8px;
            border-radius: 6px;
            background: rgba(128, 128, 128, 0.06);
          }
          .shortcut-item.conflict {
            border: 1px solid #ef4444;
            background: rgba(239, 68, 68, 0.08);
          }
          .shortcut-meta {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
          }
          .shortcut-actions {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .key-btn {
            min-width: 96px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-weight: 600;
            text-align: center;
          }
          .key-btn.recording {
            border-color: #3b82f6;
            color: #3b82f6;
            background: rgba(59, 130, 246, 0.1);
          }
          .conflict-tip {
            font-size: 11px;
            color: #ef4444;
          }
          .empty-tip {
            font-size: 12px;
            opacity: 0.6;
            text-align: center;
            padding: 8px 0;
          }
          .footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 20px;
            border-top: 1px solid rgba(128, 128, 128, 0.2);
          }
          label.toggle {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            font-size: 12px;
          }
        </style>
        <div class="backdrop" id="qa-backdrop">
          <div class="modal" role="dialog" aria-modal="true" aria-label="标注快捷键设置">
            <div class="header">
              <h2 class="title">PDF.js 标注快捷键设置</h2>
              <button class="close-btn" id="qa-close" title="关闭">×</button>
            </div>
            <div class="body">
              <section>
                <h3 class="section-title">适配域名白名单（仅匹配精确 Host）</h3>
                <div class="card">
                  <div class="row">
                    <div>
                      <span style="opacity:0.7;font-size:12px;">当前站点：</span>
                      <span class="current-host">${this._esc(currentHost)}</span>
                    </div>
                    ${
                      currentEntry
                        ? `<button class="danger" id="qa-toggle-current">${
                            currentEntry.enabled ? "禁用当前站点" : "启用当前站点"
                          }</button>`
                        : `<button class="primary" id="qa-add-current">一键加入当前站点</button>`
                    }
                  </div>
                  <div class="input-group">
                    <input type="text" id="qa-domain-input" placeholder="输入域名或 Host，例如 pdf.example.com 或 localhost:8000" />
                    <button id="qa-domain-add">添加</button>
                  </div>
                  <div class="domain-list">
                    ${
                      cfg.domains.length === 0
                        ? `<div class="empty-tip">暂无白名单域名，点击上方按钮添加当前站点即可生效。</div>`
                        : cfg.domains
                            .map((d, idx) => {
                              if (this.editingDomainIndex === idx) {
                                return `
                                  <div class="domain-item">
                                    <input type="text" class="qa-domain-edit-input" data-idx="${idx}" value="${this._esc(
                                  d.host
                                )}" />
                                    <button class="primary qa-domain-save" data-idx="${idx}">保存</button>
                                    <button class="qa-domain-cancel">取消</button>
                                  </div>
                                `;
                              }
                              return `
                                <div class="domain-item">
                                  <label class="toggle" style="flex:1;">
                                    <input type="checkbox" class="qa-domain-enable" data-idx="${idx}" ${
                                d.enabled ? "checked" : ""
                              } />
                                    <span style="font-family:monospace;${
                                      d.enabled ? "" : "opacity:0.5;text-decoration:line-through;"
                                    }">${this._esc(d.host)}</span>
                                  </label>
                                  <button class="qa-domain-edit" data-idx="${idx}">编辑</button>
                                  <button class="danger qa-domain-del" data-idx="${idx}">删除</button>
                                </div>
                              `;
                            })
                            .join("")
                    }
                  </div>
                </div>
              </section>

              <section>
                <h3 class="section-title">快捷键配置（修改后即时生效）</h3>
                <div class="shortcut-list">
                  ${Object.entries(cfg.shortcuts)
                    .map(([id, item]) => {
                      const isRecording = this.recordingActionId === id;
                      const conflictIds = conflicts[id] || [];
                      const conflictLabels = conflictIds
                        .map((cid) => cfg.shortcuts[cid]?.label)
                        .filter(Boolean);
                      return `
                        <div class="shortcut-item ${conflictIds.length ? "conflict" : ""}">
                          <div class="shortcut-meta">
                            <input type="checkbox" class="qa-sc-enable" data-id="${id}" ${
                        item.enabled ? "checked" : ""
                      } title="启用/禁用" />
                            <div>
                              <div>${this._esc(item.label)}</div>
                              ${
                                conflictLabels.length
                                  ? `<div class="conflict-tip">与「${this._esc(
                                      conflictLabels.join("、")
                                    )}」按键冲突</div>`
                                  : ""
                              }
                            </div>
                          </div>
                          <div class="shortcut-actions">
                            <button class="key-btn ${
                              isRecording ? "recording" : ""
                            }" data-id="${id}">
                              ${
                                isRecording
                                  ? "请按下按键..."
                                  : this._esc(formatShortcut(item, isMacPlatform))
                              }
                            </button>
                            <button class="qa-sc-clear" data-id="${id}" title="清空快捷键">清空</button>
                          </div>
                        </div>
                      `;
                    })
                    .join("")}
                </div>
              </section>
            </div>
            <div class="footer">
              <button class="danger" id="qa-reset">恢复默认设置</button>
              <button class="primary" id="qa-done">完成</button>
            </div>
          </div>
        </div>
      `;

      this._bindEvents(currentHost);
    }

    _esc(str) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    _bindEvents(currentHost) {
      const s = this.shadow;
      s.getElementById("qa-close")?.addEventListener("click", () => this.close());
      s.getElementById("qa-done")?.addEventListener("click", () => this.close());
      s.getElementById("qa-backdrop")?.addEventListener("click", (e) => {
        if (e.target.id === "qa-backdrop") this.close();
      });

      s.getElementById("qa-add-current")?.addEventListener("click", () => {
        const cfg = this.getConfig();
        if (!cfg.domains.some((d) => d.host === currentHost)) {
          cfg.domains.push({ host: currentHost, enabled: true });
          this.updateConfig(cfg);
          this.render();
        }
      });

      s.getElementById("qa-toggle-current")?.addEventListener("click", () => {
        const cfg = this.getConfig();
        const item = cfg.domains.find((d) => d.host === currentHost);
        if (item) {
          item.enabled = !item.enabled;
          this.updateConfig(cfg);
          this.render();
        }
      });

      const addInput = s.getElementById("qa-domain-input");
      const addDomain = () => {
        const val = (addInput?.value || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
        if (!val) return;
        const cfg = this.getConfig();
        if (!cfg.domains.some((d) => d.host === val)) {
          cfg.domains.push({ host: val, enabled: true });
          this.updateConfig(cfg);
          this.render();
        }
      };
      s.getElementById("qa-domain-add")?.addEventListener("click", addDomain);
      addInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addDomain();
      });

      s.querySelectorAll(".qa-domain-enable").forEach((el) => {
        el.addEventListener("change", (e) => {
          const idx = Number(e.target.dataset.idx);
          const cfg = this.getConfig();
          if (cfg.domains[idx]) {
            cfg.domains[idx].enabled = e.target.checked;
            this.updateConfig(cfg);
            this.render();
          }
        });
      });

      s.querySelectorAll(".qa-domain-del").forEach((el) => {
        el.addEventListener("click", (e) => {
          const idx = Number(e.target.dataset.idx);
          const cfg = this.getConfig();
          cfg.domains.splice(idx, 1);
          this.updateConfig(cfg);
          this.render();
        });
      });

      s.querySelectorAll(".qa-domain-edit").forEach((el) => {
        el.addEventListener("click", (e) => {
          this.editingDomainIndex = Number(e.target.dataset.idx);
          this.render();
        });
      });

      s.querySelectorAll(".qa-domain-cancel").forEach((el) => {
        el.addEventListener("click", () => {
          this.editingDomainIndex = null;
          this.render();
        });
      });

      s.querySelectorAll(".qa-domain-save").forEach((el) => {
        el.addEventListener("click", (e) => {
          const idx = Number(e.target.dataset.idx);
          const input = s.querySelector(`.qa-domain-edit-input[data-idx="${idx}"]`);
          const val = (input?.value || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
          const cfg = this.getConfig();
          if (val && cfg.domains[idx]) {
            cfg.domains[idx].host = val;
            this.updateConfig(cfg);
          }
          this.editingDomainIndex = null;
          this.render();
        });
      });

      s.querySelectorAll(".qa-sc-enable").forEach((el) => {
        el.addEventListener("change", (e) => {
          const id = e.target.dataset.id;
          const cfg = this.getConfig();
          if (cfg.shortcuts[id]) {
            cfg.shortcuts[id].enabled = e.target.checked;
            this.updateConfig(cfg);
            this.render();
          }
        });
      });

      s.querySelectorAll(".key-btn").forEach((el) => {
        el.addEventListener("click", (e) => {
          const id = e.target.dataset.id;
          if (this.recordingActionId === id) {
            this.stopRecording();
            this.render();
          } else {
            this.startRecording(id);
          }
        });
      });

      s.querySelectorAll(".qa-sc-clear").forEach((el) => {
        el.addEventListener("click", (e) => {
          const id = e.target.dataset.id;
          const cfg = this.getConfig();
          if (cfg.shortcuts[id]) {
            cfg.shortcuts[id].key = "";
            cfg.shortcuts[id].ctrl = false;
            cfg.shortcuts[id].alt = false;
            cfg.shortcuts[id].shift = false;
            cfg.shortcuts[id].meta = false;
            cfg.shortcuts[id].enabled = false;
            this.updateConfig(cfg);
            this.render();
          }
        });
      });

      s.getElementById("qa-reset")?.addEventListener("click", () => {
        const cfg = this.getConfig();
        const def = createDefaultConfig();
        // 保留已配置的域名列表，仅重置快捷键为初始方案
        this.updateConfig({ domains: cfg.domains, shortcuts: def.shortcuts });
        this.render();
        showToast("已恢复默认快捷键设置");
      });
    }
  }

  // ==================== 主控制器 ====================

  let currentConfig = Storage.load();
  let menuCommandIds = [];

  // 按住临时抓手状态
  const tempHandState = {
    active: false,
    previousMode: "none",
    wasHandTool: false,
  };

  function activateTempHandTool() {
    if (tempHandState.active) return;

    const previousMode = PdfAdapter.getCurrentMode();
    const wasHandTool = PdfAdapter.isHandToolActive();

    tempHandState.active = true;
    tempHandState.previousMode = previousMode;
    tempHandState.wasHandTool = wasHandTool;

    if (previousMode !== "none") {
      PdfAdapter.exitToNoneMode();
    }
    if (!wasHandTool) {
      PdfAdapter.setHandTool(true);
    }
  }

  function releaseTempHandTool() {
    if (!tempHandState.active) return;

    const { previousMode, wasHandTool } = tempHandState;
    tempHandState.active = false;
    tempHandState.previousMode = "none";
    tempHandState.wasHandTool = false;

    if (!wasHandTool) {
      PdfAdapter.setHandTool(false);
    }
    if (previousMode !== "none") {
      PdfAdapter.toggleMode(previousMode);
    }
  }

  const settingsPanel = new SettingsPanel(
    () => currentConfig,
    (nextConfig) => {
      currentConfig = Storage.save(nextConfig);
      refreshMenuCommands();
    }
  );

  function toggleCurrentHost() {
    const host = location.host.toLowerCase();
    const existing = currentConfig.domains.find((d) => d.host === host);
    if (existing) {
      existing.enabled = !existing.enabled;
      showToast(existing.enabled ? `已启用当前站点: ${host}` : `已禁用当前站点: ${host}`);
    } else {
      currentConfig.domains.push({ host, enabled: true });
      showToast(`已添加并启用站点: ${host}`);
    }
    currentConfig = Storage.save(currentConfig);
    refreshMenuCommands();
    if (settingsPanel.isOpen()) settingsPanel.render();
  }

  function refreshMenuCommands() {
    if (typeof GM_registerMenuCommand !== "function") return;
    if (typeof GM_unregisterMenuCommand === "function") {
      for (const id of menuCommandIds) {
        try {
          GM_unregisterMenuCommand(id);
        } catch {
          // 忽略部分脚本管理器不支持的情况
        }
      }
      menuCommandIds = [];
    }

    const host = location.host.toLowerCase();
    const active = isHostAllowed(host, currentConfig.domains);
    const toggleLabel = active
      ? `✅ 已启用当前域名 (${host}) - 点击禁用`
      : `➕ 启用当前域名 (${host})`;

    menuCommandIds.push(GM_registerMenuCommand(toggleLabel, toggleCurrentHost));
    menuCommandIds.push(
      GM_registerMenuCommand("⚙️ 打开标注快捷键设置", () => settingsPanel.open())
    );
  }

  function handleKeyDown(event) {
    // 正在录制快捷键时不拦截（交由录制监听器处理）
    if (settingsPanel.recordingActionId) return;

    // 严格白名单 + PDF 阅读器特征校验
    if (!isHostAllowed(location.host, currentConfig.domains)) return;
    if (!PdfAdapter.isPdfViewerPage()) return;

    const sc = currentConfig.shortcuts;

    // 1. 打开设置面板快捷键（若启用）
    if (matchShortcut(event, sc.openSettings)) {
      if (!isEditableTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        settingsPanel.isOpen() ? settingsPanel.close() : settingsPanel.open();
      }
      return;
    }

    // 2. 分层退出逻辑（Esc）
    if (matchShortcut(event, sc.escape)) {
      if (settingsPanel.isOpen()) {
        event.preventDefault();
        event.stopPropagation();
        settingsPanel.close();
        return;
      }
      if (PdfAdapter.isInsideFreeTextEditor()) {
        event.preventDefault();
        event.stopPropagation();
        document.activeElement.blur();
        return;
      }
      if (!isEditableTarget(event.target) && PdfAdapter.getCurrentMode() !== "none") {
        event.preventDefault();
        event.stopPropagation();
        PdfAdapter.exitToNoneMode();
      }
      return;
    }

    // 设置面板打开或焦点在可输入元素中时，所有单键/标注快捷键失效
    if (settingsPanel.isOpen() || isEditableTarget(event.target)) {
      return;
    }

    // 3. 标注模式快捷键
    if (matchShortcut(event, sc.highlight)) {
      event.preventDefault();
      event.stopPropagation();
      PdfAdapter.triggerHighlightAction();
      return;
    }

    if (matchShortcut(event, sc.freeText)) {
      event.preventDefault();
      event.stopPropagation();
      PdfAdapter.toggleMode("freetext");
      return;
    }

    if (matchShortcut(event, sc.ink)) {
      event.preventDefault();
      event.stopPropagation();
      PdfAdapter.toggleMode("ink");
      return;
    }

    if (matchShortcut(event, sc.handTool)) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) {
        activateTempHandTool();
      }
      return;
    }

    // 4. 快速切换颜色 1~5（仅在处于标注模式下生效）
    const colorActions = ["color1", "color2", "color3", "color4", "color5"];
    for (let i = 0; i < colorActions.length; i++) {
      if (matchShortcut(event, sc[colorActions[i]])) {
        if (PdfAdapter.getCurrentMode() !== "none") {
          event.preventDefault();
          event.stopPropagation();
          PdfAdapter.applyColor(i);
        }
        return;
      }
    }
  }

  function handleKeyUp(event) {
    if (!tempHandState.active) return;
    if (isKeyReleaseMatch(event, currentConfig.shortcuts.handTool)) {
      event.preventDefault();
      event.stopPropagation();
      releaseTempHandTool();
    }
  }

  refreshMenuCommands();
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("keyup", handleKeyUp, true);
  window.addEventListener("blur", releaseTempHandTool);
})(typeof window !== "undefined" ? window : globalThis);
