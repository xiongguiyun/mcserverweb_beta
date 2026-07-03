const state = {
  me: null,
  site: { maintenanceMode: false },
  announcements: [],
  posts: [],
  stats: null,
  admins: [],
  reports: [],
  comments: {},
  commentQuotes: [],
  commentQuoteManagerOpenPostId: null,
  commentComposerOpenPostIds: {},
  commentEditing: null,
  commentHighlightId: null,
  commentUndoItems: [],
  commentUndoTimers: {},
  profile: null,
  trash: { announcements: [], posts: [] },
  trashLoaded: false,
  profileTrashOpen: false,
  profileReportsOpen: false,
  editingPostId: null,
  forumSearch: "",
  forumSearchOpen: false,
  profilePostSearch: "",
  profilePostSearchOpen: false,
  profilePostPage: 1,
  adminLists: {
    announcements: { query: "", page: 1, open: false },
    posts: { query: "", page: 1, open: false },
    reports: { query: "", page: 1, open: false },
    users: { query: "", page: 1, open: false },
    trash: { query: "", page: 1, open: false },
  },
};

const page = document.body.dataset.page;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const serverAddress = () => "play.blockhaven.cn";
let maintenanceRequestId = 0;
const isMobileViewport = () => window.matchMedia?.("(max-width: 620px)")?.matches;
const isCoarsePointer = () => window.matchMedia?.("(pointer: coarse)")?.matches;
const shouldUseMobileTotpLayout = () => isMobileViewport() || isCoarsePointer();
const staticPreviewNotice = "当前是静态预览模式，接口内容暂时不可用。";

const api = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "include",
    ...options,
  });
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    const contentType = response.headers.get("content-type") || "";
    const isHtmlFallback = contentType.includes("text/html") || /^\s*<!doctype html/i.test(raw);
    payload = { error: isHtmlFallback ? staticPreviewNotice : raw.trim() };
  }
  if (!response.ok) {
    const message = payload.error || `请求失败 (${response.status})`;
    showToast(message, { copyText: message === staticPreviewNotice ? "" : message });
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
  return payload;
};

const showToast = (message, options = {}) => {
  const toast = $("#toast");
  if (!toast) return;
  const { copyText = "" } = options;
  toast.textContent = message;
  toast.dataset.copyText = copyText;
  toast.classList.toggle("copyable", Boolean(copyText));
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

const stripMinecraftFormatting = (value) => String(value || "").replace(/§[0-9a-fk-or]/gi, "");

const normalizeHexColor = (value, fallback = "") => {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
};

const postHighlightColor = (item) => normalizeHexColor(item?.highlight_color, "#5fa86f");
const postHighlightStyle = (item) => (item?.highlighted ? ` style="--post-highlight-color: ${postHighlightColor(item)}"` : "");

const textFromHtml = (html) => {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent.replace(/\s+/g, " ").trim();
};

const formatDate = (value) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const isAdmin = () => state.me?.role === "admin";
const isOwner = () => Boolean(state.me?.is_owner);
const isOwnerAccountType = (value) => value === "服主";
const isOwnUsername = (username) =>
  Boolean(state.me?.username && String(username || "").toLowerCase() === String(state.me.username).toLowerCase());
const ownsContent = (item, author) =>
  Boolean(state.me && (Number(item?.author_id) === Number(state.me.id) || isOwnUsername(author || item?.author)));
const isOwnerContent = (item) => isOwnerAccountType(item?.author_account_type);
const canManageContentItem = (item, author) => {
  if (!state.me) return false;
  if (ownsContent(item, author)) return true;
  if (!isAdmin()) return false;
  if (isOwner()) return true;
  return (item?.author_account_type || "") === "成员";
};
const minecraftImageUrl = (kind, name, size) => `/api/minecraft-image/${kind}/${encodeURIComponent(name)}/${size}`;
const skinUrl = (name, size = 210) => minecraftImageUrl("body", name, size);
const avatarUrl = (name, size = 32) => minecraftImageUrl("avatar", name, size);
const characterNameFor = (user) => user?.minecraft_name || user?.username || user?.author || "";
const activeSkinSrc = (user, size = 210) => (user?.skin_image || (characterNameFor(user) ? skinUrl(characterNameFor(user), size) : "/assets/unbound-skin.png"));
const activeAvatarSrc = (user, size = 32) => (user?.skin_image || (characterNameFor(user) ? avatarUrl(characterNameFor(user), size) : "/assets/unbound-skin.png"));
const authorUserFromItem = (item, author) => ({
  username: author,
  minecraft_name: item.author_minecraft_name || "",
  skin_image: item.author_skin_image || "",
});
const profileHref = (username) => `/profile.html?user=${encodeURIComponent(username)}`;
const totpQrUri = (result) => {
  const issuer = encodeURIComponent("LiouYang");
  return `otpauth://totp/${issuer}?secret=${encodeURIComponent(result.secret || "")}&issuer=${issuer}`;
};
const totpAccountInitials = () =>
  String(state.me?.username || "LiouYang")
    .trim()
    .slice(0, 2)
    .toUpperCase();
const currentProfileQuery = () => new URL(window.location.href).searchParams.get("user") || state.me?.username || "";
const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
const dialogCloseDelay = () => (prefersReducedMotion() ? 0 : 240);
const editorColorPresets = ["#c74332", "#f5a43a", "#469146", "#2f7dd1", "#7350a4", "#201713", "#ffffff"];
const highlightColorPresets = ["#5fa86f", "#f5a43a", "#2f7dd1", "#c74332", "#7350a4", "#201713"];
let editorSavedRange = null;
let profilePostSearchOutsideBound = false;
let adminSearchOutsideBound = false;
let commentUndoTicker = 0;

const searchTipText = "支持标题、内容和发布者搜索。输入 #发布者名 可以直接按发布者筛选，例如 #Steve。";

const closeSearchTips = () => {
  $$(".forum-search-tip.is-open").forEach((tip) => {
    if (typeof tip._setSearchTipOpen === "function") {
      tip._setSearchTipOpen(false);
      return;
    }
    tip.classList.remove("is-open");
    tip.setAttribute("aria-expanded", "false");
  });
};

const setupSearchTip = (searchTip, bubbleId = "") => {
  if (!searchTip) return;
  searchTip.removeAttribute("title");
  searchTip.setAttribute("role", "button");
  searchTip.setAttribute("tabindex", "0");
  searchTip.setAttribute("aria-expanded", "false");
  searchTip.setAttribute("data-tip", searchTipText);

  let tipBubble = searchTip.querySelector(".forum-search-tip-bubble");
  if (!tipBubble) {
    tipBubble = document.createElement("span");
    tipBubble.className = "forum-search-tip-bubble";
    if (bubbleId) tipBubble.id = bubbleId;
    tipBubble.innerHTML = `
      <span class="forum-search-tip-heading">搜索示例</span>
      <span class="forum-search-tip-preview" aria-hidden="true">
        <span class="forum-search-tip-field">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5"></circle>
            <path d="M16.2 16.2 21 21"></path>
          </svg>
          <span class="forum-search-tip-placeholder">搜索标题、内容、发布者</span>
        </span>
      </span>
      <span class="forum-search-tip-copy">${searchTipText}</span>
      <span class="forum-search-tip-example">示例：#Steve 建筑据点</span>
    `;
    searchTip.append(tipBubble);
  }

  let positionFrame = 0;

  const returnBubble = () => {
    window.cancelAnimationFrame(positionFrame);
    tipBubble.classList.remove("is-visible", "is-portal", "is-above");
    tipBubble.removeAttribute("style");
    if (tipBubble.parentElement !== searchTip) searchTip.append(tipBubble);
  };

  const positionBubble = () => {
    const rect = searchTip.getBoundingClientRect();
    const viewportPadding = 14;
    const narrow = window.matchMedia?.("(max-width: 620px)")?.matches;
    const bubbleRect = tipBubble.getBoundingClientRect();
    const width = Math.min(bubbleRect.width || 312, window.innerWidth - viewportPadding * 2);
    const height = bubbleRect.height || 0;
    const preferredLeft = narrow ? rect.left + rect.width / 2 - width / 2 : rect.right - width;
    const left = Math.min(Math.max(viewportPadding, preferredLeft), Math.max(viewportPadding, window.innerWidth - width - viewportPadding));
    const belowTop = rect.bottom + 10;
    const aboveTop = rect.top - height - 10;
    const useAbove = height && belowTop + height > window.innerHeight - viewportPadding && aboveTop >= viewportPadding;
    const top = useAbove ? aboveTop : belowTop;
    tipBubble.classList.toggle("is-above", useAbove);
    tipBubble.style.width = `${width}px`;
    tipBubble.style.left = `${Math.round(left)}px`;
    tipBubble.style.top = `${Math.round(Math.max(viewportPadding, top))}px`;
    tipBubble.style.setProperty("--tip-caret-left", `${Math.round(rect.left + rect.width / 2 - left)}px`);
  };

  const queuePositionBubble = () => {
    window.cancelAnimationFrame(positionFrame);
    positionFrame = window.requestAnimationFrame(positionBubble);
  };

  const setTipOpen = (open) => {
    if (open) {
      $$(".forum-search-tip.is-open").forEach((tip) => {
        if (tip !== searchTip && typeof tip._setSearchTipOpen === "function") tip._setSearchTipOpen(false);
      });
      if (tipBubble.parentElement !== document.body) document.body.append(tipBubble);
      tipBubble.classList.add("is-portal");
      positionBubble();
      window.requestAnimationFrame(() => tipBubble.classList.add("is-visible"));
      window.addEventListener("resize", queuePositionBubble);
      window.addEventListener("scroll", queuePositionBubble, true);
    } else {
      window.removeEventListener("resize", queuePositionBubble);
      window.removeEventListener("scroll", queuePositionBubble, true);
      returnBubble();
    }
    searchTip.classList.toggle("is-open", open);
    searchTip.setAttribute("aria-expanded", String(open));
  };
  searchTip._setSearchTipOpen = setTipOpen;

  searchTip.addEventListener("mouseenter", () => setTipOpen(true));
  searchTip.addEventListener("mouseleave", () => setTipOpen(false));
  searchTip.addEventListener("focus", () => setTipOpen(true));
  searchTip.addEventListener("blur", () => setTipOpen(false));
  searchTip.addEventListener("click", (event) => {
    event.stopPropagation();
    setTipOpen(isCoarsePointer() ? !searchTip.classList.contains("is-open") : true);
  });
  searchTip.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setTipOpen(!searchTip.classList.contains("is-open"));
  });
};

const saveEditorSelection = () => {
  const editor = $("#editor");
  const selection = window.getSelection?.();
  if (!editor || !selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (editor === range.commonAncestorContainer || editor.contains(range.commonAncestorContainer)) {
    editorSavedRange = range.cloneRange();
  }
};

const restoreEditorSelection = () => {
  const editor = $("#editor");
  if (!editor) return false;
  editor.focus({ preventScroll: true });
  if (!editorSavedRange) return false;
  try {
    const selection = window.getSelection?.();
    selection?.removeAllRanges();
    selection?.addRange(editorSavedRange);
    return true;
  } catch {
    editorSavedRange = null;
    return false;
  }
};

const applyEditorColor = (color) => {
  if (!color) return;
  const picker = $("#colorPickerInput");
  if (picker && /^#[0-9a-f]{6}$/i.test(color)) picker.value = color;
  restoreEditorSelection();
  command("foreColor", color);
  saveEditorSelection();
};

const renderTotpQrFallback = (result) => `
  <div class="totp-qr-fallback">
    <p>&#20108;&#32500;&#30721;&#26080;&#27861;&#26174;&#31034;&#65292;&#35831;&#20351;&#29992;&#25163;&#21160;&#23494;&#38053;&#12290;</p>
    <div class="totp-secret-card">
      <span class="totp-secret-label">&#25163;&#21160;&#23494;&#38053;</span>
      <code>${escapeHtml(result.secret)}</code>
    </div>
  </div>
`;

let qrRendererPromise = null;

const loadQrRenderer = () => {
  qrRendererPromise ||= import("./qrcode-local.js").then((module) => module.renderQrSvg);
  return qrRendererPromise;
};

const safeRenderQrSvg = async (result) => {
  try {
    const renderQrSvg = await loadQrRenderer();
    return renderQrSvg(result.uri);
  } catch {
    return renderTotpQrFallback(result);
  }
};

const syncFloatingScrollLock = () => {
  const hasOpenDialog = $$("dialog").some((dialog) => dialog.open);
  const hasProfileOverlay = $$(".profile-floating-overlay").some((overlay) => !overlay.hidden);
  document.body.classList.toggle("dialog-open", hasOpenDialog);
  document.body.classList.toggle("profile-overlay-open", hasProfileOverlay);
};

const openDialog = (dialog) => {
  if (!dialog) return;
  window.clearTimeout(dialog.closeTimer);
  dialog.classList.remove("is-closing");
  if (!dialog.dataset.scrollLockBound) {
    dialog.dataset.scrollLockBound = "true";
    dialog.addEventListener("close", syncFloatingScrollLock);
  }
  if (dialog.open) {
    syncFloatingScrollLock();
    return;
  }
  try {
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      syncFloatingScrollLock();
      return;
    }
    if (typeof dialog.show === "function") {
      dialog.show();
      syncFloatingScrollLock();
      return;
    }
  } catch {}
  dialog.setAttribute("open", "");
  syncFloatingScrollLock();
};

const closeDialogAnimated = (dialog) => {
  if (!dialog?.open) return;
  if (prefersReducedMotion()) {
    dialog.close();
    return;
  }
  if (dialog.classList.contains("is-closing")) return;
  dialog.classList.add("is-closing");
  const finishClose = () => {
    window.clearTimeout(dialog.closeTimer);
    dialog.close();
    dialog.classList.remove("is-closing");
    dialog.removeEventListener("animationend", onAnimationEnd);
    syncFloatingScrollLock();
  };
  const onAnimationEnd = (event) => {
    if (event.target === dialog) finishClose();
  };
  dialog.addEventListener("animationend", onAnimationEnd);
  dialog.closeTimer = window.setTimeout(finishClose, dialogCloseDelay() + 80);
};

const openPostDialog = () => openDialog($("#postDialog"));
const closePostDialog = () => closeDialogAnimated($("#postDialog"));
const openPreviewDialog = () => openDialog($("#previewDialog"));
const closePreviewDialog = () => closeDialogAnimated($("#previewDialog"));

const ensureSiteActionDialog = () => {
  let dialog = $("#siteActionDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "siteActionDialog";
  dialog.className = "site-modal-dialog";
  dialog.innerHTML = `
    <div class="site-modal-shell">
      <div class="site-modal-copy">
        <span class="site-modal-eyebrow" id="siteModalEyebrow">操作</span>
        <h2 id="siteModalTitle">请确认</h2>
        <p id="siteModalMessage"></p>
      </div>
      <label class="site-modal-field" id="siteModalField" hidden>
        <span id="siteModalLabel">请输入内容</span>
        <input id="siteModalInput" />
        <span class="site-modal-hint" id="siteModalHint" hidden></span>
      </label>
      <div class="site-modal-actions" id="siteModalActions">
        <button class="site-modal-option" type="button" data-site-modal-cancel>取消</button>
        <button class="site-modal-option is-primary" type="button" data-site-modal-confirm>确认</button>
      </div>
    </div>
  `;
  document.body.append(dialog);

  const cancel = () => resolveSiteActionDialog(dialog.dataset.mode === "confirm" ? false : null);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancel();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) cancel();
  });
  dialog.querySelectorAll("[data-site-modal-cancel]").forEach((button) => button.addEventListener("click", cancel));
  dialog.querySelector("[data-site-modal-confirm]")?.addEventListener("click", () => submitSiteActionDialog());
  dialog.querySelector("#siteModalInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitSiteActionDialog();
    }
  });

  return dialog;
};

const resolveSiteActionDialog = (value) => {
  const dialog = $("#siteActionDialog");
  if (!dialog) return;
  window.clearInterval(dialog._confirmDelayTimer);
  const resolver = dialog._resolver;
  dialog._resolver = null;
  closeDialogAnimated(dialog);
  resolver?.(value);
};

const submitSiteActionDialog = () => {
  const dialog = $("#siteActionDialog");
  if (!dialog || !dialog._config) return;
  const input = $("#siteModalInput");

  if (dialog.dataset.mode === "prompt") {
    const rawValue = input?.value ?? "";
    const value = dialog._config.normalize ? dialog._config.normalize(rawValue) : rawValue.trim();
    if (dialog._config.required && !value) {
      showToast(dialog._config.requiredMessage || "请输入内容");
      input?.focus();
      return;
    }
    const validationMessage = dialog._config.validate?.(value);
    if (validationMessage) {
      showToast(validationMessage);
      input?.focus();
      return;
    }
    resolveSiteActionDialog(value);
    return;
  }

  resolveSiteActionDialog(true);
};

const showSiteActionDialog = (config) =>
  new Promise((resolve) => {
    const dialog = ensureSiteActionDialog();
    if (dialog._resolver) {
      const previousResolver = dialog._resolver;
      dialog._resolver = null;
      previousResolver(dialog.dataset.mode === "confirm" ? false : null);
      window.clearTimeout(dialog.closeTimer);
      dialog.classList.remove("is-closing");
      if (dialog.open) dialog.close();
    }

    dialog._resolver = resolve;
    dialog._config = config;
    dialog.dataset.mode = config.mode;

    const eyebrow = $("#siteModalEyebrow");
    const title = $("#siteModalTitle");
    const message = $("#siteModalMessage");
    const field = $("#siteModalField");
    const label = $("#siteModalLabel");
    const input = $("#siteModalInput");
    const hint = $("#siteModalHint");
    const confirmButton = dialog.querySelector("[data-site-modal-confirm]");
    const actions = $("#siteModalActions");
    window.clearInterval(dialog._confirmDelayTimer);

    if (eyebrow) eyebrow.textContent = config.eyebrow || (config.mode === "confirm" ? "操作确认" : "输入内容");
    if (title) title.textContent = config.title || (config.mode === "confirm" ? "请确认这一步操作" : "请输入内容");
    if (message) message.textContent = config.message || "";
    if (label) label.textContent = config.inputLabel || "请输入内容";
    if (hint) {
      hint.textContent = config.hint || "";
      hint.hidden = !config.hint;
    }
    if (field) field.hidden = config.mode !== "prompt";
    if (input) {
      input.value = config.defaultValue || "";
      input.placeholder = config.placeholder || "";
      input.type = config.inputType || "text";
      input.maxLength = config.maxLength ? Number(config.maxLength) : 524288;
      input.autocomplete = config.autocomplete || "off";
      input.inputMode = config.inputMode || "text";
    }
    dialog.querySelectorAll("[data-site-modal-cancel]").forEach((button) => {
      button.textContent = config.cancelLabel || "取消";
    });
    if (confirmButton) {
      const confirmLabel = config.confirmLabel || "确认";
      confirmButton.textContent = confirmLabel;
      confirmButton.disabled = false;
      confirmButton.classList.toggle("is-primary", config.confirmTone !== "danger");
      confirmButton.classList.toggle("is-danger", config.confirmTone === "danger");
      const delaySeconds = Math.max(0, Number(config.confirmDelaySeconds || 0));
      if (delaySeconds) {
        let remaining = Math.ceil(delaySeconds);
        confirmButton.disabled = true;
        const syncConfirmDelay = () => {
          confirmButton.textContent = remaining > 0 ? `${confirmLabel} (${remaining})` : confirmLabel;
        };
        syncConfirmDelay();
        dialog._confirmDelayTimer = window.setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) {
            window.clearInterval(dialog._confirmDelayTimer);
            confirmButton.disabled = false;
            confirmButton.textContent = confirmLabel;
            return;
          }
          syncConfirmDelay();
        }, 1000);
      }
    }
    actions?.classList.toggle("is-danger", config.confirmTone === "danger");

    openDialog(dialog);
    window.requestAnimationFrame(() => {
      if (config.mode === "prompt") {
        input?.focus();
        input?.select();
        return;
      }
      if (confirmButton?.disabled) {
        dialog.querySelector("[data-site-modal-cancel]")?.focus();
        return;
      }
      confirmButton?.focus();
    });
  });

const showConfirmDialog = (message, options = {}) =>
  showSiteActionDialog({
    mode: "confirm",
    message,
    ...options,
  });

const showPromptDialog = (message, options = {}) =>
  showSiteActionDialog({
    mode: "prompt",
    message,
    ...options,
  });

const ensureEditorFindReplaceDialog = () => {
  let dialog = $("#editorFindReplaceDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "editorFindReplaceDialog";
  dialog.className = "site-modal-dialog editor-find-replace-dialog";
  dialog.innerHTML = `
    <div class="site-modal-shell editor-find-replace-shell">
      <div class="site-modal-copy">
        <span class="site-modal-eyebrow">编辑工具</span>
        <h2>查找和替换</h2>
        <p>在当前正文编辑器里查找文字，可只定位、替换当前匹配，或一次替换全部匹配。</p>
      </div>
      <div class="editor-find-replace-grid">
        <label class="site-modal-field">
          <span>查找内容</span>
          <input id="findReplaceQuery" autocomplete="off" />
        </label>
        <label class="site-modal-field">
          <span>替换为</span>
          <input id="findReplaceReplacement" autocomplete="off" placeholder="留空则删除匹配内容" />
        </label>
      </div>
      <div class="site-modal-actions editor-find-replace-actions">
        <button class="site-modal-option" type="button" data-find-replace-cancel>取消</button>
        <button class="site-modal-option" type="button" data-find-replace-action="find">查找</button>
        <button class="site-modal-option is-primary" type="button" data-find-replace-action="current">替换当前</button>
        <button class="site-modal-option is-primary" type="button" data-find-replace-action="all">全部替换</button>
      </div>
    </div>
  `;
  document.body.append(dialog);

  const resolve = (value) => {
    const resolver = dialog._resolver;
    dialog._resolver = null;
    closeDialogAnimated(dialog);
    resolver?.(value);
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    resolve(null);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) resolve(null);
  });
  dialog.querySelector("[data-find-replace-cancel]")?.addEventListener("click", () => resolve(null));
  dialog.querySelectorAll("[data-find-replace-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const query = dialog.querySelector("#findReplaceQuery")?.value.trim() || "";
      if (!query) {
        showToast("请输入查找内容");
        dialog.querySelector("#findReplaceQuery")?.focus();
        return;
      }
      resolve({
        action: button.dataset.findReplaceAction,
        query,
        replacement: dialog.querySelector("#findReplaceReplacement")?.value || "",
      });
    });
  });
  dialog.querySelector("#findReplaceQuery")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      dialog.querySelector('[data-find-replace-action="find"]')?.click();
    }
  });
  dialog.querySelector("#findReplaceReplacement")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      dialog.querySelector('[data-find-replace-action="current"]')?.click();
    }
  });

  return dialog;
};

const showEditorFindReplaceDialog = () =>
  new Promise((resolve) => {
    const dialog = ensureEditorFindReplaceDialog();
    if (dialog._resolver) dialog._resolver(null);
    dialog._resolver = resolve;
    dialog.querySelector("#findReplaceQuery").value = "";
    dialog.querySelector("#findReplaceReplacement").value = "";
    openDialog(dialog);
    window.requestAnimationFrame(() => dialog.querySelector("#findReplaceQuery")?.focus());
  });

const floatingHostFor = (anchor) => anchor?.closest("dialog") || document.body;

const updateToolbarMorePosition = () => {
  const menu = $("#moreMenu");
  const button = $("#moreButton");
  if (!menu || !button || menu.hidden) return;
  const container = button.closest(".toolbar-more");
  if (!container) return;
  const host = floatingHostFor(button);
  const isBodyHost = host === document.body;
  if (menu.parentElement !== host) {
    menu._toolbarMoreHost = container;
    host.append(menu);
  }
  const rect = button.getBoundingClientRect();
  const hostRect = isBodyHost ? { left: 0, top: 0 } : host.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 0;
  const menuHeight = menu.offsetHeight || 0;
  const margin = 8;
  const scrollLeft = isBodyHost ? 0 : host.scrollLeft;
  const scrollTop = isBodyHost ? 0 : host.scrollTop;
  const maxWidth = isBodyHost ? window.innerWidth : host.clientWidth;
  const maxHeight = isBodyHost ? window.innerHeight : host.clientHeight;
  let left = rect.right - hostRect.left + scrollLeft - menuWidth;
  let top = rect.bottom - hostRect.top + scrollTop + 10;
  let isUpward = false;

  left = Math.max(margin, Math.min(left, maxWidth + scrollLeft - menuWidth - margin));
  if (top + menuHeight > maxHeight + scrollTop - margin) {
    isUpward = true;
    top = rect.top - hostRect.top + scrollTop - menuHeight - 10;
  }
  top = Math.max(scrollTop + margin, top);

  menu.style.position = isBodyHost ? "fixed" : "absolute";
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.right = "auto";
  menu.style.bottom = "auto";
  container.classList.toggle("is-open-upward", isUpward);
};

const closeToolbarMore = () => {
  const button = $("#moreButton");
  const menu = $("#moreMenu");
  if (!button || !menu) return;
  button.setAttribute("aria-expanded", "false");
  menu.hidden = true;
  menu.style.removeProperty("position");
  menu.style.removeProperty("left");
  menu.style.removeProperty("top");
  menu.style.removeProperty("right");
  menu.style.removeProperty("bottom");
  if (menu._toolbarMoreHost && menu.parentElement !== menu._toolbarMoreHost) {
    menu._toolbarMoreHost.append(menu);
  }
  button.closest(".toolbar-more")?.classList.remove("is-open", "is-open-upward");
};

const updateColorToolPosition = () => {
  const panel = $("#colorToolPanel");
  const button = $("#colorButton");
  if (!panel || !button || panel.hidden) return;
  const host = floatingHostFor(button);
  const isBodyHost = host === document.body;
  if (panel.parentElement !== host) {
    panel._colorToolHost = button.closest(".toolbar-color-popover") || button.parentElement;
    host.append(panel);
  }
  const rect = button.getBoundingClientRect();
  const hostRect = isBodyHost ? { left: 0, top: 0 } : host.getBoundingClientRect();
  const panelWidth = panel.offsetWidth || 0;
  const panelHeight = panel.offsetHeight || 0;
  const margin = 8;
  const scrollLeft = isBodyHost ? 0 : host.scrollLeft;
  const scrollTop = isBodyHost ? 0 : host.scrollTop;
  const maxWidth = isBodyHost ? window.innerWidth : host.clientWidth;
  const maxHeight = isBodyHost ? window.innerHeight : host.clientHeight;
  let left = rect.right - hostRect.left + scrollLeft - panelWidth;
  let top = rect.bottom - hostRect.top + scrollTop + 10;

  left = Math.max(margin, Math.min(left, maxWidth + scrollLeft - panelWidth - margin));
  if (top + panelHeight > maxHeight + scrollTop - margin) {
    top = rect.top - hostRect.top + scrollTop - panelHeight - 10;
  }
  top = Math.max(scrollTop + margin, top);

  panel.style.position = isBodyHost ? "fixed" : "absolute";
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
};

const closeColorTool = () => {
  const button = $("#colorButton");
  const panel = $("#colorToolPanel");
  if (!button || !panel) return;
  button.setAttribute("aria-expanded", "false");
  panel.hidden = true;
  panel.style.removeProperty("position");
  panel.style.removeProperty("left");
  panel.style.removeProperty("top");
  panel.style.removeProperty("right");
  panel.style.removeProperty("bottom");
  button.closest(".toolbar-color-popover")?.classList.remove("is-open");
  if (panel._colorToolHost && panel.parentElement !== panel._colorToolHost) {
    panel._colorToolHost.append(panel);
  }
};

const enhanceColorTool = () => {
  const colorButton = $("#colorButton");
  if (!colorButton || colorButton.dataset.colorEnhanced) return;
  colorButton.dataset.colorEnhanced = "true";
  const wrapper = document.createElement("div");
  wrapper.className = "toolbar-color-popover";
  wrapper.innerHTML = `
    <button type="button" id="colorButton" aria-expanded="false" aria-controls="colorToolPanel">文本颜色</button>
    <div class="toolbar-color-tool" id="colorToolPanel" hidden>
      <div class="toolbar-color-presets" aria-label="默认文本颜色">
        ${editorColorPresets
          .map((color) => `<button class="toolbar-color-swatch" type="button" data-color="${color}" style="--swatch-color: ${color}" aria-label="使用颜色 ${color}"></button>`)
          .join("")}
      </div>
      <label class="toolbar-color-picker">
        <span>颜色盘</span>
        <input id="colorPickerInput" type="color" value="#f5a43a" />
      </label>
      <button type="button" id="customColorButton">手动填写</button>
    </div>
  `;
  colorButton.replaceWith(wrapper);
  const toggle = wrapper.querySelector("#colorButton");
  const panel = wrapper.querySelector("#colorToolPanel");
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    if (isOpen) {
      closeColorTool();
      return;
    }
    closeTablePicker();
    toggle.setAttribute("aria-expanded", "true");
    panel.hidden = false;
    wrapper.classList.add("is-open");
    window.requestAnimationFrame(updateColorToolPosition);
  });
  panel.addEventListener("click", (event) => event.stopPropagation());
  panel.querySelectorAll("[data-color]").forEach((button) => {
    button.addEventListener("click", () => applyEditorColor(button.dataset.color));
  });
  const colorPickerInput = panel.querySelector("#colorPickerInput");
  colorPickerInput?.addEventListener("input", (event) => applyEditorColor(event.target.value));
  colorPickerInput?.addEventListener("change", (event) => applyEditorColor(event.target.value));
  panel.querySelector("#customColorButton")?.addEventListener("click", async () => {
    const color = await showPromptDialog("输入文本颜色，例如 #ff6600 或 rgb(255, 102, 0)。", {
      title: "文本颜色",
      eyebrow: "编辑工具",
      inputLabel: "颜色值",
      placeholder: "#ff6600",
      confirmLabel: "应用颜色",
      normalize: (value) => value.trim(),
    });
    if (color) applyEditorColor(color);
  });
};

const renderAuth = () => {
  const actions = $("#authActions");
  if (!actions) return;
  $$("[data-admin-link]").forEach((link) => {
    link.hidden = !isAdmin();
  });

  if (!state.me) {
    actions.innerHTML = `<a class="button small primary" href="/login.html">登录</a>`;
    return;
  }

  actions.innerHTML = `
    <a class="user-badge user-entry" href="${profileHref(state.me.username)}">
      <img class="user-avatar" src="${activeAvatarSrc(state.me, 32)}" alt="" />
      <span class="user-chip">${escapeHtml(state.me.username)}</span>
    </a>
    <button class="button small ghost" id="logoutButton" type="button">退出</button>
  `;
  $("#logoutButton")?.addEventListener("click", async () => {
    await api("/logout", { method: "POST" });
    state.me = null;
    if (page === "admin") {
      window.location.href = "/login.html";
      return;
    }
    renderAll();
    showToast("已退出登录");
  });
};

const renderMaintenanceBanner = () => {
  let banner = $("#maintenanceBanner");
  if (!state.site?.maintenanceMode || !isAdmin()) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "maintenanceBanner";
    banner.className = "maintenance-banner";
    document.body.prepend(banner);
  }
  banner.textContent = "网站正在维护中，当前管理员可继续访问。";
};

const renderMaintenanceGate = () => {
  const gate = $("#maintenanceGate");
  if (!gate) return;
  const main = document.querySelector("main");
  if (!state.site?.maintenanceMode || isAdmin()) {
    gate.hidden = true;
    if (main) main.hidden = false;
    return;
  }
  gate.hidden = false;
  if (main) main.hidden = true;
  $("#maintenanceGateBody").innerHTML = state.me
    ? `
      <div class="maintenance-user">
        <img class="user-avatar large" src="${activeAvatarSrc(state.me, 48)}" alt="" />
        <div><strong>${escapeHtml(state.me.username)}</strong><p>你已登录，但网站当前维护中，请稍后再来。</p></div>
      </div>`
    : `<p>网站正在维护中，暂时仅管理员可登录。</p><a class="button primary" href="/login.html">登录</a>`;
};

const cardTemplate = (item, type) => {
  const excerpt = item.excerpt || textFromHtml(item.content_html).slice(0, 110);
  const author = item.author || "管理员";
  const authorUser = authorUserFromItem(item, author);
  const accountType = item.author_account_type || (type === "announcement" ? "管理员" : "成员");
  const canManagePost = type === "post" && canManageContentItem(item, author);
  const canEditPost = type === "post" && page === "forum" && canManagePost;
  const canDeletePost = type === "post" && canManagePost;
  const canReportPost = type === "post" && Boolean(state.me) && !ownsContent(item, author) && !isOwnerContent(item);
  return `
    <article class="post-card ${type === "post" ? "forum-card" : ""} ${type === "post" && item.pinned ? "is-pinned" : ""} ${type === "post" && item.highlighted ? "is-highlighted-post" : ""}"${type === "post" ? postHighlightStyle(item) : ""}>
      ${type === "post" && item.pinned ? `<span class="pinned-ribbon">置顶</span>` : ""}
      <h3>${escapeHtml(item.title)}</h3>
      <div class="meta">
        <span class="meta-role">${type === "announcement" ? "公告" : item.highlighted ? "高亮帖子" : item.pinned ? "置顶帖子" : "玩家论坛"}</span>
        <span class="meta-author">
          <span class="meta-author-badge">
            <img class="meta-author-icon" src="${activeAvatarSrc(authorUser, 32)}" alt="" loading="lazy" />
            <a class="author-link" href="${profileHref(author)}">${escapeHtml(author)}</a>
          </span>
          <span class="meta-author-type">${escapeHtml(accountType)}</span>
        </span>
        <span class="meta-date">${formatDate(item.created_at)}</span>
      </div>
      <p>${escapeHtml(excerpt || "暂无摘要。")}</p>
      <div class="card-actions">
        <button class="button ghost read-button" type="button" data-type="${type}" data-id="${item.id}">阅读</button>
        ${
          canReportPost
            ? `<button class="button ghost" type="button" data-report-post="${item.id}">举报</button>`
            : ""
        }
        ${
          canEditPost
            ? `<button class="button ghost" type="button" data-edit-post="${item.id}">编辑</button>`
            : ""
        }
        ${
          canDeletePost
            ? `<button class="button danger" type="button" data-delete-post="${item.id}">删除</button>`
            : ""
        }
      </div>
    </article>
  `;
};

const renderLists = () => {
  const announcementList = $("#announcementList");
  if (announcementList) {
    announcementList.innerHTML = state.announcements.length
      ? state.announcements.map((item) => cardTemplate(item, "announcement")).join("")
      : `<div class="empty">还没有公告。</div>`;
  }
  const postList = $("#postList");
  if (postList) {
    const filteredPosts = filterForumPosts(state.posts);
    postList.innerHTML = filteredPosts.length
      ? filteredPosts.map((item) => cardTemplate(item, "post")).join("")
      : `<div class="empty">还没有帖子。</div>`;
  }
  updateForumSearchStatus();
  bindContentButtons();
};

let renderListsFrame = 0;
const queueRenderLists = () => {
  window.cancelAnimationFrame(renderListsFrame);
  renderListsFrame = window.requestAnimationFrame(() => {
    renderListsFrame = 0;
    renderLists();
  });
};

const normalizeSearchTerms = (value) =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const filterForumPosts = (posts) => {
  const query = state.forumSearch.trim();
  if (!query) return posts;
  const authorTerms = [];
  const freeTerms = [];
  for (const term of normalizeSearchTerms(query)) {
    if (term.startsWith("#") && term.length > 1) authorTerms.push(term.slice(1).toLowerCase());
    else freeTerms.push(term.toLowerCase());
  }
  return posts.filter((item) => {
    const title = String(item.title || "").toLowerCase();
    const author = String(item.author || "").toLowerCase();
    const content = textFromHtml(item.content_html).toLowerCase();
    const haystack = `${title} ${author} ${content}`;
    return authorTerms.every((term) => author.includes(term)) && freeTerms.every((term) => haystack.includes(term));
  });
};

const ADMIN_PAGE_SIZE = 10;

const adminListState = (key) => {
  if (!state.adminLists[key]) state.adminLists[key] = { query: "", page: 1 };
  if (typeof state.adminLists[key].open !== "boolean") state.adminLists[key].open = false;
  return state.adminLists[key];
};

const adminSearchMatches = (query, haystack, author = "") => {
  const terms = normalizeSearchTerms(query);
  if (!terms.length) return true;
  const authorTerms = [];
  const freeTerms = [];
  terms.forEach((term) => {
    if (term.startsWith("#") && term.length > 1) authorTerms.push(term.slice(1).toLowerCase());
    else freeTerms.push(term.toLowerCase());
  });
  const normalizedHaystack = String(haystack || "").toLowerCase();
  const normalizedAuthor = String(author || "").toLowerCase();
  return authorTerms.every((term) => normalizedAuthor.includes(term)) && freeTerms.every((term) => normalizedHaystack.includes(term));
};

const adminListView = (key, items, matches) => {
  const list = adminListState(key);
  const query = list.query.trim();
  const filtered = query ? items.filter((item) => matches(item, query)) : items;
  const totalPages = Math.max(1, Math.ceil(filtered.length / ADMIN_PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(list.page) || 1), totalPages);
  list.page = page;
  const start = (page - 1) * ADMIN_PAGE_SIZE;
  const end = Math.min(start + ADMIN_PAGE_SIZE, filtered.length);
  return {
    query,
    total: items.length,
    filtered,
    pageItems: filtered.slice(start, end),
    page,
    totalPages,
    start,
    end,
  };
};

const adminListToolsHtml = (key, view, placeholder) => {
  if (!view.total) return "";
  const list = adminListState(key);
  const isOpen = Boolean(list.open);
  const status = view.query ? `已筛选 ${view.filtered.length}/${view.total} 条` : `显示 ${view.start + 1}-${view.end} / ${view.total} 条`;
  const panelId = `adminSearchPanel-${key}`;
  const inputId = `adminSearchInput-${key}`;
  return `
    <div class="admin-list-tools ${isOpen ? "is-open" : ""}" data-admin-search-root="${key}">
      <span class="admin-list-status">${status}</span>
      <div class="forum-toolbar-actions admin-search-actions ${isOpen ? "is-search-open" : ""} ${list.query ? "has-search-query" : ""}" data-admin-search-actions="${key}">
        <button class="forum-search-toggle admin-search-toggle" type="button" data-admin-search-toggle="${key}" aria-controls="${panelId}" aria-expanded="${isOpen}" aria-label="搜索后台列表">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5"></circle>
            <path d="M16.2 16.2 21 21"></path>
          </svg>
        </button>
        <div class="forum-search-panel admin-search-panel ${isOpen ? "is-open" : ""}" id="${panelId}" data-admin-search-panel="${key}" aria-hidden="${isOpen ? "false" : "true"}">
          <div class="forum-search-box">
            <input id="${inputId}" type="search" autocomplete="off" data-admin-search="${key}" value="${escapeHtml(list.query)}" placeholder="${escapeHtml(placeholder)}" aria-label="搜索后台列表" ${isOpen ? "" : 'tabindex="-1"'} />
            <button class="forum-search-clear" type="button" data-admin-search-clear="${key}" aria-label="清空搜索">×</button>
          </div>
          <span class="forum-search-tip admin-search-tip" data-admin-search-tip="${key}" aria-label="搜索提示">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9"></circle>
              <path d="M12 10v6"></path>
              <path d="M12 7.25h.01"></path>
            </svg>
          </span>
          <div class="forum-search-status">${view.query ? status : ""}</div>
        </div>
      </div>
    </div>
  `;
};

const adminPaginationHtml = (key, view) =>
  view.totalPages > 1
    ? `
      <div class="admin-pagination">
        <button class="button small ghost" type="button" data-admin-page="${key}" data-page="${view.page - 1}" ${view.page <= 1 ? "disabled" : ""}>上一页</button>
        <span>第 ${view.page} / ${view.totalPages} 页</span>
        <button class="button small ghost" type="button" data-admin-page="${key}" data-page="${view.page + 1}" ${view.page >= view.totalPages ? "disabled" : ""}>下一页</button>
      </div>
    `
    : "";

const syncAdminSearchShell = (key, open) => {
  const list = adminListState(key);
  const hasQuery = Boolean(list.query.trim());
  list.open = open;
  $$(`[data-admin-search-root="${key}"]`).forEach((root) => {
    root.classList.toggle("is-open", open);
    const actions = root.querySelector(`[data-admin-search-actions="${key}"]`);
    const panel = root.querySelector(`[data-admin-search-panel="${key}"]`);
    const toggle = root.querySelector(`[data-admin-search-toggle="${key}"]`);
    const input = root.querySelector(`[data-admin-search="${key}"]`);
    actions?.classList.toggle("is-search-open", open);
    actions?.classList.toggle("has-search-query", hasQuery);
    panel?.classList.toggle("is-open", open);
    panel?.setAttribute("aria-hidden", String(!open));
    toggle?.setAttribute("aria-expanded", String(open));
    if (input) {
      input.tabIndex = open ? 0 : -1;
      if (!open) input.blur();
    }
  });
};

const ensureAdminSearchOutsideClose = () => {
  if (adminSearchOutsideBound) return;
  adminSearchOutsideBound = true;
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-admin-search-root]")) return;
    closeSearchTips();
    Object.keys(state.adminLists).forEach((key) => {
      if (adminListState(key).open) syncAdminSearchShell(key, false);
    });
  });
};

const bindAdminListControls = (key, render) => {
  $$(`[data-admin-search-tip="${key}"]`).forEach((tip) => setupSearchTip(tip, `adminSearchTipBubble-${key}`));
  ensureAdminSearchOutsideClose();
  $$(`[data-admin-search-toggle="${key}"]`).forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const list = adminListState(key);
      syncAdminSearchShell(key, !list.open);
      if (!adminListState(key).open) return;
      window.setTimeout(() => $(`[data-admin-search="${key}"]`)?.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 40);
    });
  });
  $$(`[data-admin-search-panel="${key}"]`).forEach((panel) => {
    panel.addEventListener("click", (event) => event.stopPropagation());
  });
  $$(`[data-admin-search="${key}"]`).forEach((input) => {
    input.addEventListener("input", (event) => {
      const cursor = event.target.selectionStart ?? event.target.value.length;
      const list = adminListState(key);
      list.query = event.target.value;
      list.page = 1;
      list.open = true;
      render();
      const nextInput = $(`[data-admin-search="${key}"]`);
      if (!nextInput) return;
      nextInput.focus({ preventScroll: true });
      nextInput.setSelectionRange?.(cursor, cursor);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const list = adminListState(key);
      if (list.query) {
        list.query = "";
        list.page = 1;
      }
      list.open = false;
      render();
    });
  });
  $$(`[data-admin-search-clear="${key}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      const list = adminListState(key);
      list.query = "";
      list.page = 1;
      list.open = false;
      render();
    });
  });
  $$(`[data-admin-page="${key}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      adminListState(key).page = Number(button.dataset.page) || 1;
      render();
    });
  });
};

const adminContentSearchText = (item) =>
  `${item.title || ""} ${item.author || ""} ${formatDate(item.created_at)} ${item.views || 0} ${textFromHtml(item.content_html)}`;

const updateForumSearchStatus = () => {
  const status = $("#forumSearchStatus");
  const actions = $(".forum-toolbar-actions");
  if (!status) return;
  const query = state.forumSearch.trim();
  const total = state.posts.length;
  const matched = filterForumPosts(state.posts).length;
  status.hidden = !query;
  status.textContent = query ? `已筛选 ${matched}/${total} 条帖子` : "";
  actions?.classList.toggle("has-search-query", Boolean(query));
};

const PROFILE_POST_PAGE_SIZE = 10;

const profilePostListView = (posts, author) => {
  const originalSearch = state.forumSearch;
  state.forumSearch = state.profilePostSearch;
  const searchablePosts = posts.map((item) => ({ ...item, author }));
  const filtered = filterForumPosts(searchablePosts);
  state.forumSearch = originalSearch;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PROFILE_POST_PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(state.profilePostPage) || 1), totalPages);
  state.profilePostPage = page;
  const start = (page - 1) * PROFILE_POST_PAGE_SIZE;
  const end = Math.min(start + PROFILE_POST_PAGE_SIZE, filtered.length);
  return {
    filtered,
    pageItems: filtered.slice(start, end),
    page,
    totalPages,
    start,
    end,
  };
};

const renderProfilePostSearch = (view, total) => {
  const isOpen = Boolean(state.profilePostSearchOpen);
  const status = state.profilePostSearch ? `已筛选 ${view.filtered.length}/${total} 条帖子` : `显示 ${view.start + 1}-${view.end} / ${total} 条帖子`;
  return `
    <div class="forum-toolbar profile-post-toolbar">
      <div class="section-title compact">
        <h2>${escapeHtml(state.profile?.username || "")} 的帖子</h2>
        <p>展示最近 20 篇玩家内容。</p>
      </div>
      <div class="forum-toolbar-actions ${isOpen ? "is-search-open" : ""} ${state.profilePostSearch ? "has-search-query" : ""}" id="profilePostSearchActions">
        <button class="forum-search-toggle" type="button" id="profilePostSearchToggle" aria-controls="profilePostSearchPanel" aria-expanded="${isOpen}" aria-label="搜索玩家帖子">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5"></circle>
            <path d="M16.2 16.2 21 21"></path>
          </svg>
        </button>
        <div class="forum-search-panel ${isOpen ? "is-open" : ""}" id="profilePostSearchPanel" aria-hidden="${isOpen ? "false" : "true"}">
          <div class="forum-search-box">
            <input id="profilePostSearchInput" type="search" autocomplete="off" value="${escapeHtml(state.profilePostSearch)}" placeholder="搜索标题、内容、发布者" aria-label="搜索玩家帖子" ${isOpen ? "" : 'tabindex="-1"'} />
            <button class="forum-search-clear" type="button" id="profilePostSearchClear" aria-label="清空搜索">×</button>
          </div>
          <span class="forum-search-tip" id="profilePostSearchTip" aria-label="搜索提示">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9"></circle>
              <path d="M12 10v6"></path>
              <path d="M12 7.25h.01"></path>
            </svg>
          </span>
          <div class="forum-search-status">${state.profilePostSearch ? status : ""}</div>
        </div>
      </div>
      <div class="profile-post-range">${status}</div>
    </div>
  `;
};

const renderProfilePostPagination = (view) =>
  view.totalPages > 1
    ? `
      <div class="admin-pagination profile-post-pagination">
        <button class="button small ghost" type="button" data-profile-post-page="${view.page - 1}" ${view.page <= 1 ? "disabled" : ""}>上一页</button>
        <span>第 ${view.page} / ${view.totalPages} 页</span>
        <button class="button small ghost" type="button" data-profile-post-page="${view.page + 1}" ${view.page >= view.totalPages ? "disabled" : ""}>下一页</button>
      </div>
    `
    : "";

const syncProfilePostSearchShell = (open) => {
  state.profilePostSearchOpen = open;
  const hasQuery = Boolean(state.profilePostSearch.trim());
  const actions = $("#profilePostSearchActions");
  const panel = $("#profilePostSearchPanel");
  const toggle = $("#profilePostSearchToggle");
  const input = $("#profilePostSearchInput");
  actions?.classList.toggle("is-search-open", open);
  actions?.classList.toggle("has-search-query", hasQuery);
  panel?.classList.toggle("is-open", open);
  panel?.setAttribute("aria-hidden", String(!open));
  toggle?.setAttribute("aria-expanded", String(open));
  if (input) {
    input.tabIndex = open ? 0 : -1;
    if (!open) input.blur();
  }
};

const ensureProfilePostSearchOutsideClose = () => {
  if (profilePostSearchOutsideBound) return;
  profilePostSearchOutsideBound = true;
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".profile-post-toolbar")) return;
    closeSearchTips();
    if (state.profilePostSearchOpen) syncProfilePostSearchShell(false);
  });
};

const bindProfilePostSearch = () => {
  setupSearchTip($("#profilePostSearchTip"), "profilePostSearchTipBubble");
  ensureProfilePostSearchOutsideClose();
  $("#profilePostSearchToggle")?.addEventListener("click", (event) => {
    event.stopPropagation();
    syncProfilePostSearchShell(!state.profilePostSearchOpen);
    if (state.profilePostSearchOpen) {
      window.setTimeout(() => $("#profilePostSearchInput")?.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 40);
    }
  });
  $("#profilePostSearchPanel")?.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  $("#profilePostSearchInput")?.addEventListener("input", (event) => {
    const cursor = event.target.selectionStart ?? event.target.value.length;
    state.profilePostSearch = event.target.value;
    state.profilePostSearchOpen = true;
    state.profilePostPage = 1;
    queueRenderProfilePage(cursor);
  });
  $("#profilePostSearchInput")?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    state.profilePostSearch = "";
    state.profilePostSearchOpen = false;
    state.profilePostPage = 1;
    renderProfilePage();
  });
  $("#profilePostSearchClear")?.addEventListener("click", () => {
    state.profilePostSearch = "";
    state.profilePostSearchOpen = false;
    state.profilePostPage = 1;
    renderProfilePage();
  });
  $$("[data-profile-post-page]").forEach((button) => {
    button.addEventListener("click", () => {
      state.profilePostPage = Number(button.dataset.profilePostPage) || 1;
      renderProfilePage();
    });
  });
};

const totpPanelTemplate = (profile) => {
  if (!profile?.isSelf || profile.role !== "admin") return "";
  return `
    <section class="account-security" id="accountSecurity">
      <h3>双重验证</h3>
      <p>${profile.totp_enabled ? "当前已开启，登录后台时需要填写 6 位验证码。" : "开启后，登录后台时需要额外填写 Authenticator 验证码。"}</p>
      <div class="security-form">
        ${
          profile.totp_enabled
            ? `<button class="button danger" type="button" id="disableTotpButton">关闭 2FA</button>`
            : `<button class="button primary" type="button" id="beginTotpButton">开启 2FA</button>`
        }
      </div>
      <div class="totp-panel" id="totpSetupPanel" hidden></div>
    </section>
  `;
};

const renderTotpSetupPanel = async (setupPanel, result) => {
  const mobileLayout = shouldUseMobileTotpLayout();
  const qrResult = { ...result, uri: totpQrUri(result) };
  const qrMarkup = await safeRenderQrSvg(qrResult);
  setupPanel.hidden = false;
  setupPanel.innerHTML = `
    <p>${mobileLayout ? "可以直接跳转验证器，也可以扫描二维码或手动输入密钥。" : "在电脑上扫码添加，也可以切换成手动输入密钥。"}</p>
    ${mobileLayout ? `<a class="button ghost small mobile-authenticator-link" href="${escapeHtml(qrResult.uri)}">打开验证器</a>` : ""}
    <div class="totp-visual-card" id="totpVisualCard">
      <div class="totp-qr-shell" id="totpQrShell" aria-label="2FA 二维码">${qrMarkup}</div>
    </div>
    <button class="totp-text-toggle" type="button" id="totpSecretToggle">切换成密钥</button>
    <div class="totp-secret-card" id="totpSecretCard" hidden>
      <span class="totp-secret-label">手动密钥</span>
      <code>${escapeHtml(result.secret)}</code>
    </div>
    <div class="security-form">
      <input id="totpConfirmCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码" />
      <button class="button primary" type="button" id="confirmTotpButton">确认启用</button>
    </div>
  `;

  $("#totpSecretToggle")?.addEventListener("click", () => {
    const visualCard = $("#totpVisualCard");
    const secretCard = $("#totpSecretCard");
    const showingSecret = !secretCard?.hidden;
    if (secretCard) secretCard.hidden = showingSecret;
    if (visualCard) visualCard.hidden = !showingSecret;
    const toggle = $("#totpSecretToggle");
    if (toggle) toggle.textContent = showingSecret ? "切换成密钥" : "切换成二维码";
  });

  $("#totpConfirmCode")?.focus();
  $("#confirmTotpButton")?.addEventListener("click", async () => {
    const code = $("#totpConfirmCode")?.value.trim() || "";
    await api("/me/totp/confirm", { method: "POST", body: JSON.stringify({ code }) });
    await refreshPageData();
    showToast("2FA 已开启");
  });
};

const bindTotpSecurity = () => {
  const beginButton = $("#beginTotpButton");
  const disableButton = $("#disableTotpButton");
  const setupPanel = $("#totpSetupPanel");

  beginButton?.addEventListener("click", async () => {
    const result = await api("/me/totp/begin", { method: "POST" });
    if (!setupPanel) return;
    setupPanel.hidden = false;
    setupPanel.innerHTML = `<p>正在生成二维码...</p>`;
    await renderTotpSetupPanel(setupPanel, result);
  });

  disableButton?.addEventListener("click", async () => {
    const confirmed = await showConfirmDialog("确定关闭 2FA 吗？", {
      title: "关闭双重验证",
      eyebrow: "安全设置",
      confirmLabel: "关闭 2FA",
      confirmTone: "danger",
    });
    if (!confirmed) return;
    await api("/me/totp", { method: "DELETE" });
    await refreshPageData();
    showToast("2FA 已关闭");
  });
};

const parseServerDate = (value) => {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const nextUsernameChangeDate = (profile) => {
  const lastChanged = parseServerDate(profile?.username_updated_at);
  if (!lastChanged) return null;
  return new Date(lastChanged.getTime() + 7 * 24 * 60 * 60 * 1000);
};

const accountDeletionStatusText = (request) => {
  if (!request) return "";
  if (request.status === "pending_approval") return "等待服主批准";
  if (request.status === "cooling") return request.scheduled_at ? `冷静期至 ${formatDate(request.scheduled_at)}` : "注销冷静期中";
  return "";
};

const reportHistoryUpdatedAt = (report) => parseServerDate(report?.resolved_at || report?.created_at)?.getTime() || 0;

const reportHistoryIsRead = (report) => {
  const readAt = parseServerDate(report?.reporter_read_at);
  return Boolean(readAt && readAt.getTime() >= reportHistoryUpdatedAt(report));
};

const unreadReportHistoryCount = (reports = []) => reports.filter((report) => !reportHistoryIsRead(report)).length;

const profileSettingsTemplate = (profile) => {
  if (!profile?.isSelf) return "";
  const nextRenameAt = nextUsernameChangeDate(profile);
  const canRenameFreely = profile.role === "admin" || profile.isOwner;
  const renameLocked = !canRenameFreely && nextRenameAt && Date.now() < nextRenameAt.getTime();
  const renameHint = canRenameFreely
    ? "服主/管理员可随时修改。"
    : renameLocked
      ? `下次可修改：${formatDate(nextRenameAt.toISOString())}`
      : "每 7 天可修改一次。";
  const characterName = profile.minecraft_name || "";
  const deletionStatus = accountDeletionStatusText(profile.accountDeletion);
  const deletionLocked = Boolean(profile.accountDeletion);
  const deletionSection = profile.isOwner
    ? ""
    : `
      <details class="profile-setting danger-zone">
        <summary><span>注销账户</span><small>${escapeHtml(deletionStatus || "10 秒确认，3 天冷静期")}</small></summary>
        <div class="profile-setting-form">
          <p>${escapeHtml(
            deletionStatus ||
              (profile.role === "admin"
                ? "管理员提交后需要服主批准，批准后进入 3 天冷静期。冷静期内重新登录会取消注销。"
                : "发起后账号会退出登录并进入 3 天冷静期。冷静期内重新登录会取消注销，到期后账号会注销。"),
          )}</p>
          <button class="button danger" type="button" id="requestAccountDeletionButton" ${deletionLocked ? "disabled" : ""}>
            ${deletionLocked ? "注销已开启" : "注销账户"}
          </button>
        </div>
      </details>
    `;
  return `
    <section class="profile-settings">
      <h3>账号设置</h3>
      <details class="profile-setting">
        <summary><span>更改用户名</span><small>${escapeHtml(renameHint)}</small></summary>
        <form class="profile-setting-form" id="profileUsernameForm">
          <label>
            <span>新用户名</span>
            <input id="profileNewUsername" name="username" maxlength="20" autocomplete="username" value="${escapeHtml(profile.username)}" ${renameLocked ? "disabled" : ""} />
          </label>
          <button class="button primary" type="submit" ${renameLocked ? "disabled" : ""}>保存用户名</button>
        </form>
      </details>
      <details class="profile-setting">
        <summary><span>换人物角色</span><small>${escapeHtml(characterName || profile.username)}</small></summary>
        <form class="profile-setting-form" id="profileCharacterForm">
          <label>
            <span>Minecraft 角色名</span>
            <input id="profileMinecraftName" name="minecraftName" maxlength="32" autocomplete="off" value="${escapeHtml(characterName)}" placeholder="${escapeHtml(profile.username)}" />
          </label>
          <label>
            <span>上传皮肤</span>
            <input id="profileSkinFile" name="skinFile" type="file" accept="image/png,image/jpeg,image/webp" />
          </label>
          <div class="profile-skin-preview">
            <img id="profileSkinPreview" src="${activeSkinSrc(profile, 210)}" alt="" />
          </div>
          <div class="profile-setting-actions">
            <button class="button primary" type="submit">保存角色</button>
            <button class="button ghost" type="button" id="clearProfileSkinButton" ${profile.skin_image ? "" : "disabled"}>清除上传图</button>
          </div>
        </form>
      </details>
      <details class="profile-setting">
        <summary><span>修改密码</span><small>需先输入旧密码</small></summary>
        <form class="profile-setting-form" id="profilePasswordForm">
          <label>
            <span>旧密码</span>
            <input id="profileOldPassword" type="password" autocomplete="current-password" />
          </label>
          <label>
            <span>新密码</span>
            <input id="profileNewPassword" type="password" autocomplete="new-password" minlength="6" />
          </label>
          <label>
            <span>确认新密码</span>
            <input id="profileConfirmPassword" type="password" autocomplete="new-password" minlength="6" />
          </label>
          <button class="button primary" type="submit">保存密码</button>
        </form>
      </details>
      ${deletionSection}
    </section>
  `;
};

const readSkinFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 256 * 1024) {
      reject(new Error("上传图片需为 256KB 以内的 PNG、JPG 或 WebP"));
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("读取图片失败，请重新选择")));
    reader.readAsDataURL(file);
  });

const bindProfileSettings = () => {
  $("#profileUsernameForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = $("#profileNewUsername")?.value.trim() || "";
    if (!/^[\w\u4e00-\u9fa5-]{3,20}$/.test(username)) {
      showToast("用户名需要 3 到 20 位");
      return;
    }
    const result = await api("/me/username", { method: "PUT", body: JSON.stringify({ username }) });
    state.me = result.user;
    if (result.user?.username) window.history.replaceState(null, "", profileHref(result.user.username));
    await refreshPageData();
    showToast("用户名已更新");
  });

  const skinInput = $("#profileSkinFile");
  skinInput?.addEventListener("change", async (event) => {
    try {
      const dataUrl = await readSkinFileAsDataUrl(event.target.files?.[0]);
      event.target.dataset.skinImage = dataUrl;
      const preview = $("#profileSkinPreview");
      if (preview && dataUrl) preview.src = dataUrl;
    } catch (error) {
      event.target.value = "";
      event.target.dataset.skinImage = "";
      showToast(error.message);
    }
  });

  $("#profileCharacterForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const minecraftName = $("#profileMinecraftName")?.value.trim() || "";
    const body = { minecraftName };
    if (skinInput?.dataset.skinImage) body.skinImage = skinInput.dataset.skinImage;
    const result = await api("/me/character", { method: "PUT", body: JSON.stringify(body) });
    state.me = result.user;
    await refreshPageData();
    showToast("人物角色已更新");
  });

  $("#clearProfileSkinButton")?.addEventListener("click", async () => {
    const minecraftName = $("#profileMinecraftName")?.value.trim() || "";
    const result = await api("/me/character", { method: "PUT", body: JSON.stringify({ minecraftName, skinImage: "" }) });
    state.me = result.user;
    await refreshPageData();
    showToast("上传图已清除");
  });

  $("#profilePasswordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const oldPassword = $("#profileOldPassword")?.value || "";
    const newPassword = $("#profileNewPassword")?.value || "";
    const confirmPassword = $("#profileConfirmPassword")?.value || "";
    if (newPassword.length < 6) {
      showToast("新密码至少需要 6 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("两次输入的新密码不一致");
      return;
    }
    await api("/me/password", { method: "PUT", body: JSON.stringify({ oldPassword, newPassword }) });
    event.target.reset();
    showToast("密码已更新");
  });

  $("#requestAccountDeletionButton")?.addEventListener("click", async () => {
    const isAdminDeletion = state.profile?.role === "admin";
    const confirmed = await showConfirmDialog(
      isAdminDeletion
        ? "确定提交管理员账号注销申请吗？服主批准后会进入 3 天冷静期，冷静期内重新登录可取消。"
        : "确定开启账号注销吗？开启后会退出登录并进入 3 天冷静期，冷静期内重新登录可取消。",
      {
        title: "注销账户",
        eyebrow: "账号安全",
        cancelLabel: "再想想",
        confirmLabel: "开启注销",
        confirmTone: "danger",
        confirmDelaySeconds: 10,
      },
    );
    if (!confirmed) return;
    const result = await api("/me/deletion", { method: "POST" });
    if (result.approvalRequired) {
      await refreshPageData();
      showToast("注销申请已提交，等待服主批准");
      return;
    }
    showToast("注销已开启，3 天内重新登录可取消");
    window.setTimeout(() => {
      window.location.href = "/login.html";
    }, 900);
  });

  $$("[data-report-player]").forEach((button) => {
    button.addEventListener("click", async () => {
      await submitPlayerReport(button.dataset.reportPlayer);
    });
  });
};

const bindProfileFloatingOverlay = ({ buttonSelector, overlaySelector, closeSelector, stateKey, boundKey }) => {
  const button = $(buttonSelector);
  const overlay = $(overlaySelector);
  if (!button || !overlay) return;

  const finishClose = () => {
    window.clearTimeout(overlay.closeTimer);
    window.cancelAnimationFrame(overlay.openFrame);
    overlay.hidden = true;
    overlay.classList.remove("is-open", "is-closing");
    syncFloatingScrollLock();
  };
  const sync = (open) => {
    window.clearTimeout(overlay.closeTimer);
    window.cancelAnimationFrame(overlay.openFrame);
    if (open) {
      overlay.hidden = false;
      overlay.classList.remove("is-closing");
      syncFloatingScrollLock();
      overlay.openFrame = window.requestAnimationFrame(() => {
        if (state[stateKey]) {
          overlay.classList.add("is-open");
          syncFloatingScrollLock();
        }
      });
      return;
    }
    overlay.classList.remove("is-open");
    syncFloatingScrollLock();
    if (overlay.hidden || prefersReducedMotion()) {
      finishClose();
      return;
    }
    overlay.classList.add("is-closing");
    overlay.closeTimer = window.setTimeout(finishClose, dialogCloseDelay() + 80);
  };
  const open = () => {
    state[stateKey] = true;
    sync(true);
  };
  const close = () => {
    if (!state[stateKey] && overlay.hidden) return;
    state[stateKey] = false;
    sync(false);
  };

  if (!button.dataset[boundKey]) {
    button.dataset[boundKey] = "true";
    button.addEventListener("click", open);
  }
  if (!overlay.dataset[boundKey]) {
    overlay.dataset[boundKey] = "true";
    overlay.querySelectorAll(closeSelector).forEach((node) => node.addEventListener("click", close));
  }
  const keydownBoundKey = `${boundKey}Keydown`;
  if (!state[keydownBoundKey]) {
    state[keydownBoundKey] = true;
    state[`${boundKey}KeydownHandler`] = (event) => {
      if (event.key === "Escape" && state[stateKey]) close();
    };
    document.addEventListener("keydown", state[`${boundKey}KeydownHandler`]);
  }

  sync(state[stateKey]);
};

const bindProfileTrashToggle = () =>
  bindProfileFloatingOverlay({
    buttonSelector: "#profileTrashButton",
    overlaySelector: "#profileTrashOverlay",
    closeSelector: "[data-profile-trash-close]",
    stateKey: "profileTrashOpen",
    boundKey: "trashBound",
  });

const bindProfileReportsToggle = () =>
  bindProfileFloatingOverlay({
    buttonSelector: "#profileReportHistoryButton",
    overlaySelector: "#profileReportHistoryOverlay",
    closeSelector: "[data-profile-report-close]",
    stateKey: "profileReportsOpen",
    boundKey: "reportsBound",
  });

const bindProfileReportButtons = () => {
  $("#profileMarkAllReportsReadButton")?.addEventListener("click", async () => {
    const button = $("#profileMarkAllReportsReadButton");
    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = "标记中...";
    try {
      await api("/me/reports/read-all", { method: "POST" });
      if (state.profile?.reportHistory) {
        const now = new Date().toISOString();
        state.profile.reportHistory = state.profile.reportHistory.map((report) => ({ ...report, reporter_read_at: now }));
      }
      state.profileReportsOpen = true;
      renderProfilePage();
      showToast("我的举报已全部标记为已读");
    } catch {
      button.disabled = false;
      button.textContent = "标记全部已读";
    }
  });
  $$("[data-mark-report-read]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const label = button.textContent;
      button.disabled = true;
      button.textContent = "标记中...";
      try {
        await api(`/me/reports/${button.dataset.markReportReadKind}/${button.dataset.markReportRead}/read`, { method: "POST" });
        if (state.profile?.reportHistory) {
          const now = new Date().toISOString();
          state.profile.reportHistory = state.profile.reportHistory.map((report) =>
            report.kind === button.dataset.markReportReadKind && Number(report.id) === Number(button.dataset.markReportRead)
              ? { ...report, reporter_read_at: now }
              : report,
          );
        }
        state.profileReportsOpen = true;
        renderProfilePage();
        showToast("举报已标记为已读");
      } catch {
        button.disabled = false;
        button.textContent = label;
      }
    });
  });
};

const bindContentButtons = () => {
  $$(".read-button").forEach((button) => {
    button.addEventListener("click", () => openReader(button.dataset.type, Number(button.dataset.id)));
  });
  $$("[data-edit-post]").forEach((button) => {
    button.addEventListener("click", () => {
      const post = state.posts.find((item) => item.id === Number(button.dataset.editPost));
      if (!post) return;
      state.editingPostId = post.id;
      $("#forumTitle").value = post.title;
      $("#editor").innerHTML = post.content_html;
      $("#forumPostSubmit").textContent = "保存修改";
      openPostDialog();
    });
  });
  $$("[data-delete-post]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = await showConfirmDialog("删除后会进入回收站，7 天后彻底删除。确定继续吗？", {
        title: "删除帖子",
        eyebrow: "内容管理",
        confirmLabel: "移入回收站",
        confirmTone: "danger",
      });
      if (!confirmed) return;
      const id = Number(button.dataset.deletePost);
      const deletedPost = state.posts.find((item) => item.id === id);
      await api(`/posts/${id}`, { method: "DELETE" });
      state.posts = state.posts.filter((item) => item.id !== id);
      if (state.profile?.posts) state.profile.posts = state.profile.posts.filter((item) => item.id !== id);
      if (state.profile?.isSelf && deletedPost) {
        state.profile.trashPosts = [{ ...deletedPost, deleted_at: new Date().toISOString() }, ...(state.profile.trashPosts || [])];
      }
      renderAll();
      showToast("帖子已移入回收站");
    });
  });
  $$("[data-report-post]").forEach((button) => {
    button.addEventListener("click", async () => {
      await submitPostReport(button.dataset.reportPost);
    });
  });
};

const headingLevelForOutline = (heading) => Math.max(0, Math.min(3, Number(heading.tagName.slice(1)) - 2));

const submitPostReport = async (postId) => {
  const reason = await showPromptDialog("请说明举报原因，管理员会在后台查看内容并处理。", {
    title: "举报",
    eyebrow: "社区反馈",
    inputLabel: "举报原因",
    placeholder: "例如：广告、恶意内容、违规发言",
    maxLength: 500,
    confirmLabel: "提交举报",
    normalize: (value) => value.trim(),
    validate: (value) => (value.length >= 4 ? "" : "请填写至少 4 个字"),
  });
  if (!reason) return false;
  const result = await api(`/posts/${postId}/reports`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
  showToast(result.ownerOnly ? "举报已提交，将由服主处理" : "举报已提交，管理员会处理");
  return true;
};

const submitPlayerReport = async (username) => {
  const reason = await showPromptDialog("请说明举报原因，管理员会在后台查看资料并处理。", {
    title: "举报",
    eyebrow: "社区反馈",
    inputLabel: "举报原因",
    placeholder: "例如：恶意行为、冒充、骚扰",
    maxLength: 500,
    confirmLabel: "提交举报",
    normalize: (value) => value.trim(),
    validate: (value) => (value.length >= 4 ? "" : "请填写至少 4 个字"),
  });
  if (!reason) return false;
  const result = await api(`/profiles/${encodeURIComponent(username)}/reports`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
  showToast(result.ownerOnly ? "举报已提交，将由服主处理" : "举报已提交，管理员会处理");
  return true;
};

const activeCommentQuotes = (postId) => state.commentQuotes.filter((quote) => Number(quote.postId) === Number(postId));

const removeCommentQuotesForPost = (postId) => {
  state.commentQuotes = state.commentQuotes.filter((quote) => Number(quote.postId) !== Number(postId));
  if (Number(state.commentQuoteManagerOpenPostId) === Number(postId)) state.commentQuoteManagerOpenPostId = null;
};

const isCommentComposerOpen = (postId) => Boolean(state.commentComposerOpenPostIds?.[postId] || state.commentEditing?.postId === postId);

const setCommentComposerOpen = (postId, open) => {
  state.commentComposerOpenPostIds = { ...(state.commentComposerOpenPostIds || {}), [postId]: Boolean(open) };
};

const addCommentQuote = (postId, comment) => {
  if (!comment || comment.deleted_at) return false;
  const current = activeCommentQuotes(postId);
  if (current.some((quote) => Number(quote.id) === Number(comment.id))) return false;
  if (current.length >= 8) {
    showToast("最多可引用 8 条回复");
    return false;
  }
  state.commentQuotes = [
    ...state.commentQuotes,
    {
      postId,
      id: Number(comment.id),
      author: comment.author || "被引用回复",
      excerpt: textFromHtml(comment.content_html).slice(0, 120),
    },
  ];
  return true;
};

const removeCommentQuote = (postId, quoteId) => {
  state.commentQuotes = state.commentQuotes.filter((quote) => !(Number(quote.postId) === Number(postId) && Number(quote.id) === Number(quoteId)));
};

const moveCommentQuote = (postId, quoteId, direction) => {
  const quoteIdNumber = Number(quoteId);
  const postIdNumber = Number(postId);
  const quotes = activeCommentQuotes(postId);
  const index = quotes.findIndex((quote) => Number(quote.id) === quoteIdNumber);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= quotes.length) return;
  const reordered = [...quotes];
  [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
  state.commentQuotes = [
    ...state.commentQuotes.filter((quote) => Number(quote.postId) !== postIdNumber),
    ...reordered,
  ];
};

const reorderCommentQuoteToIndex = (postId, quoteId, targetIndex) => {
  const quoteIdNumber = Number(quoteId);
  const postIdNumber = Number(postId);
  const quotes = activeCommentQuotes(postId);
  const fromIndex = quotes.findIndex((quote) => Number(quote.id) === quoteIdNumber);
  if (fromIndex < 0) return false;
  let insertIndex = Math.max(0, Math.min(Number(targetIndex), quotes.length));
  if (fromIndex < insertIndex) insertIndex -= 1;
  if (fromIndex === insertIndex) return false;
  const reordered = [...quotes];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(Math.max(0, Math.min(insertIndex, reordered.length)), 0, moved);
  state.commentQuotes = [
    ...state.commentQuotes.filter((quote) => Number(quote.postId) !== postIdNumber),
    ...reordered,
  ];
  return true;
};

const commentQuoteListTemplate = (quotes, { editable = false } = {}) =>
  quotes
    .map(
      (quote, index) => `
        <blockquote class="${editable ? "comment-quote-manager-item" : "comment-quote"}" ${
          editable ? `draggable="true" data-comment-quote-id="${quote.id}" data-comment-quote-index="${index}"` : ""
        }>
          <div>
            <strong>${index + 1}. ${escapeHtml(quote.author || quote.quote_author || "被引用回复")}</strong>
            <span>${escapeHtml(quote.excerpt || quote.quote_excerpt || "")}</span>
          </div>
          ${
            editable
              ? `<div class="comment-quote-manager-actions">
                  <button type="button" data-comment-quote-move="${quote.id}" data-comment-quote-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="上移引用">↑</button>
                  <button type="button" data-comment-quote-move="${quote.id}" data-comment-quote-direction="1" ${index === quotes.length - 1 ? "disabled" : ""} aria-label="下移引用">↓</button>
                  <button type="button" data-comment-remove-quote="${quote.id}" aria-label="移除引用">×</button>
                </div>`
              : ""
          }
        </blockquote>
      `,
    )
    .join("");

const commentQuoteManagerTemplate = (quotes, open = false) => `
  <div class="comment-quote-popover ${open ? "is-open" : ""}" data-comment-quote-popover aria-hidden="${!open}">
    <div class="comment-quote-popover-head">
      <strong>引用顺序</strong>
      <button type="button" data-comment-close-quote-manager aria-label="关闭引用管理">×</button>
    </div>
    <div class="comment-quote-manager-list" data-comment-quote-list>
      ${quotes.length ? commentQuoteListTemplate(quotes, { editable: true }) : `<div class="empty compact">点击某条回复的“+ 引用”后，会出现在这里。</div>`}
    </div>
  </div>
`;

const commentToolbarTemplate = () => `
  <div class="comment-toolbar-shell" data-comment-toolbar-shell>
    <div class="comment-toolbar-drawer" data-comment-toolbar-drawer aria-hidden="true">
      <button type="button" data-comment-command="bold" title="粗体"><strong>B</strong></button>
      <button type="button" data-comment-command="italic" title="斜体"><em>I</em></button>
      <button type="button" data-comment-command="underline" title="下划线"><u>U</u></button>
      <button type="button" data-comment-command="insertUnorderedList" title="无序列表">•</button>
      <button type="button" data-comment-blockquote title="引用块">“”</button>
      <button type="button" data-comment-link title="链接">链</button>
      <label class="comment-color-tool" title="文本颜色">
        <span>色</span>
        <input type="color" value="#f5a43a" data-comment-color aria-label="文本颜色" />
      </label>
      <button type="button" data-comment-command="removeFormat" title="清除格式">清</button>
    </div>
    <button class="comment-toolbar-toggle" type="button" data-comment-toolbar-toggle aria-expanded="false" aria-label="展开回复工具栏">工具</button>
  </div>
`;

const commentComposerTemplate = (postId) => {
  if (!state.me) {
    return `<div class="comment-login"><span>登录后可以回复。</span><a class="button small primary" href="/login.html">登录</a></div>`;
  }
  const quotes = activeCommentQuotes(postId);
  const editing = state.commentEditing?.postId === postId ? state.commentEditing : null;
  const composerOpen = isCommentComposerOpen(postId);
  const quoteManagerOpen = Number(state.commentQuoteManagerOpenPostId) === Number(postId);
  return `
    <form class="comment-composer ${composerOpen ? "is-expanded" : "is-collapsed"}" data-comment-composer="${postId}">
      <button class="comment-composer-toggle" type="button" data-comment-composer-toggle aria-expanded="${composerOpen}">
        ${composerOpen ? (editing ? "收起编辑" : "收起评论") : "+ 发表评论"}
      </button>
      <div class="comment-composer-panel" aria-hidden="${!composerOpen}">
        <div class="comment-composer-panel-inner">
          <div class="comment-composer-head">
            <strong>${editing ? "编辑回复" : "发表评论"}</strong>
            ${editing ? `<button class="button small ghost" type="button" data-comment-cancel-edit>取消编辑</button>` : ""}
          </div>
          ${commentToolbarTemplate()}
          <div class="comment-editor rich-editor" contenteditable="true" role="textbox" data-comment-editor aria-label="回复内容">${editing ? editing.contentHtml : ""}</div>
          ${
            !editing
              ? `<div class="comment-insert-row">
                  <button class="comment-inline-action" type="button" data-comment-open-quote-manager aria-expanded="${quoteManagerOpen}">
                    <span aria-hidden="true">+</span> 引用${quotes.length ? ` <strong>${quotes.length}</strong>` : ""}
                  </button>
                  ${quotes.length ? `<span class="comment-quote-summary">已选择 ${quotes.length} 条引用</span>` : ""}
                </div>
                ${commentQuoteManagerTemplate(quotes, quoteManagerOpen)}`
              : ""
          }
          <div class="comment-submit-row">
            <button class="button primary small" type="submit">${editing ? "保存回复" : "发布回复"}</button>
          </div>
        </div>
      </div>
    </form>
  `;
};

const commentUndoTemplate = (postId) => {
  const items = state.commentUndoItems.filter((item) => item.postId === postId && item.expiresAt > Date.now());
  if (!items.length) return "";
  return `
    <div class="comment-undo-list">
      ${items
        .map((item) => {
          const secondsLeft = Math.max(1, Math.ceil((item.expiresAt - Date.now()) / 1000));
          return `
            <div class="comment-undo" data-comment-undo="${item.id}">
              <span>${item.type === "delete" ? "回复已删除" : "回复已更新"}，还剩 <strong class="comment-undo-count">${secondsLeft}</strong> 秒可以撤销。</span>
              <button class="button small ghost" type="button" data-comment-undo-action="${item.id}">撤销</button>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
};

const commentTemplate = (comment, postId) => {
  const deleted = Boolean(comment.deleted_at);
  const authorUser = authorUserFromItem(comment, comment.author);
  const canQuote = Boolean(state.me && !deleted);
  const canReport = Boolean(state.me && comment.can_report && !isOwnerContent(comment));
  const likeActive = Number(comment.my_reaction) === 1;
  const dislikeActive = Number(comment.my_reaction) === -1;
  const quotes = Array.isArray(comment.quotes) && comment.quotes.length
    ? comment.quotes
    : comment.quote_excerpt
      ? [{ id: comment.quote_comment_id, author: comment.quote_author || "被引用回复", excerpt: comment.quote_excerpt }]
      : [];
  return `
    <article class="comment-card ${deleted ? "is-deleted" : ""} ${Number(state.commentHighlightId) === Number(comment.id) ? "is-highlighted" : ""}" id="comment-${comment.id}" data-comment-id="${comment.id}">
      <div class="comment-avatar">
        <img src="${activeAvatarSrc(authorUser, 32)}" alt="" loading="lazy" />
      </div>
      <div class="comment-main">
        <div class="comment-meta">
          <a class="author-link" href="${profileHref(comment.author)}">${escapeHtml(comment.author)}</a>
          <span>${escapeHtml(comment.author_account_type || "成员")}</span>
          <time>${formatDate(comment.created_at)}</time>
          ${comment.updated_at && comment.updated_at !== comment.created_at ? `<em>已编辑</em>` : ""}
        </div>
        ${
          deleted
            ? `<p class="comment-deleted">这条回复已删除。</p>`
            : `
              ${
                quotes.length
                  ? `<div class="comment-quote-list">${commentQuoteListTemplate(quotes)}</div>`
                  : ""
              }
              <div class="comment-body reader-body">${comment.content_html}</div>
            `
        }
      </div>
      <div class="comment-actions">
        ${
          deleted
            ? ""
            : `<button class="comment-reaction-button ${likeActive ? "is-active" : ""}" type="button" data-comment-reaction="like" data-comment-reaction-id="${comment.id}" aria-pressed="${likeActive}" title="点赞">
                <span aria-hidden="true">👍</span><strong>${Number(comment.like_count || 0)}</strong>
              </button>
              <button class="comment-reaction-button is-dislike ${dislikeActive ? "is-active" : ""}" type="button" data-comment-reaction="dislike" data-comment-reaction-id="${comment.id}" aria-pressed="${dislikeActive}" title="点踩">
                <span aria-hidden="true">👎</span><strong>${Number(comment.dislike_count || 0)}</strong>
              </button>`
        }
        ${canQuote ? `<button class="comment-icon-button" type="button" data-comment-quote="${comment.id}" title="引用回复" aria-label="引用回复"><span aria-hidden="true">+ 引用</span></button>` : ""}
        ${canReport ? `<button class="comment-icon-button danger" type="button" data-comment-report="${comment.id}" title="举报回复" aria-label="举报回复"><span class="report-warning-icon" aria-hidden="true"></span></button>` : ""}
        ${comment.can_edit ? `<button class="button small ghost" type="button" data-comment-edit="${comment.id}">编辑</button>` : ""}
        ${comment.can_delete ? `<button class="button small danger" type="button" data-comment-delete="${comment.id}">删除</button>` : ""}
      </div>
    </article>
  `;
};

const renderComments = (postId) => {
  const section = $(`[data-comments-for="${postId}"]`);
  if (!section) return;
  const comments = state.comments[postId] || [];
  const visibleComments = comments.filter((comment) => !comment.deleted_at);
  const visibleCount = visibleComments.length;
  section.innerHTML = `
    <div class="comments-head">
      <div>
        <h2>回复</h2>
        <span>${visibleCount} 条回复</span>
      </div>
    </div>
    ${commentUndoTemplate(postId)}
    ${commentComposerTemplate(postId)}
    <div class="comments-list">
      ${visibleComments.length ? visibleComments.map((comment) => commentTemplate(comment, postId)).join("") : `<div class="empty">还没有回复。</div>`}
    </div>
  `;
  bindPostComments(postId);
  if (state.commentHighlightId) {
    const highlighted = section.querySelector(`#comment-${state.commentHighlightId}`);
    highlighted?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  }
};

const loadPostComments = async (postId) => {
  const section = $(`[data-comments-for="${postId}"]`);
  if (section) section.innerHTML = `<div class="empty">正在加载回复...</div>`;
  const result = await api(`/posts/${postId}/comments`);
  state.comments[postId] = result.items || [];
  renderComments(postId);
};

const commentById = (postId, commentId) => (state.comments[postId] || []).find((comment) => Number(comment.id) === Number(commentId));
const upsertComment = (postId, comment) => {
  const list = state.comments[postId] || [];
  state.comments[postId] = [comment, ...list.filter((entry) => Number(entry.id) !== Number(comment.id))].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
};

const removeCommentUndo = (undoId, rerenderPostId = null) => {
  window.clearTimeout(state.commentUndoTimers[undoId]);
  delete state.commentUndoTimers[undoId];
  state.commentUndoItems = state.commentUndoItems.filter((item) => item.id !== undoId);
  syncCommentUndoTicker();
  if (rerenderPostId) renderComments(rerenderPostId);
};

const startCommentUndo = (item) => {
  state.commentUndoItems = [...state.commentUndoItems, item];
  window.clearTimeout(state.commentUndoTimers[item.id]);
  state.commentUndoTimers[item.id] = window.setTimeout(() => removeCommentUndo(item.id, item.postId), 30000);
  syncCommentUndoTicker();
};

const tickCommentUndoCountdowns = () => {
  const now = Date.now();
  const expiredItems = state.commentUndoItems.filter((item) => item.expiresAt <= now);
  state.commentUndoItems
    .filter((item) => item.expiresAt > now)
    .forEach((item) => {
      const count = document.querySelector(`[data-comment-undo="${item.id}"] .comment-undo-count`);
      if (count) count.textContent = String(Math.max(1, Math.ceil((item.expiresAt - now) / 1000)));
    });
  expiredItems.forEach((item) => {
    window.clearTimeout(state.commentUndoTimers[item.id]);
    delete state.commentUndoTimers[item.id];
  });
  if (expiredItems.length) state.commentUndoItems = state.commentUndoItems.filter((item) => item.expiresAt > now);
  [...new Set(expiredItems.map((item) => item.postId))].forEach((postId) => renderComments(postId));
  syncCommentUndoTicker();
};

const syncCommentUndoTicker = () => {
  const hasActiveUndo = state.commentUndoItems.some((item) => item.expiresAt > Date.now());
  if (hasActiveUndo && !commentUndoTicker) {
    commentUndoTicker = window.setInterval(tickCommentUndoCountdowns, 1000);
  }
  if (!hasActiveUndo && commentUndoTicker) {
    window.clearInterval(commentUndoTicker);
    commentUndoTicker = 0;
  }
};

const focusCommentComposer = (postId) => {
  setCommentComposerOpen(postId, true);
  renderComments(postId);
  const editor = $(`[data-comments-for="${postId}"] [data-comment-editor]`);
  editor?.focus({ preventScroll: true });
  editor?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
};

const insertCommentLink = async (editor) => {
  const selection = window.getSelection?.();
  const savedRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  const url = await showPromptDialog("输入需要插入的链接地址。", {
    title: "插入链接",
    eyebrow: "回复工具",
    inputLabel: "链接地址",
    placeholder: "https://example.com",
    confirmLabel: "插入链接",
    normalize: (value) => value.trim(),
  });
  const href = normalizeEditorLinkHref(url);
  if (!href) {
    if (url) showToast("链接地址格式不正确");
    return;
  }
  editor.focus({ preventScroll: true });
  if (rangeBelongsToEditor(savedRange, editor)) {
    const range = savedRange.cloneRange();
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (range.collapsed) {
      link.textContent = url;
    } else {
      link.append(range.extractContents());
    }
    range.insertNode(link);
    range.setStartAfter(link);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    editor.normalize();
    return;
  }
  document.execCommand("createLink", false, href);
};

const submitCommentReport = async (commentId) => {
  const reason = await showPromptDialog("请说明举报原因，管理员会在后台查看回复并处理。", {
    title: "举报",
    eyebrow: "社区反馈",
    inputLabel: "举报原因",
    placeholder: "例如：恶意攻击、广告、违规内容",
    maxLength: 500,
    confirmLabel: "提交举报",
    normalize: (value) => value.trim(),
    validate: (value) => (value.length >= 4 ? "" : "请填写至少 4 个字"),
  });
  if (!reason) return false;
  const result = await api(`/comments/${commentId}/reports`, { method: "POST", body: JSON.stringify({ reason }) });
  showToast(result.ownerOnly ? "举报已提交，将由服主处理" : "举报已提交，管理员会处理");
  return true;
};

const submitCommentReaction = async (postId, commentId, reaction) => {
  const comment = commentById(postId, commentId);
  const nextReaction = Number(comment?.my_reaction) === (reaction === "like" ? 1 : -1) ? "" : reaction;
  const result = await api(`/comments/${commentId}/reaction`, { method: "POST", body: JSON.stringify({ reaction: nextReaction }) });
  upsertComment(postId, result.comment);
  renderComments(postId);
};

const applyCommentColor = (section, color) => {
  const editor = section.querySelector("[data-comment-editor]");
  if (!editor || !color) return;
  editor.focus({ preventScroll: true });
  document.execCommand("foreColor", false, color);
};

const bindPostComments = (postId) => {
  const section = $(`[data-comments-for="${postId}"]`);
  if (!section) return;
  section.querySelector("[data-comment-composer-toggle]")?.addEventListener("click", (event) => {
    const form = event.currentTarget.closest("[data-comment-composer]");
    const open = !form.classList.contains("is-expanded");
    setCommentComposerOpen(postId, open);
    form.classList.toggle("is-expanded", open);
    form.classList.toggle("is-collapsed", !open);
    event.currentTarget.setAttribute("aria-expanded", String(open));
    event.currentTarget.textContent = open ? (state.commentEditing?.postId === postId ? "收起编辑" : "收起评论") : "+ 发表评论";
    form.querySelector(".comment-composer-panel")?.setAttribute("aria-hidden", String(!open));
    if (!open) state.commentQuoteManagerOpenPostId = null;
    if (!open) {
      form.querySelector("[data-comment-quote-popover]")?.classList.remove("is-open");
      form.querySelector("[data-comment-quote-popover]")?.setAttribute("aria-hidden", "true");
      form.querySelector("[data-comment-open-quote-manager]")?.setAttribute("aria-expanded", "false");
    }
    if (open) window.setTimeout(() => section.querySelector("[data-comment-editor]")?.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 180);
  });
  section.querySelector("[data-comment-toolbar-toggle]")?.addEventListener("click", (event) => {
    const shell = event.currentTarget.closest("[data-comment-toolbar-shell]");
    const open = !shell.classList.contains("is-open");
    shell.classList.toggle("is-open", open);
    event.currentTarget.setAttribute("aria-expanded", String(open));
    event.currentTarget.setAttribute("aria-label", open ? "收回回复工具栏" : "展开回复工具栏");
    shell.querySelector("[data-comment-toolbar-drawer]")?.setAttribute("aria-hidden", String(!open));
  });
  section.querySelectorAll("[data-comment-command], [data-comment-blockquote], [data-comment-link]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.preventDefault());
  });
  section.querySelectorAll("[data-comment-command]").forEach((button) => {
    button.addEventListener("click", () => {
      const editor = section.querySelector("[data-comment-editor]");
      editor?.focus({ preventScroll: true });
      document.execCommand(button.dataset.commentCommand, false, null);
    });
  });
  section.querySelector("[data-comment-blockquote]")?.addEventListener("click", () => {
    const editor = section.querySelector("[data-comment-editor]");
    editor?.focus({ preventScroll: true });
    document.execCommand("formatBlock", false, "BLOCKQUOTE");
  });
  section.querySelector("[data-comment-link]")?.addEventListener("click", async () => {
    const editor = section.querySelector("[data-comment-editor]");
    if (editor) await insertCommentLink(editor);
  });
  section.querySelector("[data-comment-color]")?.addEventListener("input", (event) => applyCommentColor(section, event.target.value));
  section.querySelector("[data-comment-open-quote-manager]")?.addEventListener("click", (event) => {
    const open = Number(state.commentQuoteManagerOpenPostId) !== Number(postId);
    state.commentQuoteManagerOpenPostId = open ? postId : null;
    event.currentTarget.setAttribute("aria-expanded", String(open));
    const popover = section.querySelector("[data-comment-quote-popover]");
    popover?.classList.toggle("is-open", open);
    popover?.setAttribute("aria-hidden", String(!open));
  });
  section.querySelector("[data-comment-close-quote-manager]")?.addEventListener("click", (event) => {
    state.commentQuoteManagerOpenPostId = null;
    const popover = event.currentTarget.closest("[data-comment-quote-popover]");
    popover?.classList.remove("is-open");
    popover?.setAttribute("aria-hidden", "true");
    section.querySelector("[data-comment-open-quote-manager]")?.setAttribute("aria-expanded", "false");
  });
  section.querySelectorAll("[data-comment-quote-move]").forEach((button) => {
    button.addEventListener("click", () => {
      moveCommentQuote(postId, button.dataset.commentQuoteMove, Number(button.dataset.commentQuoteDirection || 0));
      state.commentQuoteManagerOpenPostId = postId;
      renderComments(postId);
    });
  });
  section.querySelectorAll("[data-comment-remove-quote]").forEach((button) => {
    button.addEventListener("click", () => {
      removeCommentQuote(postId, button.dataset.commentRemoveQuote);
      state.commentQuoteManagerOpenPostId = postId;
      renderComments(postId);
    });
  });
  section.querySelectorAll("[data-comment-quote-id]").forEach((item) => {
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", item.dataset.commentQuoteId);
      event.dataTransfer?.setData("application/x-comment-quote-id", item.dataset.commentQuoteId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      item.classList.add("is-dragging");
    });
    item.addEventListener("dragend", () => {
      section.querySelectorAll(".comment-quote-manager-item").forEach((entry) => entry.classList.remove("is-dragging", "is-drag-over"));
    });
    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      section.querySelectorAll(".comment-quote-manager-item.is-drag-over").forEach((entry) => {
        if (entry !== item) entry.classList.remove("is-drag-over");
      });
      item.classList.add("is-drag-over");
    });
    item.addEventListener("dragleave", () => item.classList.remove("is-drag-over"));
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const quoteId = event.dataTransfer?.getData("application/x-comment-quote-id") || event.dataTransfer?.getData("text/plain");
      const rect = item.getBoundingClientRect();
      const targetIndex = Number(item.dataset.commentQuoteIndex || 0) + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
      if (reorderCommentQuoteToIndex(postId, quoteId, targetIndex)) {
        state.commentQuoteManagerOpenPostId = postId;
        renderComments(postId);
      }
    });
  });
  section.querySelector("[data-comment-quote-list]")?.addEventListener("dragover", (event) => {
    if (!event.target.closest("[data-comment-quote-id]")) event.preventDefault();
  });
  section.querySelector("[data-comment-quote-list]")?.addEventListener("drop", (event) => {
    if (event.target.closest("[data-comment-quote-id]")) return;
    event.preventDefault();
    const quoteId = event.dataTransfer?.getData("application/x-comment-quote-id") || event.dataTransfer?.getData("text/plain");
    if (reorderCommentQuoteToIndex(postId, quoteId, activeCommentQuotes(postId).length)) {
      state.commentQuoteManagerOpenPostId = postId;
      renderComments(postId);
    }
  });
  section.querySelector("[data-comment-cancel-edit]")?.addEventListener("click", () => {
    state.commentEditing = null;
    setCommentComposerOpen(postId, false);
    renderComments(postId);
  });
  section.querySelector("[data-comment-composer]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const editor = section.querySelector("[data-comment-editor]");
    const contentHtml = editor?.innerHTML.trim() || "";
    if (!textFromHtml(contentHtml)) {
      showToast("回复内容不能为空");
      return;
    }
    if (state.commentEditing?.postId === postId) {
      const editing = state.commentEditing;
      const result = await api(`/comments/${editing.id}`, { method: "PUT", body: JSON.stringify({ contentHtml }) });
      upsertComment(postId, result.comment);
      state.commentEditing = null;
      startCommentUndo({
        id: `edit-${result.comment.id}-${Date.now()}`,
        type: "edit",
        postId,
        commentId: result.comment.id,
        previousHtml: editing.previousHtml,
        expiresAt: Date.now() + 30000,
      });
      renderComments(postId);
      showToast("回复已更新，可在 30 秒内撤销");
      return;
    }
    const body = { contentHtml, quoteCommentIds: activeCommentQuotes(postId).map((quote) => quote.id) };
    const result = await api(`/posts/${postId}/comments`, { method: "POST", body: JSON.stringify(body) });
    upsertComment(postId, result.comment);
    removeCommentQuotesForPost(postId);
    setCommentComposerOpen(postId, false);
    renderComments(postId);
    showToast("回复已发布");
  });
  section.querySelectorAll("[data-comment-quote]").forEach((button) => {
    button.addEventListener("click", () => {
      const comment = commentById(postId, button.dataset.commentQuote);
      if (!comment) return;
      state.commentEditing = null;
      if (addCommentQuote(postId, comment)) state.commentQuoteManagerOpenPostId = postId;
      focusCommentComposer(postId);
    });
  });
  section.querySelectorAll("[data-comment-report]").forEach((button) => {
    button.addEventListener("click", async () => {
      await submitCommentReport(button.dataset.commentReport);
    });
  });
  section.querySelectorAll("[data-comment-reaction]").forEach((button) => {
    button.addEventListener("click", async () => {
      await submitCommentReaction(postId, button.dataset.commentReactionId, button.dataset.commentReaction);
    });
  });
  section.querySelectorAll("[data-comment-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const comment = commentById(postId, button.dataset.commentEdit);
      if (!comment) return;
      removeCommentQuotesForPost(postId);
      state.commentEditing = { postId, id: comment.id, contentHtml: comment.content_html, previousHtml: comment.content_html };
      focusCommentComposer(postId);
    });
  });
  section.querySelectorAll("[data-comment-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const comment = commentById(postId, button.dataset.commentDelete);
      if (!comment) return;
      await api(`/comments/${comment.id}`, { method: "DELETE" });
      upsertComment(postId, { ...comment, content_html: "", deleted_at: new Date().toISOString(), can_edit: false, can_delete: false, can_report: false });
      startCommentUndo({
        id: `delete-${comment.id}-${Date.now()}`,
        type: "delete",
        postId,
        commentId: comment.id,
        expiresAt: Date.now() + 30000,
      });
      renderComments(postId);
      showToast("回复已删除，可在 30 秒内撤销");
    });
  });
  section.querySelectorAll("[data-comment-undo-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const undo = state.commentUndoItems.find((item) => item.id === button.dataset.commentUndoAction);
      if (!undo) return;
      if (undo.type === "edit") {
        const result = await api(`/comments/${undo.commentId}`, { method: "PUT", body: JSON.stringify({ contentHtml: undo.previousHtml }) });
        upsertComment(postId, result.comment);
      } else {
        const result = await api(`/comments/${undo.commentId}/restore`, { method: "POST" });
        upsertComment(postId, result.comment);
      }
      removeCommentUndo(undo.id);
      renderComments(postId);
      showToast("已撤销");
    });
  });
};

const setupReaderOutline = (readerContent) => {
  const main = readerContent?.querySelector(".reader-main");
  const body = readerContent?.querySelector(".reader-body");
  const outline = readerContent?.querySelector("[data-reader-outline]");
  const list = readerContent?.querySelector("[data-reader-outline-list]");
  const toggle = readerContent?.querySelector("[data-outline-toggle]");
  if (!main || !body || !outline || !list || !toggle) return;

  const headings = [...body.querySelectorAll("h2, h3, h4")].filter((heading) => heading.textContent.trim());
  if (!headings.length) {
    outline.hidden = true;
    main.classList.add("has-no-outline");
    return;
  }

  main.classList.remove("has-no-outline");
  outline.hidden = false;
  const outlineId = Date.now();
  headings.forEach((heading, index) => {
    heading.id = `reader-heading-${outlineId}-${index}`;
  });
  list.innerHTML = headings
    .map(
      (heading) => `
        <a class="reader-outline-link" href="#${heading.id}" data-outline-target="${heading.id}" style="--outline-depth: ${headingLevelForOutline(heading)}">
          ${escapeHtml(heading.textContent.trim())}
        </a>
      `,
    )
    .join("");

  const links = [...list.querySelectorAll(".reader-outline-link")];
  const setCollapsed = (collapsed) => {
    outline.classList.toggle("is-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "显示大纲" : "隐藏大纲");
    toggle.textContent = collapsed ? "显示" : "隐藏";
  };

  links.forEach((link, index) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const heading = headings[index];
      const top = heading.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 12;
      main.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? "auto" : "smooth" });
      links.forEach((entry) => entry.classList.toggle("is-active", entry === link));
    });
  });

  const syncActiveLink = () => {
    const mainTop = main.getBoundingClientRect().top;
    let activeIndex = 0;
    headings.forEach((heading, index) => {
      if (heading.getBoundingClientRect().top - mainTop <= 28) activeIndex = index;
    });
    links.forEach((link, index) => link.classList.toggle("is-active", index === activeIndex));
  };

  toggle.addEventListener("click", () => setCollapsed(!outline.classList.contains("is-collapsed")));
  main.addEventListener("scroll", () => window.requestAnimationFrame(syncActiveLink), { passive: true });
  setCollapsed(false);
  syncActiveLink();
};

const openReader = (type, id) => {
  const source = type === "announcement" ? state.announcements : state.posts;
  const item = source.find((entry) => entry.id === id);
  if (!item || !$("#readerContent")) return;
  api(`/track-view/${type}/${id}`, { method: "POST" }).catch(() => {});
  item.views = Number(item.views || 0) + 1;
  const author = item.author || "管理员";
  const authorUser = authorUserFromItem(item, author);
  const accountType = item.author_account_type || (type === "announcement" ? "管理员" : "成员");
  const canReportPost = type === "post" && Boolean(state.me) && !ownsContent(item, author) && !isOwnerContent(item);
  $("#readerContent").innerHTML = `
    <button class="dialog-close-button" type="button" data-reader-close aria-label="关闭阅读页">×</button>
    <div class="reader-layout ${type === "post" || type === "announcement" ? "has-author-panel" : ""}">
      ${
        type === "post" || type === "announcement"
          ? `<aside class="reader-author-panel">
              <a class="reader-author-skin" href="${profileHref(author)}">
                <img src="${activeSkinSrc(authorUser, 210)}" alt="" loading="lazy" />
              </a>
              <div class="reader-author-meta">
                <span>${type === "announcement" ? "发布公告" : "发布者"}</span>
                <a class="author-link" href="${profileHref(author)}">${escapeHtml(author)}</a>
                <strong>${escapeHtml(accountType)}</strong>
              </div>
            </aside>`
          : ""
      }
      <div class="reader-main">
        <h1>${escapeHtml(item.title)}</h1>
        <div class="meta">
          <span class="meta-author">
            <span class="meta-author-badge">
              <img class="meta-author-icon" src="${activeAvatarSrc(authorUser, 32)}" alt="" loading="lazy" />
              <a class="author-link" href="${profileHref(author)}">${escapeHtml(author)}</a>
            </span>
            <span class="meta-author-type">${escapeHtml(accountType)}</span>
          </span>
          <span class="meta-date">${formatDate(item.created_at)}</span>
          <span>${item.views || 0} 次浏览</span>
        </div>
        ${
          canReportPost
            ? `
              <div class="reader-actions">
                <button class="button ghost small" type="button" data-reader-report="${item.id}">举报</button>
              </div>
            `
            : ""
        }
        <div class="reader-content-grid">
          <aside class="reader-outline" data-reader-outline hidden>
            <div class="reader-outline-header">
              <strong>大纲</strong>
              <button type="button" data-outline-toggle aria-expanded="true" aria-label="隐藏大纲">隐藏</button>
            </div>
            <nav class="reader-outline-list" data-reader-outline-list aria-label="文章大纲"></nav>
          </aside>
          <div class="reader-body">${item.content_html}</div>
        </div>
        ${type === "post" ? `<section class="comments-panel" data-comments-for="${item.id}" aria-label="帖子回复"></section>` : ""}
      </div>
    </div>
  `;
  $("#readerContent [data-reader-close]")?.addEventListener("click", () => closeDialogAnimated($("#readerDialog")));
  $("#readerContent [data-reader-report]")?.addEventListener("click", async () => {
    await submitPostReport(id);
  });
  setupReaderOutline($("#readerContent"));
  const serverStatusBinder = globalThis.bindServerStatusCardActions;
  if (typeof serverStatusBinder === "function") serverStatusBinder($("#readerContent"));
  openDialog($("#readerDialog"));
  if (type === "post") {
    removeCommentQuotesForPost(id);
    setCommentComposerOpen(id, false);
    state.commentEditing = null;
    loadPostComments(id).catch((error) => {
      const section = $(`[data-comments-for="${id}"]`);
      if (section) section.innerHTML = `<div class="empty">${escapeHtml(error.message || "回复加载失败")}</div>`;
    });
  }
};

const command = (name, value = null) => {
  const editor = $("#editor");
  if (!editor) return;
  if (!restoreEditorSelection()) editor.focus();
  document.execCommand(name, false, value);
  saveEditorSelection();
};

const editorAlignmentMap = {
  justifyLeft: "left",
  justifyCenter: "center",
  justifyRight: "right",
};

const closestEditableBlock = (node, editor) => {
  let current = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (current && current !== editor) {
    if (current.matches?.("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div,td,th")) return current;
    current = current.parentElement;
  }
  return editor;
};

const selectedEditableBlocks = (editor) => {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  if (!(editor === range.commonAncestorContainer || editor.contains(range.commonAncestorContainer))) return [];
  const blocks = new Set();
  const startBlock = closestEditableBlock(range.startContainer, editor);
  const endBlock = closestEditableBlock(range.endContainer, editor);
  if (startBlock) blocks.add(startBlock);
  if (endBlock) blocks.add(endBlock);
  editor.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div,td,th").forEach((block) => {
    try {
      if (range.intersectsNode(block)) blocks.add(block);
    } catch {
      // Ignore detached nodes from rapidly edited selections.
    }
  });
  return [...blocks];
};

const applyEditorAlignment = (name) => {
  const editor = $("#editor");
  const align = editorAlignmentMap[name];
  if (!editor || !align) return;
  if (!restoreEditorSelection()) editor.focus();
  document.execCommand(name, false, null);
  const blocks = selectedEditableBlocks(editor);
  const targets = blocks.filter((block) => block !== editor);
  if (targets.length) {
    targets.forEach((block) => {
      block.style.textAlign = align;
    });
  } else {
    editor.style.textAlign = align;
  }
  saveEditorSelection();
};

const insertHtmlBlock = (html) => command("insertHTML", html);

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findEditorMatch = (query) => {
  const editor = $("#editor");
  if (!editor || !query) return null;
  const needle = query.toLowerCase();
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const index = node.nodeValue.toLowerCase().indexOf(needle);
    if (index !== -1) return { node, start: index, end: index + query.length };
    node = walker.nextNode();
  }
  return null;
};

const selectEditorMatch = (match) => {
  const editor = $("#editor");
  if (!editor || !match) return;
  const range = document.createRange();
  range.setStart(match.node, match.start);
  range.setEnd(match.node, match.end);
  const selection = window.getSelection?.();
  editor.focus({ preventScroll: true });
  selection?.removeAllRanges();
  selection?.addRange(range);
  saveEditorSelection();
};

const replaceEditorMatch = (match, replacement) => {
  if (!match) return;
  const range = document.createRange();
  range.setStart(match.node, match.start);
  range.setEnd(match.node, match.end);
  range.deleteContents();
  range.insertNode(document.createTextNode(replacement));
  $("#editor")?.normalize();
};

const replaceAllEditorMatches = (query, replacement) => {
  const editor = $("#editor");
  if (!editor || !query) return 0;
  const pattern = new RegExp(escapeRegExp(query), "gi");
  const nodes = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    nodes.push(node);
    node = walker.nextNode();
  }
  let count = 0;
  nodes.forEach((textNode) => {
    const nextValue = textNode.nodeValue.replace(pattern, () => {
      count += 1;
      return replacement;
    });
    if (nextValue !== textNode.nodeValue) textNode.nodeValue = nextValue;
  });
  editor.normalize();
  return count;
};

const runEditorFindReplace = async () => {
  const editor = $("#editor");
  if (!editor) return;
  const result = await showEditorFindReplaceDialog();
  if (!result) return;

  const match = findEditorMatch(result.query);
  if (!match) {
    showToast("没有找到匹配内容");
    editor.focus();
    return;
  }
  selectEditorMatch(match);

  if (result.action === "find") {
    showToast("已选中第一处匹配");
    return;
  }
  if (result.action === "all") {
    const count = replaceAllEditorMatches(result.query, result.replacement);
    showToast(`已替换 ${count} 处`);
    return;
  }
  replaceEditorMatch(match, result.replacement);
  showToast("已替换当前匹配");
};

const createTableHtml = (rows, cols) => {
  const safeRows = Math.max(1, Math.min(10, Number(rows) || 1));
  const safeCols = Math.max(1, Math.min(10, Number(cols) || 1));
  const cells = Array.from({ length: safeCols }, () => "<td><br></td>").join("");
  const body = Array.from({ length: safeRows }, () => `<tr>${cells}</tr>`).join("");
  const width = Math.max(100, safeCols * 88);
  return `<table class="inline-table" data-table-rows="${safeRows}" data-table-cols="${safeCols}" style="width: ${width}px; table-layout: fixed;">${body}</table><p><br></p>`;
};

let tablePicker = null;
let tablePickerSelection = { rows: 1, cols: 1 };
let tablePickerAnchor = null;
let tablePickerHost = null;

const setTablePickerSelection = (rows, cols) => {
  tablePickerSelection = { rows, cols };
  if (!tablePicker) return;
  const label = tablePicker.querySelector("[data-table-picker-label]");
  if (label) label.textContent = `${rows} × ${cols}`;
  tablePicker.querySelectorAll(".table-picker-cell").forEach((cell) => {
    const cellRows = Number(cell.dataset.row);
    const cellCols = Number(cell.dataset.col);
    cell.classList.toggle("is-active", cellRows <= rows && cellCols <= cols);
  });
};

const positionTablePicker = () => {
  if (!tablePicker || tablePicker.hidden || !tablePickerAnchor) return;
  const rect = tablePickerAnchor.getBoundingClientRect();
  const host = tablePickerHost || document.body;
  const isBodyHost = host === document.body;
  const hostRect = isBodyHost ? { left: 0, top: 0 } : host.getBoundingClientRect();
  const margin = 8;
  const pickerRect = tablePicker.getBoundingClientRect();
  const scrollLeft = isBodyHost ? 0 : host.scrollLeft;
  const scrollTop = isBodyHost ? 0 : host.scrollTop;
  const maxWidth = isBodyHost ? window.innerWidth : host.clientWidth;
  const maxHeight = isBodyHost ? window.innerHeight : host.clientHeight;
  let left = rect.left - hostRect.left + scrollLeft;
  let top = rect.bottom - hostRect.top + scrollTop + 10;
  if (left + pickerRect.width > maxWidth + scrollLeft - margin) {
    left = maxWidth + scrollLeft - pickerRect.width - margin;
  }
  if (left < scrollLeft + margin) left = scrollLeft + margin;
  if (top + pickerRect.height > maxHeight + scrollTop - margin) {
    top = rect.top - hostRect.top + scrollTop - pickerRect.height - 10;
  }
  if (top < scrollTop + margin) top = scrollTop + margin;
  tablePicker.style.position = isBodyHost ? "fixed" : "absolute";
  tablePicker.style.left = `${Math.round(left)}px`;
  tablePicker.style.top = `${Math.round(top)}px`;
};

const closeTablePicker = () => {
  if (!tablePicker) return;
  tablePicker.hidden = true;
  tablePicker.classList.remove("is-open");
  tablePickerAnchor = null;
  tablePickerHost = null;
};

const openTablePicker = (anchor) => {
  if (!anchor) return;
  if (!tablePicker) {
    tablePicker = document.createElement("div");
    tablePicker.className = "table-picker";
    tablePicker.hidden = true;
    tablePicker.innerHTML = `
      <div class="table-picker-head">
        <strong data-table-picker-label>1 × 1</strong>
        <span>拖动鼠标选择行和列</span>
      </div>
      <div class="table-picker-grid" role="grid" aria-label="表格尺寸选择器"></div>
      <div class="table-picker-foot">点击即可插入表格</div>
    `;
    const grid = tablePicker.querySelector(".table-picker-grid");
    for (let row = 1; row <= 10; row += 1) {
      for (let col = 1; col <= 10; col += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "table-picker-cell";
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        cell.setAttribute("aria-label", `${row} × ${col}`);
        cell.addEventListener("pointerenter", () => setTablePickerSelection(row, col));
        cell.addEventListener("click", () => {
          insertHtmlBlock(createTableHtml(row, col));
          closeTablePicker();
        });
        grid?.append(cell);
      }
    }
    tablePicker.addEventListener("pointerleave", () => setTablePickerSelection(tablePickerSelection.rows, tablePickerSelection.cols));
    document.body.append(tablePicker);
    window.addEventListener("resize", positionTablePicker);
    window.addEventListener("scroll", positionTablePicker, { passive: true });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeTablePicker();
    });
    document.addEventListener("click", (event) => {
      if (!tablePicker || tablePicker.hidden) return;
      const target = event.target;
      if (tablePicker.contains(target) || tablePickerAnchor?.contains(target)) return;
      closeTablePicker();
    });
  }

  if (tablePicker.hidden) {
    tablePickerAnchor = anchor;
    tablePickerHost = floatingHostFor(anchor);
    if (tablePicker.parentElement !== tablePickerHost) tablePickerHost.append(tablePicker);
    tablePicker.hidden = false;
    tablePicker.classList.add("is-open");
    setTablePickerSelection(1, 1);
    window.requestAnimationFrame(() => positionTablePicker());
    return;
  }

  closeTablePicker();
};

const normalizeEditorLinkHref = (url) => {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(value)) return value;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return "";
  return `https://${value}`;
};

const rangeBelongsToEditor = (range, editor) =>
  Boolean(range && editor && (editor === range.commonAncestorContainer || editor.contains(range.commonAncestorContainer)));

const insertEditorLink = (url, savedRange) => {
  const editor = $("#editor");
  const href = normalizeEditorLinkHref(url);
  if (!editor || !href) return false;
  const range = savedRange?.cloneRange();
  if (!rangeBelongsToEditor(range, editor)) {
    editor.focus({ preventScroll: true });
    command("createLink", href);
    return true;
  }

  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  if (range.collapsed) {
    link.textContent = url;
  } else {
    link.append(range.extractContents());
  }
  range.insertNode(link);
  range.setStartAfter(link);
  range.collapse(true);
  const selection = window.getSelection?.();
  selection?.removeAllRanges();
  selection?.addRange(range);
  editorSavedRange = range.cloneRange();
  editor.normalize();
  return true;
};

const setupEditor = () => {
  if (!$("#editor")) return;
  const editor = $("#editor");
  ["keyup", "mouseup", "touchend", "input"].forEach((eventName) => {
    editor.addEventListener(eventName, saveEditorSelection);
  });
  $(".editor-toolbar")?.addEventListener("pointerdown", saveEditorSelection);
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === editor) saveEditorSelection();
  });
  $$("[data-command]").forEach((button) => button.addEventListener("click", () => command(button.dataset.command)));
  $("#fontSizeSelect")?.addEventListener("change", (event) => {
    if (event.target.value) command("fontSize", event.target.value);
    event.target.value = "";
  });
  $("#blockFormatSelect")?.addEventListener("change", (event) => {
    if (event.target.value) command("formatBlock", event.target.value);
    event.target.value = "";
  });
  $("#alignSelect")?.addEventListener("change", (event) => {
    if (event.target.value) applyEditorAlignment(event.target.value);
    event.target.value = "";
  });
  $("#findReplaceButton")?.addEventListener("click", () => runEditorFindReplace());
  $("#linkButton")?.addEventListener("click", async () => {
    const savedRange = editorSavedRange?.cloneRange();
    const url = await showPromptDialog("输入需要插入的链接地址。", {
      title: "插入链接",
      eyebrow: "编辑工具",
      inputLabel: "链接地址",
      placeholder: "https://example.com",
      confirmLabel: "插入链接",
      normalize: (value) => value.trim(),
    });
    if (!url) return;
    if (!insertEditorLink(url, savedRange)) showToast("链接地址格式不正确");
  });
  $("#imageButton")?.addEventListener("click", async () => {
    const url = await showPromptDialog("输入图片链接后会直接插入到正文中。", {
      title: "插入图片",
      eyebrow: "编辑工具",
      inputLabel: "图片链接",
      placeholder: "https://example.com/image.png",
      confirmLabel: "插入图片",
      normalize: (value) => value.trim(),
    });
    if (url) insertHtmlBlock(`<p><img src="${escapeHtml(url)}" alt="" class="inline-image" /></p>`);
  });
  $("#tableButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeToolbarMore();
    closeColorTool();
    openTablePicker(event.currentTarget);
  });
  $("#spoilerButton")?.addEventListener("click", () => insertHtmlBlock(`<span class="spoiler-inline">隐藏内容</span>`));
  $("#hrButton")?.addEventListener("click", () => insertHtmlBlock(`<hr class="inline-rule" />`));
  $("#detailsButton")?.addEventListener("click", () => insertHtmlBlock(`<details class="inline-details"><summary>点击展开</summary><p>折叠内容</p></details><p><br></p>`));
  $("#codeButton")?.addEventListener("click", () => insertHtmlBlock(`<pre class="inline-code"><code>// code</code></pre><p><br></p>`));
  $("#quoteButton")?.addEventListener("click", () => insertHtmlBlock(`<blockquote class="inline-quote">引用内容</blockquote><p><br></p>`));
  enhanceColorTool();
  $("#bilibiliButton")?.addEventListener("click", async () => {
    const input = await showPromptDialog("粘贴 Bilibili 链接、BV 号或 av 号。", {
      title: "插入 Bilibili 视频",
      eyebrow: "编辑工具",
      inputLabel: "视频地址或编号",
      placeholder: "BV1xx... 或 https://www.bilibili.com/...",
      confirmLabel: "插入视频",
      normalize: (value) => value.trim(),
    });
    const bv = input?.match(/BV[a-zA-Z0-9]{8,12}/)?.[0];
    const av = input?.match(/(?:av|aid=)(\d+)/i)?.[1];
    const src = bv ? `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bv)}` : av ? `https://player.bilibili.com/player.html?aid=${encodeURIComponent(av)}` : null;
    if (!src) return showToast("没有识别到有效的 Bilibili 视频 ID");
    insertHtmlBlock(`<p><iframe src="${src}" allowfullscreen loading="lazy"></iframe></p><p><br></p>`);
  });
  $("#moreButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = $("#moreButton");
    const menu = $("#moreMenu");
    if (!button || !menu) return;
    const isOpen = button.getAttribute("aria-expanded") === "true";
    if (isOpen) {
      closeToolbarMore();
      closeColorTool();
      closeTablePicker();
      return;
    }
    closeColorTool();
    closeTablePicker();
    button.setAttribute("aria-expanded", String(!isOpen));
    menu.hidden = isOpen;
    button.closest(".toolbar-more")?.classList.toggle("is-open", !isOpen);
    window.requestAnimationFrame(() => updateToolbarMorePosition());
  });
  $("#moreMenu")?.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", () => {
    closeToolbarMore();
    closeColorTool();
  });
  window.addEventListener("resize", () => {
    closeToolbarMore();
    closeColorTool();
  });
  window.addEventListener("scroll", updateToolbarMorePosition, { passive: true });
  window.addEventListener("scroll", updateColorToolPosition, { passive: true });
  $$(".toolbar-preview-button").forEach((button) => button.addEventListener("click", () => {
    const editor = $("#editor");
    const previewContent = $("#previewContent");
    if (!editor || !previewContent) return;
    const title = $("#forumTitle")?.value.trim() || $("#title")?.value.trim() || "预览";
    previewContent.innerHTML = `
      <h1>${escapeHtml(title)}</h1>
      <div class="reader-body">${editor.innerHTML.trim() || "<p>暂无内容</p>"}</div>
    `;
    const serverStatusBinder = globalThis.bindServerStatusCardActions;
    if (typeof serverStatusBinder === "function") serverStatusBinder(previewContent);
    openPreviewDialog();
  }));
};

const renderForumProfileCard = () => {
  const card = $("#profileCard");
  if (!card) return;
  if (!state.me) {
    card.classList.remove("is-logged-in");
    card.innerHTML = `
      <h2>玩家资料</h2>
      <div class="skin-stage"><img src="/assets/unbound-skin.png" alt="" loading="lazy" /></div>
      <a class="button primary" href="/login.html">登录</a>
    `;
    return;
  }
  card.classList.add("is-logged-in");
  card.innerHTML = `
    <h2>玩家资料</h2>
    <a class="profile-card-link" href="${profileHref(state.me.username)}">
      <div class="skin-stage"><img src="${activeSkinSrc(state.me, 210)}" alt="" loading="lazy" /></div>
      <div class="profile-name ${state.me.last_seen_at ? "online" : ""}">
        <strong>${escapeHtml(state.me.username)}</strong>
        <span>${escapeHtml(state.me.account_type || "管理员")}</span>
      </div>
    </a>
    <div class="profile-actions">
      <a class="button ghost" href="${profileHref(state.me.username)}">查看资料页</a>
      ${isAdmin() ? `<a class="button primary" href="/admin.html">后台管理</a>` : ""}
    </div>
  `;
};

const renderProfilePage = () => {
  closeSearchTips();
  const panel = $("#profilePanel");
  const posts = $("#profilePosts");
  if (!panel || !posts) return;
  const profile = state.profile;
  if (!profile) {
    panel.innerHTML = `<div class="empty">没有找到这个玩家。</div>`;
    posts.innerHTML = "";
    return;
  }
  const trashPosts = profile.trashPosts || [];
  const reportHistory = profile.reportHistory || [];
  const unreadReportCount = unreadReportHistoryCount(reportHistory);
  const inviteCode = String(profile.inviteCode || "");
  const invitePanel = profile.isSelf
    ? `
      <section class="profile-invite">
        <div class="profile-invite-head">
          <h3>邀请码</h3>
          <button class="button small ghost" type="button" id="copyInviteCodeButton" data-invite-code="${escapeHtml(inviteCode)}" ${inviteCode ? "" : "disabled"}>复制</button>
        </div>
        <code>${escapeHtml(inviteCode || "暂无邀请码")}</code>
        <p>新玩家注册时填写此码。每个邀请码只能使用一次，被使用后会自动换成新的。</p>
      </section>`
    : "";
  const reportPanel =
    !profile.isSelf && state.me && !profile.isOwner
      ? `<div class="profile-actions"><button class="button danger" type="button" data-report-player="${escapeHtml(profile.username)}">举报</button></div>`
      : "";
  panel.innerHTML = `
    <div class="profile-page-card">
      <div class="skin-stage large"><img src="${activeSkinSrc(profile, 210)}" alt="" loading="lazy" /></div>
      <div class="profile-name ${profile.online ? "online" : ""}">
        <strong>${escapeHtml(profile.username)}</strong>
        <span>${escapeHtml(profile.accountType)} ${formatDate(profile.created_at)}</span>
      </div>
      <div class="profile-summary">
        <div><strong>${profile.postCount}</strong><span>最近帖子</span></div>
        <div><strong>${escapeHtml(profile.accountType)}</strong><span>账号类型</span></div>
      </div>
      ${reportPanel}
      ${profileSettingsTemplate(profile)}
      ${invitePanel}
      ${
        profile.isSelf
          ? `<div class="profile-actions profile-floating-actions">
              <button class="button danger" type="button" id="profileReportHistoryButton">我的举报 <span class="profile-trash-count" ${unreadReportCount ? "" : "hidden"}>${unreadReportCount}</span></button>
              <button class="button danger" type="button" id="profileTrashButton">回收站 <span class="profile-trash-count" ${trashPosts.length ? "" : "hidden"}>${trashPosts.length}</span></button>
            </div>`
          : ""
      }
      ${totpPanelTemplate(profile)}
    </div>
  `;
  const trashSection = profile.isSelf
    ? `
      <section class="profile-trash-overlay profile-floating-overlay" id="profileTrashOverlay" hidden>
        <div class="profile-trash-backdrop" data-profile-trash-close></div>
        <div class="profile-trash-popover" role="dialog" aria-modal="true" aria-labelledby="profileTrashTitle">
          <button class="dialog-close-button" type="button" data-profile-trash-close aria-label="关闭回收站">×</button>
          <div class="section-title compact">
            <h2 id="profileTrashTitle">回收站</h2>
            <p>这里是你已删除的帖子，7 天后会自动彻底删除。</p>
          </div>
          <div class="admin-table profile-trash-table">
            ${
              trashPosts.length
                ? trashPosts
                    .map(
                      (item) => `
                        <div class="table-row">
                          <div><strong>${escapeHtml(item.title)}</strong><span>帖子 ${formatDate(item.deleted_at || item.created_at)}</span></div>
                          <div class="row-actions">
                            <button class="button small ghost" type="button" data-profile-edit-trash-post="${item.id}">编辑</button>
                            <button class="button small ghost" type="button" data-profile-restore-post="${item.id}">恢复</button>
                            <button class="button small danger" type="button" data-profile-purge-post="${item.id}">彻底删除</button>
                          </div>
                        </div>`,
                    )
                    .join("")
                : `<div class="empty">回收站为空。</div>`
            }
          </div>
        </div>
      </section>`
    : "";
  const reportHistoryOverlay = profile.isSelf
    ? `<section class="profile-trash-overlay profile-report-overlay profile-floating-overlay" id="profileReportHistoryOverlay" hidden>
        <div class="profile-trash-backdrop" data-profile-report-close></div>
        <div class="profile-trash-popover profile-report-popover" role="dialog" aria-modal="true" aria-labelledby="profileReportHistoryTitle">
          <button class="dialog-close-button" type="button" data-profile-report-close aria-label="关闭我的举报">×</button>
          <div class="section-title compact">
            <h2 id="profileReportHistoryTitle">我的举报</h2>
            <p>${reportHistory.length ? `共 ${reportHistory.length} 条记录，${unreadReportCount ? `${unreadReportCount} 条未读更新。` : "全部已读。"}` : "查看你提交过的举报处理情况。"}</p>
          </div>
          ${
            reportHistory.length
              ? `<div class="profile-report-actions">
                  <span class="profile-report-count ${unreadReportCount ? "has-unread" : ""}">${unreadReportCount ? `${unreadReportCount} 条未读` : "全部已读"}</span>
                  <button class="button small ${unreadReportCount ? "primary" : "ghost"}" type="button" id="profileMarkAllReportsReadButton" ${unreadReportCount ? "" : "disabled"}>${unreadReportCount ? "标记全部已读" : "全部已读"}</button>
                </div>`
              : ""
          }
          <div class="admin-table profile-report-table">
            ${
              reportHistory.length
                ? reportHistory
                    .map((report) => {
                      const kind = report.kind === "player" ? "玩家" : report.kind === "comment" ? "回复" : "帖子";
                      const punishment = report.punishment_type ? ` · ${punishmentLabels[report.punishment_type] || "处罚"} 至 ${report.punishment_expires_at || "到期"}` : "";
                      const isRead = reportHistoryIsRead(report);
                      const statusText = report.status === "resolved" ? "已处理" : "待处理";
                      return `<div class="table-row report-row ${isRead ? "is-read" : "is-unread"}">
                        <div>
                          <div class="profile-report-meta">
                            <span>${kind}</span>
                            <span class="profile-report-status ${report.status === "resolved" ? "is-resolved" : "is-open"}">${statusText}</span>
                            <span>${formatDate(report.created_at)}</span>
                            <span class="profile-report-read-state ${isRead ? "is-read" : "is-unread"}">${isRead ? "已读" : "未读"}</span>
                          </div>
                          <strong>${escapeHtml(report.target_title || "被举报内容")}</strong>
                          ${report.reason ? `<p class="report-reason"><span>举报原因</span>${escapeHtml(report.reason)}</p>` : ""}
                          ${report.resolution_reason ? `<p class="report-reason profile-report-resolution"><span>处理说明</span>${escapeHtml(report.resolution_reason)}${escapeHtml(punishment)}</p>` : punishment ? `<p class="report-reason profile-report-resolution"><span>处理结果</span>${escapeHtml(punishment.replace(/^ · /, ""))}</p>` : ""}
                        </div>
                        <div class="row-actions">
                          <button class="button small ${isRead ? "ghost" : "primary"}" type="button" data-mark-report-read="${report.id}" data-mark-report-read-kind="${report.kind}" ${isRead ? "disabled" : ""} aria-label="${isRead ? "举报已读" : `标记${kind}举报为已读`}">${isRead ? "已读" : "标记已读"}</button>
                        </div>
                      </div>`;
                    })
                    .join("")
                : `<div class="empty">还没有提交过举报。</div>`
            }
          </div>
        </div>
      </section>`
    : "";
  const profilePosts = profile.posts || [];
  const postView = profilePostListView(profilePosts, profile.username);
  const postListHtml = profilePosts.length
    ? postView.pageItems.length
      ? postView.pageItems.map((item) => cardTemplate({ ...item, author: profile.username }, "post")).join("")
      : `<div class="empty">没有匹配的帖子。</div>`
    : `<div class="empty">这个玩家暂时还没有发布。</div>`;
  posts.innerHTML = `
    ${
      profilePosts.length
        ? renderProfilePostSearch(postView, profilePosts.length)
        : `<div class="section-title compact"><h2>${escapeHtml(profile.username)} 的帖子</h2><p>展示最近 20 篇玩家内容。</p></div>`
    }
    <div class="list forum-list">${postListHtml}</div>
    ${profilePosts.length ? renderProfilePostPagination(postView) : ""}
    ${reportHistoryOverlay}
    ${trashSection}
  `;
  bindTotpSecurity();
  bindProfileSettings();
  bindProfileInviteCopy();
  bindContentButtons();
  bindProfilePostSearch();
  bindProfileReportButtons();
  bindProfileTrashButtons();
  bindProfileTrashToggle();
  bindProfileReportsToggle();
};

let profilePageRenderFrame = 0;
let pendingProfileSearchCursor = null;
const queueRenderProfilePage = (searchCursor = null) => {
  pendingProfileSearchCursor = searchCursor;
  window.cancelAnimationFrame(profilePageRenderFrame);
  profilePageRenderFrame = window.requestAnimationFrame(() => {
    profilePageRenderFrame = 0;
    renderProfilePage();
    if (pendingProfileSearchCursor !== null) {
      const input = $("#profilePostSearchInput");
      input?.focus({ preventScroll: true });
      input?.setSelectionRange?.(pendingProfileSearchCursor, pendingProfileSearchCursor);
      pendingProfileSearchCursor = null;
    }
  });
};

const bindProfileInviteCopy = () => {
  $("#copyInviteCodeButton")?.addEventListener("click", async (event) => {
    const inviteCode = event.currentTarget.dataset.inviteCode;
    if (!inviteCode) return;
    await navigator.clipboard?.writeText(inviteCode).catch(() => {});
    showToast("邀请码已复制");
  });
};

const ensureTrashPostEditDialog = () => {
  let dialog = $("#trashPostEditDialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "trashPostEditDialog";
  dialog.className = "site-modal-dialog trash-post-edit-dialog";
  dialog.innerHTML = `
    <div class="site-modal-shell">
      <div class="site-modal-copy">
        <span class="site-modal-eyebrow">回收站</span>
        <h2>编辑帖子</h2>
        <p>保存后帖子仍留在回收站，恢复后才会重新公开。</p>
      </div>
      <label class="site-modal-field">
        <span>标题</span>
        <input id="trashPostEditTitle" maxlength="80" />
      </label>
      <div class="rich-editor trash-post-edit-body" id="trashPostEditBody" contenteditable="true" role="textbox" aria-label="帖子正文"></div>
      <div class="site-modal-actions">
        <button class="site-modal-option" type="button" data-trash-edit-cancel>取消</button>
        <button class="site-modal-option is-primary" type="button" data-trash-edit-save>保存</button>
      </div>
    </div>
  `;
  document.body.append(dialog);
  dialog.querySelector("[data-trash-edit-cancel]")?.addEventListener("click", () => closeDialogAnimated(dialog));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialogAnimated(dialog);
  });
  dialog.querySelector("[data-trash-edit-save]")?.addEventListener("click", async () => {
    const id = Number(dialog.dataset.postId);
    const title = dialog.querySelector("#trashPostEditTitle")?.value.trim() || "";
    const contentHtml = dialog.querySelector("#trashPostEditBody")?.innerHTML.trim() || "";
    if (!title || !textFromHtml(contentHtml)) {
      showToast("标题和正文都要填写");
      return;
    }
    await api(`/posts/${id}`, { method: "PUT", body: JSON.stringify({ title, contentHtml }) });
    if (state.profile) {
      state.profile.trashPosts = (state.profile.trashPosts || []).map((item) =>
        item.id === id ? { ...item, title, content_html: contentHtml, excerpt: textFromHtml(contentHtml).slice(0, 140) } : item,
      );
    }
    closeDialogAnimated(dialog);
    renderProfilePage();
    showToast("回收站帖子已保存");
  });
  return dialog;
};

const bindProfileTrashButtons = () => {
  $$("[data-profile-edit-trash-post]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.profileEditTrashPost);
      const post = state.profile?.trashPosts?.find((item) => item.id === id);
      if (!post) return;
      const dialog = ensureTrashPostEditDialog();
      dialog.dataset.postId = String(id);
      dialog.querySelector("#trashPostEditTitle").value = post.title || "";
      dialog.querySelector("#trashPostEditBody").innerHTML = post.content_html || "";
      openDialog(dialog);
    });
  });
  $$("[data-profile-restore-post]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.profileRestorePost);
      const restoredPost = state.profile?.trashPosts?.find((item) => item.id === id);
      await api(`/posts/${id}/restore`, { method: "POST" });
      if (state.profile) {
        state.profile.trashPosts = (state.profile.trashPosts || []).filter((item) => item.id !== id);
        if (restoredPost) {
          const restored = { ...restoredPost, deleted_at: null };
          state.profile.posts = [restored, ...(state.profile.posts || [])].slice(0, 20);
          state.posts = state.profile.posts;
        }
      }
      renderProfilePage();
      showToast("帖子已恢复");
    });
  });
  $$("[data-profile-purge-post]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = await showConfirmDialog("彻底删除后无法恢复。确定继续吗？", {
        title: "彻底删除帖子",
        eyebrow: "回收站",
        confirmLabel: "彻底删除",
        confirmTone: "danger",
      });
      if (!confirmed) return;
      const id = Number(button.dataset.profilePurgePost);
      await api(`/posts/${id}/purge`, { method: "DELETE" });
      if (state.profile) state.profile.trashPosts = (state.profile.trashPosts || []).filter((item) => item.id !== id);
      renderProfilePage();
      showToast("帖子已彻底删除");
    });
  });
};

const setupForumPost = () => {
  const searchToggle = $("#forumSearchToggle");
  const searchPanel = $("#forumSearchPanel");
  const searchActions = $(".forum-toolbar-actions");
  const searchInput = $("#forumSearchInput");
  const searchClear = $("#forumSearchClear");
  const searchTip = $(".forum-search-tip");
  setupSearchTip(searchTip, "forumSearchTipBubble");

  const syncSearch = (open = state.forumSearchOpen) => {
    state.forumSearchOpen = open;
    if (searchPanel) {
      searchPanel.hidden = false;
      searchPanel.classList.toggle("is-open", open);
      searchPanel.setAttribute("aria-hidden", String(!open));
    }
    searchActions?.classList.toggle("is-search-open", open);
    if (searchToggle) searchToggle.setAttribute("aria-expanded", String(open));
    if (open) {
      window.setTimeout(() => searchInput?.focus(), prefersReducedMotion() ? 0 : 40);
    } else {
      searchInput?.blur();
    }
  };

  searchToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    syncSearch(!state.forumSearchOpen);
  });
  searchPanel?.addEventListener("click", (event) => event.stopPropagation());
  searchInput?.addEventListener("input", (event) => {
    state.forumSearch = event.target.value;
    queueRenderLists();
  });
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      state.forumSearch = "";
      searchInput.value = "";
      renderLists();
      syncSearch(false);
    }
  });
  searchClear?.addEventListener("click", () => {
    state.forumSearch = "";
    if (searchInput) searchInput.value = "";
    renderLists();
    syncSearch(false);
  });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target && searchTip?.contains(target)) return;
    closeSearchTips();
    if (!state.forumSearchOpen || (target && (searchPanel?.contains(target) || searchToggle?.contains(target)))) return;
    syncSearch(false);
  });
  syncSearch(false);

  $("#openPostComposer")?.addEventListener("click", () => {
    if (!state.me) {
      window.location.href = "/login.html";
      return;
    }
    state.editingPostId = null;
    $("#forumPostForm")?.reset();
    if ($("#editor")) $("#editor").innerHTML = "";
    if ($("#forumPostSubmit")) $("#forumPostSubmit").textContent = "发布帖子";
    openPostDialog();
  });
  $("#forumPostForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.me) {
      window.location.href = "/login.html";
      return;
    }
    const title = $("#forumTitle").value.trim();
    const contentHtml = $("#editor").innerHTML.trim();
    const endpoint = state.editingPostId ? `/posts/${state.editingPostId}` : "/posts";
    await api(endpoint, { method: state.editingPostId ? "PUT" : "POST", body: JSON.stringify({ title, contentHtml }) });
    state.editingPostId = null;
    closePostDialog();
    await loadPublicData();
    showToast("帖子已保存");
  });
};

const resetEditor = () => {
  $("#editingId").value = "";
  $("#publishForm")?.reset();
  if ($("#editor")) $("#editor").innerHTML = "";
  $("#contentType")?.removeAttribute("disabled");
};

const setupPublish = () => {
  $("#publishForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const type = $("#contentType").value;
    const id = $("#editingId").value;
    const title = $("#title").value.trim();
    const contentHtml = $("#editor").innerHTML.trim();
    const endpoint = type === "announcement" ? "/announcements" : "/posts";
    await api(id ? `${endpoint}/${id}` : endpoint, { method: id ? "PUT" : "POST", body: JSON.stringify({ title, contentHtml }) });
    resetEditor();
    await loadAdminData();
    showToast(id ? "内容已更新" : "内容已发布");
  });
  $("#cancelEditButton")?.addEventListener("click", resetEditor);
};

const renderAdminGate = () => {
  const shell = $("#adminShell");
  const locked = $("#adminLocked");
  if (!shell || !locked) return;
  shell.hidden = !isAdmin();
  locked.hidden = isAdmin();
  window.requestAnimationFrame(syncAdminSidebarFollow);
};

const clearAdminSidebarFollow = () => {
  const sidebar = document.querySelector(".admin-sidebar:not(.admin-sidebar-drawer)");
  if (!sidebar) return;
  sidebar.style.removeProperty("position");
  sidebar.style.removeProperty("top");
  sidebar.style.removeProperty("left");
  sidebar.style.removeProperty("width");
  sidebar.style.removeProperty("z-index");
};

const syncAdminSidebarFollow = () => {
  if (page !== "admin") return;
  clearAdminSidebarFollow();
};

const setupAdminSidebarFollow = () => {
  if (page !== "admin") return;
  window.addEventListener("scroll", syncAdminSidebarFollow, { passive: true });
  window.addEventListener("resize", syncAdminSidebarFollow);
  window.requestAnimationFrame(syncAdminSidebarFollow);
};

const statCard = (label, value) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`;

const renderStats = () => {
  if (!$("#statsGrid") || !state.stats) return;
  $("#statsGrid").innerHTML = [
    statCard("总浏览", state.stats.totalViews),
    statCard("公告浏览", state.stats.announcementViews),
    statCard("论坛浏览", state.stats.postViews),
    statCard("注册用户", state.stats.userCount),
    statCard("管理员账号", state.stats.adminCount),
    statCard("待处理举报", state.stats.reportCount),
  ].join("");
  const dock = $("#trashDock");
  if (dock) {
    dock.hidden = !(state.stats.trashCount > 0);
    const badge = dock.querySelector(".trash-count-badge");
    if (badge) {
      badge.textContent = String(state.stats.trashCount || 0);
      badge.hidden = !(state.stats.trashCount > 0);
    }
  }
  if ($("#maintenanceToggle")) $("#maintenanceToggle").checked = Boolean(state.stats.maintenanceMode);
  if ($("#maintenanceStatusText")) $("#maintenanceStatusText").textContent = state.stats.maintenanceMode ? "当前维护模式已开启。" : "当前网站正常开放。";
};

const ensureHighlightColorDialog = () => {
  let dialog = $("#highlightColorDialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "highlightColorDialog";
  dialog.className = "site-modal-dialog highlight-color-dialog";
  dialog.innerHTML = `
    <div class="site-modal-shell">
      <div class="site-modal-copy">
        <span class="site-modal-eyebrow">帖子高亮</span>
        <h2>设置边框颜色</h2>
        <p>高亮只显示边框，不再填充背景。</p>
      </div>
      <div class="highlight-color-swatches" aria-label="高亮颜色预设">
        ${highlightColorPresets
          .map((color) => `<button type="button" data-highlight-color-preset="${color}" style="--swatch-color: ${color}" aria-label="使用颜色 ${color}"></button>`)
          .join("")}
      </div>
      <label class="site-modal-field">
        <span>自定义颜色</span>
        <input id="highlightColorInput" type="color" value="#5fa86f" />
      </label>
      <div class="site-modal-actions">
        <button class="site-modal-option" type="button" data-highlight-color-cancel>取消</button>
        <button class="site-modal-option is-primary" type="button" data-highlight-color-save>保存高亮</button>
      </div>
    </div>
  `;
  document.body.append(dialog);
  dialog.querySelector("[data-highlight-color-cancel]")?.addEventListener("click", () => closeDialogAnimated(dialog));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialogAnimated(dialog);
  });
  dialog.querySelectorAll("[data-highlight-color-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = dialog.querySelector("#highlightColorInput");
      if (input) input.value = normalizeHexColor(button.dataset.highlightColorPreset, "#5fa86f");
    });
  });
  dialog.querySelector("[data-highlight-color-save]")?.addEventListener("click", async () => {
    const id = dialog.dataset.postId;
    const color = normalizeHexColor(dialog.querySelector("#highlightColorInput")?.value, "#5fa86f");
    await api(`/posts/${id}/highlight`, {
      method: "PUT",
      body: JSON.stringify({ highlighted: true, highlightColor: color }),
    });
    closeDialogAnimated(dialog);
    await loadAdminData();
    showToast("帖子高亮颜色已保存");
  });
  return dialog;
};

const openHighlightColorDialog = (post) => {
  const dialog = ensureHighlightColorDialog();
  dialog.dataset.postId = String(post.id);
  const input = dialog.querySelector("#highlightColorInput");
  if (input) input.value = postHighlightColor(post);
  openDialog(dialog);
};

const adminRows = (items, type) => {
  const key = type === "post" ? "posts" : "announcements";
  const view = adminListView(key, items, (item, query) => adminSearchMatches(query, adminContentSearchText(item), item.author));
  const rows = view.pageItems.length
    ? view.pageItems
        .map(
          (item) => {
            const canManage = canManageContentItem(item, item.author);
            return `
            <div class="table-row ${type === "post" && item.pinned ? "is-pinned-row" : ""} ${type === "post" && item.highlighted ? "is-highlighted-row" : ""}"${type === "post" ? postHighlightStyle(item) : ""}>
              <div><strong>${type === "post" && item.pinned ? "置顶 · " : ""}${type === "post" && item.highlighted ? "高亮 · " : ""}${escapeHtml(item.title)}</strong><span>${escapeHtml(item.author || "管理员")} ${formatDate(item.created_at)} ${item.views || 0} 次浏览</span></div>
              <div class="row-actions">
                ${
                  type === "post"
                    ? `<button class="button small ghost" type="button" data-pin-post="${canManage ? item.id : ""}" data-pinned="${item.pinned ? "1" : "0"}" ${canManage ? "" : "disabled"}>${item.pinned ? "取消置顶" : "置顶"}</button>`
                    : ""
                }
                ${
                  type === "post"
                    ? `<button class="button small ghost" type="button" data-highlight-post="${canManage ? item.id : ""}" data-highlighted="${item.highlighted ? "1" : "0"}" data-highlight-color="${postHighlightColor(item)}" ${canManage ? "" : "disabled"}>${item.highlighted ? "高亮颜色" : "高亮"}</button>`
                    : ""
                }
                ${
                  type === "post" && item.highlighted
                    ? `<button class="button small ghost" type="button" data-unhighlight-post="${canManage ? item.id : ""}" ${canManage ? "" : "disabled"}>取消高亮</button>`
                    : ""
                }
                <button class="button small ghost" type="button" ${canManage ? `data-edit="${type}" data-id="${item.id}"` : "disabled"}>编辑</button>
                <button class="button small danger" type="button" ${canManage ? `data-delete="${type}" data-id="${item.id}"` : "disabled"}>${type === "post" ? "撤回" : "删除"}</button>
              </div>
            </div>`;
          },
        )
        .join("")
    : `<div class="empty">${view.total ? "没有匹配内容。" : "暂无内容。"}</div>`;
  return `${adminListToolsHtml(key, view, "搜索标题、内容、发布者，#发布者")}${rows}${adminPaginationHtml(key, view)}`;
};

const renderManagement = () => {
  if ($("#manageAnnouncements")) $("#manageAnnouncements").innerHTML = adminRows(state.announcements, "announcement");
  if ($("#managePosts")) $("#managePosts").innerHTML = adminRows(state.posts, "post");
  bindAdminListControls("announcements", renderManagement);
  bindAdminListControls("posts", renderManagement);
  $$("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.edit;
      const source = type === "announcement" ? state.announcements : state.posts;
      const item = source.find((entry) => entry.id === Number(button.dataset.id));
      if (!item) return;
      $("#editingId").value = item.id;
      $("#contentType").value = type === "announcement" ? "announcement" : "post";
      $("#contentType").setAttribute("disabled", "disabled");
      $("#title").value = item.title;
      $("#editor").innerHTML = item.content_html;
      $("#publishForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  $$("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const type = button.dataset.delete;
      const isPost = type === "post";
      const confirmed = await showConfirmDialog(isPost ? "撤回后会进入作者的回收站。确定继续吗？" : "删除后会进入回收站。确定继续吗？", {
        title: isPost ? "撤回帖子" : "删除内容",
        eyebrow: "内容管理",
        confirmLabel: isPost ? "撤回" : "移入回收站",
        confirmTone: "danger",
      });
      if (!confirmed) return;
      await api(`/${type === "announcement" ? "announcements" : "posts"}/${button.dataset.id}`, { method: "DELETE" });
      state.trashLoaded = false;
      await loadAdminData();
      if (window.location.hash === "#adminTrash") await renderTrash({ force: true });
      showToast("内容已移入回收站");
    });
  });
  $$("[data-pin-post]").forEach((button) => {
    button.addEventListener("click", async () => {
      const pinned = button.dataset.pinned !== "1";
      await api(`/posts/${button.dataset.pinPost}/pin`, {
        method: "PUT",
        body: JSON.stringify({ pinned }),
      });
      await loadAdminData();
      showToast(pinned ? "帖子已置顶" : "已取消置顶");
    });
  });
  $$("[data-highlight-post]").forEach((button) => {
    button.addEventListener("click", () => {
      const post = state.posts.find((item) => Number(item.id) === Number(button.dataset.highlightPost));
      if (!post) return;
      openHighlightColorDialog(post);
    });
  });
  $$("[data-unhighlight-post]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/posts/${button.dataset.unhighlightPost}/highlight`, {
        method: "PUT",
        body: JSON.stringify({ highlighted: false }),
      });
      await loadAdminData();
      showToast("已取消高亮");
    });
  });
};

const renderTrashRows = () => {
  const panel = $("#adminTrash");
  if (!panel) return;
  const rows = [
    ...(state.trash.announcements || []).map((item) => ({ ...item, type: "announcement" })),
    ...(state.trash.posts || []).map((item) => ({ ...item, type: "post" })),
  ];
  const view = adminListView("trash", rows, (item, query) =>
    adminSearchMatches(
      query,
      `${item.title || ""} ${item.type === "announcement" ? "公告" : "帖子"} ${item.author || ""} ${formatDate(item.deleted_at)} ${textFromHtml(item.content_html)}`,
      item.author,
    ),
  );
  const renderedRows = view.pageItems.length
    ? view.pageItems
        .map(
          (item) => {
            const canManage = canManageContentItem(item, item.author);
            return `
            <div class="table-row">
              <div><strong>${escapeHtml(item.title)}</strong><span>${item.type === "announcement" ? "公告" : "帖子"} ${formatDate(item.deleted_at)}</span></div>
              <div class="row-actions">
                <button class="button small ghost" type="button" ${canManage ? `data-restore="${item.type}" data-id="${item.id}"` : "disabled"}>恢复</button>
                <button class="button small danger" type="button" ${canManage ? `data-purge="${item.type}" data-id="${item.id}"` : "disabled"}>彻底删除</button>
              </div>
            </div>`;
          },
        )
        .join("")
    : `<div class="empty">${view.total ? "没有匹配内容。" : "回收站为空。"}</div>`;
  panel.querySelector(".admin-table").innerHTML = `${adminListToolsHtml("trash", view, "搜索标题、类型、发布者，#发布者")}${renderedRows}${adminPaginationHtml("trash", view)}`;
  bindAdminListControls("trash", renderTrashRows);
  $$("[data-restore]").forEach((button) =>
    button.addEventListener("click", async () => {
      await api(`/${button.dataset.restore === "announcement" ? "announcements" : "posts"}/${button.dataset.id}/restore`, { method: "POST" });
      const collection = button.dataset.restore === "announcement" ? "announcements" : "posts";
      state.trash[collection] = state.trash[collection].filter((item) => item.id !== Number(button.dataset.id));
      if (state.stats) state.stats.trashCount = Math.max(0, Number(state.stats.trashCount || 0) - 1);
      renderTrashRows();
      renderStats();
      showToast("内容已恢复");
    }),
  );
  $$("[data-purge]").forEach((button) =>
    button.addEventListener("click", async () => {
      await api(`/${button.dataset.purge === "announcement" ? "announcements" : "posts"}/${button.dataset.id}/purge`, { method: "DELETE" });
      const collection = button.dataset.purge === "announcement" ? "announcements" : "posts";
      state.trash[collection] = state.trash[collection].filter((item) => item.id !== Number(button.dataset.id));
      if (state.stats) state.stats.trashCount = Math.max(0, Number(state.stats.trashCount || 0) - 1);
      renderTrashRows();
      renderStats();
      showToast("内容已彻底删除");
    }),
  );
};

const renderTrash = async ({ force = false } = {}) => {
  const panel = $("#adminTrash");
  if (!panel) return;
  const table = panel.querySelector(".admin-table");
  if (!state.trashLoaded || force) {
    if (table) table.innerHTML = `<div class="empty">正在加载回收站...</div>`;
    state.trash = await api("/admin/trash");
    state.trashLoaded = true;
  }
  renderTrashRows();
};

const reportPostReaderItem = (report) => ({
  id: Number(report.post_id),
  title: report.post_title || "被举报内容",
  excerpt: report.post_excerpt || "",
  content_html: report.post_content_html || "<p>暂无可查看内容。</p>",
  pinned: Boolean(report.post_pinned),
  highlighted: Boolean(report.post_highlighted),
  highlight_color: report.post_highlight_color || "",
  views: Number(report.post_views || 0),
  created_at: report.post_created_at || report.created_at,
  updated_at: report.post_updated_at || report.created_at,
  author_id: report.kind === "comment" ? report.post_author_id || report.author_id || report.target_id : report.author_id || report.target_id,
  author: report.kind === "comment" ? report.post_author || report.author || "未知用户" : report.author || "未知用户",
  author_role: report.kind === "comment" ? report.post_author_role || report.target_role || "user" : report.target_role || "user",
  author_account_type: report.kind === "comment" ? report.post_author_account_type || report.author_account_type || "成员" : report.author_account_type || "成员",
  author_minecraft_name: report.kind === "comment" ? report.post_author_minecraft_name || report.author_minecraft_name || "" : report.author_minecraft_name || "",
  author_skin_image: report.kind === "comment" ? report.post_author_skin_image || report.author_skin_image || "" : report.author_skin_image || "",
});

const punishmentLabels = {
  none: "不处罚",
  account_ban: "临时封号",
  comment_ban: "禁止评论",
  post_ban: "禁止发表帖子",
  site_ban: "禁止访问网站",
};

const showReportResolutionDialog = (report) =>
  new Promise((resolve) => {
    let dialog = $("#reportResolutionDialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "reportResolutionDialog";
      dialog.className = "site-modal-dialog report-resolution-dialog";
      dialog.innerHTML = `
        <div class="site-modal-shell">
          <div class="site-modal-copy">
            <span class="site-modal-eyebrow">举报处理</span>
            <h2>处理举报</h2>
            <p id="reportResolutionTarget"></p>
          </div>
          <label class="site-modal-field">
            <span>处理说明</span>
            <input id="reportResolutionReason" maxlength="500" placeholder="例如：内容违规，已警告并限制发言" />
          </label>
          <div class="report-resolution-grid">
            <label class="site-modal-field">
              <span>处罚</span>
              <select id="reportPunishmentType">
                <option value="none">不处罚</option>
                <option value="account_ban">临时封号</option>
                <option value="comment_ban">禁止评论</option>
                <option value="post_ban">禁止发表帖子</option>
                <option value="site_ban">禁止访问网站</option>
              </select>
            </label>
            <label class="site-modal-field">
              <span>时长</span>
              <select id="reportPunishmentDuration">
                <option value="24">1 天</option>
                <option value="72">3 天</option>
                <option value="168">7 天</option>
                <option value="720">30 天</option>
              </select>
            </label>
          </div>
          <label class="site-modal-field">
            <span>处罚原因</span>
            <input id="reportPunishmentReason" maxlength="500" placeholder="留给处罚记录，可和处理说明不同" />
          </label>
          <div class="site-modal-actions">
            <button class="site-modal-option" type="button" data-report-resolution-cancel>取消</button>
            <button class="site-modal-option is-primary" type="button" data-report-resolution-confirm>标记已处理</button>
          </div>
        </div>
      `;
      document.body.append(dialog);
      dialog.querySelector("[data-report-resolution-cancel]")?.addEventListener("click", () => {
        dialog._resolver?.(null);
        dialog._resolver = null;
        closeDialogAnimated(dialog);
      });
      dialog.querySelector("[data-report-resolution-confirm]")?.addEventListener("click", () => {
        const punishmentType = dialog.querySelector("#reportPunishmentType")?.value || "none";
        const resolutionReason = dialog.querySelector("#reportResolutionReason")?.value.trim() || "";
        const punishmentReason = dialog.querySelector("#reportPunishmentReason")?.value.trim() || resolutionReason;
        dialog._resolver?.({
          resolutionReason,
          punishmentType,
          punishmentDurationHours: Number(dialog.querySelector("#reportPunishmentDuration")?.value || 24),
          punishmentReason,
        });
        dialog._resolver = null;
        closeDialogAnimated(dialog);
      });
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        dialog._resolver?.(null);
        dialog._resolver = null;
        closeDialogAnimated(dialog);
      });
    }
    dialog._resolver = resolve;
    dialog.querySelector("#reportResolutionTarget").textContent = `对象：${report.target_user || report.author || report.post_title || "被举报内容"}`;
    dialog.querySelector("#reportResolutionReason").value = "";
    dialog.querySelector("#reportPunishmentType").value = "none";
    dialog.querySelector("#reportPunishmentDuration").value = "24";
    dialog.querySelector("#reportPunishmentReason").value = "";
    openDialog(dialog);
  });

const renderReports = () => {
  const table = $("#adminReportsTable");
  if (!table) return;
  const view = adminListView("reports", state.reports, (report, query) =>
    adminSearchMatches(
      query,
      `举报 ${report.post_title || ""} ${report.target_user || ""} ${report.reporter || ""} ${report.author || ""} ${report.reason || ""} ${textFromHtml(report.comment_content_html)} ${formatDate(report.created_at)}`,
      report.reporter,
    ),
  );
  const rows = view.pageItems.length
    ? view.pageItems
        .map(
          (report) => {
            const isPlayerReport = report.kind === "player";
            const isCommentReport = report.kind === "comment";
            const title = isPlayerReport ? `举报 · ${report.target_user}` : isCommentReport ? `举报 · 回复 · ${report.post_title}` : `举报 · ${report.post_title}`;
            const target = isPlayerReport ? `被举报玩家 ${report.target_user}` : `作者 ${report.author}`;
            return `
            <div class="table-row report-row">
              <div>
                <strong>${escapeHtml(title)}</strong>
                <span>举报人 ${escapeHtml(report.reporter)} · ${escapeHtml(target)} · ${formatDate(report.created_at)}</span>
                ${isCommentReport ? `<p class="report-reason">${escapeHtml(textFromHtml(report.comment_content_html).slice(0, 120))}</p>` : ""}
                <p class="report-reason">${escapeHtml(report.reason)}</p>
              </div>
              <div class="row-actions">
                ${
                  isPlayerReport
                    ? `<a class="button small ghost" href="${profileHref(report.target_user)}">查看资料</a>`
                    : isCommentReport
                      ? `<button class="button small ghost" type="button" data-open-report-comment="${report.comment_id}" data-open-report-post="${report.post_id}">查看回复</button>`
                      : `<button class="button small ghost" type="button" data-open-report-post="${report.post_id}">查看帖子</button>`
                }
                <button class="button small primary" type="button" data-resolve-report="${report.id}" data-resolve-report-kind="${isPlayerReport ? "player" : isCommentReport ? "comment" : "post"}">标记已处理</button>
              </div>
            </div>`;
          },
        )
        .join("")
    : `<div class="empty">${view.total ? "没有匹配举报。" : "暂无待处理举报。"}</div>`;
  table.innerHTML = `${adminListToolsHtml("reports", view, "搜索举报、举报人、作者、原因")}${rows}${adminPaginationHtml("reports", view)}`;
  bindAdminListControls("reports", renderReports);
  $$("[data-open-report-post]").forEach((button) => {
    button.addEventListener("click", () => {
      const postId = Number(button.dataset.openReportPost);
      if (!state.posts.some((entry) => Number(entry.id) === postId)) {
        const report = state.reports.find((entry) => (entry.kind === "post" || entry.kind === "comment") && Number(entry.post_id) === postId);
        if (report) state.posts = [reportPostReaderItem(report), ...state.posts.filter((entry) => Number(entry.id) !== postId)];
      }
      state.commentHighlightId = button.dataset.openReportComment ? Number(button.dataset.openReportComment) : null;
      openReader("post", postId);
    });
  });
  $$("[data-resolve-report]").forEach((button) => {
    button.addEventListener("click", async () => {
      const report = state.reports.find((entry) => entry.kind === button.dataset.resolveReportKind && entry.id === Number(button.dataset.resolveReport));
      const resolution = await showReportResolutionDialog(report || {});
      if (!resolution) return;
      const result = await api(`/admin/reports/${button.dataset.resolveReportKind}/${button.dataset.resolveReport}/resolve`, {
        method: "POST",
        body: JSON.stringify(resolution),
      });
      state.reports = state.reports.filter(
        (report) => !(report.kind === button.dataset.resolveReportKind && report.id === Number(button.dataset.resolveReport)),
      );
      if (state.stats) state.stats.reportCount = Math.max(0, Number(state.stats.reportCount || 0) - 1);
      renderReports();
      renderStats();
      showToast(result.punishment ? `举报已处理，已执行${punishmentLabels[result.punishment.type] || "处罚"}` : "举报已标记处理");
    });
  });
};

const renderAdmins = () => {
  if (!$("#adminUsers")) return;
  const normalUsers = state.admins.filter((user) => user.role !== "admin" && !user.account_deletion);
  const promoteSelect = $("#promoteUserSelect");
  if (promoteSelect) {
    promoteSelect.innerHTML = normalUsers.length
      ? normalUsers.map((user) => `<option value="${user.id}">${escapeHtml(user.username)} ${formatDate(user.created_at)}</option>`).join("")
      : `<option value="">暂无可提权注册用户</option>`;
    promoteSelect.disabled = !isOwner() || !normalUsers.length;
  }
  const promoteButton = $("#promoteUserButton");
  if (promoteButton) {
    promoteButton.disabled = !isOwner() || !normalUsers.length;
    promoteButton.textContent = isOwner() ? "设为管理员" : "仅服主可提权";
  }
  const view = adminListView("users", state.admins, (user, query) =>
    adminSearchMatches(
      query,
      `${user.username || ""} ${user.account_type || ""} ${user.role === "admin" ? "管理员" : "成员"} ${user.is_owner ? "服主" : ""} ${accountDeletionStatusText(user.account_deletion)} ${formatDate(user.created_at)} ${user.last_seen_at ? formatDate(user.last_seen_at) : ""}`,
      user.username,
    ),
  );
  const rows = view.pageItems.length
    ? view.pageItems
        .map((user) => {
          const deletionStatus = accountDeletionStatusText(user.account_deletion);
          return `
            <div class="table-row user-row">
              <div>
                <strong>${escapeHtml(user.username)}</strong>
                <span>${escapeHtml(user.account_type)} ${formatDate(user.created_at)}${user.last_seen_at ? ` · 最近在线 ${formatDate(user.last_seen_at)}` : ""}${deletionStatus ? ` · ${escapeHtml(deletionStatus)}` : ""}</span>
              </div>
              <div class="row-actions">
                ${
                  isOwner() && !user.is_owner
                    ? `
                      <button class="button small ghost" type="button" data-rename-user="${user.id}" data-name="${escapeHtml(user.username)}">改名</button>
                      <button class="button small ghost" type="button" data-role-user="${user.id}" data-role="${user.role}" data-name="${escapeHtml(user.username)}">${user.role === "admin" ? "降为成员" : "设为管理员"}</button>
                      <button class="button small ghost" type="button" data-reset-user-password="${user.id}" data-name="${escapeHtml(user.username)}">改密码</button>
                      ${
                        user.account_deletion?.status === "pending_approval"
                          ? `<button class="button small danger" type="button" data-approve-user-deletion="${user.id}" data-name="${escapeHtml(user.username)}">批准注销</button>`
                          : ""
                      }
                      <button class="button small danger" type="button" data-remove-user="${user.id}" data-name="${escapeHtml(user.username)}">删除账号</button>
                    `
                    : `<button class="button small ghost" type="button" disabled>${user.is_owner ? "服主账号" : "仅服主可操作"}</button>`
                }
              </div>
            </div>`;
        })
        .join("")
    : `<div class="empty">${view.total ? "没有匹配账号。" : "暂无注册用户。"}</div>`;
  $("#adminUsers").innerHTML = `${adminListToolsHtml("users", view, "搜索用户名、账号类型、角色")}${rows}${adminPaginationHtml("users", view)}`;
  bindAdminListControls("users", renderAdmins);
  if (promoteButton) promoteButton.onclick = async () => {
    const id = $("#promoteUserSelect")?.value;
    if (!id) return;
    await api(`/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ role: "admin" }) });
    await loadAdminData();
    showToast("用户已设为管理员");
  };
  $$("[data-rename-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const username = await showPromptDialog(`修改 ${button.dataset.name} 的用户名。`, {
        title: "修改用户名",
        eyebrow: "用户管理",
        inputLabel: "新用户名",
        defaultValue: button.dataset.name,
        maxLength: 20,
        confirmLabel: "保存用户名",
        normalize: (value) => value.trim(),
        validate: (value) => (/^[\w\u4e00-\u9fa5-]{3,20}$/.test(value) ? "" : "用户名需要 3 到 20 位"),
      });
      if (!username) return;
      await api(`/admin/users/${button.dataset.renameUser}`, { method: "PUT", body: JSON.stringify({ username }) });
      await loadAdminData();
      showToast("用户名已更新");
    });
  });
  $$("[data-role-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextRole = button.dataset.role === "admin" ? "user" : "admin";
      const confirmed = await showConfirmDialog(`确定将 ${button.dataset.name} ${nextRole === "admin" ? "设为管理员" : "降为成员"}吗？`, {
        title: "调整权限",
        eyebrow: "用户管理",
        confirmLabel: nextRole === "admin" ? "设为管理员" : "降为成员",
        confirmTone: nextRole === "admin" ? "primary" : "danger",
      });
      if (!confirmed) return;
      await api(`/admin/users/${button.dataset.roleUser}`, { method: "PUT", body: JSON.stringify({ role: nextRole }) });
      await loadAdminData();
      showToast(nextRole === "admin" ? "用户已设为管理员" : "用户已降为成员");
    });
  });
  $$("[data-approve-user-deletion]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = await showConfirmDialog(`批准 ${button.dataset.name} 的注销申请吗？批准后会进入 3 天冷静期，期间重新登录会取消注销。`, {
        title: "批准注销",
        eyebrow: "权限管理",
        confirmLabel: "批准注销",
        confirmTone: "danger",
      });
      if (!confirmed) return;
      await api(`/admin/users/${button.dataset.approveUserDeletion}/deletion/approve`, { method: "POST" });
      await loadAdminData();
      showToast("已批准注销，账号进入 3 天冷静期");
    });
  });
  $$("[data-remove-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = await showConfirmDialog(`确定删除 ${button.dataset.name} 的账号吗？这会立即注销账号并踢下线。`, {
        title: "删除账号",
        eyebrow: "用户管理",
        confirmLabel: "删除账号",
        confirmTone: "danger",
      });
      if (!confirmed) return;
      await api(`/admin/users/${button.dataset.removeUser}`, { method: "DELETE" });
      await loadAdminData();
      showToast("账号已删除");
    });
  });
  $$("[data-reset-user-password]").forEach((button) => {
    button.addEventListener("click", async () => {
      const password = await showPromptDialog(`为 ${button.dataset.name} 设置新密码（至少 6 位）。`, {
        title: "修改成员密码",
        eyebrow: "用户管理",
        inputLabel: "新密码",
        inputType: "password",
        autocomplete: "new-password",
        maxLength: 120,
        confirmLabel: "重置密码",
        normalize: (value) => value.trim(),
        validate: (value) => (value.length >= 6 ? "" : "密码至少需要 6 位"),
      });
      if (!password) return;
      await api(`/admin/users/${button.dataset.resetUserPassword}/password`, {
        method: "PUT",
        body: JSON.stringify({ password }),
      });
      showToast("成员密码已更新");
    });
  });
};

const setupAdminUsers = () => {
  $("#adminUserForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/admin/users", {
      method: "POST",
      body: JSON.stringify({ username: $("#adminUsername").value.trim(), password: $("#adminPassword").value }),
    });
    event.target.reset();
    await loadAdminData();
    showToast("已创建管理员账号");
  });
};

const setupMaintenanceToggle = () => {
  $("#maintenanceToggle")?.addEventListener("change", async (event) => {
    const requestId = ++maintenanceRequestId;
    const enabled = event.target.checked;
    const previous = Boolean(state.stats?.maintenanceMode);
    state.site.maintenanceMode = enabled;
    if (state.stats) state.stats.maintenanceMode = enabled;
    renderStats();
    renderMaintenanceBanner();
    try {
      const result = await api("/admin/settings/maintenance", { method: "PUT", body: JSON.stringify({ enabled }) });
      if (requestId !== maintenanceRequestId) return;
      state.site.maintenanceMode = result.maintenanceMode;
      if (state.stats) state.stats.maintenanceMode = result.maintenanceMode;
      renderStats();
      renderMaintenanceBanner();
      showToast(result.maintenanceMode ? "已开启维护模式" : "已关闭维护模式");
    } catch (error) {
      if (requestId !== maintenanceRequestId) return;
      state.site.maintenanceMode = previous;
      if (state.stats) state.stats.maintenanceMode = previous;
      renderStats();
      renderMaintenanceBanner();
      showToast(error.message);
    }
  });
};

const setupAdminNavigation = () => {
  const links = $$(".admin-nav a");
  const trashDock = $("#trashDock");
  if (!links.length && !trashDock) return;

  const setActive = (current) => {
    links.forEach((link) => {
      const active = link.getAttribute("href") === current;
      link.classList.toggle("active", active);
    });
  };
  const sync = () => {
    const current = window.location.hash || "#adminOverview";
    setActive(current);
    if (current === "#adminTrash") renderTrash().catch((error) => showToast(error.message));
  };
  links.forEach((link) =>
    link.addEventListener("click", () => {
      const target = link.getAttribute("href");
      if (target) setActive(target);
    }),
  );
  trashDock?.addEventListener("click", () => {
    window.location.hash = "#adminTrash";
    $("#adminTrash")?.scrollIntoView({ behavior: "smooth", block: "start" });
    renderTrash().catch((error) => showToast(error.message));
  });
  window.addEventListener("hashchange", sync);
  sync();
};

const setupAdminMobileDrawer = () => {
  const toggle = $("#adminSidebarToggle");
  const drawer = $("#adminSidebarDrawer");
  const backdrop = $("#adminSidebarBackdrop");
  if (!toggle || !drawer || !backdrop) return;

  const setOpen = (open) => {
    document.body.classList.toggle("admin-drawer-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    drawer.setAttribute("aria-hidden", String(!open));
    backdrop.hidden = false;
    if (!open) {
      window.setTimeout(() => {
        if (!document.body.classList.contains("admin-drawer-open")) {
          backdrop.hidden = true;
        }
      }, prefersReducedMotion() ? 0 : 240);
    }
  };

  toggle.addEventListener("click", () => setOpen(!document.body.classList.contains("admin-drawer-open")));
  backdrop.addEventListener("click", () => setOpen(false));
  $$(".admin-nav-drawer a").forEach((link) => link.addEventListener("click", () => setOpen(false)));
  window.addEventListener("resize", () => {
    if (window.innerWidth > 620) setOpen(false);
  });
};

const setupDialogDismiss = () => {
  $$("dialog").forEach((dialog) => {
    dialog.querySelectorAll("[data-dialog-close]").forEach((button) =>
      button.addEventListener("click", () => closeDialogAnimated(dialog)),
    );
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialogAnimated(dialog);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      closeDialogAnimated(dialog);
    });
  });
};

const setupHomeActions = () => {
  $("#copyServerAddress")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(serverAddress());
    showToast("服务器地址已复制");
  });
};

const scrollToAnnouncementAnchor = () => {
  if (page !== "home" || window.location.hash !== "#announcements") return;
  const target = $("#announcements");
  if (!target) return;
  const headerHeight = $(".site-header")?.offsetHeight || 0;
  const top = target.getBoundingClientRect().top + window.scrollY - headerHeight - 12;
  window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? "auto" : "smooth" });
};

const setupAnnouncementAnchorFix = () => {
  if (page !== "home") return;
  $$('a[href="#announcements"], a[href="/index.html#announcements"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      if (new URL(link.href, window.location.href).pathname !== window.location.pathname) return;
      event.preventDefault();
      if (window.location.hash !== "#announcements") window.history.pushState(null, "", "#announcements");
      scrollToAnnouncementAnchor();
    });
  });
  window.addEventListener("hashchange", scrollToAnnouncementAnchor);
  window.requestAnimationFrame(() => window.setTimeout(scrollToAnnouncementAnchor, 80));
};

const setupHeroTyping = () => {
  const title = $("#heroTypedTitle");
  if (!title) return;
  const fullText = title.dataset.text || "Liou_Yang Server";
  title.textContent = fullText;
};

let revealObserver = null;
const revealSelector = [
  ".hero-copy",
  ".hero-showcase",
  ".feature-band .section-title",
  ".feature-band article",
  ".world-routes",
  ".section-title",
  ".post-card",
  ".profile-card",
  ".forum-main",
  ".profile-page-card",
  ".profile-posts",
  ".admin-panel",
  ".stat-card",
  ".login-card",
  ".login-world-card",
].join(",");

const queueMotionTargets = () => {
  const targets = $$(revealSelector).filter((node) => !node.dataset.motionBound);
  if (!targets.length) return;
  targets.forEach((node, index) => {
    node.dataset.motionBound = "true";
    node.style.setProperty("--reveal-delay", `${Math.min(index, 8) * 48}ms`);
    node.classList.add("reveal-item");
    if (prefersReducedMotion() || !revealObserver) {
      node.classList.add("is-visible");
      return;
    }
    revealObserver?.observe(node);
  });
};

const setupAmbientMotion = () => {
  if (!prefersReducedMotion() && "IntersectionObserver" in window) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" },
    );
  }
  queueMotionTargets();
  const showcase = $(".hero-showcase");
  if (!showcase || prefersReducedMotion()) return;
  showcase.addEventListener("pointermove", (event) => {
    const rect = showcase.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    showcase.style.setProperty("--tilt-x", `${(-y * 4).toFixed(2)}deg`);
    showcase.style.setProperty("--tilt-y", `${(x * 5).toFixed(2)}deg`);
  });
  showcase.addEventListener("pointerleave", () => {
    showcase.style.removeProperty("--tilt-x");
    showcase.style.removeProperty("--tilt-y");
  });
};

const setupCinematicMotion = () => {
  const markReady = () => document.body.classList.add("cinematic-ready");
  if (prefersReducedMotion()) {
    markReady();
    return;
  }

  window.requestAnimationFrame(() => window.setTimeout(markReady, 90));

  const hero = $(".hero");
  if (!hero) return;
  const updateSceneProgress = () => {
    const rect = hero.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, -rect.top / Math.max(rect.height, 1)));
    document.documentElement.style.setProperty("--scene-progress", progress.toFixed(3));
  };

  updateSceneProgress();
  window.addEventListener("scroll", updateSceneProgress, { passive: true });
  window.addEventListener("resize", updateSceneProgress);
};

const setupLoginPage = () => {
  if (page !== "login") return;
  const loginForm = $("#loginForm");
  const registerForm = $("#registerForm");
  const redirectAfterAuth = (user, result = {}) => {
    state.me = user;
    if (result.accountDeletionCancelled) {
      window.sessionStorage?.setItem("siteToast", "注销已取消，账号已恢复正常登录");
    }
    window.location.href = user?.role === "admin" ? "/admin.html" : "/forum.html";
  };
  const openAuthDialog = (dialog, focusTarget) => {
    openDialog(dialog);
    window.setTimeout(() => focusTarget?.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 80);
  };
  $("#loginChoiceButton")?.addEventListener("click", () => openAuthDialog($("#loginDialog"), $("#loginUsername")));
  $("#registerChoiceButton")?.addEventListener("click", () => openAuthDialog($("#registerDialog"), $("#registerUsername")));
  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/login", {
        method: "POST",
        body: JSON.stringify({
          username: $("#loginUsername").value.trim(),
          password: $("#loginPassword").value,
          totpCode: $("#loginTotpCode")?.value.trim(),
        }),
      });
      redirectAfterAuth(result.user, result);
    } catch (error) {
      if (error.payload?.needsTotp) $("#loginTotpCode")?.focus();
    }
  });
  registerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/register", {
      method: "POST",
      body: JSON.stringify({
        username: $("#registerUsername").value.trim(),
        password: $("#registerPassword").value,
        inviteCode: $("#registerInviteCode").value.trim(),
      }),
    });
    redirectAfterAuth(result.user, result);
  });
};

const loadBaseState = async () => {
  const me = await api("/me").catch(() => ({ user: null, site: { maintenanceMode: false } }));
  state.me = me.user;
  state.site = me.site || { maintenanceMode: false };
};

const loadPublicData = async () => {
  const baseStatePromise = loadBaseState();
  let pageDataPromise = Promise.resolve(null);

  if (page === "home") pageDataPromise = api("/announcements").catch(() => ({ items: [] }));
  if (page === "forum") pageDataPromise = api("/posts").catch(() => ({ items: [] }));
  if (page === "profile") {
    const profileQuery = new URL(window.location.href).searchParams.get("user");
    pageDataPromise = profileQuery
      ? api(`/profiles/${encodeURIComponent(profileQuery)}`).catch(() => ({ profile: null }))
      : baseStatePromise.then(() => {
          const username = currentProfileQuery();
          return username ? api(`/profiles/${encodeURIComponent(username)}`).catch(() => ({ profile: null })) : { profile: null };
        });
  }

  const [, pageData] = await Promise.all([baseStatePromise, pageDataPromise]);

  if (page === "home") state.announcements = pageData?.items || [];
  if (page === "forum") state.posts = pageData?.items || [];
  if (page === "profile") {
    state.profile = pageData?.profile || null;
    state.posts = state.profile?.posts || [];
  }
  renderAll();
};

const loadAdminData = async () => {
  await loadBaseState();
  renderAll();
  renderAdminGate();
  if (!isAdmin()) return;
  const [announcements, posts, stats, admins, reports] = await Promise.all([
    api("/announcements"),
    api("/posts"),
    api("/admin/stats"),
    api("/admin/users"),
    api("/admin/reports"),
  ]);
  state.announcements = announcements.items;
  state.posts = posts.items;
  state.stats = stats;
  state.site.maintenanceMode = Boolean(stats.maintenanceMode);
  state.admins = admins.items;
  state.reports = reports.items;
  state.trashLoaded = false;
  renderAll();
  renderStats();
  renderManagement();
  renderReports();
  renderAdmins();
};

const refreshPageData = async () => (page === "admin" ? loadAdminData() : loadPublicData());

const renderAll = () => {
  renderAuth();
  renderMaintenanceBanner();
  renderMaintenanceGate();
  if (page === "home" || page === "forum") renderLists();
  if (page === "forum") renderForumProfileCard();
  if (page === "profile") renderProfilePage();
  if (page === "admin") renderAdminGate();
  queueMotionTargets();
};

$("#toast")?.addEventListener("click", async (event) => {
  const copyText = event.currentTarget.dataset.copyText;
  if (!copyText) return;
  await navigator.clipboard?.writeText(copyText).catch(() => {});
});

setupDialogDismiss();
setupAmbientMotion();
setupCinematicMotion();

if (page === "login") setupLoginPage();

if (page === "home") {
  setupHomeActions();
  setupAnnouncementAnchorFix();
  setupHeroTyping();
}

if (page === "forum") {
  setupEditor();
  setupForumPost();
}

if (page === "admin") {
  setupEditor();
  setupPublish();
  setupAdminUsers();
  setupMaintenanceToggle();
  setupAdminNavigation();
  setupAdminMobileDrawer();
  setupAdminSidebarFollow();
}

const pendingToast = window.sessionStorage?.getItem("siteToast");
if (pendingToast) {
  window.sessionStorage?.removeItem("siteToast");
  window.setTimeout(() => showToast(pendingToast), 300);
}

refreshPageData().catch((error) => showToast(error.message));
