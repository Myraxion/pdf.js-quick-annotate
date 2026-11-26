const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../pdfjs-quick-annotate.user.js");

test("isHostAllowed 精确匹配且区分启用状态", () => {
  const domains = [
    { host: "pdf.example.com", enabled: true },
    { host: "localhost:8000", enabled: false },
  ];

  assert.equal(Core.isHostAllowed("pdf.example.com", domains), true);
  assert.equal(Core.isHostAllowed("PDF.EXAMPLE.COM", domains), true);
  assert.equal(Core.isHostAllowed("sub.pdf.example.com", domains), false);
  assert.equal(Core.isHostAllowed("localhost:8000", domains), false);
  assert.equal(Core.isHostAllowed("localhost:3000", domains), false);
  assert.equal(Core.isHostAllowed("", domains), false);
});

test("matchShortcut 支持单键、大小写忽略、组合键与输入法防误触", () => {
  const cfg = Core.createDefaultConfig();
  const hBinding = cfg.shortcuts.highlight;

  assert.equal(Core.matchShortcut({ key: "h" }, hBinding), true);
  assert.equal(Core.matchShortcut({ key: "H" }, hBinding), true);
  assert.equal(Core.matchShortcut({ key: "h", ctrlKey: true }, hBinding), false);
  assert.equal(Core.matchShortcut({ key: "h", isComposing: true }, hBinding), false);

  // 中文输入法下 event.key 为 Process 时使用 code 兜底
  assert.equal(Core.matchShortcut({ key: "Process", code: "KeyH" }, hBinding), true);

  const combo = { key: "k", ctrl: true, shift: true, alt: false, meta: false, enabled: true };
  assert.equal(
    Core.matchShortcut({ key: "K", ctrlKey: true, shiftKey: true }, combo),
    true
  );
  assert.equal(
    Core.matchShortcut({ key: "K", ctrlKey: true, shiftKey: false }, combo),
    false
  );
});

test("detectShortcutConflicts 检测重复绑定并忽略禁用或空绑定", () => {
  const cfg = Core.createDefaultConfig();
  assert.deepEqual(Core.detectShortcutConflicts(cfg.shortcuts), {});

  cfg.shortcuts.freeText.key = "h";
  const conflicts = Core.detectShortcutConflicts(cfg.shortcuts);
  assert.deepEqual(conflicts.highlight, ["freeText"]);
  assert.deepEqual(conflicts.freeText, ["highlight"]);

  // 禁用其中一项后冲突解除
  cfg.shortcuts.freeText.enabled = false;
  assert.deepEqual(Core.detectShortcutConflicts(cfg.shortcuts), {});
});

test("formatShortcut 跨平台展示正确", () => {
  const binding = { key: "h", ctrl: true, alt: false, shift: true, meta: true, enabled: true };
  assert.equal(Core.formatShortcut(binding, false), "Ctrl + Shift + Win + H");
  assert.equal(Core.formatShortcut(binding, true), "⌃⇧⌘H");
  assert.equal(Core.formatShortcut({ key: "Escape", enabled: true }, false), "Esc");
});

test("mergeConfig 规范化并保留默认字段", () => {
  const merged = Core.mergeConfig({
    domains: [{ host: "  MyHost.Local:8080  ", enabled: true }, { host: "" }],
    shortcuts: {
      highlight: { key: "J", ctrl: true, enabled: true },
    },
  });

  assert.deepEqual(merged.domains, [{ host: "myhost.local:8080", enabled: true }]);
  assert.equal(merged.shortcuts.highlight.key, "j");
  assert.equal(merged.shortcuts.highlight.ctrl, true);
  assert.equal(merged.shortcuts.highlight.label, "高亮 / 划词即高亮");
  assert.equal(merged.shortcuts.ink.key, "d");
});

test("isEditableTarget 识别输入元素", () => {
  assert.equal(Core.isEditableTarget({ tagName: "INPUT" }), true);
  assert.equal(Core.isEditableTarget({ tagName: "textarea" }), true);
  assert.equal(Core.isEditableTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(Core.isEditableTarget({ tagName: "DIV", isContentEditable: false }), false);
});

test("handTool 默认绑定 V 键且 isKeyReleaseMatch 正确识别松开事件", () => {
  const cfg = Core.createDefaultConfig();
  assert.equal(cfg.shortcuts.handTool.key, "v");
  assert.equal(cfg.shortcuts.handTool.enabled, true);

  const binding = cfg.shortcuts.handTool;
  assert.equal(Core.isKeyReleaseMatch({ key: "v" }, binding), true);
  assert.equal(Core.isKeyReleaseMatch({ key: "V" }, binding), true);
  assert.equal(Core.isKeyReleaseMatch({ key: "Process", code: "KeyV" }, binding), true);
  // 按住期间即使修饰键变化，松开主键仍应释放
  assert.equal(Core.isKeyReleaseMatch({ key: "v", shiftKey: true }, binding), true);
  assert.equal(Core.isKeyReleaseMatch({ key: "h" }, binding), false);
  assert.equal(Core.isKeyReleaseMatch({ key: "v" }, { ...binding, enabled: false }), false);
});
