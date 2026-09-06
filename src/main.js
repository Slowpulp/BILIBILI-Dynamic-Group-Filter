import {
  COLLAPSIBLE_SECTIONS,
  DEFAULT_SETTINGS,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  SCHEMA_VERSION,
  addWatchLater,
  evaluateCard,
  fnv1a,
  normalizeFontScale,
  normalizeGroupCache,
  normalizeSettings,
  pruneHiddenRecords,
  sameWatchItem,
  watchKey,
} from "./core.js";
import { SELECTORS, collectCardWrappers, extractCardModel } from "./dom.js";
import {
  clampLauncherPixels,
  launcherCornerToPixels,
  placePanel,
} from "./layout.js";
import { GLOBAL_STYLE, PANEL_STYLE } from "./style.js";

const VERSION = "3.0.1";
const STORAGE_PREFIX = "__bilibili_timeline_focus_v1__";
const ROOT_ID = "btf-root";
const GLOBAL_STYLE_ID = "btf-global-style";
const PAGE_URL = "https://t.bilibili.com/";
const API_ORIGIN = "https://api.bilibili.com";
const GROUP_PAGE_SIZE = 50;
const GROUP_MAX_PAGES = 100;
const INSTANCE_KEY = "__BILIBILI_TIMELINE_FOCUS_INSTANCE__";
const LAUNCHER_SIZE = 48;
const LAUNCHER_MARGIN = 12;
const PANEL_MARGIN = 10;
const PANEL_GAP = 10;
const TYPE_LABELS = Object.freeze({
  video: "视频",
  image: "图文",
  forward: "转发",
  live: "直播",
  pgc: "番剧影视",
  other: "其他",
});

class ApiError extends Error {
  constructor(message, { code = null, status = null, cause = null } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

const Storage = {
  key(name) {
    return `${STORAGE_PREFIX}:${name}`;
  },
  read(name, fallback) {
    try {
      const raw = localStorage.getItem(this.key(name));
      return raw == null ? fallback : JSON.parse(raw);
    } catch (error) {
      console.warn("[动态净览] 本地设置读取失败", error);
      return fallback;
    }
  },
  write(name, value) {
    try {
      localStorage.setItem(this.key(name), JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn("[动态净览] 本地设置保存失败", error);
      return false;
    }
  },
  remove(name) {
    try {
      localStorage.removeItem(this.key(name));
    } catch (error) {
      console.warn("[动态净览] 本地设置删除失败", error);
    }
  },
};

class BilibiliApi {
  async request(path, { signal, timeoutMs = 15_000 } = {}) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromParent();
    else signal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = window.setTimeout(() => controller.abort("timeout"), timeoutMs);

    try {
      const response = await fetch(new URL(path, API_ORIGIN), {
        method: "GET",
        credentials: "include",
        mode: "cors",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ApiError(`HTTP ${response.status}`, { status: response.status });
      }
      let payload;
      try {
        payload = await response.json();
      } catch (cause) {
        throw new ApiError("接口返回了非 JSON 内容", { status: response.status, cause });
      }
      if (!payload || Number(payload.code) !== 0) {
        throw new ApiError(String(payload?.message || `B站接口错误 ${payload?.code ?? "unknown"}`), {
          code: Number(payload?.code),
          status: response.status,
        });
      }
      return payload.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) {
        const timedOut = controller.signal.reason === "timeout";
        throw new ApiError(timedOut ? "请求超时" : "请求已取消", {
          code: timedOut ? "TIMEOUT" : "ABORTED",
          cause: error,
        });
      }
      throw new ApiError("网络请求失败", { code: "NETWORK", cause: error });
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromParent);
    }
  }

  nav(options) {
    return this.request("/x/web-interface/nav", options);
  }

  async tags(options) {
    const data = await this.request("/x/relation/tags", options);
    const valid = Array.isArray(data) && data.every((tag) => {
      if (!tag || typeof tag !== "object" || Array.isArray(tag)) return false;
      return /^-?\d+$/.test(String(tag.tagid ?? ""));
    });
    if (!valid) {
      throw new ApiError("关注分组接口数据格式已变化", { code: "SHAPE" });
    }
    return data;
  }

  async tagMembers(tagId, expectedCount, { signal } = {}) {
    const members = [];
    const seen = new Set();
    let previousPageSignature = null;

    for (let page = 1; page <= GROUP_MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        tagid: String(tagId),
        pn: String(page),
        ps: String(GROUP_PAGE_SIZE),
      });
      const data = await this.request(`/x/relation/tag?${params}`, { signal });
      if (!Array.isArray(data)) {
        throw new ApiError("分组成员接口数据格式已变化", { code: "SHAPE" });
      }
      const list = data;
      const structurallyValid = list.every((member) => member
        && typeof member === "object"
        && !Array.isArray(member)
        && /^\d+$/.test(String(member.mid ?? "")));
      if (!structurallyValid) {
        throw new ApiError("分组成员接口数据格式已变化", { code: "SHAPE" });
      }
      const pageMids = list.map((member) => String(member.mid));
      if (new Set(pageMids).size !== pageMids.length) {
        throw new ApiError("分组成员单页包含重复账号", { code: "PAGINATION_INCOMPLETE" });
      }
      const pageSignature = [...pageMids].sort().join("|");
      if (list.length === GROUP_PAGE_SIZE && pageSignature === previousPageSignature) {
        throw new ApiError("分组成员分页返回了重复的完整页", { code: "PAGINATION_INCOMPLETE" });
      }
      previousPageSignature = pageSignature;
      const sizeBeforePage = seen.size;
      for (const member of list) {
        const mid = String(member?.mid ?? "");
        const name = String(member?.uname ?? "").trim();
        if (seen.has(mid)) continue;
        seen.add(mid);
        members.push({ mid, name });
      }
      // `count` is only a display hint and can lag behind the paginated result.
      // Stop on the server's short page instead of truncating at that stale hint.
      if (list.length > 0 && seen.size === sizeBeforePage) {
        throw new ApiError("分组成员分页没有返回新成员", { code: "PAGINATION_INCOMPLETE" });
      }
      if (list.length < GROUP_PAGE_SIZE) break;
      if (page === GROUP_MAX_PAGES) {
        throw new ApiError(`分组成员超过 ${GROUP_MAX_PAGES * GROUP_PAGE_SIZE} 条分页上限`, {
          code: "PAGINATION_INCOMPLETE",
        });
      }
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
    return members;
  }
}

const state = {
  api: new BilibiliApi(),
  settings: normalizeSettings(Storage.read("settings", DEFAULT_SETTINGS)),
  uid: null,
  loggedIn: null,
  accountReady: false,
  accountCheckPromise: null,
  accountRecheckPending: false,
  lastAccountCheckAt: 0,
  cookieUidSnapshot: cookieUid(),
  accountRecheckTimer: 0,
  groupCache: normalizeGroupCache(null),
  authorGroupsMap: {},
  hiddenRecords: {},
  watchLater: [],
  sessionHiddenWrappers: new WeakSet(),
  sessionHiddenStableIds: new WeakMap(),
  sessionHiddenOrigins: new WeakMap(),
  groupLoads: new Map(),
  root: null,
  shadow: null,
  ui: {},
  list: null,
  listObserver: null,
  bodyObserver: null,
  pendingCards: new Set(),
  scanFrame: 0,
  statsFrame: 0,
  bindFrame: 0,
  refilterToken: 0,
  cardSignatures: new WeakMap(),
  cardErrors: new WeakSet(),
  emptyNotice: null,
  status: { kind: "idle", message: "正在启动…" },
  stats: { total: 0, visible: 0, hidden: 0, unknown: 0 },
  viewMode: "normal",
  hiddenReasonSequence: 0,
  toastTimer: 0,
  toastUndo: null,
  resetArmedUntil: 0,
  clearHiddenArmedUntil: 0,
  resetTimer: 0,
  clearHiddenTimer: 0,
  routeActive: false,
  routeGeneration: 0,
  routeController: null,
  destroyed: false,
  historyHooks: [],
  drawerReturnFocus: null,
  launcherAnchor: null,
  panelResolvedDirection: null,
  panelFrame: 0,
  panelResizeObserver: null,
};

function isFeedRoute() {
  return location.hostname === "t.bilibili.com" && location.pathname === "/";
}

function cookieUid() {
  return document.cookie.match(/(?:^|;\s*)DedeUserID=(\d+)/)?.[1] ?? null;
}

function accountKey(kind) {
  return `${kind}:${state.uid || "anonymous"}`;
}

function currentGroupStates() {
  const key = String(state.uid ?? "anonymous");
  state.settings.groupStatesByUid[key] ??= {};
  return state.settings.groupStatesByUid[key];
}

function activeGroupIds() {
  const validIds = new Set(state.groupCache.groups.map((group) => group.id));
  return Object.entries(currentGroupStates())
    .filter(([id, value]) => validIds.has(String(id)) && (Number(value) === 1 || Number(value) === -1))
    .map(([id]) => String(id));
}

function areActiveGroupsReady() {
  const active = activeGroupIds();
  if (!active.length) return true;
  const byId = new Map(state.groupCache.groups.map((group) => [group.id, group]));
  return active.every((id) => Number(byId.get(id)?.loadedAt) > 0);
}

function saveSettings() {
  state.settings = normalizeSettings(state.settings);
  Storage.write("settings", state.settings);
}

function saveGroupCache() {
  if (!state.uid) return;
  state.groupCache = normalizeGroupCache(state.groupCache);
  Storage.write(accountKey("groups"), state.groupCache);
}

function saveHiddenRecords() {
  state.hiddenRecords = pruneHiddenRecords(state.hiddenRecords);
  Storage.write(accountKey("hidden"), state.hiddenRecords);
}

function saveWatchLater() {
  Storage.write(accountKey("watch"), state.watchLater);
}

function sanitizeWatchLater(raw) {
  if (!Array.isArray(raw)) return [];
  let output = [];
  // Bound work on corrupted or manually edited storage. Iterate backwards so
  // addWatchLater's prepend behavior preserves the stored newest-first order.
  for (const item of raw.slice(0, 1000).reverse()) {
    if (!item || typeof item !== "object" || (!item.id && !item.url)) continue;
    output = addWatchLater(output, item);
  }
  return output;
}

function loadAccountData() {
  state.groupCache = normalizeGroupCache(Storage.read(accountKey("groups"), null));
  state.hiddenRecords = pruneHiddenRecords(Storage.read(accountKey("hidden"), {}));
  state.watchLater = sanitizeWatchLater(Storage.read(accountKey("watch"), []));
  rebuildMembershipMap();
}

function abortGroupLoads() {
  for (const controller of state.groupLoads.values()) controller.abort();
  state.groupLoads.clear();
}

function resetAccountForDetection() {
  setHiddenOnlyView(false, { announce: false });
  abortGroupLoads();
  state.uid = null;
  state.loggedIn = null;
  state.accountReady = false;
  state.clearHiddenArmedUntil = 0;
  state.sessionHiddenWrappers = new WeakSet();
  state.sessionHiddenStableIds = new WeakMap();
  state.sessionHiddenOrigins = new WeakMap();
  // Keep account-scoped data empty until nav/cookie detection commits an
  // identity. This prevents even a brief flash of the previous account's
  // hidden decisions or watch list during startup.
  state.groupCache = normalizeGroupCache(null);
  state.hiddenRecords = {};
  state.watchLater = [];
  rebuildMembershipMap();
}

function clearAccountScopedCardUi() {
  for (const wrapper of document.querySelectorAll(SELECTORS.wrapper)) {
    const reason = wrapper.dataset.btfHiddenReason;
    if (reason === "manual" || reason === "group") clearHiddenDecision(wrapper);
    const watch = wrapper.querySelector(".btf-card-action[data-action='watch']");
    const hide = wrapper.querySelector(".btf-card-action[data-action='hide']");
    if (hide) {
      hide.disabled = true;
      hide.title = "正在确认账号";
      hide.setAttribute("aria-label", hide.title);
    }
    if (watch) {
      watch.disabled = true;
      watch.setAttribute("aria-pressed", "false");
      watch.title = "正在确认账号";
      watch.setAttribute("aria-label", watch.title);
      watch.querySelector(".btf-icon").textContent = "☆";
    }
  }
  updateStats();
}

function quarantineAccountChange(observedCookie = cookieUid()) {
  if (observedCookie === state.cookieUidSnapshot && !state.accountReady) return false;
  resetAccountForDetection();
  state.cookieUidSnapshot = observedCookie;
  state.lastAccountCheckAt = 0;
  hideToast();
  window.clearTimeout(state.clearHiddenTimer);
  state.clearHiddenTimer = 0;
  state.clearHiddenArmedUntil = 0;
  if (state.ui.clearHidden) state.ui.clearHidden.textContent = "恢复本地隐藏";
  clearAccountScopedCardUi();
  setStatus("loading", "检测到账号变化，正在隔离并重新同步…");
  renderUi();
  void refilterAll();
  return true;
}

function transitionAccount(nextUid, loggedIn) {
  const normalizedUid = nextUid == null || nextUid === "" ? null : String(nextUid);
  const identityChanged = state.uid !== normalizedUid;
  const sessionStatusChanged = state.loggedIn !== loggedIn;
  const shouldReload = identityChanged || !state.accountReady;
  if (identityChanged) {
    setHiddenOnlyView(false, { announce: false });
    abortGroupLoads();
    state.sessionHiddenWrappers = new WeakSet();
    state.sessionHiddenStableIds = new WeakMap();
    state.sessionHiddenOrigins = new WeakMap();
    hideToast();
    state.clearHiddenArmedUntil = 0;
    window.clearTimeout(state.clearHiddenTimer);
    state.clearHiddenTimer = 0;
    if (state.ui.clearHidden) state.ui.clearHidden.textContent = "恢复本地隐藏";
  }
  state.uid = normalizedUid;
  state.loggedIn = loggedIn;
  state.accountReady = true;
  if (shouldReload) loadAccountData();
  // A cookie-based fallback uses loggedIn=null. When nav later confirms the
  // same UID, callers still need to retry groups and clear the stale warning,
  // but the already-correct account partition does not need to be reloaded.
  return shouldReload || sessionStatusChanged;
}

function requireCurrentAccount() {
  if (!state.accountReady) {
    showToast("正在确认账号，请稍后再试");
    return false;
  }
  if (cookieUid() !== state.cookieUidSnapshot) {
    queueAccountRecheck();
    showToast("检测到账号状态变化，正在重新同步");
    return false;
  }
  return true;
}

function queueAccountRecheck() {
  const currentCookie = cookieUid();
  if (currentCookie === state.cookieUidSnapshot) return;
  quarantineAccountChange(currentCookie);
  state.accountRecheckPending = true;
  if (state.accountRecheckTimer || state.accountCheckPromise) return;
  state.accountRecheckTimer = window.setTimeout(() => {
    state.accountRecheckTimer = 0;
    recheckAccountOnResume();
  }, 250);
}

function retryAccountCheckSoon() {
  if (state.accountRecheckTimer || !state.routeActive || state.destroyed) return;
  state.accountRecheckPending = true;
  state.accountRecheckTimer = window.setTimeout(() => {
    state.accountRecheckTimer = 0;
    recheckAccountOnResume();
  }, 0);
}

function accountCookieStillCurrent(expectedCookie = state.cookieUidSnapshot) {
  const current = cookieUid();
  const matches = current === expectedCookie && state.cookieUidSnapshot === expectedCookie;
  if (!matches) queueAccountRecheck();
  return matches;
}

function rebuildMembershipMap() {
  state.groupCache = normalizeGroupCache(state.groupCache);
  state.authorGroupsMap = state.groupCache.memberships;
}

function ensureGlobalStyle() {
  let style = document.getElementById(GLOBAL_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = GLOBAL_STYLE_ID;
    style.textContent = GLOBAL_STYLE;
    (document.head || document.documentElement).append(style);
  }
}

function staticPanelMarkup() {
  return `
    <style>${PANEL_STYLE}</style>
    <button class="launcher" type="button" aria-label="打开动态净览" aria-controls="btf-panel" aria-expanded="false" title="打开动态净览（入口位置可在设置中选择）">
      <svg class="launcher-icon" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="btf-launcher-funnel-gradient" x1="2" y1="3" x2="16" y2="25" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#17d9b8"></stop>
            <stop offset=".24" stop-color="#00b7f0"></stop>
            <stop offset=".47" stop-color="#3887ff"></stop>
            <stop offset=".67" stop-color="#8b3dff"></stop>
            <stop offset=".84" stop-color="#e527d7"></stop>
            <stop offset="1" stop-color="#ff6471"></stop>
          </linearGradient>
          <linearGradient id="btf-launcher-sparkle-gradient" x1="18" y1="15" x2="25" y2="23" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#d91ee9"></stop>
            <stop offset=".52" stop-color="#ff2d96"></stop>
            <stop offset="1" stop-color="#ff9b24"></stop>
          </linearGradient>
        </defs>
        <path fill="url(#btf-launcher-funnel-gradient) #006f9e" d="M3.5 4h17c.82 0 1.24.99.66 1.57l-5.93 5.93a3.2 3.2 0 0 0-.94 2.27v7.9c0 .82-.89 1.33-1.6.91l-2.03-1.2a1.8 1.8 0 0 1-.89-1.55v-6.06c0-.85-.34-1.67-.94-2.27L2.84 5.57C2.26 4.99 2.67 4 3.5 4Z"></path>
        <path fill="url(#btf-launcher-sparkle-gradient) #e527d7" d="M21.45 15.25c.36 1.84 1.8 3.28 3.64 3.64-1.84.36-3.28 1.8-3.64 3.64-.36-1.84-1.8-3.28-3.64-3.64 1.84-.36 3.28-1.8 3.64-3.64Z"></path>
      </svg>
      <span class="badge" hidden>0</span>
    </button>
    <section class="panel" id="btf-panel" role="dialog" aria-label="B站动态净览筛选器" aria-hidden="true">
      <header class="panel-header">
        <div class="brand-mark" aria-hidden="true">净</div>
        <div class="brand">
          <h2 class="brand-title">动态净览</h2>
          <p class="brand-status" aria-live="polite">正在启动…</p>
        </div>
        <button class="icon-button collapse" type="button" aria-label="收起面板" title="收起">×</button>
      </header>
      <div class="stats" aria-label="筛选统计">
        <div class="stat"><strong data-stat="visible">0</strong><span>显示</span></div>
        <button class="stat stat-button hidden hidden-view-toggle" type="button" aria-label="没有隐藏动态" aria-pressed="false" disabled title="没有可查看的隐藏动态"><strong data-stat="hidden">0</strong><span>隐藏</span></button>
        <div class="stat unknown"><strong data-stat="unknown">0</strong><span>待识别</span></div>
      </div>
      <div class="scroll-area">
        <section class="section">
          <div class="switch-row">
            <div class="switch-copy"><strong>启用筛选</strong><span>关闭后立即恢复所有卡片</span></div>
            <button class="switch enabled-switch" type="button" role="switch" aria-label="启用筛选" aria-checked="true"></button>
          </div>
        </section>
        <section class="section collapsible-section" data-section-id="groups">
          <h3 class="section-title">
            <button class="section-toggle" id="btf-toggle-groups" type="button" data-section-id="groups" aria-expanded="true" aria-controls="btf-section-groups">
              <span class="section-title-label">关注分组</span>
              <span class="section-title-trailing"><span class="section-hint">包含取并集 · 排除优先</span><span class="section-chevron" aria-hidden="true"></span></span>
            </button>
          </h3>
          <div class="section-collapse" id="btf-section-groups" role="region" aria-labelledby="btf-toggle-groups" aria-hidden="false">
            <div class="section-content"><div class="section-content-inner">
              <input class="search group-search" type="search" placeholder="搜索分组" aria-label="搜索关注分组">
              <div class="group-gesture-help" id="btf-group-help">
                <span class="include-gesture">左键包含</span><span class="exclude-gesture">右键排除</span><span>同键再次点击取消</span>
              </div>
              <div class="groups" aria-live="polite"></div>
            </div></div>
          </div>
        </section>
        <section class="section collapsible-section" data-section-id="types">
          <h3 class="section-title">
            <button class="section-toggle" id="btf-toggle-types" type="button" data-section-id="types" aria-expanded="true" aria-controls="btf-section-types">
              <span class="section-title-label">隐藏内容类型</span>
              <span class="section-title-trailing"><span class="section-hint">未知类型会保留</span><span class="section-chevron" aria-hidden="true"></span></span>
            </button>
          </h3>
          <div class="section-collapse" id="btf-section-types" role="region" aria-labelledby="btf-toggle-types" aria-hidden="false">
            <div class="section-content"><div class="section-content-inner">
              <div class="chips type-chips"></div>
            </div></div>
          </div>
        </section>
        <section class="section collapsible-section" data-section-id="promotion">
          <h3 class="section-title">
            <button class="section-toggle" id="btf-toggle-promotion" type="button" data-section-id="promotion" aria-expanded="true" aria-controls="btf-section-promotion">
              <span class="section-title-label">推广与抽奖</span>
              <span class="section-title-trailing"><span class="section-hint">组合信号识别</span><span class="section-chevron" aria-hidden="true"></span></span>
            </button>
          </h3>
          <div class="section-collapse" id="btf-section-promotion" role="region" aria-labelledby="btf-toggle-promotion" aria-hidden="false">
            <div class="section-content"><div class="section-content-inner">
              <div class="promotion-options">
                <div class="switch-row promotion-option">
                  <div class="switch-copy"><strong>屏蔽推广动态</strong><span>识别商品卡、购买引导和促销组合信号</span></div>
                  <button class="switch promotion-switch" type="button" role="switch" aria-label="屏蔽推广动态" aria-checked="true"></button>
                </div>
                <div class="switch-row promotion-option">
                  <div class="switch-copy"><strong>屏蔽互动抽奖</strong><span>识别抽奖行为、参与条件与开奖信息</span></div>
                  <button class="switch giveaway-switch" type="button" role="switch" aria-label="屏蔽互动抽奖" aria-checked="true"></button>
                </div>
                <label class="field suspicious-field"><span>疑似内容处理</span><select class="suspicious-action" aria-label="疑似推广或抽奖内容处理方式"><option value="collapse">折叠，可手动展开</option><option value="show">正常显示</option></select></label>
                <p class="promotion-note">根据多项特征综合判断；单独出现“价格”或“抽奖”等词不会触发。</p>
              </div>
            </div></div>
          </div>
        </section>
        <section class="section collapsible-section" data-section-id="layout">
          <h3 class="section-title">
            <button class="section-toggle" id="btf-toggle-layout" type="button" data-section-id="layout" aria-expanded="true" aria-controls="btf-section-layout">
              <span class="section-title-label">界面与布局</span>
              <span class="section-title-trailing"><span class="section-chevron" aria-hidden="true"></span></span>
            </button>
          </h3>
          <div class="section-collapse" id="btf-section-layout" role="region" aria-labelledby="btf-toggle-layout" aria-hidden="false">
            <div class="section-content"><div class="section-content-inner">
              <div class="settings-grid">
                <label class="field"><span>主题</span><select class="theme"><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
                <label class="field"><span>入口位置</span><select class="launcher-corner"><option value="bottom-left">左下角</option><option value="bottom-right">右下角</option><option value="top-left">左上角</option><option value="top-right">右上角</option></select></label>
                <label class="field"><span>展开方向</span><select class="panel-direction"><option value="auto">自动避让</option><option value="up">向上优先</option><option value="down">向下优先</option><option value="left">向左优先</option><option value="right">向右优先</option></select></label>
                <label class="field"><span>卡片密度</span><select class="density"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
                <label class="field"><span>信息流宽度</span><select class="feed-width"><option value="default">原始</option><option value="wide">加宽</option></select></label>
              </div>
              <div class="font-toolbar" role="group" aria-label="界面字体大小">
                <span class="font-toolbar-label">界面字号</span>
                <button class="font-step font-decrease" type="button" aria-label="缩小界面字体" title="缩小字体">A−</button>
                <input class="font-scale" id="btf-font-scale" type="range" min="${FONT_SCALE_MIN}" max="${FONT_SCALE_MAX}" step="${FONT_SCALE_STEP}" aria-label="界面字体大小">
                <button class="font-step font-increase" type="button" aria-label="放大界面字体" title="放大字体">A+</button>
                <button class="font-reset" type="button" aria-label="恢复默认字体大小" title="恢复 100%"><output class="font-scale-value" for="btf-font-scale">100%</output></button>
              </div>
              <label class="inline-check"><input class="hide-sidebars" type="checkbox">专注模式：隐藏动态页侧栏</label>
              <div class="actions">
                <button class="button primary refresh-groups" type="button">刷新分组</button>
                <button class="button clear-groups" type="button">清空分组条件</button>
                <button class="button clear-hidden" type="button">恢复本地隐藏</button>
                <button class="button export-settings" type="button">导出设置</button>
                <button class="button import-settings" type="button">导入设置</button>
                <button class="button danger reset-settings" type="button">恢复默认</button>
                <input class="import-file" type="file" accept="application/json,.json" hidden>
              </div>
            </div></div>
          </div>
        </section>
      </div>
      <footer class="panel-footer">
        <span class="cache-info">v${VERSION}</span>
        <button class="footer-link open-watch" type="button" aria-controls="btf-watch-drawer" aria-expanded="false">本地稍后看（0）</button>
      </footer>
      <section class="drawer" id="btf-watch-drawer" role="region" aria-label="本地稍后看" aria-hidden="true">
        <header class="drawer-header"><h2>本地稍后看</h2><button class="icon-button close-watch" type="button" aria-label="关闭本地稍后看">×</button></header>
        <div class="watch-list"></div>
      </section>
    </section>
    <div class="toast" role="status"><span class="toast-message"></span><button class="toast-action" type="button" hidden>撤销</button></div>
  `;
}

function mountUi() {
  if (state.root?.isConnected) return;
  ensureGlobalStyle();
  document.getElementById(ROOT_ID)?.remove();
  const root = document.createElement("div");
  root.id = ROOT_ID;
  const shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML = staticPanelMarkup();
  document.body.append(root);
  state.root = root;
  state.shadow = shadow;
  state.ui = {
    launcher: shadow.querySelector(".launcher"),
    badge: shadow.querySelector(".badge"),
    panel: shadow.querySelector(".panel"),
    scrollArea: shadow.querySelector(".scroll-area"),
    stats: shadow.querySelector(".stats"),
    panelHeader: shadow.querySelector(".panel-header"),
    panelFooter: shadow.querySelector(".panel-footer"),
    status: shadow.querySelector(".brand-status"),
    collapse: shadow.querySelector(".collapse"),
    enabled: shadow.querySelector(".enabled-switch"),
    hiddenViewToggle: shadow.querySelector(".hidden-view-toggle"),
    sectionToggles: [...shadow.querySelectorAll(".section-toggle[data-section-id]")],
    groups: shadow.querySelector(".groups"),
    groupSearch: shadow.querySelector(".group-search"),
    typeChips: shadow.querySelector(".type-chips"),
    promotionEnabled: shadow.querySelector(".promotion-switch"),
    giveawayEnabled: shadow.querySelector(".giveaway-switch"),
    suspiciousAction: shadow.querySelector(".suspicious-action"),
    theme: shadow.querySelector(".theme"),
    launcherCorner: shadow.querySelector(".launcher-corner"),
    panelDirection: shadow.querySelector(".panel-direction"),
    fontScale: shadow.querySelector(".font-scale"),
    fontDecrease: shadow.querySelector(".font-decrease"),
    fontIncrease: shadow.querySelector(".font-increase"),
    fontReset: shadow.querySelector(".font-reset"),
    fontScaleValue: shadow.querySelector(".font-scale-value"),
    density: shadow.querySelector(".density"),
    feedWidth: shadow.querySelector(".feed-width"),
    hideSidebars: shadow.querySelector(".hide-sidebars"),
    refreshGroups: shadow.querySelector(".refresh-groups"),
    clearGroups: shadow.querySelector(".clear-groups"),
    clearHidden: shadow.querySelector(".clear-hidden"),
    exportSettings: shadow.querySelector(".export-settings"),
    importSettings: shadow.querySelector(".import-settings"),
    importFile: shadow.querySelector(".import-file"),
    resetSettings: shadow.querySelector(".reset-settings"),
    cacheInfo: shadow.querySelector(".cache-info"),
    openWatch: shadow.querySelector(".open-watch"),
    drawer: shadow.querySelector(".drawer"),
    closeWatch: shadow.querySelector(".close-watch"),
    watchList: shadow.querySelector(".watch-list"),
    toast: shadow.querySelector(".toast"),
    toastMessage: shadow.querySelector(".toast-message"),
    toastAction: shadow.querySelector(".toast-action"),
  };
  bindUiEvents();
  if (typeof window.ResizeObserver === "function") {
    state.panelResizeObserver = new window.ResizeObserver(() => schedulePanelPosition());
    state.panelResizeObserver.observe(state.ui.panel);
  }
  renderTypeChips();
  renderUi();
}

function viewportSize() {
  const visualViewport = window.visualViewport;
  return {
    left: Number(visualViewport?.offsetLeft) || 0,
    top: Number(visualViewport?.offsetTop) || 0,
    width: Math.max(1, Number(visualViewport?.width) || Number(window.innerWidth) || 1),
    height: Math.max(1, Number(visualViewport?.height) || Number(window.innerHeight) || 1),
  };
}

function applyLauncherPixels(pixels) {
  if (!state.root) return;
  const viewport = viewportSize();
  const next = clampLauncherPixels(pixels, {
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    viewportLeft: viewport.left,
    viewportTop: viewport.top,
    margin: LAUNCHER_MARGIN,
    launcherSize: LAUNCHER_SIZE,
  });
  state.root.style.left = `${next.x}px`;
  state.root.style.top = `${next.y}px`;
  state.root.style.right = "auto";
  state.root.style.bottom = "auto";
  state.root.dataset.edgeX = next.x + LAUNCHER_SIZE / 2 <= viewport.left + viewport.width / 2 ? "left" : "right";
  state.root.dataset.edgeY = next.y + LAUNCHER_SIZE / 2 <= viewport.top + viewport.height / 2 ? "top" : "bottom";
  state.launcherAnchor = {
    left: next.x,
    top: next.y,
    width: LAUNCHER_SIZE,
    height: LAUNCHER_SIZE,
  };
}

function applyLauncherPosition() {
  if (!state.root) return;
  const viewport = viewportSize();
  state.root.dataset.launcherCorner = state.settings.launcherCorner;
  applyLauncherPixels(launcherCornerToPixels(state.settings.launcherCorner, {
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    viewportLeft: viewport.left,
    viewportTop: viewport.top,
    margin: LAUNCHER_MARGIN,
    launcherSize: LAUNCHER_SIZE,
  }));
}

function positionPanel() {
  const { panel } = state.ui;
  if (!panel || !state.root?.isConnected || !state.settings.panelOpen || !state.launcherAnchor) return;
  const viewport = viewportSize();
  const maximumWidth = Math.max(1, viewport.width - PANEL_MARGIN * 2);
  const maximumHeight = Math.max(1, viewport.height - PANEL_MARGIN * 2);
  panel.style.maxWidth = `${maximumWidth}px`;
  panel.style.maxHeight = `${maximumHeight}px`;
  const rect = panel.getBoundingClientRect();
  const panelWidth = Math.min(maximumWidth, Math.max(1, Number(rect.width) || Math.min(340, maximumWidth)));
  const panelHeight = Math.min(maximumHeight, Math.max(1, Number(rect.height) || Math.min(760, maximumHeight)));
  const placement = placePanel({
    direction: state.panelResolvedDirection ?? state.settings.panelDirection,
    anchor: state.launcherAnchor,
    panelWidth,
    panelHeight,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    viewportLeft: viewport.left,
    viewportTop: viewport.top,
    margin: PANEL_MARGIN,
    gap: PANEL_GAP,
  });
  panel.style.left = `${placement.left}px`;
  panel.style.top = `${placement.top}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.dataset.direction = placement.direction;
  state.panelResolvedDirection = placement.direction;
}

function schedulePanelPosition() {
  if (state.panelFrame || !state.settings.panelOpen || !state.root) return;
  const root = state.root;
  const generation = state.routeGeneration;
  state.panelFrame = requestAnimationFrame(() => {
    state.panelFrame = 0;
    if (root !== state.root || !root.isConnected || generation !== state.routeGeneration) return;
    positionPanel();
  });
}

function isSectionCollapsed(sectionId) {
  return state.settings.collapsedSections.includes(sectionId);
}

function preferredPanelFocusTarget() {
  if (!isSectionCollapsed("groups") && state.ui.groupSearch?.isConnected) {
    return state.ui.groupSearch;
  }
  return state.ui.sectionToggles?.find((toggle) => toggle.dataset.sectionId === "groups")
    ?? state.ui.enabled;
}

function renderCollapsibleSections() {
  const activeElement = state.shadow?.activeElement;
  for (const toggle of state.ui.sectionToggles ?? []) {
    const sectionId = toggle.dataset.sectionId;
    const collapsed = isSectionCollapsed(sectionId);
    const section = toggle.closest(".collapsible-section");
    const content = state.shadow?.getElementById(toggle.getAttribute("aria-controls"));
    if (!section || !content) continue;
    if (collapsed && activeElement && content.contains(activeElement)) {
      toggle.focus({ preventScroll: true });
    }
    section.dataset.collapsed = String(collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    const label = toggle.querySelector(".section-title-label")?.textContent?.trim() || "模块";
    toggle.title = `${collapsed ? "展开" : "收起"}${label}`;
    content.setAttribute("aria-hidden", String(collapsed));
    content.toggleAttribute("inert", collapsed);
  }
}

function toggleCollapsibleSection(sectionId) {
  if (!COLLAPSIBLE_SECTIONS.includes(sectionId)) return;
  const collapsed = new Set(state.settings.collapsedSections);
  if (collapsed.has(sectionId)) collapsed.delete(sectionId);
  else collapsed.add(sectionId);
  state.settings.collapsedSections = COLLAPSIBLE_SECTIONS.filter((id) => collapsed.has(id));
  saveSettings();
  renderCollapsibleSections();
  schedulePanelPosition();
}

function handleViewportChange() {
  if (!state.root?.isConnected) return;
  state.panelResolvedDirection = null;
  applyLauncherPosition();
  schedulePanelPosition();
}

function bindUiEvents() {
  const ui = state.ui;
  ui.launcher.addEventListener("click", () => setPanelOpen(true));
  ui.hiddenViewToggle.addEventListener("click", () => {
    setHiddenOnlyView(state.viewMode !== "hidden");
  });
  for (const toggle of ui.sectionToggles) {
    toggle.addEventListener("click", () => toggleCollapsibleSection(toggle.dataset.sectionId));
    const content = state.shadow.getElementById(toggle.getAttribute("aria-controls"));
    content?.addEventListener("transitionend", (event) => {
      if (event.target === content && event.propertyName === "grid-template-rows") {
        schedulePanelPosition();
      }
    });
  }
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("orientationchange", handleViewportChange);
  window.visualViewport?.addEventListener("resize", handleViewportChange);
  window.visualViewport?.addEventListener("scroll", handleViewportChange);
  ui.collapse.addEventListener("click", () => setPanelOpen(false));
  ui.enabled.addEventListener("click", () => {
    state.settings.enabled = !state.settings.enabled;
    if (!state.settings.enabled) setHiddenOnlyView(false, { announce: false });
    saveSettings();
    renderUi();
    void refilterAll();
  });
  ui.groupSearch.addEventListener("input", () => renderGroups(ui.groupSearch.value));
  const applyGroupGesture = async (row, desired) => {
    try {
      await setGroupState(row.dataset.groupId, desired);
    } catch (error) {
      reportRuntimeError("更新分组筛选失败", error);
    }
  };
  ui.groups.addEventListener("click", (event) => {
    const row = event.target.closest(".group-row[data-group-id]");
    if (!row || event.button !== 0) return;
    void applyGroupGesture(row, 1);
  });
  ui.groups.addEventListener("contextmenu", (event) => {
    const row = event.target.closest(".group-row[data-group-id]");
    const fromTouch = event.pointerType === "touch" || event.sourceCapabilities?.firesTouchEvents === true;
    if (!row || event.button !== 2 || fromTouch) return;
    event.preventDefault();
    row.focus({ preventScroll: true });
    void applyGroupGesture(row, -1);
  });
  ui.groups.addEventListener("keydown", (event) => {
    const row = event.target.closest(".group-row[data-group-id]");
    if (!row || !event.shiftKey || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    void applyGroupGesture(row, -1);
  });
  ui.typeChips.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-type]");
    if (!button) return;
    const type = button.dataset.type;
    const hidden = new Set(state.settings.hiddenTypes);
    if (hidden.has(type)) hidden.delete(type);
    else hidden.add(type);
    state.settings.hiddenTypes = [...hidden];
    saveSettings();
    renderTypeChips();
    void refilterAll();
  });
  for (const [element, property] of [
    [ui.promotionEnabled, "promotionEnabled"],
    [ui.giveawayEnabled, "giveawayEnabled"],
  ]) {
    element.addEventListener("click", () => {
      state.settings[property] = !state.settings[property];
      saveSettings();
      renderPromotionSettings();
      void refilterAll();
    });
  }
  ui.suspiciousAction.addEventListener("change", () => {
    state.settings.suspiciousAction = ui.suspiciousAction.value;
    saveSettings();
    void refilterAll();
  });
  for (const [element, property] of [
    [ui.theme, "theme"],
    [ui.launcherCorner, "launcherCorner"],
    [ui.panelDirection, "panelDirection"],
    [ui.density, "density"],
    [ui.feedWidth, "feedWidth"],
  ]) {
    element.addEventListener("change", () => {
      state.settings[property] = element.value;
      saveSettings();
      if (property === "launcherCorner" || property === "panelDirection") {
        state.panelResolvedDirection = null;
      }
      applyLayoutSettings();
    });
  }
  ui.fontScale.addEventListener("input", () => setFontScale(ui.fontScale.value, { persist: false }));
  ui.fontScale.addEventListener("change", () => setFontScale(ui.fontScale.value));
  ui.fontDecrease.addEventListener("click", () => setFontScale(state.settings.fontScale - FONT_SCALE_STEP));
  ui.fontIncrease.addEventListener("click", () => setFontScale(state.settings.fontScale + FONT_SCALE_STEP));
  ui.fontReset.addEventListener("click", () => setFontScale(100));
  ui.hideSidebars.addEventListener("change", () => {
    state.settings.hideSidebars = ui.hideSidebars.checked;
    saveSettings();
    applyLayoutSettings();
  });
  ui.refreshGroups.addEventListener("click", () => {
    void refreshGroups({ force: true }).catch((error) => reportRuntimeError("刷新分组失败", error));
  });
  ui.clearGroups.addEventListener("click", () => {
    if (!requireCurrentAccount()) return;
    state.settings.groupStatesByUid[String(state.uid ?? "anonymous")] = {};
    abortGroupLoads();
    setStatus("ready", "已清空分组条件");
    saveSettings();
    renderGroups(ui.groupSearch.value);
    void refilterAll();
    showToast("已清空分组条件");
  });
  ui.clearHidden.addEventListener("click", () => {
    void clearHiddenRecords().catch((error) => reportRuntimeError("恢复隐藏记录失败", error));
  });
  ui.exportSettings.addEventListener("click", exportSettings);
  ui.importSettings.addEventListener("click", () => ui.importFile.click());
  ui.importFile.addEventListener("change", importSettings);
  ui.resetSettings.addEventListener("click", resetSettings);
  ui.openWatch.addEventListener("click", () => openWatchDrawer(true));
  ui.closeWatch.addEventListener("click", () => openWatchDrawer(false));
  ui.toastAction.addEventListener("click", () => {
    const undo = state.toastUndo;
    hideToast();
    undo?.();
  });
  ui.toast.addEventListener("focusin", () => window.clearTimeout(state.toastTimer));
  ui.toast.addEventListener("focusout", () => queueMicrotask(() => {
    if (ui.toast.classList.contains("show") && !ui.toast.contains(state.shadow?.activeElement)) {
      scheduleToastHide(state.toastUndo ? 6000 : 3200);
    }
  }));
  document.addEventListener("keydown", handleGlobalKeydown);
}

function setPanelOpen(open) {
  const shouldOpen = Boolean(open);
  if (!shouldOpen && state.ui.drawer?.classList.contains("open")) {
    openWatchDrawer(false, { restoreFocus: false });
  }
  if (state.settings.panelOpen !== shouldOpen) state.panelResolvedDirection = null;
  state.settings.panelOpen = shouldOpen;
  saveSettings();
  renderUi();
  window.setTimeout(() => {
    if (shouldOpen) preferredPanelFocusTarget()?.focus();
    else state.ui.launcher?.focus();
  }, 0);
}

function handleGlobalKeydown(event) {
  if (!state.root?.isConnected) return;
  if (event.key === "Escape") {
    if (state.ui.drawer?.classList.contains("open")) openWatchDrawer(false);
    else if (state.settings.panelOpen) setPanelOpen(false);
    return;
  }
}

function setStatus(kind, message) {
  state.status = { kind, message: String(message) };
  if (state.ui.status) {
    state.ui.status.textContent = state.status.message;
    state.ui.status.dataset.kind = kind;
  }
}

function renderUi() {
  if (!state.root) return;
  state.root.dataset.open = String(state.settings.panelOpen);
  state.root.dataset.theme = state.settings.theme;
  state.root.dataset.panelDirection = state.settings.panelDirection;
  state.ui.launcher.setAttribute("aria-expanded", String(state.settings.panelOpen));
  state.ui.panel.setAttribute("aria-hidden", String(!state.settings.panelOpen));
  state.ui.enabled.setAttribute("aria-checked", String(state.settings.enabled));
  state.ui.status.textContent = state.status.message;
  state.ui.theme.value = state.settings.theme;
  state.ui.launcherCorner.value = state.settings.launcherCorner;
  state.ui.panelDirection.value = state.settings.panelDirection;
  state.ui.density.value = state.settings.density;
  state.ui.feedWidth.value = state.settings.feedWidth;
  state.ui.hideSidebars.checked = state.settings.hideSidebars;
  state.ui.refreshGroups.disabled = !state.accountReady || state.loggedIn === false;
  renderCollapsibleSections();
  renderGroups(state.ui.groupSearch.value);
  renderTypeChips();
  renderPromotionSettings();
  renderStats();
  renderCacheInfo();
  renderWatchLater();
  renderFontScaleControls();
  applyLayoutSettings();
}

function renderPromotionSettings() {
  if (!state.ui.promotionEnabled) return;
  state.ui.promotionEnabled.setAttribute("aria-checked", String(state.settings.promotionEnabled));
  state.ui.giveawayEnabled.setAttribute("aria-checked", String(state.settings.giveawayEnabled));
  state.ui.suspiciousAction.value = state.settings.suspiciousAction === "show" ? "show" : "collapse";
}

function renderFontScaleControls() {
  if (!state.ui.fontScale) return;
  const scale = normalizeFontScale(state.settings.fontScale);
  state.ui.fontScale.value = String(scale);
  state.ui.fontScale.setAttribute("aria-valuetext", `${scale}%`);
  state.ui.fontScaleValue.textContent = `${scale}%`;
  state.ui.fontDecrease.disabled = scale <= FONT_SCALE_MIN;
  state.ui.fontIncrease.disabled = scale >= FONT_SCALE_MAX;
  state.ui.fontReset.disabled = scale === 100;
}

function setFontScale(value, { persist = true } = {}) {
  state.settings.fontScale = normalizeFontScale(value);
  if (persist) saveSettings();
  renderFontScaleControls();
  applyLayoutSettings();
}

function renderTypeChips() {
  const container = state.ui.typeChips;
  if (!container) return;
  if (!container.childElementCount) {
    for (const [type, label] of Object.entries(TYPE_LABELS)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset.type = type;
      button.textContent = label;
      container.append(button);
    }
  }
  for (const button of container.querySelectorAll("button[data-type]")) {
    button.setAttribute("aria-pressed", String(state.settings.hiddenTypes.includes(button.dataset.type)));
  }
}

function renderGroups(search = "") {
  const container = state.ui.groups;
  if (!container) return;
  const active = state.shadow?.activeElement;
  const focusedGroupId = active?.matches?.(".group-row[data-group-id]") && container.contains(active)
    ? active.dataset.groupId
    : null;
  container.replaceChildren();
  const needle = String(search).trim().toLocaleLowerCase("zh-CN");
  const groups = state.groupCache.groups.filter((group) => !needle || group.name.toLocaleLowerCase("zh-CN").includes(needle));
  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "empty-groups";
    empty.textContent = state.loggedIn === false
      ? "登录 B 站后可读取关注分组；其他筛选仍可使用。"
      : state.groupCache.groups.length
        ? "没有匹配的分组"
        : "暂无分组数据";
    container.append(empty);
    if (focusedGroupId) state.ui.groupSearch?.focus({ preventScroll: true });
    return;
  }

  const states = currentGroupStates();
  for (const group of groups) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "group-row";
    row.dataset.groupId = group.id;
    const groupState = Number(states[group.id]) === 1 ? 1 : Number(states[group.id]) === -1 ? -1 : 0;
    const stateText = groupState === 1 ? "包含" : groupState === -1 ? "排除" : "未选择";
    row.dataset.state = String(groupState);
    row.setAttribute("aria-pressed", String(groupState !== 0));
    row.setAttribute("aria-describedby", "btf-group-help");
    row.setAttribute("aria-label", `${group.name}，当前${stateText}。回车或空格切换包含，Shift 加回车或空格切换排除`);
    row.setAttribute("aria-keyshortcuts", "Enter Space Shift+Enter Shift+Space");
    row.title = "左键：包含 · 右键：排除 · 同键再次点击：取消";
    if (state.groupLoads.has(group.id)) {
      row.classList.add("loading");
      row.setAttribute("aria-busy", "true");
    }

    const name = document.createElement("span");
    name.className = "group-name";
    const strong = document.createElement("strong");
    strong.textContent = group.name;
    strong.title = group.name;
    const count = document.createElement("span");
    count.textContent = state.groupLoads.has(group.id)
      ? "正在读取成员…"
      : `${group.count} 人${group.loadedAt ? " · 已缓存" : ""}`;
    name.append(strong, count);

    const stateLabel = document.createElement("span");
    stateLabel.className = "group-state";
    stateLabel.textContent = stateText;
    row.append(name, stateLabel);
    container.append(row);
  }
  if (focusedGroupId) {
    const replacement = [...container.querySelectorAll(".group-row[data-group-id]")].find((row) => (
      row.dataset.groupId === focusedGroupId
    ));
    (replacement ?? state.ui.groupSearch)?.focus({ preventScroll: true });
  }
}

function applyViewMode() {
  const hiddenView = state.viewMode === "hidden" && state.routeActive && state.settings.enabled;
  state.viewMode = hiddenView ? "hidden" : "normal";
  if (hiddenView) document.documentElement.dataset.btfViewMode = "hidden";
  else delete document.documentElement.dataset.btfViewMode;
  if (state.root) state.root.dataset.viewMode = state.viewMode;

  for (const hide of document.querySelectorAll(".btf-card-action[data-action='hide']")) {
    const wrapper = hide.closest(SELECTORS.wrapper);
    if (wrapper) updateHideButton(wrapper);
  }

  const button = state.ui.hiddenViewToggle;
  if (!button) return;
  button.setAttribute("aria-pressed", String(hiddenView));
  button.disabled = !state.settings.enabled || (!hiddenView && state.stats.hidden === 0);
  if (hiddenView) {
    button.setAttribute("aria-label", `退出只看隐藏动态，当前已加载 ${state.stats.hidden} 条`);
    button.title = "恢复显示未被隐藏的动态";
  } else if (state.stats.hidden > 0) {
    button.setAttribute("aria-label", `只看 ${state.stats.hidden} 条隐藏动态`);
    button.title = "只显示当前已加载的隐藏动态";
  } else {
    button.setAttribute("aria-label", "没有隐藏动态");
    button.title = "没有可查看的隐藏动态";
  }
}

function setHiddenOnlyView(showHidden, { announce = true } = {}) {
  const nextHidden = Boolean(showHidden);
  // A list removal may arrive immediately before the click. Recount the live
  // DOM synchronously so a stale tile cannot open an empty hidden-only view.
  if (nextHidden) updateStats();
  if (nextHidden && (!state.routeActive || !state.settings.enabled || state.stats.hidden === 0)) return false;
  state.viewMode = nextHidden ? "hidden" : "normal";
  applyViewMode();
  updateEmptyNotice();
  if (announce) {
    showToast(nextHidden
      ? `正在只看当前已加载的 ${state.stats.hidden} 条隐藏动态`
      : "已恢复显示未被隐藏的动态");
  }
  return true;
}

function renderStats() {
  if (!state.shadow) return;
  for (const [key, value] of Object.entries({
    visible: state.stats.visible,
    hidden: state.stats.hidden,
    unknown: state.stats.unknown,
  })) {
    const element = state.shadow.querySelector(`[data-stat='${key}']`);
    if (element) element.textContent = String(value);
  }
  state.ui.badge.textContent = String(state.stats.hidden);
  state.ui.badge.hidden = state.stats.hidden === 0;
  applyViewMode();
}

function renderCacheInfo() {
  if (!state.ui.cacheInfo) return;
  const age = Date.now() - Number(state.groupCache.fetchedAt || 0);
  const suffix = state.groupCache.fetchedAt
    ? age < 60_000 ? "刚刚同步" : age < 3_600_000 ? `${Math.floor(age / 60_000)} 分钟前同步` : `${Math.floor(age / 3_600_000)} 小时前同步`
    : "分组未同步";
  state.ui.cacheInfo.textContent = `v${VERSION} · ${suffix}`;
}

function applyLayoutSettings() {
  const html = document.documentElement;
  html.dataset.btfDensity = state.settings.density;
  html.dataset.btfWidth = state.settings.feedWidth;
  html.dataset.btfFocus = String(state.settings.hideSidebars);
  const scale = normalizeFontScale(state.settings.fontScale);
  html.style.setProperty("--btf-card-action-font-size", `${12 * scale / 100}px`);
  html.style.setProperty("--btf-empty-font-size", `${14 * scale / 100}px`);
  html.style.setProperty("--btf-card-icon-font-size", `${13 * scale / 100}px`);
  if (state.root) {
    state.root.dataset.theme = state.settings.theme;
    state.root.dataset.panelDirection = state.settings.panelDirection;
    state.root.dataset.fontSize = scale >= 130 ? "large" : "normal";
    state.root.style.setProperty("--btf-ui-font-size", `${12 * scale / 100}px`);
    applyLauncherPosition();
    positionPanel();
    schedulePanelPosition();
  }
}

function clearLayoutSettings() {
  const html = document.documentElement;
  delete html.dataset.btfDensity;
  delete html.dataset.btfWidth;
  delete html.dataset.btfFocus;
  delete html.dataset.btfViewMode;
  html.style.removeProperty("--btf-card-action-font-size");
  html.style.removeProperty("--btf-empty-font-size");
  html.style.removeProperty("--btf-card-icon-font-size");
}

async function setGroupState(groupId, desired) {
  if (!requireCurrentAccount()) return;
  if (!state.uid) {
    showToast("登录 B 站后才能使用关注分组");
    return;
  }
  const generation = state.routeGeneration;
  const expectedUid = state.uid;
  const expectedCookie = state.cookieUidSnapshot;
  const stillCurrent = () => state.routeActive
    && generation === state.routeGeneration
    && state.uid === expectedUid
    && accountCookieStillCurrent(expectedCookie)
    && Boolean(state.ui.groups);
  const states = currentGroupStates();
  const previous = Number(states[groupId]) || 0;
  const next = previous === desired ? 0 : desired;
  if (next === 0) {
    delete states[groupId];
    state.groupLoads.get(groupId)?.abort();
    state.groupLoads.delete(groupId);
    saveSettings();
    setStatus(state.groupLoads.size ? "loading" : "ready", state.groupLoads.size ? "其他分组仍在读取…" : "已取消该分组条件");
    renderGroups(state.ui.groupSearch.value);
    await refilterAll();
    return;
  }

  states[groupId] = next;
  saveSettings();
  renderGroups(state.ui.groupSearch.value);
  await refilterAll();
  if (!stillCurrent() || Number(currentGroupStates()[groupId]) !== next) return;
  const loaded = await ensureGroupLoaded(groupId);
  if (!stillCurrent()) return;
  if (!loaded && !state.groupCache.groups.find((group) => group.id === groupId)?.loadedAt) {
    const liveStates = currentGroupStates();
    if (Number(liveStates[groupId]) === next) {
      delete liveStates[groupId];
      saveSettings();
      showToast("该分组暂时无法读取，已取消条件");
    }
  }
  renderGroups(state.ui.groupSearch.value);
  await refilterAll();
}

async function ensureGroupLoaded(groupId, { force = false } = {}) {
  if (!state.routeActive || state.destroyed || !state.uid) return false;
  const group = state.groupCache.groups.find((item) => item.id === String(groupId));
  if (!group) return false;
  const maximumAge = state.settings.cacheHours * 3_600_000;
  const cacheFresh = group.loadedAt && Date.now() - Number(group.loadedAt) < maximumAge;
  if (cacheFresh && !force) return true;
  const existing = state.groupLoads.get(group.id);
  if (existing && !existing.signal.aborted) return existing.promise;
  if (existing) state.groupLoads.delete(group.id);

  const controller = new AbortController();
  const generation = state.routeGeneration;
  const expectedUid = state.uid;
  const expectedCookie = state.cookieUidSnapshot;
  const hadCachedMembers = Number(group.loadedAt) > 0;
  state.groupLoads.set(group.id, controller);
  const followReplacementOrFallback = () => {
    const replacement = state.groupLoads.get(group.id);
    if (replacement
      && replacement !== controller
      && !replacement.signal.aborted
      && state.routeActive
      && generation === state.routeGeneration
      && state.uid === expectedUid
      && accountCookieStillCurrent(expectedCookie)) {
      return replacement.promise;
    }
    return hadCachedMembers;
  };
  const run = (async () => {
    renderGroups(state.ui.groupSearch?.value || "");
    setStatus("loading", `正在读取“${group.name}”成员…`);
    try {
      const members = await state.api.tagMembers(group.id, group.count, { signal: controller.signal });
      if (controller.signal.aborted) return followReplacementOrFallback();
      if (!state.routeActive || generation !== state.routeGeneration || state.uid !== expectedUid || !accountCookieStillCurrent(expectedCookie)) {
        return hadCachedMembers;
      }
      const currentGroup = state.groupCache.groups.find((item) => item.id === group.id);
      if (!currentGroup) return false;
      if (group.count > 0 && members.length === 0) {
        throw new ApiError("分组人数与成员列表不一致", { code: "EMPTY_MEMBERS" });
      }
      currentGroup.memberMids = members.map((member) => member.mid).filter(Boolean);
      currentGroup.memberNames = members.map((member) => member.name).filter(Boolean);
      currentGroup.loadedAt = Date.now();
      saveGroupCache();
      rebuildMembershipMap();
      setStatus("ready", `“${group.name}”已就绪`);
      return true;
    } catch (error) {
      if (error.code === "ABORTED") {
        return followReplacementOrFallback();
      }
      if (!accountCookieStillCurrent(expectedCookie)) return hadCachedMembers;
      if (error.code === -101 && state.routeActive && generation === state.routeGeneration && state.uid === expectedUid) {
        transitionAccount(null, false);
        setStatus("login", "登录状态已失效；类型与推广抽奖筛选仍可使用");
        renderUi();
        void refilterAll();
        return false;
      }
      if (error.code !== "ABORTED" && state.routeActive && generation === state.routeGeneration && state.uid === expectedUid) {
        setStatus("warning", friendlyApiMessage(error, hadCachedMembers ? "分组成员更新失败，继续使用缓存" : "分组成员读取失败"));
      }
      return hadCachedMembers;
    } finally {
      if (state.groupLoads.get(group.id) === controller) state.groupLoads.delete(group.id);
      if (state.routeActive && generation === state.routeGeneration && state.uid === expectedUid && accountCookieStillCurrent(expectedCookie) && state.ui.groups) {
        renderGroups(state.ui.groupSearch?.value || "");
      }
    }
  })();
  controller.promise = run;
  return run;
}

async function ensureActiveGroups({ force = false } = {}) {
  const ids = activeGroupIds();
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor];
      cursor += 1;
      await ensureGroupLoaded(id, { force });
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, ids.length) }, worker));
  const byId = new Map(state.groupCache.groups.map((group) => [group.id, group]));
  const maximumAge = state.settings.cacheHours * 3_600_000;
  return {
    unavailableIds: ids.filter((id) => Number(byId.get(id)?.loadedAt) <= 0),
    staleIds: ids.filter((id) => {
      const loadedAt = Number(byId.get(id)?.loadedAt) || 0;
      return loadedAt > 0 && Date.now() - loadedAt >= maximumAge;
    }),
  };
}

function setGroupReadinessStatus(successMessage, readiness) {
  const nameFor = (id) => state.groupCache.groups.find((group) => group.id === id)?.name ?? id;
  if (readiness.unavailableIds.length) {
    const names = readiness.unavailableIds.slice(0, 2).map(nameFor).join("、");
    setStatus("warning", `${names}${readiness.unavailableIds.length > 2 ? "等" : ""}暂未生效，相关内容已安全放行`);
    return false;
  }
  if (readiness.staleIds.length) {
    const names = readiness.staleIds.slice(0, 2).map(nameFor).join("、");
    setStatus("warning", `${names}${readiness.staleIds.length > 2 ? "等" : ""}更新失败，正在使用旧缓存`);
    return true;
  }
  setStatus("ready", successMessage);
  return true;
}

function mergeTags(tags) {
  // Replacing the cache while a member request owns an older group object can
  // otherwise make that successful response disappear into a detached object.
  abortGroupLoads();
  const previous = new Map(state.groupCache.groups.map((group) => [group.id, group]));
  const groups = (Array.isArray(tags) ? tags : []).map((tag) => {
    const id = String(tag?.tagid ?? "");
    const cached = previous.get(id);
    const count = Math.max(0, Number(tag?.count) || 0);
    const membershipMayHaveChanged = Boolean(cached) && cached.count !== count;
    return {
      id,
      name: String(tag?.name ?? id),
      count,
      loadedAt: membershipMayHaveChanged ? 0 : Number(cached?.loadedAt) || 0,
      memberMids: membershipMayHaveChanged ? [] : cached?.memberMids ?? [],
      memberNames: membershipMayHaveChanged ? [] : cached?.memberNames ?? [],
    };
  }).filter((group) => group.id);
  state.groupCache = normalizeGroupCache({
    uid: state.uid,
    fetchedAt: Date.now(),
    groups,
  });
  const validIds = new Set(groups.map((group) => group.id));
  const states = currentGroupStates();
  let settingsChanged = false;
  for (const id of Object.keys(states)) {
    if (!validIds.has(id)) {
      delete states[id];
      settingsChanged = true;
    }
  }
  if (settingsChanged) saveSettings();
  rebuildMembershipMap();
  saveGroupCache();
}

function friendlyApiMessage(error, fallback) {
  if (error?.code === -101) return "请先登录 B 站；类型与推广抽奖筛选仍可使用";
  if (error?.status === 412 || error?.code === -352 || error?.code === -401) return "B站请求受限，已停止重试并保留缓存";
  if (error?.code === "TIMEOUT") return "B站接口响应超时，已保留缓存";
  if (error?.code === "NETWORK") return "当前网络不可用，已保留缓存";
  if (["SHAPE", "EMPTY_MEMBERS", "PAGINATION_INCOMPLETE"].includes(error?.code)) return "B站接口数据异常，已保留缓存并安全放行";
  return `${fallback}：${error?.message || "未知错误"}`;
}

function reportRuntimeError(context, error) {
  if (error?.code === "ABORTED" || error?.name === "AbortError") return;
  console.error(`[动态净览] ${context}`, error);
  if (state.routeActive) setStatus("error", `${context}，请刷新页面重试`);
}

async function refreshGroups({ force = false, generation = state.routeGeneration } = {}) {
  if (!state.routeActive || generation !== state.routeGeneration) return false;
  if (!requireCurrentAccount()) return false;
  if (!state.uid) {
    setStatus("login", "请先登录 B 站；其他筛选仍可使用");
    renderUi();
    return false;
  }
  const expectedUid = state.uid;
  const expectedCookie = state.cookieUidSnapshot;
  const cacheAge = Date.now() - Number(state.groupCache.fetchedAt || 0);
  const cacheFresh = state.groupCache.groups.length && cacheAge < state.settings.cacheHours * 3_600_000;
  if (!force && cacheFresh) {
    const readiness = await ensureActiveGroups();
    if (!state.routeActive || generation !== state.routeGeneration || state.uid !== expectedUid || !accountCookieStillCurrent(expectedCookie)) return false;
    const usable = setGroupReadinessStatus(`已载入 ${state.groupCache.groups.length} 个关注分组`, readiness);
    renderUi();
    await refilterAll();
    return usable;
  }

  if (state.ui.refreshGroups) state.ui.refreshGroups.disabled = true;
  setStatus("loading", "正在同步关注分组…");
  try {
    const tags = await state.api.tags({ signal: state.routeController?.signal });
    if (!state.routeActive || generation !== state.routeGeneration || state.uid !== expectedUid || !accountCookieStillCurrent(expectedCookie)) return false;
    mergeTags(tags);
    const readiness = await ensureActiveGroups({ force });
    if (!state.routeActive || generation !== state.routeGeneration || state.uid !== expectedUid || !accountCookieStillCurrent(expectedCookie)) return false;
    const usable = setGroupReadinessStatus(`已同步 ${state.groupCache.groups.length} 个关注分组`, readiness);
    renderUi();
    await refilterAll();
    return usable;
  } catch (error) {
    if (error.code === "ABORTED") return false;
    if (!state.routeActive || generation !== state.routeGeneration || state.uid !== expectedUid || !accountCookieStillCurrent(expectedCookie)) return false;
    if (error.code === -101) transitionAccount(null, false);
    setStatus("warning", friendlyApiMessage(error, "关注分组同步失败"));
    renderUi();
    await refilterAll();
    return false;
  } finally {
    if (state.ui.refreshGroups) state.ui.refreshGroups.disabled = false;
  }
}

async function detectAccount({ signal } = {}) {
  const generation = state.routeGeneration;
  const cookieAtStart = cookieUid();
  let nextUid;
  let nextLoggedIn;
  let warning = null;
  try {
    const nav = await state.api.nav({ signal });
    if (!nav?.isLogin || !nav?.mid) {
      nextUid = null;
      nextLoggedIn = false;
    } else {
      nextUid = String(nav.mid);
      nextLoggedIn = true;
    }
  } catch (error) {
    if (error.code === "ABORTED") return { completed: false, changed: false, retry: false };
    if (error.code === -101) {
      nextUid = null;
      nextLoggedIn = false;
    } else {
      nextUid = cookieAtStart;
      nextLoggedIn = cookieAtStart ? null : false;
      warning = friendlyApiMessage(error, "登录状态检查失败");
    }
  }
  if (signal?.aborted || !state.routeActive || generation !== state.routeGeneration) {
    return { completed: false, changed: false, retry: false };
  }
  const cookieAtCommit = cookieUid();
  if (cookieAtCommit !== cookieAtStart) {
    // The nav response and cookie fallback belong to a no-longer-current
    // session. Never commit a mixed A/B identity; ask the caller to retry.
    return { completed: false, changed: false, retry: true };
  }
  const changed = transitionAccount(nextUid, nextLoggedIn);
  state.cookieUidSnapshot = cookieAtCommit;
  state.lastAccountCheckAt = Date.now();
  if (warning) setStatus("warning", warning);
  return { completed: true, changed };
}

function queueCards(elements) {
  if (!state.routeActive || state.destroyed) return;
  for (const element of elements) {
    if (element?.nodeType === 1) state.pendingCards.add(element);
  }
  if (state.scanFrame) return;
  state.scanFrame = requestAnimationFrame(flushCardQueue);
}

function flushCardQueue() {
  state.scanFrame = 0;
  if (!state.routeActive || state.destroyed) {
    state.pendingCards.clear();
    return;
  }
  const batch = [...state.pendingCards];
  state.pendingCards.clear();
  for (const wrapper of batch) processCardSafely(wrapper);
  updateStats();
}

function queueStatsUpdate() {
  if (state.statsFrame || !state.routeActive || state.destroyed) return;
  const generation = state.routeGeneration;
  state.statsFrame = requestAnimationFrame(() => {
    state.statsFrame = 0;
    if (!state.routeActive || state.destroyed || generation !== state.routeGeneration) return;
    updateStats();
  });
}

function processCardSafely(wrapper, options) {
  try {
    processCard(wrapper, options);
    state.cardErrors.delete(wrapper);
    return true;
  } catch (error) {
    if (wrapper?.dataset) {
      clearHiddenDecision(wrapper);
      delete wrapper.dataset.btfAuthorKnown;
      clearCollapsedCard(wrapper);
    }
    state.cardSignatures.delete(wrapper);
    if (wrapper && !state.cardErrors.has(wrapper)) {
      state.cardErrors.add(wrapper);
      console.warn("[动态净览] 单张动态处理失败，已放行并继续处理后续卡片", error);
    }
    return false;
  }
}

function processCard(wrapper, { force = false } = {}) {
  if (!wrapper?.isConnected || !wrapper.matches?.(SELECTORS.wrapper)) return;
  const model = extractCardModel(wrapper, location.href);
  let contentSignalsSignature = "";
  try {
    contentSignalsSignature = fnv1a(JSON.stringify(model.contentSignals ?? null));
  } catch {
    contentSignalsSignature = "unavailable";
  }
  const signature = [
    model.identity,
    model.authorMid,
    model.authorName,
    model.type,
    model.typeKnown,
    model.linkKnown,
    model.primaryUrl,
    model.relatedUrls.join(","),
    contentSignalsSignature,
    fnv1a(model.text),
  ].join("|");
  const existingToolbar = wrapper.querySelector(".btf-card-tools");
  const collapseUiCurrent = !wrapper.hasAttribute("data-btf-collapsed-reason")
    || Boolean(wrapper.querySelector(":scope > .btf-card-collapse-toggle"));
  const hiddenDescriptionId = wrapper.dataset.btfHiddenDescriptionId;
  const hiddenDescription = wrapper.querySelector(":scope > .btf-hidden-reason");
  const hiddenUiCurrent = !wrapper.hasAttribute("data-btf-hidden-reason")
    || Boolean(
      hiddenDescriptionId
      && hiddenDescription?.id === hiddenDescriptionId
      && (wrapper.getAttribute("aria-describedby") || "").split(/\s+/).includes(hiddenDescriptionId),
    );
  if (
    !force
    && state.cardSignatures.get(wrapper) === signature
    && existingToolbar
    && cardToolbarPlacementIsCurrent(wrapper, existingToolbar)
    && collapseUiCurrent
    && hiddenUiCurrent
  ) return;
  state.cardSignatures.set(wrapper, signature);
  wrapper.dataset.btfAuthorKnown = String(Boolean(model.authorMid));
  enhanceCard(wrapper);
  applyCardDecision(wrapper, model);
  updateWatchButton(wrapper, model);
}

function hiddenOriginFromModel(model) {
  return {
    identity: model.identity,
    persistable: model.persistable,
    authorMid: model.authorMid || null,
    url: model.linkKnown ? model.primaryUrl : "",
    aliasUrls: model.relatedUrls,
    migratedIdentity: model.persistable ? model.identity : null,
  };
}

function hiddenWrapperIsContinuous(origin, model, trackedStableIdentity) {
  if (!origin) return false;
  if (trackedStableIdentity) return model.persistable && model.identity === trackedStableIdentity;
  if (origin.persistable) return model.persistable && model.identity === origin.identity;

  const originMid = origin.authorMid || null;
  const nextMid = model.authorMid || null;
  if (originMid && nextMid && originMid !== nextMid) return false;
  const originHasUrl = Boolean(origin.url);
  const nextHasUrl = Boolean(model.linkKnown);
  if (originHasUrl && nextHasUrl) {
    return sameWatchItem(origin, {
      url: model.primaryUrl,
      dynamicId: model.dynamicId,
      aliasUrls: model.relatedUrls,
    });
  }
  if (originHasUrl !== nextHasUrl) return false;
  if (originMid && nextMid) return originMid === nextMid;

  // A stable ID appearing without any matching author or URL signal is more
  // likely a virtual-list node being reused than hydration of the hidden card.
  if (model.persistable || originMid !== nextMid) return false;
  return true;
}

function hiddenReasonLabel(reason) {
  switch (reason) {
    case "manual": return "本地手动隐藏";
    case "group": return "关注分组";
    case "type": return "内容类型";
    case "promotion": return "商品推广";
    case "giveaway": return "互动抽奖";
    default: return "筛选规则";
  }
}

function setHiddenDecision(wrapper, reason, detail = "") {
  const normalizedReason = String(reason || "filtered");
  const normalizedDetail = String(detail || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const description = `隐藏原因：${hiddenReasonLabel(normalizedReason)}${normalizedDetail ? ` · ${normalizedDetail}` : ""}`;
  wrapper.dataset.btfHiddenReason = normalizedReason;
  wrapper.dataset.btfHiddenDetail = description;

  let descriptionId = wrapper.dataset.btfHiddenDescriptionId;
  const duplicateId = descriptionId ? document.getElementById(descriptionId) : null;
  if (!descriptionId || duplicateId && duplicateId.parentElement !== wrapper) {
    descriptionId = `btf-hidden-reason-${++state.hiddenReasonSequence}`;
    wrapper.dataset.btfHiddenDescriptionId = descriptionId;
  }
  let reasonNode = wrapper.querySelector(":scope > .btf-hidden-reason");
  if (!reasonNode) {
    reasonNode = document.createElement("div");
    reasonNode.className = "btf-hidden-reason";
    reasonNode.dataset.btfOwned = "hidden-reason";
    reasonNode.setAttribute("role", "note");
    wrapper.insertBefore(reasonNode, wrapper.firstChild);
  }
  reasonNode.id = descriptionId;
  reasonNode.textContent = description;
  const describedBy = new Set((wrapper.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
  describedBy.add(descriptionId);
  wrapper.setAttribute("aria-describedby", [...describedBy].join(" "));
}

function clearHiddenDecision(wrapper) {
  if (!wrapper?.dataset) return;
  const descriptionId = wrapper.dataset.btfHiddenDescriptionId;
  if (descriptionId) {
    const describedBy = (wrapper.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((token) => token && token !== descriptionId);
    if (describedBy.length) wrapper.setAttribute("aria-describedby", describedBy.join(" "));
    else wrapper.removeAttribute("aria-describedby");
  }
  delete wrapper.dataset.btfHiddenReason;
  delete wrapper.dataset.btfHiddenDetail;
  delete wrapper.dataset.btfHiddenDescriptionId;
  wrapper.querySelector?.(":scope > .btf-hidden-reason")?.remove();
}

function collapsedReasonLabel(reason) {
  if (reason === "giveaway") return "疑似互动抽奖";
  if (reason === "promotion") return "疑似推广";
  return "疑似需要过滤的内容";
}

function updateCollapsedCardToggle(wrapper) {
  const toggle = wrapper.querySelector(":scope > .btf-card-collapse-toggle");
  if (!toggle) return;
  const expanded = wrapper.dataset.btfCollapsedExpanded === "true";
  const label = collapsedReasonLabel(wrapper.dataset.btfCollapsedReason);
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.textContent = expanded ? `${label} · 点击收起` : `${label}，已折叠 · 点击展开`;
  const detail = wrapper.dataset.btfCollapsedDetail;
  toggle.title = `${expanded ? "收起这条动态" : "临时展开这条动态"}${detail ? `；判断依据：${detail}` : ""}`;
}

function collapseCard(wrapper, decision, model) {
  const reason = String(decision?.reason || "suspicious");
  const identity = String(model?.identity || "unknown");
  if (
    wrapper.dataset.btfCollapsedReason !== reason
    || wrapper.dataset.btfCollapsedIdentity !== identity
  ) {
    delete wrapper.dataset.btfCollapsedExpanded;
  }
  wrapper.dataset.btfCollapsedReason = reason;
  wrapper.dataset.btfCollapsedIdentity = identity;
  wrapper.dataset.btfCollapsedDetail = String(decision?.detail || "").replace(/\s+/g, " ").trim().slice(0, 120);
  let toggle = wrapper.querySelector(":scope > .btf-card-collapse-toggle");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btf-card-collapse-toggle";
    toggle.dataset.btfOwned = "collapse-toggle";
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      wrapper.dataset.btfCollapsedExpanded = String(wrapper.dataset.btfCollapsedExpanded !== "true");
      updateCollapsedCardToggle(wrapper);
    });
    wrapper.insertBefore(toggle, wrapper.firstChild);
  }
  updateCollapsedCardToggle(wrapper);
}

function clearCollapsedCard(wrapper) {
  if (!wrapper) return;
  const toggle = wrapper.querySelector?.(":scope > .btf-card-collapse-toggle");
  if (toggle && (document.activeElement === toggle || toggle.contains(document.activeElement))) {
    state.ui.launcher?.focus({ preventScroll: true });
  }
  delete wrapper.dataset.btfCollapsedReason;
  delete wrapper.dataset.btfCollapsedIdentity;
  delete wrapper.dataset.btfCollapsedDetail;
  delete wrapper.dataset.btfCollapsedExpanded;
  toggle?.remove();
}

function applyCardDecision(wrapper, model) {
  if (!state.settings.enabled) {
    clearHiddenDecision(wrapper);
    clearCollapsedCard(wrapper);
    return;
  }
  if (state.sessionHiddenWrappers.has(wrapper)) {
    const trackedStableIdentity = state.sessionHiddenStableIds.get(wrapper);
    const origin = state.sessionHiddenOrigins.get(wrapper);
    if (!hiddenWrapperIsContinuous(origin, model, trackedStableIdentity)) {
      // A virtualized list may reuse the same element for another post. The
      // old post stays hidden by its persisted ID; the new post must be judged
      // independently.
      state.sessionHiddenWrappers.delete(wrapper);
      state.sessionHiddenStableIds.delete(wrapper);
      state.sessionHiddenOrigins.delete(wrapper);
    } else {
      if (model.persistable && !state.hiddenRecords[model.identity]) {
        state.hiddenRecords[model.identity] = Date.now();
        state.sessionHiddenStableIds.set(wrapper, model.identity);
        origin.migratedIdentity = model.identity;
        saveHiddenRecords();
      }
      clearCollapsedCard(wrapper);
      setHiddenDecision(wrapper, "manual");
      return;
    }
  }
  const groupMap = areActiveGroupsReady() ? state.authorGroupsMap : null;
  const decision = evaluateCard(model, state.settings, {
    uid: state.uid,
    groupStates: currentGroupStates(),
    authorGroupsMap: groupMap,
    hiddenRecords: state.hiddenRecords,
  });
  const action = decision?.action ?? (decision?.visible === false ? "hide" : "show");
  if (action === "collapse") {
    clearHiddenDecision(wrapper);
    collapseCard(wrapper, decision, model);
    return;
  }
  clearCollapsedCard(wrapper);
  if (action === "hide") setHiddenDecision(wrapper, decision.reason, decision.detail);
  else clearHiddenDecision(wrapper);
}

function actionButton(icon, label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btf-card-action";
  button.dataset.action = action;
  button.title = label;
  button.setAttribute("aria-label", label);
  const iconSpan = document.createElement("span");
  iconSpan.className = "btf-icon";
  iconSpan.setAttribute("aria-hidden", "true");
  iconSpan.textContent = icon;
  const labelSpan = document.createElement("span");
  labelSpan.className = "btf-label";
  labelSpan.textContent = label;
  button.append(iconSpan, document.createTextNode(" "), labelSpan);
  return button;
}

function clearCardToolPlacement(root) {
  for (const host of root?.querySelectorAll?.("[data-btf-card-tools-host]") ?? []) {
    delete host.dataset.btfCardToolsHost;
  }
  for (const slot of root?.querySelectorAll?.("[data-btf-card-author-slot]") ?? []) {
    delete slot.dataset.btfCardAuthorSlot;
  }
}

function authorTitlePlacement(header) {
  const authorName = header.querySelector(SELECTORS.authorName);
  const title = authorName?.closest(".bili-dyn-title, [data-module='title']");
  if (
    !authorName
    || !title
    || title === header
    || !header.contains(title)
    || title.closest("a, button, label, [role='button'], [role='link']")
  ) {
    return null;
  }
  let authorSlot = authorName;
  while (authorSlot.parentElement && authorSlot.parentElement !== title) {
    authorSlot = authorSlot.parentElement;
  }
  return authorSlot.parentElement === title ? { title, authorSlot } : null;
}

function cardToolbarPlacementIsCurrent(wrapper, toolbar) {
  const card = wrapper.querySelector(SELECTORS.card) ?? wrapper;
  const header = card.querySelector(".bili-dyn-item__header");
  if (!header) return false;
  const placement = authorTitlePlacement(header);
  if (placement) {
    return toolbar.dataset.placement === "author"
      && toolbar.parentElement === placement.title
      && toolbar.previousElementSibling === placement.authorSlot
      && placement.title.dataset.btfCardToolsHost === "author"
      && placement.authorSlot.dataset.btfCardAuthorSlot === "true";
  }
  return toolbar.dataset.placement === "header" && toolbar.parentElement === header;
}

function placeCardToolbar(wrapper, header, toolbar) {
  clearCardToolPlacement(wrapper);
  const placement = authorTitlePlacement(header);
  if (placement) {
    placement.title.dataset.btfCardToolsHost = "author";
    placement.authorSlot.dataset.btfCardAuthorSlot = "true";
    toolbar.dataset.placement = "author";
    placement.title.insertBefore(toolbar, placement.authorSlot.nextSibling);
    return;
  }
  toolbar.dataset.placement = "header";
  const more = header.querySelector(".bili-dyn-item__more");
  header.insertBefore(toolbar, more?.parentElement === header ? more : null);
}

function enhanceCard(wrapper) {
  const card = wrapper.querySelector(SELECTORS.card) ?? wrapper;
  const header = card.querySelector(".bili-dyn-item__header");
  if (!header) return;
  let toolbar = wrapper.querySelector(".btf-card-tools");
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.className = "btf-card-tools";
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", "动态净览本地操作");
    const hide = actionButton("×", "隐藏", "hide");
    const watch = actionButton("☆", "本地稍后看", "watch");
    toolbar.append(hide, watch);
    toolbar.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.action === "hide") hideCard(wrapper, { focusUndo: event.detail === 0 });
      if (button.dataset.action === "watch") toggleWatchLater(wrapper);
    });
  }
  placeCardToolbar(wrapper, header, toolbar);
  wrapper.dataset.btfEnhanced = "true";
}

function hideCard(wrapper, { focusUndo = false } = {}) {
  if (state.viewMode === "hidden") {
    showToast("只看隐藏动态时不可再次隐藏；请先退出该视图");
    return;
  }
  if (!requireCurrentAccount()) return;
  const model = extractCardModel(wrapper, location.href);
  const hiddenOrigin = hiddenOriginFromModel(model);
  state.sessionHiddenWrappers.add(wrapper);
  state.sessionHiddenOrigins.set(wrapper, hiddenOrigin);
  if (model.persistable) {
    state.hiddenRecords[model.identity] = Date.now();
    state.sessionHiddenStableIds.set(wrapper, model.identity);
    saveHiddenRecords();
  }
  applyCardDecision(wrapper, model);
  updateStats();
  showToast(model.persistable ? "已在本机隐藏这条动态" : "本次浏览中已隐藏（未找到稳定动态 ID）", () => {
    delete state.hiddenRecords[model.identity];
    const migratedIdentity = hiddenOrigin.migratedIdentity;
    if (migratedIdentity) delete state.hiddenRecords[migratedIdentity];
    state.sessionHiddenWrappers.delete(wrapper);
    state.sessionHiddenStableIds.delete(wrapper);
    state.sessionHiddenOrigins.delete(wrapper);
    saveHiddenRecords();
    processCard(wrapper, { force: true });
    updateStats();
    if (focusUndo) window.setTimeout(() => wrapper.querySelector(".btf-card-action[data-action='hide']")?.focus(), 0);
  });
  if (focusUndo) window.setTimeout(() => state.ui.toastAction?.focus(), 0);
}

function watchItemFromModel(model) {
  return {
    id: watchKey(model.primaryUrl, model.dynamicId),
    dynamicId: model.dynamicId || undefined,
    url: model.primaryUrl,
    aliasUrls: model.relatedUrls,
    title: model.title,
    author: model.authorName || "未知作者",
    time: model.time,
    addedAt: Date.now(),
  };
}

function toggleWatchLater(wrapper) {
  if (!requireCurrentAccount()) return;
  const model = extractCardModel(wrapper, location.href);
  if (!model.linkKnown) {
    showToast("这条动态没有可确认的详情链接，暂时无法加入稍后看");
    return;
  }
  const item = watchItemFromModel(model);
  const index = state.watchLater.findIndex((entry) => sameWatchItem(entry, item));
  if (index >= 0) {
    state.watchLater.splice(index, 1);
    showToast("已从本地稍后看移除");
  } else {
    state.watchLater = addWatchLater(state.watchLater, item);
    showToast("已加入本地稍后看");
  }
  saveWatchLater();
  updateWatchButton(wrapper, model);
  renderWatchLater();
}

function updateHideButton(wrapper) {
  const hide = wrapper.querySelector(".btf-card-action[data-action='hide']");
  if (!hide) return;
  if (!state.accountReady) {
    hide.disabled = true;
    hide.title = "正在确认账号";
  } else if (state.viewMode === "hidden") {
    hide.disabled = true;
    hide.title = "只看隐藏动态时不可再次隐藏";
  } else {
    hide.disabled = false;
    hide.title = "隐藏";
  }
  hide.setAttribute("aria-label", hide.title);
}

function updateWatchButton(wrapper, model = extractCardModel(wrapper, location.href)) {
  const button = wrapper.querySelector(".btf-card-action[data-action='watch']");
  const hide = wrapper.querySelector(".btf-card-action[data-action='hide']");
  if (!button && !hide) return;
  updateHideButton(wrapper);
  if (!state.accountReady) {
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-pressed", "false");
      button.title = "正在确认账号";
      button.setAttribute("aria-label", button.title);
      button.querySelector(".btf-icon").textContent = "☆";
    }
    return;
  }
  if (!button) return;
  if (!model.linkKnown) {
    button.disabled = true;
    button.setAttribute("aria-pressed", "false");
    button.title = "未找到可确认的详情链接";
    button.setAttribute("aria-label", button.title);
    button.querySelector(".btf-icon").textContent = "☆";
    return;
  }
  button.disabled = false;
  const item = watchItemFromModel(model);
  const saved = state.watchLater.some((entry) => sameWatchItem(entry, item));
  button.setAttribute("aria-pressed", String(saved));
  button.title = saved ? "从本地稍后看移除" : "加入本地稍后看";
  button.setAttribute("aria-label", button.title);
  button.querySelector(".btf-icon").textContent = saved ? "★" : "☆";
}

function safeBilibiliUrl(raw) {
  try {
    const url = new URL(raw, PAGE_URL);
    return url.protocol === "https:" && (url.hostname === "bilibili.com" || url.hostname.endsWith(".bilibili.com"))
      ? url.href
      : PAGE_URL;
  } catch {
    return PAGE_URL;
  }
}

function renderWatchLater({ focusIndex = null } = {}) {
  if (!state.ui.watchList) return;
  state.ui.openWatch.textContent = `本地稍后看（${state.watchLater.length}）`;
  state.ui.watchList.replaceChildren();
  if (!state.watchLater.length) {
    const empty = document.createElement("div");
    empty.className = "watch-empty";
    empty.textContent = "还没有内容。把鼠标移到动态卡片上，点击“☆ 本地稍后看”即可收藏到这台设备。";
    state.ui.watchList.append(empty);
    if (focusIndex != null) state.ui.closeWatch?.focus({ preventScroll: true });
    return;
  }

  for (const item of state.watchLater) {
    const row = document.createElement("article");
    row.className = "watch-item";
    const body = document.createElement("div");
    const link = document.createElement("a");
    link.href = safeBilibiliUrl(item.url);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.title || "未命名动态";
    link.title = item.title || "未命名动态";
    const meta = document.createElement("div");
    meta.className = "watch-meta";
    meta.textContent = [item.author, item.time].filter(Boolean).join(" · ");
    body.append(link, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "watch-remove";
    remove.textContent = "×";
    remove.title = "移除";
    remove.setAttribute("aria-label", `移除：${item.title || "未命名动态"}`);
    remove.addEventListener("click", () => {
      if (!requireCurrentAccount()) return;
      const removedIndex = state.watchLater.findIndex((entry) => sameWatchItem(entry, item));
      state.watchLater = state.watchLater.filter((entry) => !sameWatchItem(entry, item));
      saveWatchLater();
      renderWatchLater({ focusIndex: Math.max(0, Math.min(removedIndex, state.watchLater.length - 1)) });
      document.querySelectorAll(`${SELECTORS.wrapper}[data-btf-enhanced='true']`).forEach((wrapper) => updateWatchButton(wrapper));
    });
    row.append(body, remove);
    state.ui.watchList.append(row);
  }
  if (focusIndex != null) {
    const removeButtons = state.ui.watchList.querySelectorAll(".watch-remove");
    removeButtons[Math.min(focusIndex, removeButtons.length - 1)]?.focus({ preventScroll: true });
  }
}

function openWatchDrawer(open, { restoreFocus = true } = {}) {
  const shouldOpen = Boolean(open);
  if (!state.ui.drawer) return;
  if (shouldOpen) state.drawerReturnFocus = state.shadow?.activeElement ?? state.ui.openWatch;
  state.ui.drawer.classList.toggle("open", shouldOpen);
  state.ui.drawer.setAttribute("aria-hidden", String(!shouldOpen));
  state.ui.openWatch?.setAttribute("aria-expanded", String(shouldOpen));
  for (const element of [state.ui.panelHeader, state.ui.stats, state.ui.scrollArea, state.ui.panelFooter]) {
    if (!element) continue;
    element.inert = shouldOpen;
    if (shouldOpen) element.setAttribute("aria-hidden", "true");
    else element.removeAttribute("aria-hidden");
  }
  if (shouldOpen) {
    renderWatchLater();
    window.setTimeout(() => state.ui.closeWatch?.focus(), 0);
  } else if (restoreFocus) {
    const target = state.drawerReturnFocus;
    state.drawerReturnFocus = null;
    window.setTimeout(() => target?.isConnected && target.focus(), 0);
  }
}

function showToast(message, undo = null) {
  if (!state.ui.toastMessage || !state.ui.toastAction || !state.ui.toast) return;
  window.clearTimeout(state.toastTimer);
  state.toastUndo = undo;
  state.ui.toastMessage.textContent = String(message);
  state.ui.toastAction.hidden = typeof undo !== "function";
  state.ui.toast.classList.add("show");
  if (!state.ui.toast.contains(state.shadow?.activeElement)) scheduleToastHide(undo ? 6000 : 3200);
}

function scheduleToastHide(delay) {
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(hideToast, delay);
}

function hideToast({ restoreFocus = true } = {}) {
  const hadFocus = Boolean(state.ui.toast?.contains(state.shadow?.activeElement));
  window.clearTimeout(state.toastTimer);
  state.toastTimer = 0;
  state.ui.toast?.classList.remove("show");
  state.toastUndo = null;
  if (hadFocus && restoreFocus) {
    const target = state.ui.drawer?.classList.contains("open")
      ? state.ui.closeWatch
      : state.settings.panelOpen ? preferredPanelFocusTarget() : state.ui.launcher;
    window.setTimeout(() => target?.isConnected && target.focus(), 0);
  }
}

function exportSettings() {
  const payload = {
    product: "B站动态净览",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bilibili-timeline-focus-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("设置已导出（不含隐藏记录和稍后看）");
}

async function importSettings(event) {
  const [file] = event.target.files ?? [];
  event.target.value = "";
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    setHiddenOnlyView(false, { announce: false });
    state.settings = normalizeSettings(payload?.settings ?? payload);
    state.settings.panelOpen = true;
    state.panelResolvedDirection = null;
    saveSettings();
    renderUi();
    await ensureActiveGroups();
    await refilterAll();
    showToast("设置导入成功");
  } catch (error) {
    console.warn("[动态净览] 设置导入失败", error);
    showToast("设置文件无效，未做更改");
  }
}

async function clearHiddenRecords() {
  if (!requireCurrentAccount()) return;
  const now = Date.now();
  if (now > state.clearHiddenArmedUntil) {
    state.clearHiddenArmedUntil = now + 3500;
    state.ui.clearHidden.textContent = "再次点击确认";
    showToast("再次点击“恢复本地隐藏”以恢复当前账号的全部隐藏动态");
    window.clearTimeout(state.clearHiddenTimer);
    state.clearHiddenTimer = window.setTimeout(() => {
      state.clearHiddenTimer = 0;
      if (Date.now() > state.clearHiddenArmedUntil && state.ui.clearHidden) {
        state.ui.clearHidden.textContent = "恢复本地隐藏";
      }
    }, 3600);
    return;
  }
  state.hiddenRecords = {};
  state.sessionHiddenWrappers = new WeakSet();
  state.sessionHiddenStableIds = new WeakMap();
  state.sessionHiddenOrigins = new WeakMap();
  Storage.remove(accountKey("hidden"));
  window.clearTimeout(state.clearHiddenTimer);
  state.clearHiddenTimer = 0;
  state.clearHiddenArmedUntil = 0;
  state.ui.clearHidden.textContent = "恢复本地隐藏";
  await refilterAll();
  showToast("已恢复当前账号在本机隐藏的动态");
}

async function resetSettings() {
  const now = Date.now();
  if (now > state.resetArmedUntil) {
    state.resetArmedUntil = now + 3500;
    state.ui.resetSettings.textContent = "再次点击确认";
    showToast("再次点击“恢复默认”以确认；隐藏记录和稍后看会保留");
    window.clearTimeout(state.resetTimer);
    state.resetTimer = window.setTimeout(() => {
      state.resetTimer = 0;
      if (Date.now() > state.resetArmedUntil && state.ui.resetSettings) state.ui.resetSettings.textContent = "恢复默认";
    }, 3600);
    return;
  }
  const panelOpen = true;
  setHiddenOnlyView(false, { announce: false });
  state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, panelOpen });
  state.panelResolvedDirection = null;
  saveSettings();
  window.clearTimeout(state.resetTimer);
  state.resetTimer = 0;
  state.resetArmedUntil = 0;
  state.ui.resetSettings.textContent = "恢复默认";
  renderUi();
  await refilterAll();
  showToast("设置已恢复默认");
}

async function refilterAll() {
  const token = ++state.refilterToken;
  const generation = state.routeGeneration;
  const wrappers = [...document.querySelectorAll(SELECTORS.wrapper)];
  let index = 0;
  return new Promise((resolve) => {
    const run = () => {
      if (state.destroyed || !state.routeActive || token !== state.refilterToken || generation !== state.routeGeneration) {
        resolve(false);
        return;
      }
      const end = Math.min(index + 40, wrappers.length);
      for (; index < end; index += 1) processCardSafely(wrappers[index], { force: true });
      if (index < wrappers.length) requestAnimationFrame(run);
      else {
        updateStats();
        resolve(true);
      }
    };
    run();
  });
}

function updateStats() {
  if (state.statsFrame) {
    cancelAnimationFrame(state.statsFrame);
    state.statsFrame = 0;
  }
  const wrappers = [...document.querySelectorAll(SELECTORS.wrapper)];
  const hidden = wrappers.filter((wrapper) => wrapper.hasAttribute("data-btf-hidden-reason")).length;
  const groupFiltering = activeGroupIds().length > 0;
  const unknown = groupFiltering
    ? wrappers.filter((wrapper) => wrapper.dataset.btfAuthorKnown === "false").length
    : 0;
  state.stats = {
    total: wrappers.length,
    visible: wrappers.length - hidden,
    hidden,
    unknown,
  };
  renderStats();
  updateEmptyNotice();
}

function updateEmptyNotice() {
  if (!state.list?.isConnected) return;
  const hiddenViewEmpty = state.settings.enabled && state.viewMode === "hidden" && state.stats.hidden === 0;
  const normalViewEmpty = state.settings.enabled
    && state.viewMode === "normal"
    && state.stats.total > 0
    && state.stats.visible === 0;
  const shouldShow = hiddenViewEmpty || normalViewEmpty;
  if (!shouldShow) {
    state.emptyNotice?.remove();
    state.emptyNotice = null;
    return;
  }
  if (!state.emptyNotice?.isConnected) {
    const notice = document.createElement("div");
    notice.className = "btf-feed-empty";
    state.list.insertAdjacentElement("afterend", notice);
    state.emptyNotice = notice;
  }
  state.emptyNotice.dataset.viewMode = state.viewMode;
  state.emptyNotice.textContent = hiddenViewEmpty
    ? "当前已加载范围内没有隐藏动态。再次点击“隐藏”统计卡即可返回普通动态。"
    : "当前条件下没有匹配的动态。可在“动态净览”中清空条件，或继续向下滚动加载更多。";
}

function bindList() {
  state.bindFrame = 0;
  if (!state.routeActive || state.destroyed) return;
  const list = document.querySelector(SELECTORS.list);
  if (!list) {
    setStatus(state.loggedIn === false ? "login" : "waiting", state.loggedIn === false ? "请先登录 B 站；其他筛选仍可使用" : "正在等待动态列表…");
    return;
  }
  if (state.list === list && state.listObserver) return;
  state.listObserver?.disconnect();
  state.list = list;
  state.listObserver = new MutationObserver((mutations) => {
    const wrappers = [];
    let removedCard = false;
    for (const mutation of mutations) {
      const targetElement = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
      if (targetElement?.closest?.(".btf-card-tools, [data-btf-owned]")) continue;
      if (mutation.type === "attributes" || mutation.type === "characterData") {
        const closest = targetElement?.closest?.(SELECTORS.wrapper);
        if (closest) wrappers.push(closest);
        continue;
      }
      const targetWrapper = targetElement?.closest?.(SELECTORS.wrapper);
      for (const node of mutation.removedNodes) {
        if (node.nodeType === 1 && collectCardWrappers(node).length) removedCard = true;
        // Removed content can change both the card identity and its decision.
        // In particular, if Bilibili removes one of our direct controls while
        // patching a card, processing the still-connected wrapper recreates it.
        if (targetWrapper) wrappers.push(targetWrapper);
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 3) {
          const closest = node.parentElement?.closest?.(SELECTORS.wrapper);
          if (closest) wrappers.push(closest);
          continue;
        }
        if (node.nodeType !== 1 || node.closest?.(".btf-card-tools, [data-btf-owned]")) continue;
        const closest = node.closest?.(SELECTORS.wrapper);
        if (closest) wrappers.push(closest);
        wrappers.push(...collectCardWrappers(node));
      }
    }
    if (wrappers.length) queueCards(wrappers);
    if (removedCard) queueStatsUpdate();
  });
  state.listObserver.observe(list, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "data-mid",
      "data-did",
      "data-url",
      "data-module",
      "data-type",
      "data-dyn-card-type",
      "dyn-id",
      "href",
      "class",
    ],
  });
  queueCards(collectCardWrappers(list));
  if (state.loggedIn !== false && state.status.kind === "waiting") setStatus("ready", "动态列表已连接");
}

function queueBindList() {
  if (state.bindFrame || !state.routeActive) return;
  state.bindFrame = requestAnimationFrame(bindList);
}

function observePage() {
  state.bodyObserver?.disconnect();
  state.bodyObserver = new MutationObserver((mutations) => {
    queueAccountRecheck();
    if (!state.list?.isConnected) {
      queueBindList();
      return;
    }
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1 && (node.matches?.(SELECTORS.list) || node.querySelector?.(SELECTORS.list))) {
          queueBindList();
          return;
        }
      }
    }
  });
  state.bodyObserver.observe(document.body, { childList: true, subtree: true });
}

function clearOurCardChanges() {
  document.querySelectorAll(SELECTORS.wrapper).forEach((wrapper) => {
    clearHiddenDecision(wrapper);
    delete wrapper.dataset.btfEnhanced;
    delete wrapper.dataset.btfAuthorKnown;
    clearCollapsedCard(wrapper);
    wrapper.querySelector(".btf-card-tools")?.remove();
    clearCardToolPlacement(wrapper);
  });
  state.emptyNotice?.remove();
  state.emptyNotice = null;
}

async function activateRoute() {
  if (state.routeActive || state.destroyed) return;
  const generation = ++state.routeGeneration;
  state.routeActive = true;
  state.viewMode = "normal";
  delete document.documentElement.dataset.btfViewMode;
  state.routeController?.abort();
  state.routeController = new AbortController();
  resetAccountForDetection();
  mountUi();
  observePage();
  bindList();
  setStatus("loading", "正在检查登录状态…");
  const accountPromise = detectAccount({ signal: state.routeController.signal });
  state.accountCheckPromise = accountPromise;
  let accountResult;
  try {
    accountResult = await accountPromise;
  } finally {
    if (state.accountCheckPromise === accountPromise) state.accountCheckPromise = null;
  }
  if (!accountResult.completed || !state.routeActive || generation !== state.routeGeneration) {
    if (accountResult.retry && state.routeActive && generation === state.routeGeneration) retryAccountCheckSoon();
    return;
  }
  renderUi();
  await refilterAll();
  if (!state.routeActive || generation !== state.routeGeneration) return;
  if (state.loggedIn === false) {
    setStatus("login", "请先登录 B 站；其他筛选仍可使用");
    return;
  }
  await refreshGroups({ generation });
}

function suspendRoute() {
  if (!state.routeActive) return;
  setHiddenOnlyView(false, { announce: false });
  state.routeGeneration += 1;
  state.refilterToken += 1;
  state.routeActive = false;
  state.routeController?.abort();
  state.routeController = null;
  state.listObserver?.disconnect();
  state.listObserver = null;
  state.bodyObserver?.disconnect();
  state.bodyObserver = null;
  state.list = null;
  abortGroupLoads();
  if (state.scanFrame) cancelAnimationFrame(state.scanFrame);
  if (state.statsFrame) cancelAnimationFrame(state.statsFrame);
  if (state.bindFrame) cancelAnimationFrame(state.bindFrame);
  if (state.panelFrame) cancelAnimationFrame(state.panelFrame);
  state.scanFrame = 0;
  state.statsFrame = 0;
  state.bindFrame = 0;
  state.panelFrame = 0;
  state.launcherAnchor = null;
  state.panelResolvedDirection = null;
  state.panelResizeObserver?.disconnect();
  state.panelResizeObserver = null;
  state.pendingCards.clear();
  window.clearTimeout(state.toastTimer);
  window.clearTimeout(state.accountRecheckTimer);
  window.clearTimeout(state.resetTimer);
  window.clearTimeout(state.clearHiddenTimer);
  state.toastTimer = 0;
  state.accountRecheckTimer = 0;
  state.resetTimer = 0;
  state.clearHiddenTimer = 0;
  state.resetArmedUntil = 0;
  state.clearHiddenArmedUntil = 0;
  state.toastUndo = null;
  state.accountReady = false;
  state.accountRecheckPending = false;
  clearOurCardChanges();
  clearLayoutSettings();
  document.removeEventListener("keydown", handleGlobalKeydown);
  window.removeEventListener("resize", handleViewportChange);
  window.removeEventListener("orientationchange", handleViewportChange);
  window.visualViewport?.removeEventListener("resize", handleViewportChange);
  window.visualViewport?.removeEventListener("scroll", handleViewportChange);
  state.root?.remove();
  state.root = null;
  state.shadow = null;
  state.ui = {};
}

function reconcileRoute() {
  if (isFeedRoute()) {
    void activateRoute().catch((error) => reportRuntimeError("动态页初始化失败", error));
  }
  else suspendRoute();
}

function recheckAccountOnResume() {
  if (document.hidden || !state.routeActive || state.destroyed) return;
  const currentCookie = cookieUid();
  const cookieChanged = currentCookie !== state.cookieUidSnapshot;
  if (cookieChanged) quarantineAccountChange(currentCookie);
  if (state.accountCheckPromise) {
    if (cookieChanged || !state.accountReady) state.accountRecheckPending = true;
    return;
  }
  if (state.accountReady && !cookieChanged && Date.now() - state.lastAccountCheckAt < 30_000) return;
  state.accountRecheckPending = false;
  const generation = state.routeGeneration;
  const promise = (async () => {
    const result = await detectAccount({ signal: state.routeController?.signal });
    if (!result.completed || !state.routeActive || generation !== state.routeGeneration) {
      if (result.retry && state.routeActive && generation === state.routeGeneration) retryAccountCheckSoon();
      return;
    }
    renderUi();
    if (result.changed) {
      // Clear decisions from the previous account immediately; the network
      // refresh may take seconds and must not extend that cross-account window.
      await refilterAll();
      if (!state.accountReady || !state.routeActive || generation !== state.routeGeneration) return;
      if (state.uid) await refreshGroups({ generation });
      else {
        setStatus("login", "请先登录 B 站；其他筛选仍可使用");
      }
    }
  })().catch((error) => reportRuntimeError("重新检查账号失败", error)).finally(() => {
    if (state.accountCheckPromise === promise) state.accountCheckPromise = null;
    if (state.routeActive && !state.destroyed && (state.accountRecheckPending || !state.accountReady)) {
      state.accountRecheckPending = false;
      retryAccountCheckSoon();
    }
  });
  state.accountCheckPromise = promise;
}

function installRouteHooks() {
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      queueMicrotask(reconcileRoute);
      return result;
    };
    history[method] = wrapped;
    state.historyHooks.push({ method, original, wrapped });
  }
  window.addEventListener("popstate", reconcileRoute);
  window.addEventListener("hashchange", reconcileRoute);
  window.addEventListener("pageshow", recheckAccountOnResume);
  document.addEventListener("visibilitychange", recheckAccountOnResume);
}

function destroy() {
  if (state.destroyed) return;
  state.destroyed = true;
  suspendRoute();
  window.removeEventListener("popstate", reconcileRoute);
  window.removeEventListener("hashchange", reconcileRoute);
  window.removeEventListener("pageshow", recheckAccountOnResume);
  document.removeEventListener("visibilitychange", recheckAccountOnResume);
  document.removeEventListener("keydown", handleGlobalKeydown);
  for (const { method, original, wrapped } of state.historyHooks) {
    if (history[method] === wrapped) history[method] = original;
  }
  document.getElementById(GLOBAL_STYLE_ID)?.remove();
  clearLayoutSettings();
  if (window[INSTANCE_KEY]?.destroy === destroy) delete window[INSTANCE_KEY];
}

async function start() {
  if (window.top !== window.self) return;
  window[INSTANCE_KEY]?.destroy?.();
  window[INSTANCE_KEY] = { destroy, version: VERSION };
  installRouteHooks();
  if (document.readyState === "loading") {
    await new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  reconcileRoute();
}

start().catch((error) => {
  console.error("[动态净览] 启动失败", error);
  setStatus("error", "脚本启动失败，页面内容未被更改");
});
