const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

const textEncoder = new TextEncoder();
const usernameChangeCooldownMs = 7 * 24 * 60 * 60 * 1000;
const commentUndoWindowMs = 30 * 1000;
const maxSkinImageBytes = 256 * 1024;
const maxSkinImageDataUrlLength = Math.ceil(maxSkinImageBytes * 1.4) + 64;
const accountDeletionDelaySql = "+3 days";

const messageFromError = (error, fallback = "服务器错误") => {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message) return error.message;
  return fallback;
};

const getCookie = (request, name) => {
  const cookie = request.headers.get("Cookie") || "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
};

const bytesToBase32 = (bytes) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  let output = "";
  bytes.forEach((byte) => {
    bits += byte.toString(2).padStart(8, "0");
  });
  for (let index = 0; index < bits.length; index += 5) {
    output += alphabet[parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return output;
};

const base32ToBytes = (value) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(value || "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return new Uint8Array(bytes);
};

const hashPassword = async (password, salt = crypto.randomUUID()) => {
  const encoded = textEncoder.encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${salt}:${hash}`;
};

const verifyPassword = async (password, stored) => {
  const [salt] = String(stored || "").split(":");
  if (!salt) return false;
  return (await hashPassword(password, salt)) === stored;
};

const sanitizeHtml = (html) => {
  let output = String(html || "");
  output = output.replace(/<script[\s\S]*?<\/script>/gi, "");
  output = output.replace(/<(style|object|embed|link|meta|base)[\s\S]*?<\/\1>/gi, "");
  output = output.replace(/<(style|object|embed|link|meta|base)\b[^>]*>/gi, "");
  output = output.replace(/\son\w+(="[^"]*"|='[^']*'|=[^\s>]+)?/gi, "");
  output = output.replace(/javascript:/gi, "");
  output = output.replace(/<iframe\b[^>]*>(?:[\s\S]*?<\/iframe>)?/gi, (iframe) => {
    const src = iframe.match(/\ssrc=["']([^"']+)["']/i)?.[1] || "";
    if (!/^https:\/\/player\.bilibili\.com\/player\.html\?(bvid=BV[a-zA-Z0-9]{8,12}|aid=\d+)/.test(src)) {
      return "";
    }
    return `<iframe src="${src}" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen loading="lazy"></iframe>`;
  });
  return output.slice(0, 60000);
};

const excerptFromHtml = (html) =>
  sanitizeHtml(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

const normalizeHexColor = (value, fallback = "#5fa86f") => {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
};

const motdToPlainText = (motd) => {
  if (!motd) return "";
  if (typeof motd === "string") return motd.replace(/§[0-9a-fk-or]/gi, "");
  if (typeof motd !== "object") return "";
  let output = "";
  const visit = (node) => {
    if (!node) return;
    if (typeof node === "string") {
      output += node;
      return;
    }
    if (typeof node.text === "string") output += node.text;
    if (Array.isArray(node.extra)) node.extra.forEach(visit);
  };
  visit(motd);
  return output.replace(/§[0-9a-fk-or]/gi, "");
};

const readBody = async (request) => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

const isMissingColumnError = (error) => /no such column|duplicate column/i.test(messageFromError(error));

const ownerUser = async (env) => {
  try {
    return await env.DB.prepare(
      "SELECT id, username FROM users WHERE role = 'admin' AND deleted_at IS NULL ORDER BY id ASC LIMIT 1",
    ).first();
  } catch (error) {
    if (!/no such column/i.test(messageFromError(error))) throw error;
    return env.DB.prepare("SELECT id, username FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").first();
  }
};

const ensureForumAdminSchema = async (env) => {
  await ensurePlayerProfileSchema(env);
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS post_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT
    )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_post_reports_status ON post_reports(status, created_at DESC)").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_post_reports_unique_open ON post_reports(post_id, reporter_id) WHERE status = 'open'").run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_html TEXT NOT NULL,
      quote_comment_id INTEGER REFERENCES comments(id) ON DELETE SET NULL,
      quote_author TEXT,
      quote_excerpt TEXT,
      deleted_at TEXT,
      deleted_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS comment_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS comment_reactions (
      comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      value INTEGER NOT NULL CHECK (value IN (-1, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (comment_id, user_id)
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS comment_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      quote_comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      quote_author TEXT,
      quote_excerpt TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_comments_post_created_at ON comments(post_id, created_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_comments_deleted_at ON comments(deleted_at)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_comment_reports_status ON comment_reports(status, created_at DESC)").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_reports_unique_open ON comment_reports(comment_id, reporter_id) WHERE status = 'open'").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_comment_reactions_value ON comment_reactions(comment_id, value)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_comment_quotes_comment_order ON comment_quotes(comment_id, sort_order)").run();
  await addTableColumnIfMissing(env, "post_reports", "resolution_reason TEXT");
  await addTableColumnIfMissing(env, "post_reports", "punishment_type TEXT");
  await addTableColumnIfMissing(env, "post_reports", "punishment_expires_at TEXT");
  await addTableColumnIfMissing(env, "post_reports", "reporter_read_at TEXT");
  await addTableColumnIfMissing(env, "comment_reports", "resolution_reason TEXT");
  await addTableColumnIfMissing(env, "comment_reports", "punishment_type TEXT");
  await addTableColumnIfMissing(env, "comment_reports", "punishment_expires_at TEXT");
  await addTableColumnIfMissing(env, "comment_reports", "reporter_read_at TEXT");
  try {
    await env.DB.prepare("ALTER TABLE posts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0").run();
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
  }
  await addTableColumnIfMissing(env, "posts", "highlighted INTEGER NOT NULL DEFAULT 0");
  await addTableColumnIfMissing(env, "posts", "highlight_color TEXT");
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_posts_pinned_created_at ON posts(pinned DESC, created_at DESC)").run();
};

const addUserColumnIfMissing = async (env, definition) => {
  try {
    await env.DB.prepare(`ALTER TABLE users ADD COLUMN ${definition}`).run();
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
  }
};

const addTableColumnIfMissing = async (env, table, definition) => {
  try {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
  }
};

const ensureAccountDeletionSchema = async (env) => {
  await addUserColumnIfMissing(env, "deleted_at TEXT");
  await addUserColumnIfMissing(env, "deleted_by INTEGER");
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS account_deletion_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'cooling', 'cancelled', 'completed')),
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_at TEXT,
      approved_by INTEGER REFERENCES users(id),
      scheduled_at TEXT,
      cancelled_at TEXT,
      completed_at TEXT
    )`,
  ).run();
  await env.DB.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_account_deletion_active ON account_deletion_requests(user_id) WHERE status IN ('pending_approval', 'cooling')",
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_account_deletion_due ON account_deletion_requests(status, scheduled_at)").run();
};

const ensurePlayerProfileSchema = async (env) => {
  await addUserColumnIfMissing(env, "minecraft_name TEXT");
  await addUserColumnIfMissing(env, "skin_image TEXT");
  await addUserColumnIfMissing(env, "username_updated_at TEXT");
  await ensureAccountDeletionSchema(env);
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS player_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reported_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT
    )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_player_reports_status ON player_reports(status, created_at DESC)").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_player_reports_unique_open ON player_reports(reported_user_id, reporter_id) WHERE status = 'open'").run();
  await addTableColumnIfMissing(env, "player_reports", "resolution_reason TEXT");
  await addTableColumnIfMissing(env, "player_reports", "punishment_type TEXT");
  await addTableColumnIfMissing(env, "player_reports", "punishment_expires_at TEXT");
  await addTableColumnIfMissing(env, "player_reports", "reporter_read_at TEXT");
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS user_punishments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('account_ban', 'comment_ban', 'post_ban', 'site_ban')),
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_user_punishments_active ON user_punishments(user_id, type, expires_at, revoked_at)").run();
};

const defaultServerStatusSettings = {
  enabled: true,
  title: "服务器状态",
  address: "play.blockhaven.cn",
  apiBase: "https://motd.minebbs.com/api/status",
  serverType: "auto",
  srv: true,
  icon: "",
  footer: "API by motd.minebbs.com",
};

const readSiteSettingsMap = async (env) => {
  try {
    const { results } = await env.DB.prepare("SELECT key, value FROM site_settings").all();
    return Object.fromEntries((results || []).map((row) => [row.key, row.value]));
  } catch (error) {
    if (/no such table/i.test(messageFromError(error))) return {};
    throw error;
  }
};

const normalizeServerStatusSettings = (map = {}) => {
  const rawType = String(map.server_status_type || defaultServerStatusSettings.serverType).toLowerCase();
  const serverType = ["auto", "je", "be"].includes(rawType) ? rawType : "auto";
  return {
    enabled: map.server_status_enabled !== "off",
    title: String(map.server_status_title || defaultServerStatusSettings.title).trim().slice(0, 30) || defaultServerStatusSettings.title,
    address: String(map.server_status_address || defaultServerStatusSettings.address).trim().slice(0, 120) || defaultServerStatusSettings.address,
    apiBase: String(map.server_status_api_base || defaultServerStatusSettings.apiBase).trim().slice(0, 220) || defaultServerStatusSettings.apiBase,
    serverType,
    srv: map.server_status_srv !== "off",
    icon: String(map.server_status_icon || defaultServerStatusSettings.icon).trim().slice(0, 500),
    footer: String(map.server_status_footer || defaultServerStatusSettings.footer).trim().slice(0, 60) || defaultServerStatusSettings.footer,
  };
};

const getServerStatusSettings = async (env) => normalizeServerStatusSettings(await readSiteSettingsMap(env));

const publicServerStatusSettings = (settings) => ({
  enabled: settings.enabled,
  title: settings.title,
  address: settings.address,
  serverType: settings.serverType,
  srv: settings.srv,
  footer: settings.footer,
});

const serverStatusQueryKeys = ["enabled", "title", "address", "apiBase", "serverType", "srv", "icon", "footer"];

const queryValueOr = (searchParams, key, fallback) => {
  if (!searchParams.has(key)) return fallback;
  const value = String(searchParams.get(key) || "").trim();
  return value || fallback;
};

const queryToggleOr = (searchParams, key, fallback) => {
  if (!searchParams.has(key)) return fallback ? "on" : "off";
  const value = String(searchParams.get(key) || "").trim().toLowerCase();
  if (!value) return fallback ? "on" : "off";
  return ["0", "false", "off", "no", "disabled"].includes(value) ? "off" : "on";
};

const isValidServerStatusAddress = (value) => /^[a-z0-9\u4e00-\u9fa5_.:-]+$/i.test(String(value || "").trim());

const isValidServerStatusApiBase = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    return /^https?:$/.test(url.protocol);
  } catch {
    return false;
  }
};

const buildServerStatusSettingsFromRequest = (baseSettings, request) => {
  if (!request?.url) return { hasOverrides: false, settings: baseSettings };
  const searchParams = new URL(request.url).searchParams;
  const hasOverrides = serverStatusQueryKeys.some((key) => searchParams.has(key));
  if (!hasOverrides) return { hasOverrides: false, settings: baseSettings };

  return {
    hasOverrides: true,
    settings: normalizeServerStatusSettings({
      server_status_enabled: queryToggleOr(searchParams, "enabled", baseSettings.enabled),
      server_status_title: queryValueOr(searchParams, "title", baseSettings.title),
      server_status_address: queryValueOr(searchParams, "address", baseSettings.address),
      server_status_api_base: queryValueOr(searchParams, "apiBase", baseSettings.apiBase),
      server_status_type: queryValueOr(searchParams, "serverType", baseSettings.serverType),
      server_status_srv: queryToggleOr(searchParams, "srv", baseSettings.srv),
      server_status_icon: queryValueOr(searchParams, "icon", baseSettings.icon),
      server_status_footer: queryValueOr(searchParams, "footer", baseSettings.footer),
    }),
  };
};

const buildServerStatusApiUrl = (settings) => {
  const url = new URL(settings.apiBase || defaultServerStatusSettings.apiBase);
  const cleanPath = url.pathname.replace(/\/+$/, "");
  if (!/(^|\/)api\/status$/i.test(cleanPath) && !/(^|\/)status$/i.test(cleanPath)) {
    url.pathname = `${cleanPath}/api/status`.replace(/\/{2,}/g, "/");
  }
  url.searchParams.set("host", settings.address);
  url.searchParams.set("stype", settings.serverType);
  url.searchParams.set("srv", settings.srv ? "true" : "false");
  if (settings.icon) url.searchParams.set("icon", settings.icon);
  return url;
};

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const pickNumeric = (...values) => {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
};

const normalizeServerOnlineState = (payload) => {
  const rawStatus = String(payload?.status ?? payload?.state ?? payload?.online_status ?? "").toLowerCase();
  if (["online", "success", "ok"].includes(rawStatus)) return "online";
  if (["offline", "error", "fail"].includes(rawStatus)) return "offline";
  if (typeof payload?.online === "boolean") return payload.online ? "online" : "offline";
  if (typeof payload?.reachable === "boolean") return payload.reachable ? "online" : "offline";
  if (payload?.code === 200) return "online";
  return "offline";
};

const normalizeServerType = (payload, settings) => {
  const rawType = String(
    payload?.type || payload?.serverType || payload?.stype || payload?.edition || settings.serverType || "auto",
  ).toLowerCase();
  if (["je", "java"].includes(rawType)) return "java";
  if (["be", "bedrock"].includes(rawType)) return "bedrock";
  if (["auto", "unknown"].includes(rawType)) return "自动";
  return rawType;
};

const normalizeServerStatusPayload = (payload, settings) => {
  const root = payload && typeof payload === "object" ? payload : {};
  const nested = root.data && typeof root.data === "object" ? root.data : root.result && typeof root.result === "object" ? root.result : null;
  const resolved = nested && (nested.players || nested.motd || nested.description || nested.pureMotd || nested.cleanMotd) ? nested : root;
  const players = resolved?.players || {};
  const online = pickNumeric(players.online, players.currentPlayers, players.now, resolved?.online, resolved?.player_online);
  const max = pickNumeric(players.max, players.maxPlayers, players.total, resolved?.max, resolved?.player_max);
  const delay = pickNumeric(resolved?.delay, resolved?.latency, resolved?.ping, resolved?.ms);
  const motd = motdToPlainText(
    resolved?.pureMotd || resolved?.cleanMotd || resolved?.motd || resolved?.description || resolved?.desc,
  ).trim();
  const samplePlayers = Array.isArray(players.sample)
    ? players.sample
        .map((item) => (typeof item === "string" ? item : item?.name))
        .filter((item) => typeof item === "string" && item.trim())
        .slice(0, 8)
    : [];
  return {
    status: normalizeServerOnlineState(resolved),
    type: normalizeServerType(resolved, settings),
    host: firstNonEmptyString(resolved?.host, resolved?.hostname, resolved?.ip, settings.address),
    port: pickNumeric(resolved?.port, resolved?.queryPort, players?.port),
    motd,
    version: firstNonEmptyString(resolved?.version, resolved?.versionName, resolved?.game_version),
    protocol: firstNonEmptyString(resolved?.protocol, resolved?.protocolVersion),
    players: {
      online: Number.isFinite(online) ? online : 0,
      max: Number.isFinite(max) ? max : 0,
      sample: samplePlayers,
    },
    delay: Number.isFinite(delay) ? delay : null,
    icon: resolved?.icon || resolved?.favicon || settings.icon || "",
    error: firstNonEmptyString(resolved?.error, resolved?.message, resolved?.msg, resolved?.detail, resolved?.reason),
  };
};

const queryConfiguredServerStatus = async (settings) => {
  if (!settings.enabled) return { status: "disabled" };
  try {
    const response = await fetch(buildServerStatusApiUrl(settings), {
      headers: {
        Accept: "application/json",
        "User-Agent": "liouyang-server-site",
        "X-Internal-Request": "true",
      },
      cf: { cacheTtl: 25, cacheEverything: true },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || `状态接口请求失败 (${response.status})`);
    return normalizeServerStatusPayload(payload, settings);
  } catch (error) {
    return {
      status: "offline",
      type: normalizeServerType({}, settings),
      host: settings.address,
      port: null,
      motd: "",
      version: "",
      protocol: "",
      players: { online: 0, max: 0, sample: [] },
      delay: null,
      icon: settings.icon,
      error: messageFromError(error, "无法连接状态接口"),
    };
  }
};


const captchaConfig = {
  width: 320,
  height: 160,
  pieceSize: 42,
  radius: 9,
  tolerance: 8,
};

const ensureCaptchaTable = async (env) => {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS captcha_challenges (
      id TEXT PRIMARY KEY,
      target_x INTEGER NOT NULL,
      target_y INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      verified_at TEXT,
      used_at TEXT
    )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_captcha_challenges_expires_at ON captcha_challenges(expires_at)").run();
};

const createCaptchaChallenge = async (env) => {
  await ensureCaptchaTable(env);
  await env.DB.prepare("DELETE FROM captcha_challenges WHERE expires_at <= datetime('now') OR used_at IS NOT NULL").run();
  const { width, height, pieceSize, radius } = captchaConfig;
  const actualPieceSize = pieceSize + radius * 2 + 3;
  const targetX = actualPieceSize + 10 + Math.floor(Math.random() * Math.max(1, width - actualPieceSize * 2 - 20));
  const targetY = 10 + radius * 2 + Math.floor(Math.random() * Math.max(1, height - actualPieceSize - radius * 2 - 20));
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO captcha_challenges (id, target_x, target_y, expires_at) VALUES (?, ?, ?, datetime('now', '+5 minutes'))",
  )
    .bind(id, targetX, targetY)
    .run();
  return json({
    id,
    width,
    height,
    pieceSize,
    radius,
    targetX,
    pieceY: targetY,
    backgroundSeed: Math.floor(Math.random() * 1000000),
  });
};

const verifyCaptchaChallenge = async (env, request) => {
  await ensureCaptchaTable(env);
  const body = await readBody(request);
  const id = String(body.id || "").trim();
  const x = Number(body.x);
  const trailStddev = Number(body.trailStddev);
  if (!id || !Number.isFinite(x)) return json({ error: "验证已失效，请刷新后重试" }, 400);
  const row = await env.DB.prepare(
    "SELECT target_x FROM captcha_challenges WHERE id = ? AND expires_at > datetime('now') AND used_at IS NULL",
  )
    .bind(id)
    .first();
  if (!row) return json({ error: "验证已失效，请刷新后重试" }, 400);
  if (Math.abs(Number(row.target_x) - x) > captchaConfig.tolerance) {
    return json({ error: "滑块位置不正确，请再试一次" }, 400);
  }
  if (Number.isFinite(trailStddev) && trailStddev === 0) {
    return json({ error: "拖动轨迹异常，请再试一次" }, 400);
  }
  await env.DB.prepare("UPDATE captcha_challenges SET verified_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  return json({ ok: true });
};

const consumeCaptchaChallenge = async (env, id) => {
  return true;
};

const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const normalizeInviteCode = (value) => String(value || "").trim().toUpperCase().replace(/\s+/g, "");

const inviteCodeError = "邀请码不存在或已被使用";

const randomInviteCode = () => {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => inviteAlphabet[byte % inviteAlphabet.length]).join("");
};

const isUniqueConstraintError = (error) => /unique constraint|constraint failed/i.test(messageFromError(error));

const ensureInviteCodeSchema = async (env) => {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS invite_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_invite_codes_used_by ON invite_codes(used_by)").run();
  await env.DB.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_codes_one_active_per_owner ON invite_codes(owner_id) WHERE used_at IS NULL",
  ).run();
};

const activeInviteCode = async (env, ownerId) => {
  await ensureInviteCodeSchema(env);
  const existing = await env.DB.prepare(
    "SELECT code FROM invite_codes WHERE owner_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1",
  )
    .bind(ownerId)
    .first();
  if (existing?.code) return existing.code;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomInviteCode();
    try {
      await env.DB.prepare("INSERT INTO invite_codes (code, owner_id) VALUES (?, ?)").bind(code, ownerId).run();
      return code;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await env.DB.prepare(
        "SELECT code FROM invite_codes WHERE owner_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1",
      )
        .bind(ownerId)
        .first();
      if (raced?.code) return raced.code;
    }
  }
  throw new Error("生成邀请码失败，请稍后再试");
};

const createUserWithInvite = async (env, username, password, inviteCode, duplicateMessage) => {
  await ensureAccountDeletionSchema(env);
  await ensureInviteCodeSchema(env);
  const code = normalizeInviteCode(inviteCode);
  if (!code) return { response: json({ error: "请填写邀请码" }, 400) };
  if (!/^[A-Z0-9]{6,24}$/.test(code)) return { response: json({ error: inviteCodeError }, 400) };

  const invite = await env.DB.prepare(
    `SELECT invite_codes.id, invite_codes.owner_id
     FROM invite_codes
     JOIN users AS owners ON owners.id = invite_codes.owner_id
     WHERE invite_codes.code = ? AND invite_codes.used_at IS NULL AND owners.deleted_at IS NULL`,
  )
    .bind(code)
    .first();
  if (!invite) return { response: json({ error: inviteCodeError }, 400) };

  try {
    await env.DB.prepare("INSERT INTO users (username, password_hash, role, last_seen_at) VALUES (?, ?, 'user', CURRENT_TIMESTAMP)")
      .bind(username, await hashPassword(password))
      .run();
  } catch {
    return { response: json({ error: duplicateMessage }, 409) };
  }

  const user = await env.DB.prepare(
    "SELECT id, username, role, totp_enabled, created_at, last_seen_at FROM users WHERE username = ?",
  )
    .bind(username)
    .first();
  const result = await env.DB.prepare(
    "UPDATE invite_codes SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL",
  )
    .bind(user.id, invite.id)
    .run();
  if (!result.meta?.changes) {
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
    return { response: json({ error: "邀请码已被使用，请换一个" }, 409) };
  }

  await Promise.all([activeInviteCode(env, invite.owner_id), activeInviteCode(env, user.id)]);
  return { user };
};

const accountTypeLabel = (user, ownerId) => {
  if (!user) return "成员";
  if (ownerId && Number(user.id) === Number(ownerId)) return "服主";
  if (user.role === "admin") return "管理员";
  return "成员";
};

const normalizeMinecraftName = (value) => String(value || "").trim().slice(0, 32);

const validateMinecraftName = (value) =>
  !value || /^[\w-]{1,32}$/.test(value) ? "" : "Minecraft 角色名只能包含字母、数字、下划线或短横线";

const normalizeSkinImage = (value) => {
  const skinImage = String(value || "").trim();
  if (!skinImage) return "";
  if (skinImage.length > maxSkinImageDataUrlLength) return null;
  const match = skinImage.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const byteLength = Math.floor((match[2].length * 3) / 4) - (match[2].match(/=+$/)?.[0]?.length || 0);
  return byteLength <= maxSkinImageBytes ? skinImage : null;
};

const publicUser = (user, ownerId) =>
  user
    ? {
        id: user.id,
        username: user.username,
        role: user.role,
        is_owner: ownerId ? Number(user.id) === Number(ownerId) : Boolean(user.is_owner),
        account_type: accountTypeLabel(user, ownerId),
        minecraft_name: user.minecraft_name || "",
        skin_image: user.skin_image || "",
        username_updated_at: user.username_updated_at || "",
        totp_enabled: Boolean(user.totp_enabled),
        created_at: user.created_at,
        last_seen_at: user.last_seen_at,
      }
    : null;

const getSiteSettings = async (env) => {
  const map = await readSiteSettingsMap(env);
  return { maintenanceMode: map.maintenance_mode === "on", serverStatus: publicServerStatusSettings(normalizeServerStatusSettings(map)) };
};

const setSiteSetting = async (env, key, value) => {
  await env.DB.prepare(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(key, value)
    .run();
};

const currentUser = async (env, request) => {
  await ensurePlayerProfileSchema(env);
  const token = getCookie(request, "session");
  if (!token) return null;
  const user = await env.DB.prepare(
    `SELECT users.id, users.username, users.role, users.minecraft_name, users.skin_image,
            users.username_updated_at, users.totp_enabled, users.created_at, users.last_seen_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ? AND sessions.expires_at > datetime('now') AND users.deleted_at IS NULL`,
  )
    .bind(token)
    .first();
  if (user) {
    await env.DB.prepare("UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id).run();
  }
  return user;
};

const requireUser = async (env, request) => {
  const user = await currentUser(env, request);
  if (!user) throw new Response(JSON.stringify({ error: "请先登录" }), { status: 401 });
  await assertNoPunishment(env, user, ["site_ban", "account_ban"]);
  return user;
};

const requireAdmin = async (env, request) => {
  const user = await requireUser(env, request);
  if (user.role !== "admin") {
    throw new Response(JSON.stringify({ error: "只有管理员可以执行此操作" }), { status: 403 });
  }
  return user;
};

const requireOwnerAdmin = async (env, request) => {
  const user = await requireAdmin(env, request);
  const owner = await ownerUser(env);
  if (!owner || Number(owner.id) !== Number(user.id)) {
    throw new Response(JSON.stringify({ error: "只有服主可以管理管理员账号" }), { status: 403 });
  }
  return user;
};

const createSession = async (env, user) => {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+14 days'))",
  )
    .bind(token, user.id)
    .run();
  return token;
};

const createAuthResponse = async (env, user, status = 200, extra = {}) => {
  const token = await createSession(env, user);
  const owner = await ownerUser(env);
  return json(
    { user: publicUser(user, owner?.id), ...extra },
    status,
    { "Set-Cookie": `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600` },
  );
};

const publicUserById = async (env, id) => {
  await ensurePlayerProfileSchema(env);
  const owner = await ownerUser(env);
  const user = await env.DB.prepare(
    `SELECT id, username, role, minecraft_name, skin_image, username_updated_at,
            totp_enabled, created_at, last_seen_at
     FROM users
     WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first();
  return publicUser(user, owner?.id);
};

const activeAccountDeletionRequest = async (env, userId) => {
  await ensureAccountDeletionSchema(env);
  return env.DB.prepare(
    `SELECT id, user_id, requester_id, status, requested_at, approved_at, approved_by, scheduled_at, cancelled_at, completed_at
     FROM account_deletion_requests
     WHERE user_id = ? AND status IN ('pending_approval', 'cooling')
     ORDER BY id DESC
     LIMIT 1`,
  )
    .bind(userId)
    .first();
};

const publicAccountDeletionRequest = (request) =>
  request
    ? {
        id: request.id,
        status: request.status,
        requested_at: request.requested_at,
        approved_at: request.approved_at || "",
        scheduled_at: request.scheduled_at || "",
        requires_owner_approval: request.status === "pending_approval",
      }
    : null;

const cancelAccountDeletionOnLogin = async (env, userId) => {
  await ensureAccountDeletionSchema(env);
  const active = await activeAccountDeletionRequest(env, userId);
  if (!active) return null;
  const result = await env.DB.prepare(
    `UPDATE account_deletion_requests
     SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
     WHERE user_id = ?
       AND status IN ('pending_approval', 'cooling')
       AND (scheduled_at IS NULL OR scheduled_at > CURRENT_TIMESTAMP)`,
  )
    .bind(userId)
    .run();
  return result.meta?.changes ? active : null;
};

const softDeleteAccount = async (env, targetId, deletedBy = null) => {
  await ensureAccountDeletionSchema(env);
  await ensureInviteCodeSchema(env);
  const deletedUsername = `已注销用户${targetId}`;
  const passwordHash = `deleted:${crypto.randomUUID()}`;
  const runUpdate = (username) =>
    env.DB.prepare(
      `UPDATE users
       SET username = ?,
           password_hash = ?,
           role = 'user',
           minecraft_name = NULL,
           skin_image = NULL,
           username_updated_at = NULL,
           totp_secret = NULL,
           totp_enabled = 0,
           last_seen_at = NULL,
           deleted_at = CURRENT_TIMESTAMP,
           deleted_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
      .bind(username, passwordHash, deletedBy, targetId)
      .run();

  let result;
  try {
    result = await runUpdate(deletedUsername);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    result = await runUpdate(`已注销${targetId}${Date.now().toString(36)}`);
  }
  if (!result.meta?.changes) return result;

  await Promise.all([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId).run(),
    env.DB.prepare("UPDATE invite_codes SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP) WHERE owner_id = ? AND used_at IS NULL")
      .bind(targetId)
      .run(),
    env.DB.prepare(
      `UPDATE account_deletion_requests
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND status IN ('pending_approval', 'cooling')`,
    )
      .bind(targetId)
      .run(),
  ]);
  return result;
};

const completeMaturedAccountDeletions = async (env) => {
  await ensureAccountDeletionSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT user_id, requester_id, approved_by
     FROM account_deletion_requests
     WHERE status = 'cooling' AND scheduled_at <= CURRENT_TIMESTAMP
     ORDER BY scheduled_at ASC
     LIMIT 25`,
  ).all();
  for (const request of results || []) {
    await softDeleteAccount(env, request.user_id, request.approved_by || request.requester_id || request.user_id);
  }
};

const requestOwnAccountDeletion = async (env, request) => {
  await ensurePlayerProfileSchema(env);
  const actor = await requireUser(env, request);
  const owner = await ownerUser(env);
  if (owner?.id && Number(owner.id) === Number(actor.id)) {
    return json({ error: "服主账号不能注销" }, 400);
  }

  const existing = await activeAccountDeletionRequest(env, actor.id);
  if (existing) {
    return json({ ok: true, request: publicAccountDeletionRequest(existing), alreadyActive: true }, 200);
  }

  if (actor.role === "admin") {
    await env.DB.prepare(
      "INSERT INTO account_deletion_requests (user_id, requester_id, status) VALUES (?, ?, 'pending_approval')",
    )
      .bind(actor.id, actor.id)
      .run();
    return json(
      { ok: true, approvalRequired: true, request: publicAccountDeletionRequest(await activeAccountDeletionRequest(env, actor.id)) },
      202,
    );
  }

  await env.DB.prepare(
    `INSERT INTO account_deletion_requests (user_id, requester_id, status, approved_at, scheduled_at)
     VALUES (?, ?, 'cooling', CURRENT_TIMESTAMP, datetime('now', ?))`,
  )
    .bind(actor.id, actor.id, accountDeletionDelaySql)
    .run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(actor.id).run();
  return json(
    { ok: true, scheduled: true, request: publicAccountDeletionRequest(await activeAccountDeletionRequest(env, actor.id)) },
    202,
    { "Set-Cookie": "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" },
  );
};

const approveManagedAccountDeletion = async (env, request, id) => {
  const actor = await requireOwnerAdmin(env, request);
  const targetId = Number(id);
  const owner = await ownerUser(env);
  if (owner?.id && Number(owner.id) === targetId) return json({ error: "服主账号不能注销" }, 400);
  const target = await env.DB.prepare("SELECT id, username, role FROM users WHERE id = ? AND deleted_at IS NULL").bind(targetId).first();
  if (!target) return json({ error: "没有找到这个用户" }, 404);
  const result = await env.DB.prepare(
    `UPDATE account_deletion_requests
     SET status = 'cooling',
         approved_at = CURRENT_TIMESTAMP,
         approved_by = ?,
         scheduled_at = datetime('now', ?)
     WHERE user_id = ? AND status = 'pending_approval'`,
  )
    .bind(actor.id, accountDeletionDelaySql, targetId)
    .run();
  if (!result.meta?.changes) return json({ error: "这个账号没有待批准的注销申请" }, 404);
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId).run();
  return json({ ok: true, request: publicAccountDeletionRequest(await activeAccountDeletionRequest(env, targetId)) });
};

const timestampMs = (value) => {
  const text = String(value || "").trim();
  if (!text) return 0;
  const normalized = text.includes("T") ? text : `${text.replace(" ", "T")}Z`;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : 0;
};

const nextUsernameChangeIso = (lastChangedAt) => {
  const lastChangedMs = timestampMs(lastChangedAt);
  return lastChangedMs ? new Date(lastChangedMs + usernameChangeCooldownMs).toISOString() : "";
};

const punishmentTypeLabels = {
  account_ban: "临时封号",
  comment_ban: "禁止评论",
  post_ban: "禁止发表帖子",
  site_ban: "禁止访问网站",
};

const punishmentTypes = new Set(Object.keys(punishmentTypeLabels));

const activePunishments = async (env, userId, types = []) => {
  await ensurePlayerProfileSchema(env);
  const wanted = types.length ? types : [...punishmentTypes];
  const placeholders = wanted.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT id, type, reason, expires_at
     FROM user_punishments
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP AND type IN (${placeholders})
     ORDER BY expires_at DESC`,
  )
    .bind(userId, ...wanted)
    .all();
  return results || [];
};

const punishmentMessage = (punishment) => {
  const label = punishmentTypeLabels[punishment.type] || "处罚";
  const expires = punishment.expires_at ? `，到期时间 ${punishment.expires_at}` : "";
  const reason = punishment.reason ? `，原因：${punishment.reason}` : "";
  return `${label}生效中${expires}${reason}`;
};

const assertNoPunishment = async (env, user, types) => {
  if (!user || user.role === "admin") return;
  const punishment = (await activePunishments(env, user.id, types))[0];
  if (punishment) throw new Response(JSON.stringify({ error: punishmentMessage(punishment), punishment }), { status: 403 });
};

const createPunishmentFromBody = async (env, actor, targetId, body = {}) => {
  const type = String(body.punishmentType || "").trim();
  if (!type || type === "none") return null;
  if (!punishmentTypes.has(type)) throw new Response(JSON.stringify({ error: "处罚类型不正确" }), { status: 400 });
  const hours = Math.max(1, Math.min(24 * 30, Number(body.punishmentDurationHours || 24)));
  const reason = String(body.punishmentReason || body.resolutionReason || "").trim().slice(0, 500);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO user_punishments (user_id, admin_id, type, reason, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(targetId, actor.id, type, reason || null, expiresAt)
    .run();
  return { type, reason, expiresAt };
};

const resolveReportWithPunishment = async (env, request, table, reportId, actor, targetId) => {
  const body = await readBody(request);
  const resolutionReason = String(body.resolutionReason || body.punishmentReason || "").trim().slice(0, 500);
  const punishment = await createPunishmentFromBody(env, actor, targetId, body);
  const result = await env.DB.prepare(
    `UPDATE ${table}
     SET status = 'resolved',
         resolved_at = CURRENT_TIMESTAMP,
         resolution_reason = ?,
         punishment_type = ?,
         punishment_expires_at = ?
     WHERE id = ? AND status = 'open'`,
  )
    .bind(resolutionReason || null, punishment?.type || null, punishment?.expiresAt || null, reportId)
    .run();
  return { result, punishment };
};

const canManageAuthoredContent = async (env, actor, authorId) => {
  if (!actor) return false;
  if (Number(actor.id) === Number(authorId)) return true;
  if (actor.role !== "admin") return false;
  const owner = await ownerUser(env);
  if (owner?.id && Number(owner.id) === Number(actor.id)) return true;
  if (owner?.id && Number(owner.id) === Number(authorId)) return false;
  const author = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(authorId).first();
  return Boolean(author && author.role !== "admin");
};

const targetNeedsOwnerReview = (target, ownerId) => target?.role === "admin" || (ownerId && Number(target?.id) === Number(ownerId));

const canResolveReportForTarget = (actor, target, ownerId) => {
  if (!actor || actor.role !== "admin") return false;
  if (ownerId && Number(actor.id) === Number(ownerId)) return true;
  return !targetNeedsOwnerReview(target, ownerId);
};

const canManageAuthoredSnapshot = (actor, author, ownerId) => {
  if (!actor || !author) return false;
  if (Number(actor.id) === Number(author.id)) return true;
  if (actor.role !== "admin") return false;
  if (ownerId && Number(actor.id) === Number(ownerId)) return true;
  if (ownerId && Number(author.id) === Number(ownerId)) return false;
  return author.role !== "admin";
};

const canReportAuthoredSnapshot = (actor, author, ownerId) =>
  Boolean(actor && author && Number(actor.id) !== Number(author.id) && !(ownerId && Number(author.id) === Number(ownerId)));

const me = async (env, request) => {
  const user = await currentUser(env, request);
  const owner = await ownerUser(env);
  const site = await getSiteSettings(env);
  return json({ user: publicUser(user, owner?.id), site: { maintenanceMode: site.maintenanceMode, serverStatus: site.serverStatus } });
};

const purgeExpiredDeletedPosts = async (env) => {
  await env.DB.prepare("DELETE FROM posts WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-7 days')").run();
};

const withAuthorAccountTypes = async (env, rows = []) => {
  const owner = await ownerUser(env);
  return rows.map((row) => ({
    ...row,
    author_account_type: accountTypeLabel({ id: row.author_id, role: row.author_role }, owner?.id),
  }));
};

const listAnnouncements = async (env, { trash = false } = {}) => {
  await ensurePlayerProfileSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT announcements.id, announcements.title, announcements.content_html, announcements.pinned,
            announcements.views, announcements.deleted_at, announcements.created_at, announcements.updated_at,
            users.id AS author_id, users.role AS author_role, users.username AS author,
            users.minecraft_name AS author_minecraft_name, users.skin_image AS author_skin_image
     FROM announcements
     JOIN users ON users.id = announcements.author_id
     WHERE ${trash ? "announcements.deleted_at IS NOT NULL" : "announcements.deleted_at IS NULL"}
     ORDER BY announcements.pinned DESC, announcements.created_at DESC
     LIMIT 50`,
  ).all();
  return json({ items: await withAuthorAccountTypes(env, results || []) });
};

const listPosts = async (env, { trash = false, authorId = null, limit = 100 } = {}) => {
  await ensureForumAdminSchema(env);
  await purgeExpiredDeletedPosts(env);
  const where = [trash ? "posts.deleted_at IS NOT NULL" : "posts.deleted_at IS NULL"];
  const bindings = [];
  if (authorId !== null) {
    where.push("posts.author_id = ?");
    bindings.push(authorId);
  }
  bindings.push(limit);
  const { results } = await env.DB.prepare(
    `SELECT posts.id, posts.title, posts.excerpt, posts.content_html, posts.pinned, posts.highlighted, posts.highlight_color, posts.views, posts.deleted_at, posts.created_at,
            posts.updated_at, users.id AS author_id, users.role AS author_role, users.username AS author,
            users.minecraft_name AS author_minecraft_name, users.skin_image AS author_skin_image
     FROM posts
     JOIN users ON users.id = posts.author_id
     WHERE ${where.join(" AND ")}
     ORDER BY posts.pinned DESC, posts.created_at DESC
     LIMIT ?`,
  )
    .bind(...bindings)
    .all();
  return json({ items: await withAuthorAccountTypes(env, results || []) });
};

const ownReportHistory = async (env, userId) => {
  const { results: postReports } = await env.DB.prepare(
    `SELECT 'post' AS kind, post_reports.id, post_reports.reason, post_reports.status, post_reports.created_at,
            post_reports.resolved_at, post_reports.resolution_reason, post_reports.punishment_type, post_reports.punishment_expires_at,
            post_reports.reporter_read_at,
            posts.title AS target_title
     FROM post_reports
     JOIN posts ON posts.id = post_reports.post_id
     WHERE post_reports.reporter_id = ?`,
  )
    .bind(userId)
    .all();
  const { results: commentReports } = await env.DB.prepare(
    `SELECT 'comment' AS kind, comment_reports.id, comment_reports.reason, comment_reports.status, comment_reports.created_at,
            comment_reports.resolved_at, comment_reports.resolution_reason, comment_reports.punishment_type, comment_reports.punishment_expires_at,
            comment_reports.reporter_read_at,
            posts.title AS target_title
     FROM comment_reports
     JOIN comments ON comments.id = comment_reports.comment_id
     JOIN posts ON posts.id = comments.post_id
     WHERE comment_reports.reporter_id = ?`,
  )
    .bind(userId)
    .all();
  const { results: playerReports } = await env.DB.prepare(
    `SELECT 'player' AS kind, player_reports.id, player_reports.reason, player_reports.status, player_reports.created_at,
            player_reports.resolved_at, player_reports.resolution_reason, player_reports.punishment_type, player_reports.punishment_expires_at,
            player_reports.reporter_read_at,
            reported.username AS target_title
     FROM player_reports
     JOIN users AS reported ON reported.id = player_reports.reported_user_id
     WHERE player_reports.reporter_id = ?`,
  )
    .bind(userId)
    .all();
  return [...(postReports || []), ...(commentReports || []), ...(playerReports || [])]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50);
};

const reportHistoryTableMap = {
  post: "post_reports",
  comment: "comment_reports",
  player: "player_reports",
};

const markOwnReportRead = async (env, request, kind, id) => {
  await ensureForumAdminSchema(env);
  const actor = await requireUser(env, request);
  const table = reportHistoryTableMap[kind];
  if (!table) return json({ error: "举报类型不存在" }, 404);
  const result = await env.DB.prepare(`UPDATE ${table} SET reporter_read_at = CURRENT_TIMESTAMP WHERE id = ? AND reporter_id = ?`)
    .bind(Number(id), actor.id)
    .run();
  if (!result.meta?.changes) return json({ error: "举报不存在" }, 404);
  return json({ ok: true });
};

const markAllOwnReportsRead = async (env, request) => {
  await ensureForumAdminSchema(env);
  const actor = await requireUser(env, request);
  await Promise.all(
    Object.values(reportHistoryTableMap).map((table) =>
      env.DB.prepare(
        `UPDATE ${table}
         SET reporter_read_at = CURRENT_TIMESTAMP
         WHERE reporter_id = ?
           AND (reporter_read_at IS NULL OR reporter_read_at < COALESCE(resolved_at, created_at))`,
      )
        .bind(actor.id)
        .run(),
    ),
  );
  return json({ ok: true });
};

const profile = async (env, request, username) => {
  await ensureForumAdminSchema(env);
  const viewer = await currentUser(env, request);
  const owner = await ownerUser(env);
  const user = await env.DB.prepare(
    `SELECT id, username, role, minecraft_name, skin_image, username_updated_at, totp_enabled, last_seen_at, created_at
     FROM users
     WHERE lower(username) = lower(?) AND deleted_at IS NULL`,
  )
    .bind(username)
    .first();
  if (!user) return json({ error: "没有找到这个玩家" }, 404);
  const posts = await env.DB.prepare(
    `SELECT posts.id, posts.title, posts.excerpt, posts.content_html, posts.pinned, posts.highlighted, posts.highlight_color, posts.views, posts.created_at, posts.updated_at,
            users.id AS author_id, users.role AS author_role, users.username AS author,
            users.minecraft_name AS author_minecraft_name, users.skin_image AS author_skin_image
     FROM posts
     JOIN users ON users.id = posts.author_id
     WHERE posts.author_id = ? AND posts.deleted_at IS NULL
     ORDER BY posts.pinned DESC, posts.created_at DESC
     LIMIT 20`,
  )
    .bind(user.id)
    .all();
  const isSelf = Number(viewer?.id) === Number(user.id);
  const inviteCode = isSelf ? await activeInviteCode(env, user.id) : "";
  const trash = isSelf ? (await listPosts(env, { trash: true, authorId: user.id, limit: 50 })).json() : Promise.resolve({ items: [] });
  const reportHistory = isSelf ? await ownReportHistory(env, user.id) : [];
  const accountDeletion = isSelf ? publicAccountDeletionRequest(await activeAccountDeletionRequest(env, user.id)) : null;
  return json({
    profile: {
      id: user.id,
      username: user.username,
      role: user.role,
      minecraft_name: user.minecraft_name || "",
      skin_image: user.skin_image || "",
      username_updated_at: user.username_updated_at || "",
      accountType: accountTypeLabel(user, owner?.id),
      totp_enabled: Boolean(user.totp_enabled),
      online: user.last_seen_at ? Date.now() - new Date(user.last_seen_at).getTime() < 5 * 60 * 1000 : false,
      created_at: user.created_at,
      postCount: (posts.results || []).length,
      posts: await withAuthorAccountTypes(env, posts.results || []),
      trashPosts: (await trash).items || [],
      reportHistory,
      inviteCode,
      accountDeletion,
      isSelf,
      isOwner: owner?.id ? Number(owner.id) === Number(user.id) : false,
    },
  });
};

const login = async (env, request) => {
  const body = await readBody(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const totpCode = String(body.totpCode || "").trim();
  if (!(await consumeCaptchaChallenge(env, body.captchaId))) {
    return json({ error: "请先完成滑块验证" }, 400);
  }
  await ensurePlayerProfileSchema(env);
  const user = await env.DB.prepare(
    `SELECT id, username, password_hash, role, minecraft_name, skin_image, username_updated_at,
            totp_secret, totp_enabled, created_at, last_seen_at
     FROM users
     WHERE username = ? AND deleted_at IS NULL`,
  )
    .bind(username)
    .first();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json({ error: "用户名或密码错误" }, 401);
  }
  if (user.totp_enabled && !(await verifyTotpAsync(user.totp_secret, totpCode))) {
    return json({ error: "请输入正确的双重验证码", needsTotp: true }, 401);
  }
  const cancelledDeletion = await cancelAccountDeletionOnLogin(env, user.id);
  await assertNoPunishment(env, user, ["site_ban", "account_ban"]);
  const token = await createSession(env, user);
  await env.DB.prepare("UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id).run();
  const owner = await ownerUser(env);
  return json(
    { user: publicUser(user, owner?.id), accountDeletionCancelled: Boolean(cancelledDeletion) },
    200,
    { "Set-Cookie": `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600` },
  );
};

const logout = async (env, request) => {
  const token = getCookie(request, "session");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true }, 200, {
    "Set-Cookie": "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
  });
};

const register = async (env, request) => {
  const body = await readBody(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!(await consumeCaptchaChallenge(env, body.captchaId))) {
    return json({ error: "请先完成滑块验证" }, 400);
  }
  if (!/^[\w\u4e00-\u9fa5-]{3,20}$/.test(username)) return json({ error: "用户名需要 3 到 20 位" }, 400);
  if (password.length < 6) return json({ error: "密码至少 6 位" }, 400);
  const created = await createUserWithInvite(env, username, password, body.inviteCode, "用户名已存在");
  if (created.response) return created.response;
  const user = created.user;
  const owner = await ownerUser(env);
  const token = await createSession(env, user);
  return json(
    { user: publicUser(user, owner?.id) },
    201,
    { "Set-Cookie": `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600` },
  );
};

const account = async (env, request) => {
  const body = await readBody(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const totpCode = String(body.totpCode || "").trim();
  if (!(await consumeCaptchaChallenge(env, body.captchaId))) {
    return json({ error: "请先完成滑块验证" }, 400);
  }
  if (!/^[\w\u4e00-\u9fa5-]{3,20}$/.test(username)) return json({ error: "用户名需要 3 到 20 位" }, 400);
  if (password.length < 6) return json({ error: "密码至少 6 位" }, 400);

  await ensurePlayerProfileSchema(env);
  const existingUser = await env.DB.prepare(
    `SELECT id, username, password_hash, role, minecraft_name, skin_image, username_updated_at,
            totp_secret, totp_enabled, created_at, last_seen_at
     FROM users
     WHERE lower(username) = lower(?) AND deleted_at IS NULL`,
  )
    .bind(username)
    .first();

  if (existingUser) {
    if (!(await verifyPassword(password, existingUser.password_hash))) {
      return json({ error: "用户名或密码错误" }, 401);
    }
    if (existingUser.totp_enabled && !(await verifyTotpAsync(existingUser.totp_secret, totpCode))) {
      return json({ error: "请输入正确的双重验证码", needsTotp: true }, 401);
    }
    const cancelledDeletion = await cancelAccountDeletionOnLogin(env, existingUser.id);
    await assertNoPunishment(env, existingUser, ["site_ban", "account_ban"]);
    await env.DB.prepare("UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").bind(existingUser.id).run();
    return createAuthResponse(env, existingUser, 200, { mode: "login", accountDeletionCancelled: Boolean(cancelledDeletion) });
  }

  const created = await createUserWithInvite(env, username, password, body.inviteCode, "用户名已存在，请直接登录");
  if (created.response) return created.response;
  return createAuthResponse(env, created.user, 201, { mode: "register" });
};

const updateOwnUsername = async (env, request) => {
  await ensurePlayerProfileSchema(env);
  const actor = await requireUser(env, request);
  const body = await readBody(request);
  const username = String(body.username || "").trim();
  if (!/^[\w\u4e00-\u9fa5-]{3,20}$/.test(username)) return json({ error: "用户名需要 3 到 20 位" }, 400);

  const user = await env.DB.prepare("SELECT id, username, username_updated_at FROM users WHERE id = ?").bind(actor.id).first();
  if (!user) return json({ error: "请重新登录后再试" }, 401);
  const canRenameFreely = actor.role === "admin";
  if (String(user.username).toLowerCase() === username.toLowerCase()) {
    return json({ ok: true, user: await publicUserById(env, actor.id), canRenameAt: canRenameFreely ? "" : nextUsernameChangeIso(user.username_updated_at) });
  }

  const nextAllowedAt = timestampMs(user.username_updated_at) + usernameChangeCooldownMs;
  if (!canRenameFreely && user.username_updated_at && Date.now() < nextAllowedAt) {
    return json({ error: "每周只能修改一次用户名", canRenameAt: new Date(nextAllowedAt).toISOString() }, 429);
  }

  try {
    await env.DB.prepare("UPDATE users SET username = ?, username_updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(username, actor.id).run();
  } catch {
    return json({ error: "用户名已存在" }, 409);
  }
  return json({ ok: true, user: await publicUserById(env, actor.id), canRenameAt: canRenameFreely ? "" : nextUsernameChangeIso(new Date().toISOString()) });
};

const updateOwnCharacter = async (env, request) => {
  await ensurePlayerProfileSchema(env);
  const actor = await requireUser(env, request);
  const body = await readBody(request);
  const minecraftName = normalizeMinecraftName(body.minecraftName);
  const minecraftNameError = validateMinecraftName(minecraftName);
  if (minecraftNameError) return json({ error: minecraftNameError }, 400);

  const hasSkinImage = Object.prototype.hasOwnProperty.call(body, "skinImage");
  const skinImage = hasSkinImage ? normalizeSkinImage(body.skinImage) : undefined;
  if (hasSkinImage && skinImage === null) return json({ error: "上传图片需为 256KB 以内的 PNG、JPG 或 WebP" }, 400);

  if (hasSkinImage) {
    await env.DB.prepare("UPDATE users SET minecraft_name = ?, skin_image = ? WHERE id = ?").bind(minecraftName || null, skinImage || null, actor.id).run();
  } else {
    await env.DB.prepare("UPDATE users SET minecraft_name = ? WHERE id = ?").bind(minecraftName || null, actor.id).run();
  }
  return json({ ok: true, user: await publicUserById(env, actor.id) });
};

const updateOwnPassword = async (env, request) => {
  await ensurePlayerProfileSchema(env);
  const actor = await requireUser(env, request);
  const body = await readBody(request);
  const oldPassword = String(body.oldPassword || "");
  const newPassword = String(body.newPassword || "");
  if (newPassword.length < 6) return json({ error: "新密码至少需要 6 位" }, 400);

  const user = await env.DB.prepare("SELECT id, password_hash FROM users WHERE id = ?").bind(actor.id).first();
  if (!user || !(await verifyPassword(oldPassword, user.password_hash))) return json({ error: "旧密码不正确" }, 401);

  await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(newPassword), actor.id).run();
  const token = getCookie(request, "session");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token <> ?").bind(actor.id, token).run();
  return json({ ok: true });
};

const reportPlayer = async (env, request, username) => {
  await ensurePlayerProfileSchema(env);
  const reporter = await requireUser(env, request);
  const owner = await ownerUser(env);
  const target = await env.DB.prepare("SELECT id, username, role FROM users WHERE lower(username) = lower(?) AND deleted_at IS NULL").bind(username).first();
  if (!target) return json({ error: "没有找到这个玩家" }, 404);
  if (Number(target.id) === Number(reporter.id)) return json({ error: "不能举报自己" }, 400);
  if (owner?.id && Number(target.id) === Number(owner.id)) return json({ error: "不能举报服主" }, 400);

  const body = await readBody(request);
  const reason = String(body.reason || "").trim().slice(0, 500);
  if (reason.length < 4) return json({ error: "请填写至少 4 个字的举报原因" }, 400);

  try {
    await env.DB.prepare("INSERT INTO player_reports (reported_user_id, reporter_id, reason) VALUES (?, ?, ?)")
      .bind(target.id, reporter.id, reason)
      .run();
  } catch {
    return json({ error: "你已经举报过这个玩家，管理员会处理" }, 409);
  }
  return json({ ok: true, ownerOnly: reporter.role === "admin" && targetNeedsOwnerReview(target, owner?.id) }, 201);
};

const minecraftImage = async (request, waitUntil, kind, username, size) => {
  if (!["avatar", "body"].includes(kind)) return json({ error: "图片类型不存在" }, 404);
  const cleanName = String(username || "").trim();
  const cleanSize = Number(size);
  const fallbackUrl = new URL("/assets/unbound-skin.png", request.url);
  if (!/^[\w-]{1,32}$/.test(cleanName) || !Number.isInteger(cleanSize) || cleanSize < 16 || cleanSize > 512) return fetch(fallbackUrl);

  const cache = globalThis.caches?.default;
  const imageUrl = `https://mc-heads.net/${kind}/${encodeURIComponent(cleanName)}/${cleanSize}`;
  const cacheRequest = new Request(imageUrl, { method: "GET" });
  const cached = await cache?.match(cacheRequest);
  if (cached) return cached;

  try {
    const upstream = await fetch(imageUrl, {
      headers: {
        Accept: "image/png,image/*;q=0.8,*/*;q=0.5",
        "User-Agent": "blockhaven-site-image-proxy",
      },
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    const contentType = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !contentType.startsWith("image/")) throw new Error(`Minecraft image upstream failed: ${upstream.status}`);
    const response = new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
    if (cache) waitUntil?.(cache.put(cacheRequest, response.clone()));
    return response;
  } catch {
    return fetch(fallbackUrl, {
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
  }
};

const generateTotpAsync = async (secret, counter) => {
  const key = await crypto.subtle.importKey("raw", base32ToBytes(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 1000000).padStart(6, "0");
};

const verifyTotpAsync = async (secret, token) => {
  if (!secret || !/^\d{6}$/.test(token || "")) return false;
  const counter = Math.floor(Date.now() / 30000);
  for (const offset of [-1, 0, 1]) {
    if ((await generateTotpAsync(secret, counter + offset)) === token) return true;
  }
  return false;
};

const beginTotp = async (env, request) => {
  const user = await requireAdmin(env, request);
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const secret = bytesToBase32(bytes);
  await env.DB.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?").bind(secret, user.id).run();
  const issuer = "Liou_Yang Server";
  const accountLabel = user.username;
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
  return json({ secret, uri });
};

const confirmTotp = async (env, request) => {
  const user = await requireAdmin(env, request);
  const body = await readBody(request);
  const row = await env.DB.prepare("SELECT totp_secret FROM users WHERE id = ?").bind(user.id).first();
  if (!(await verifyTotpAsync(row?.totp_secret, String(body.code || "").trim()))) {
    return json({ error: "双重验证码不正确" }, 400);
  }
  await env.DB.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").bind(user.id).run();
  return json({ ok: true });
};

const disableTotp = async (env, request) => {
  const user = await requireAdmin(env, request);
  await env.DB.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?").bind(user.id).run();
  return json({ ok: true });
};

const contentPayload = async (request) => {
  const body = await readBody(request);
  const title = String(body.title || "").trim().slice(0, 80);
  const contentHtml = sanitizeHtml(body.contentHtml);
  const excerpt = excerptFromHtml(contentHtml);
  if (!title || !excerpt) throw new Response(JSON.stringify({ error: "标题和正文都要填写" }), { status: 400 });
  return { title, contentHtml, excerpt };
};

const createAnnouncement = async (env, request) => {
  const user = await requireAdmin(env, request);
  const { title, contentHtml } = await contentPayload(request);
  await env.DB.prepare("INSERT INTO announcements (title, content_html, author_id, pinned) VALUES (?, ?, ?, 0)")
    .bind(title, contentHtml, user.id)
    .run();
  return json({ ok: true }, 201);
};

const createPost = async (env, request) => {
  await ensureForumAdminSchema(env);
  const user = await requireUser(env, request);
  await assertNoPunishment(env, user, ["post_ban"]);
  const { title, contentHtml, excerpt } = await contentPayload(request);
  await env.DB.prepare("INSERT INTO posts (title, excerpt, content_html, author_id) VALUES (?, ?, ?, ?)")
    .bind(title, excerpt, contentHtml, user.id)
    .run();
  return json({ ok: true }, 201);
};

const updateAnnouncement = async (env, request, id) => {
  const user = await requireAdmin(env, request);
  const announcement = await env.DB.prepare("SELECT id, author_id FROM announcements WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!announcement) return json({ error: "公告不存在" }, 404);
  if (!(await canManageAuthoredContent(env, user, announcement.author_id))) {
    return json({ error: "不能编辑服主或其他管理员发布的公告" }, 403);
  }
  const { title, contentHtml } = await contentPayload(request);
  await env.DB.prepare("UPDATE announcements SET title = ?, content_html = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(title, contentHtml, id)
    .run();
  return json({ ok: true });
};

const updatePost = async (env, request, id) => {
  await ensureForumAdminSchema(env);
  const user = await requireUser(env, request);
  const post = await env.DB.prepare("SELECT id, author_id FROM posts WHERE id = ?").bind(id).first();
  if (!post) return json({ error: "帖子不存在" }, 404);
  if (!(await canManageAuthoredContent(env, user, post.author_id))) {
    return json({ error: "你只能编辑自己的帖子" }, 403);
  }
  const { title, contentHtml, excerpt } = await contentPayload(request);
  await env.DB.prepare("UPDATE posts SET title = ?, excerpt = ?, content_html = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(title, excerpt, contentHtml, id)
    .run();
  return json({ ok: true });
};

const updatePostPinned = async (env, request, id) => {
  await ensureForumAdminSchema(env);
  const user = await requireAdmin(env, request);
  const post = await env.DB.prepare("SELECT id, author_id FROM posts WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!post) return json({ error: "帖子不存在" }, 404);
  if (!(await canManageAuthoredContent(env, user, post.author_id))) {
    return json({ error: "不能管理服主或其他管理员发布的帖子" }, 403);
  }
  const body = await readBody(request);
  const pinned = Boolean(body.pinned);
  const result = await env.DB.prepare("UPDATE posts SET pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL")
    .bind(pinned ? 1 : 0, id)
    .run();
  if (!result.meta?.changes) return json({ error: "帖子不存在" }, 404);
  return json({ ok: true, pinned });
};

const updatePostHighlighted = async (env, request, id) => {
  await ensureForumAdminSchema(env);
  const user = await requireAdmin(env, request);
  const post = await env.DB.prepare("SELECT id, author_id FROM posts WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!post) return json({ error: "帖子不存在" }, 404);
  if (!(await canManageAuthoredContent(env, user, post.author_id))) {
    return json({ error: "不能管理这个帖子" }, 403);
  }
  const body = await readBody(request);
  const highlighted = Boolean(body.highlighted);
  const highlightColor = highlighted ? normalizeHexColor(body.highlightColor || body.highlight_color) : null;
  const result = await env.DB.prepare("UPDATE posts SET highlighted = ?, highlight_color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL")
    .bind(highlighted ? 1 : 0, highlightColor, id)
    .run();
  if (!result.meta?.changes) return json({ error: "帖子不存在" }, 404);
  return json({ ok: true, highlighted, highlightColor });
};

const reportPost = async (env, request, id) => {
  await ensureForumAdminSchema(env);
  const user = await requireUser(env, request);
  const owner = await ownerUser(env);
  const post = await env.DB.prepare(
    `SELECT posts.id, posts.author_id, users.role AS author_role
     FROM posts
     JOIN users ON users.id = posts.author_id
     WHERE posts.id = ? AND posts.deleted_at IS NULL`,
  )
    .bind(id)
    .first();
  if (!post) return json({ error: "帖子不存在" }, 404);
  if (Number(post.author_id) === Number(user.id)) return json({ error: "不能举报自己的帖子" }, 400);
  if (owner?.id && Number(post.author_id) === Number(owner.id)) return json({ error: "不能举报服主" }, 400);
  const body = await readBody(request);
  const reason = String(body.reason || "").trim().slice(0, 500);
  if (reason.length < 4) return json({ error: "请填写至少 4 个字的举报原因" }, 400);
  try {
    await env.DB.prepare("INSERT INTO post_reports (post_id, reporter_id, reason) VALUES (?, ?, ?)")
      .bind(id, user.id, reason)
      .run();
  } catch {
    return json({ error: "你已经举报过这个帖子，管理员会处理" }, 409);
  }
  return json({ ok: true, ownerOnly: user.role === "admin" && targetNeedsOwnerReview({ id: post.author_id, role: post.author_role }, owner?.id) }, 201);
};

const normalizeQuoteCommentIds = (body) => {
  const source = Array.isArray(body.quoteCommentIds) ? body.quoteCommentIds : [body.quoteCommentId];
  const seen = new Set();
  return source
    .map((value) => Number(value || 0))
    .filter((value) => Number.isInteger(value) && value > 0)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, 8);
};

const commentPayload = async (request) => {
  const body = await readBody(request);
  const contentHtml = sanitizeHtml(body.contentHtml).slice(0, 12000);
  const excerpt = excerptFromHtml(contentHtml);
  if (!excerpt) throw new Response(JSON.stringify({ error: "回复内容不能为空" }), { status: 400 });
  return { contentHtml, quoteCommentIds: normalizeQuoteCommentIds(body) };
};

const commentSelect = `
  SELECT comments.id, comments.post_id, comments.author_id, comments.content_html,
         comments.quote_comment_id, comments.quote_author, comments.quote_excerpt,
         comments.deleted_at, comments.deleted_by, comments.created_at, comments.updated_at,
         users.username AS author, users.role AS author_role,
         users.minecraft_name AS author_minecraft_name, users.skin_image AS author_skin_image,
         (SELECT COUNT(*) FROM comment_reactions WHERE comment_reactions.comment_id = comments.id AND comment_reactions.value = 1) AS like_count,
         (SELECT COUNT(*) FROM comment_reactions WHERE comment_reactions.comment_id = comments.id AND comment_reactions.value = -1) AS dislike_count
  FROM comments
  JOIN users ON users.id = comments.author_id
`;

const hydrateCommentActorReactions = async (env, comments, actor) => {
  const items = (Array.isArray(comments) ? comments : [comments]).filter(Boolean);
  if (!items.length) return comments;
  items.forEach((comment) => {
    comment.my_reaction = 0;
  });
  if (!actor?.id) return comments;
  const placeholders = items.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT comment_id, value FROM comment_reactions WHERE user_id = ? AND comment_id IN (${placeholders})`,
  )
    .bind(actor.id, ...items.map((comment) => comment.id))
    .all();
  const byCommentId = new Map((results || []).map((reaction) => [Number(reaction.comment_id), Number(reaction.value)]));
  items.forEach((comment) => {
    comment.my_reaction = byCommentId.get(Number(comment.id)) || 0;
  });
  return comments;
};

const hydrateCommentQuotes = async (env, comments) => {
  const items = (Array.isArray(comments) ? comments : [comments]).filter(Boolean);
  if (!items.length) return comments;
  items.forEach((comment) => {
    comment.quotes = [];
  });
  const placeholders = items.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT comment_id, quote_comment_id, quote_author, quote_excerpt, sort_order
     FROM comment_quotes
     WHERE comment_id IN (${placeholders})
     ORDER BY comment_id ASC, sort_order ASC, id ASC`,
  )
    .bind(...items.map((comment) => comment.id))
    .all();
  const byCommentId = new Map();
  (results || []).forEach((quote) => {
    const key = Number(quote.comment_id);
    if (!byCommentId.has(key)) byCommentId.set(key, []);
    byCommentId.get(key).push({
      id: Number(quote.quote_comment_id),
      author: quote.quote_author || "被引用回复",
      excerpt: quote.quote_excerpt || "",
      sort_order: Number(quote.sort_order || 0),
    });
  });
  items.forEach((comment) => {
    comment.quotes = byCommentId.get(Number(comment.id)) || [];
  });
  return comments;
};

const publicComment = (comment, actor, ownerId) => {
  const author = { id: comment.author_id, role: comment.author_role };
  const deleted = Boolean(comment.deleted_at);
  const quotes = Array.isArray(comment.quotes) && comment.quotes.length
    ? comment.quotes
    : comment.quote_excerpt
      ? [{ id: comment.quote_comment_id || null, author: comment.quote_author || "被引用回复", excerpt: comment.quote_excerpt || "" }]
      : [];
  return {
    id: comment.id,
    post_id: comment.post_id,
    author_id: comment.author_id,
    author: comment.author,
    author_role: comment.author_role,
    author_account_type: accountTypeLabel(author, ownerId),
    author_minecraft_name: comment.author_minecraft_name || "",
    author_skin_image: comment.author_skin_image || "",
    content_html: deleted ? "" : comment.content_html,
    quote_comment_id: comment.quote_comment_id || null,
    quote_author: comment.quote_author || "",
    quote_excerpt: comment.quote_excerpt || "",
    quotes: deleted ? [] : quotes,
    deleted_at: comment.deleted_at || "",
    deleted_by: comment.deleted_by || null,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
    like_count: Number(comment.like_count || 0),
    dislike_count: Number(comment.dislike_count || 0),
    my_reaction: Number(comment.my_reaction || 0),
    can_edit: !deleted && canManageAuthoredSnapshot(actor, author, ownerId),
    can_delete: !deleted && canManageAuthoredSnapshot(actor, author, ownerId),
    can_report: !deleted && canReportAuthoredSnapshot(actor, author, ownerId),
  };
};

const commentById = async (env, id) => env.DB.prepare(`${commentSelect} WHERE comments.id = ?`).bind(id).first();

const listPostComments = async (env, request, postId) => {
  await ensureForumAdminSchema(env);
  const actor = await currentUser(env, request);
  const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL").bind(postId).first();
  if (!post) return json({ error: "帖子不存在" }, 404);
  const owner = await ownerUser(env);
  const { results } = await env.DB.prepare(`${commentSelect} WHERE comments.post_id = ? ORDER BY comments.created_at ASC LIMIT 200`).bind(postId).all();
  const comments = await hydrateCommentActorReactions(env, results || [], actor);
  await hydrateCommentQuotes(env, comments);
  return json({ items: comments.map((comment) => publicComment(comment, actor, owner?.id)) });
};

const createComment = async (env, request, postId) => {
  await ensureForumAdminSchema(env);
  const user = await requireUser(env, request);
  await assertNoPunishment(env, user, ["comment_ban"]);
  const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL").bind(postId).first();
  if (!post) return json({ error: "帖子不存在" }, 404);
  const { contentHtml, quoteCommentIds } = await commentPayload(request);
  let quoteRows = [];
  if (quoteCommentIds.length) {
    const placeholders = quoteCommentIds.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `${commentSelect} WHERE comments.id IN (${placeholders}) AND comments.post_id = ? AND comments.deleted_at IS NULL`,
    )
      .bind(...quoteCommentIds, postId)
      .all();
    if ((results || []).length !== quoteCommentIds.length) return json({ error: "寮曠敤鐨勫洖澶嶄笉瀛樺湪" }, 404);
    const byId = new Map((results || []).map((quote) => [Number(quote.id), quote]));
    quoteRows = quoteCommentIds.map((quoteId) => {
      const quote = byId.get(Number(quoteId));
      return {
        id: Number(quote.id),
        author: quote.author,
        excerpt: excerptFromHtml(quote.content_html).slice(0, 120),
      };
    });
  }
  const firstQuote = quoteRows[0];
  if (false) {
    const quote = await env.DB.prepare(
      `${commentSelect} WHERE comments.id = ? AND comments.post_id = ? AND comments.deleted_at IS NULL`,
    )
      .bind(firstQuote?.id || 0, postId)
      .first();
    if (!quote) return json({ error: "引用的回复不存在" }, 404);
    const legacyQuoteAuthor = quote.author;
    const legacyQuoteExcerpt = excerptFromHtml(quote.content_html).slice(0, 120);
    void legacyQuoteAuthor;
    void legacyQuoteExcerpt;
  }
  const result = await env.DB.prepare(
    `INSERT INTO comments (post_id, author_id, content_html, quote_comment_id, quote_author, quote_excerpt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(postId, user.id, contentHtml, firstQuote?.id || null, firstQuote?.author || null, firstQuote?.excerpt || null)
    .run();
  const owner = await ownerUser(env);
  const comment =
    (result.meta?.last_row_id ? await commentById(env, result.meta.last_row_id) : null) ||
    (await env.DB.prepare(`${commentSelect} WHERE comments.post_id = ? AND comments.author_id = ? ORDER BY comments.id DESC LIMIT 1`).bind(postId, user.id).first());
  if (comment?.id && quoteRows.length) {
    for (const [index, quote] of quoteRows.entries()) {
      await env.DB.prepare(
        `INSERT INTO comment_quotes (comment_id, quote_comment_id, quote_author, quote_excerpt, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(comment.id, quote.id, quote.author || null, quote.excerpt || null, index)
        .run();
    }
  }
  await hydrateCommentActorReactions(env, comment, user);
  await hydrateCommentQuotes(env, comment);
  return json({ ok: true, comment: publicComment(comment, user, owner?.id) }, 201);
};

const updateComment = async (env, request, id) => {
  await ensureForumAdminSchema(env);
  const user = await requireUser(env, request);
  const owner = await ownerUser(env);
  const comment = await commentById(env, id);
  if (!comment || comment.deleted_at) return json({ error: "回复不存在" }, 404);
  if (!canManageAuthoredSnapshot(user, { id: comment.author_id, role: comment.author_role }, owner?.id)) {
    return json({ error: "不能编辑这个回复" }, 403);
  }
  const { contentHtml } = await commentPayload(request);
  await env.DB.prepare("UPDATE comments SET content_html = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(contentHtml, id).run();
  const updated = await commentById(env, id);
  await hydrateCommentActorReactions(env, updated, user);
  await hydrateCommentQuotes(env, updated);
  return json({ ok: true, comment: publicComment(updated, user, owner?.id) });
};

const deleteComment = async (env, request, id) => {
  await ensureForumAdminSchema(env);
  const user = await requireUser(env, request);
  const owner = await ownerUser(env);
  const comment = await commentById(env, id);
  if (!comment || comment.deleted_at) return json({ error: "回复不存在" }, 404);
  if (!canManageAuthoredSnapshot(user, { id: comment.author_id, role: comment.author_role }, owner?.id)) {
    return json({ error: "不能删除这个回复" }, 403);
  }
  await env.DB.prepare("UPDATE comments SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? WHERE id = ?").bind(user.id, id).run();
  return json({ ok: true, undoExpiresAt: new Date(Date.now() + commentUndoWindowMs).toISOString() });
};

const restoreComment = async (env, request, id) => {
  await ensureForumAdminSchema(env);
  const user = await requireUser(env, request);
  const owner = await ownerUser(env);
  const comment = await commentById(env, id);
  if (!comment) return json({ error: "回复不存在" }, 404);
  if (!comment.deleted_at) {
    await hydrateCommentActorReactions(env, comment, user);
    await hydrateCommentQuotes(env, comment);
    return json({ ok: true, comment: publicComment(comment, user, owner?.id) });
  }
  const deletedAt = timestampMs(comment.deleted_at);
  const canUndo = Number(comment.deleted_by) === Number(user.id) && deletedAt && Date.now() - deletedAt <= commentUndoWindowMs;
  if (!canUndo) return json({ error: "撤销时间已过" }, 403);
  await env.DB.prepare("UPDATE comments SET deleted_at = NULL, deleted_by = NULL WHERE id = ?").bind(id).run();
  const restored = await commentById(env, id);
  await hydrateCommentActorReactions(env, restored, user);
  await hydrateCommentQuotes(env, restored);
  return json({ ok: true, comment: publicComment(restored, user, owner?.id) });
};

const reactToComment = async (env, request, id) => {
  await ensureForumAdminSchema(env);
  const user = await requireUser(env, request);
  const owner = await ownerUser(env);
  const comment = await commentById(env, id);
  if (!comment || comment.deleted_at) return json({ error: "回复不存在" }, 404);
  const body = await readBody(request);
  const reaction = String(body.reaction || "").toLowerCase();
  const value = reaction === "like" ? 1 : reaction === "dislike" ? -1 : 0;
  if (!value) {
    await env.DB.prepare("DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ?").bind(id, user.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO comment_reactions (comment_id, user_id, value)
       VALUES (?, ?, ?)
       ON CONFLICT(comment_id, user_id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(id, user.id, value)
      .run();
  }
  const updated = await commentById(env, id);
  await hydrateCommentActorReactions(env, updated, user);
  await hydrateCommentQuotes(env, updated);
  return json({ ok: true, comment: publicComment(updated, user, owner?.id) });
};

const reportComment = async (env, request, id) => {
  await ensureForumAdminSchema(env);
  const reporter = await requireUser(env, request);
  const owner = await ownerUser(env);
  const comment = await commentById(env, id);
  if (!comment || comment.deleted_at) return json({ error: "回复不存在" }, 404);
  const target = { id: comment.author_id, role: comment.author_role };
  if (Number(target.id) === Number(reporter.id)) return json({ error: "不能举报自己的回复" }, 400);
  if (owner?.id && Number(target.id) === Number(owner.id)) return json({ error: "不能举报服主" }, 400);
  const body = await readBody(request);
  const reason = String(body.reason || "").trim().slice(0, 500);
  if (reason.length < 4) return json({ error: "请填写至少 4 个字的举报原因" }, 400);
  try {
    await env.DB.prepare("INSERT INTO comment_reports (comment_id, reporter_id, reason) VALUES (?, ?, ?)").bind(id, reporter.id, reason).run();
  } catch {
    return json({ error: "你已经举报过这个回复，管理员会处理" }, 409);
  }
  return json({ ok: true, ownerOnly: reporter.role === "admin" && targetNeedsOwnerReview(target, owner?.id) }, 201);
};

const deletePost = async (env, request, id) => {
  await ensureForumAdminSchema(env);
  const user = await requireUser(env, request);
  const post = await env.DB.prepare("SELECT id, author_id FROM posts WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!post) return json({ error: "帖子不存在" }, 404);
  if (!(await canManageAuthoredContent(env, user, post.author_id))) {
    return json({ error: "浣犲彧鑳藉垹闄よ嚜宸辩殑甯栧瓙" }, 403);
  }
  await env.DB.prepare("UPDATE posts SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? WHERE id = ?").bind(user.id, id).run();
  return json({ ok: true });
};

const restorePost = async (env, request, id) => {
  const user = await requireUser(env, request);
  const post = await env.DB.prepare("SELECT id, author_id FROM posts WHERE id = ? AND deleted_at IS NOT NULL").bind(id).first();
  if (!post) return json({ error: "Post is not in recycle bin" }, 404);
  if (!(await canManageAuthoredContent(env, user, post.author_id))) {
    return json({ error: "You can only restore your own posts" }, 403);
  }
  await env.DB.prepare("UPDATE posts SET deleted_at = NULL, deleted_by = NULL WHERE id = ?").bind(id).run();
  return json({ ok: true });
};

const purgePost = async (env, request, id) => {
  const user = await requireUser(env, request);
  const post = await env.DB.prepare("SELECT id, author_id FROM posts WHERE id = ? AND deleted_at IS NOT NULL").bind(id).first();
  if (!post) return json({ error: "Post is not in recycle bin" }, 404);
  if (!(await canManageAuthoredContent(env, user, post.author_id))) {
    return json({ error: "You can only purge your own posts" }, 403);
  }
  await env.DB.prepare("DELETE FROM posts WHERE id = ? AND deleted_at IS NOT NULL").bind(id).run();
  return json({ ok: true });
};

const deleteAnnouncement = async (env, request, id) => {
  const user = await requireAdmin(env, request);
  const announcement = await env.DB.prepare("SELECT id, author_id FROM announcements WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!announcement) return json({ error: "公告不存在" }, 404);
  if (!(await canManageAuthoredContent(env, user, announcement.author_id))) {
    return json({ error: "不能删除服主或其他管理员发布的公告" }, 403);
  }
  await env.DB.prepare("UPDATE announcements SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  return json({ ok: true });
};

const restoreAnnouncement = async (env, request, id) => {
  const user = await requireAdmin(env, request);
  const announcement = await env.DB.prepare("SELECT id, author_id FROM announcements WHERE id = ? AND deleted_at IS NOT NULL").bind(id).first();
  if (!announcement) return json({ error: "公告不在回收站" }, 404);
  if (!(await canManageAuthoredContent(env, user, announcement.author_id))) {
    return json({ error: "不能恢复服主或其他管理员发布的公告" }, 403);
  }
  await env.DB.prepare("UPDATE announcements SET deleted_at = NULL WHERE id = ?").bind(id).run();
  return json({ ok: true });
};

const purgeAnnouncement = async (env, request, id) => {
  const user = await requireAdmin(env, request);
  const announcement = await env.DB.prepare("SELECT id, author_id FROM announcements WHERE id = ? AND deleted_at IS NOT NULL").bind(id).first();
  if (!announcement) return json({ error: "公告不在回收站" }, 404);
  if (!(await canManageAuthoredContent(env, user, announcement.author_id))) {
    return json({ error: "不能彻底删除服主或其他管理员发布的公告" }, 403);
  }
  await env.DB.prepare("DELETE FROM announcements WHERE id = ? AND deleted_at IS NOT NULL").bind(id).run();
  return json({ ok: true });
};

const trackView = async (env, type, id) => {
  const table = type === "announcement" ? "announcements" : type === "post" ? "posts" : null;
  if (!table) return json({ error: "类型不存在" }, 404);
  await env.DB.prepare(`UPDATE ${table} SET views = COALESCE(views, 0) + 1 WHERE id = ? AND deleted_at IS NULL`).bind(id).run();
  return json({ ok: true });
};

const stats = async (env, request) => {
  await ensureForumAdminSchema(env);
  const actor = await requireAdmin(env, request);
  const owner = await ownerUser(env);
  const site = await getSiteSettings(env);
  const announcementViews = await env.DB.prepare("SELECT COALESCE(SUM(views), 0) AS total FROM announcements WHERE deleted_at IS NULL").first();
  const postViews = await env.DB.prepare("SELECT COALESCE(SUM(views), 0) AS total FROM posts WHERE deleted_at IS NULL").first();
  const userCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE deleted_at IS NULL").first();
  const adminCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND deleted_at IS NULL").first();
  const ownerId = owner?.id || 0;
  const reportCount =
    ownerId && Number(actor.id) === Number(ownerId)
      ? await env.DB.prepare(
          `SELECT
             (SELECT COUNT(*) FROM post_reports WHERE status = 'open') +
             (SELECT COUNT(*) FROM comment_reports WHERE status = 'open') +
             (SELECT COUNT(*) FROM player_reports WHERE status = 'open') AS total`,
        ).first()
      : await env.DB.prepare(
          `SELECT
             (SELECT COUNT(*)
              FROM post_reports
              JOIN posts ON posts.id = post_reports.post_id
              JOIN users AS authors ON authors.id = posts.author_id
              WHERE post_reports.status = 'open' AND authors.role <> 'admin' AND authors.id <> ?) +
             (SELECT COUNT(*)
              FROM comment_reports
              JOIN comments ON comments.id = comment_reports.comment_id
              JOIN users AS authors ON authors.id = comments.author_id
              WHERE comment_reports.status = 'open' AND authors.role <> 'admin' AND authors.id <> ?) +
             (SELECT COUNT(*)
              FROM player_reports
              JOIN users AS reported ON reported.id = player_reports.reported_user_id
              WHERE player_reports.status = 'open' AND reported.role <> 'admin' AND reported.id <> ?) AS total`,
        )
          .bind(ownerId, ownerId, ownerId)
          .first();
  const trashCount = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM posts WHERE deleted_at IS NOT NULL) + (SELECT COUNT(*) FROM announcements WHERE deleted_at IS NOT NULL) AS total",
  ).first();
  return json({
    totalViews: Number(announcementViews.total || 0) + Number(postViews.total || 0),
    announcementViews: Number(announcementViews.total || 0),
    postViews: Number(postViews.total || 0),
    userCount: Number(userCount.total || 0),
    adminCount: Number(adminCount.total || 0),
    reportCount: Number(reportCount.total || 0),
    trashCount: Number(trashCount.total || 0),
    maintenanceMode: site.maintenanceMode,
  });
};

const serverStatus = async (env, request) => {
  const settings = await getServerStatusSettings(env);
  const override = buildServerStatusSettingsFromRequest(settings, request);
  if (override.hasOverrides) {
    const user = await currentUser(env, request);
    if (!user) return json({ error: "请先登录" }, 401);
    if (user.role !== "admin") return json({ error: "只有管理员可以执行此操作" }, 403);
  }
  const responseSettings = override.hasOverrides ? override.settings : settings;
  return json({
    settings: publicServerStatusSettings(responseSettings),
    status: await queryConfiguredServerStatus(override.settings),
  });
};

const adminServerStatusSettings = async (env, request) => {
  await requireAdmin(env, request);
  const settings = await getServerStatusSettings(env);
  return json({ settings });
};

const updateServerStatusSettings = async (env, request) => {
  await requireAdmin(env, request);
  const body = await readBody(request);
  const next = normalizeServerStatusSettings({
    server_status_enabled: body.enabled === false ? "off" : "on",
    server_status_title: body.title,
    server_status_address: body.address,
    server_status_api_base: body.apiBase,
    server_status_type: body.serverType,
    server_status_srv: body.srv === false ? "off" : "on",
    server_status_icon: body.icon,
    server_status_footer: body.footer,
  });
  try {
    const url = new URL(next.apiBase);
    if (!/^https?:$/.test(url.protocol)) throw new Error("invalid protocol");
  } catch {
    return json({ error: "状态 API 地址格式不正确" }, 400);
  }
  if (!/^[a-z0-9\u4e00-\u9fa5_.:-]+$/i.test(next.address)) {
    return json({ error: "服务器地址只能包含域名、IP、端口或下划线" }, 400);
  }
  await Promise.all([
    setSiteSetting(env, "server_status_enabled", next.enabled ? "on" : "off"),
    setSiteSetting(env, "server_status_title", next.title),
    setSiteSetting(env, "server_status_address", next.address),
    setSiteSetting(env, "server_status_api_base", next.apiBase),
    setSiteSetting(env, "server_status_type", next.serverType),
    setSiteSetting(env, "server_status_srv", next.srv ? "on" : "off"),
    setSiteSetting(env, "server_status_icon", next.icon),
    setSiteSetting(env, "server_status_footer", next.footer),
  ]);
  return json({ ok: true, settings: next });
};

const listAdminUsers = async (env, request) => {
  await ensureForumAdminSchema(env);
  await requireAdmin(env, request);
  const owner = await ownerUser(env);
  const { results } = await env.DB.prepare(
    `SELECT users.id, users.username, users.role, users.created_at, users.last_seen_at,
            account_deletion_requests.status AS deletion_status,
            account_deletion_requests.requested_at AS deletion_requested_at,
            account_deletion_requests.approved_at AS deletion_approved_at,
            account_deletion_requests.scheduled_at AS deletion_scheduled_at
     FROM users
     LEFT JOIN account_deletion_requests
       ON account_deletion_requests.user_id = users.id
      AND account_deletion_requests.status IN ('pending_approval', 'cooling')
     WHERE users.deleted_at IS NULL
     ORDER BY users.role = 'admin' DESC, users.id ASC`,
  ).all();
  return json({
    items: (results || []).map((user) => ({
      ...user,
      is_owner: owner?.id ? Number(owner.id) === Number(user.id) : false,
      account_type: accountTypeLabel(user, owner?.id),
      account_deletion: publicAccountDeletionRequest(
        user.deletion_status
          ? {
              id: 0,
              status: user.deletion_status,
              requested_at: user.deletion_requested_at,
              approved_at: user.deletion_approved_at,
              scheduled_at: user.deletion_scheduled_at,
            }
          : null,
      ),
    })),
  });
};

const createAdminAccount = async (env, request) => {
  await requireOwnerAdmin(env, request);
  const body = await readBody(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!/^[\w\u4e00-\u9fa5-]{3,20}$/.test(username)) return json({ error: "用户名需要 3 到 20 位" }, 400);
  if (password.length < 6) return json({ error: "密码至少 6 位" }, 400);
  try {
    await env.DB.prepare("INSERT INTO users (username, password_hash, role, last_seen_at) VALUES (?, ?, 'admin', CURRENT_TIMESTAMP)")
      .bind(username, await hashPassword(password))
      .run();
  } catch {
    return json({ error: "用户名已存在" }, 409);
  }
  return json({ ok: true }, 201);
};

const updateManagedUser = async (env, request, id) => {
  const actor = await requireOwnerAdmin(env, request);
  const targetId = Number(id);
  const owner = await ownerUser(env);
  const target = await env.DB.prepare("SELECT id, username, role FROM users WHERE id = ? AND deleted_at IS NULL").bind(targetId).first();
  if (!target) return json({ error: "没有找到这个用户" }, 404);
  const body = await readBody(request);
  const nextUsername = body.username === undefined ? target.username : String(body.username || "").trim();
  const nextRole = body.role === undefined ? target.role : String(body.role || "").trim();
  if (!/^[\w\u4e00-\u9fa5-]{3,20}$/.test(nextUsername)) return json({ error: "用户名需要 3 到 20 位" }, 400);
  if (!["user", "admin"].includes(nextRole)) return json({ error: "账号类型不正确" }, 400);
  if (owner?.id && Number(owner.id) === targetId && nextRole !== "admin") return json({ error: "服主账号不能降权" }, 400);
  if (Number(actor.id) === targetId && nextRole !== "admin") return json({ error: "不能降权自己的账号" }, 400);
  try {
    await env.DB.prepare("UPDATE users SET username = ?, role = ? WHERE id = ?").bind(nextUsername, nextRole, targetId).run();
  } catch {
    return json({ error: "用户名已存在" }, 409);
  }
  if (target.role !== nextRole) await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId).run();
  return json({ ok: true });
};

const removeManagedUser = async (env, request, id) => {
  const user = await requireOwnerAdmin(env, request);
  const targetId = Number(id);
  const owner = await ownerUser(env);
  if (owner?.id && Number(owner.id) === targetId) return json({ error: "服主账号不能删除" }, 400);
  if (Number(user.id) === targetId) return json({ error: "不能删除自己的账号" }, 400);
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL").bind(targetId).first();
  if (!target) return json({ error: "没有找到这个用户" }, 404);
  const result = await softDeleteAccount(env, targetId, user.id);
  if (!result.meta?.changes) return json({ error: "没有找到这个用户" }, 404);
  return json({ ok: true });
};

const listPostReports = async (env, request) => {
  await ensureForumAdminSchema(env);
  const actor = await requireAdmin(env, request);
  const owner = await ownerUser(env);
  const { results: postReports } = await env.DB.prepare(
    `SELECT post_reports.id, post_reports.reason, post_reports.status, post_reports.created_at,
            posts.id AS post_id, posts.title AS post_title, posts.excerpt AS post_excerpt,
            posts.content_html AS post_content_html, posts.pinned AS post_pinned, posts.highlighted AS post_highlighted, posts.highlight_color AS post_highlight_color,
            posts.views AS post_views, posts.created_at AS post_created_at,
            posts.updated_at AS post_updated_at,
            reporters.username AS reporter,
            authors.id AS target_id, authors.id AS author_id, authors.username AS author,
            authors.role AS target_role, authors.minecraft_name AS author_minecraft_name,
            authors.skin_image AS author_skin_image
     FROM post_reports
     JOIN posts ON posts.id = post_reports.post_id
     JOIN users AS reporters ON reporters.id = post_reports.reporter_id
     JOIN users AS authors ON authors.id = posts.author_id
     WHERE post_reports.status = 'open'
     ORDER BY post_reports.created_at DESC
     LIMIT 80`,
  ).all();
  const { results: playerReports } = await env.DB.prepare(
    `SELECT player_reports.id, player_reports.reason, player_reports.status, player_reports.created_at,
            reporters.username AS reporter,
            reported.id AS target_id, reported.username AS target_user, reported.role AS target_role
     FROM player_reports
     JOIN users AS reporters ON reporters.id = player_reports.reporter_id
     JOIN users AS reported ON reported.id = player_reports.reported_user_id
     WHERE player_reports.status = 'open'
     ORDER BY player_reports.created_at DESC
     LIMIT 80`,
  ).all();
  const { results: commentReports } = await env.DB.prepare(
    `SELECT comment_reports.id, comment_reports.reason, comment_reports.status, comment_reports.created_at,
            comments.id AS comment_id, comments.content_html AS comment_content_html,
            posts.id AS post_id, posts.title AS post_title, posts.excerpt AS post_excerpt,
            posts.content_html AS post_content_html, posts.pinned AS post_pinned, posts.highlighted AS post_highlighted, posts.highlight_color AS post_highlight_color,
            posts.views AS post_views, posts.created_at AS post_created_at,
            posts.updated_at AS post_updated_at,
            reporters.username AS reporter,
            post_authors.id AS post_author_id, post_authors.username AS post_author,
            post_authors.role AS post_author_role, post_authors.minecraft_name AS post_author_minecraft_name,
            post_authors.skin_image AS post_author_skin_image,
            authors.id AS target_id, authors.id AS author_id, authors.username AS author,
            authors.role AS target_role, authors.minecraft_name AS author_minecraft_name,
            authors.skin_image AS author_skin_image
     FROM comment_reports
     JOIN comments ON comments.id = comment_reports.comment_id
     JOIN posts ON posts.id = comments.post_id
     JOIN users AS post_authors ON post_authors.id = posts.author_id
     JOIN users AS reporters ON reporters.id = comment_reports.reporter_id
     JOIN users AS authors ON authors.id = comments.author_id
     WHERE comment_reports.status = 'open'
     ORDER BY comment_reports.created_at DESC
     LIMIT 80`,
  ).all();
  const normalize = (report) => {
    const targetAccountType = accountTypeLabel({ id: report.target_id, role: report.target_role }, owner?.id);
    return {
      ...report,
      target_account_type: targetAccountType,
      author_account_type: targetAccountType,
      post_author_account_type: report.post_author_id ? accountTypeLabel({ id: report.post_author_id, role: report.post_author_role }, owner?.id) : "",
      can_resolve: canResolveReportForTarget(actor, { id: report.target_id, role: report.target_role }, owner?.id),
    };
  };
  const items = [
    ...(postReports || []).map((report) => ({ ...normalize(report), kind: "post" })),
    ...(commentReports || []).map((report) => ({ ...normalize(report), kind: "comment" })),
    ...(playerReports || []).map((report) => ({ ...normalize(report), kind: "player" })),
  ]
    .filter((report) => report.can_resolve)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 80);
  return json({ items });
};

const resolvePostReport = async (env, request, id) => {
  await ensureForumAdminSchema(env);
  const actor = await requireAdmin(env, request);
  const owner = await ownerUser(env);
  const report = await env.DB.prepare(
    `SELECT post_reports.id, authors.id AS target_id, authors.role AS target_role
     FROM post_reports
     JOIN posts ON posts.id = post_reports.post_id
     JOIN users AS authors ON authors.id = posts.author_id
     WHERE post_reports.id = ? AND post_reports.status = 'open'`,
  )
    .bind(id)
    .first();
  if (!report) return json({ error: "举报不存在或已处理" }, 404);
  if (!canResolveReportForTarget(actor, { id: report.target_id, role: report.target_role }, owner?.id)) {
    return json({ error: "管理员相关举报只能由服主处理" }, 403);
  }
  const { result, punishment } = await resolveReportWithPunishment(env, request, "post_reports", id, actor, report.target_id);
  if (!result.meta?.changes) return json({ error: "举报不存在或已处理" }, 404);
  return json({ ok: true, punishment });
};

const resolveCommentReport = async (env, request, id) => {
  await ensureForumAdminSchema(env);
  const actor = await requireAdmin(env, request);
  const owner = await ownerUser(env);
  const report = await env.DB.prepare(
    `SELECT comment_reports.id, authors.id AS target_id, authors.role AS target_role
     FROM comment_reports
     JOIN comments ON comments.id = comment_reports.comment_id
     JOIN users AS authors ON authors.id = comments.author_id
     WHERE comment_reports.id = ? AND comment_reports.status = 'open'`,
  )
    .bind(id)
    .first();
  if (!report) return json({ error: "举报不存在或已处理" }, 404);
  if (!canResolveReportForTarget(actor, { id: report.target_id, role: report.target_role }, owner?.id)) {
    return json({ error: "管理员相关举报只能由服主处理" }, 403);
  }
  const { result, punishment } = await resolveReportWithPunishment(env, request, "comment_reports", id, actor, report.target_id);
  if (!result.meta?.changes) return json({ error: "举报不存在或已处理" }, 404);
  return json({ ok: true, punishment });
};

const resolvePlayerReport = async (env, request, id) => {
  await ensureForumAdminSchema(env);
  const actor = await requireAdmin(env, request);
  const owner = await ownerUser(env);
  const report = await env.DB.prepare(
    `SELECT player_reports.id, reported.id AS target_id, reported.role AS target_role
     FROM player_reports
     JOIN users AS reported ON reported.id = player_reports.reported_user_id
     WHERE player_reports.id = ? AND player_reports.status = 'open'`,
  )
    .bind(id)
    .first();
  if (!report) return json({ error: "举报不存在或已处理" }, 404);
  if (!canResolveReportForTarget(actor, { id: report.target_id, role: report.target_role }, owner?.id)) {
    return json({ error: "管理员相关举报只能由服主处理" }, 403);
  }
  const { result, punishment } = await resolveReportWithPunishment(env, request, "player_reports", id, actor, report.target_id);
  if (!result.meta?.changes) return json({ error: "举报不存在或已处理" }, 404);
  return json({ ok: true, punishment });
};

const resetManagedUserPassword = async (env, request, id) => {
  await requireOwnerAdmin(env, request);
  const targetId = Number(id);
  const owner = await ownerUser(env);
  if (owner?.id && Number(owner.id) === targetId) {
    return json({ error: "服主密码请使用手动重置方案" }, 400);
  }
  const body = await readBody(request);
  const password = String(body.password || "");
  if (password.length < 6) return json({ error: "密码至少 6 位" }, 400);
  const result = await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(await hashPassword(password), targetId)
    .run();
  if (!result.meta?.changes) return json({ error: "没有找到这个用户" }, 404);
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId).run();
  return json({ ok: true });
};

const updateMaintenance = async (env, request) => {
  await requireAdmin(env, request);
  const body = await readBody(request);
  const enabled = Boolean(body.enabled);
  await setSiteSetting(env, "maintenance_mode", enabled ? "on" : "off");
  return json({ ok: true, maintenanceMode: enabled });
};

export async function onRequest(context) {
  const { request, env, params, waitUntil } = context;
  const pathname = `/${(params.path || []).join("/")}`;
  const method = request.method;

  try {
    await completeMaturedAccountDeletions(env);
    if (pathname !== "/logout") {
      const sessionUser = await currentUser(env, request);
      if (sessionUser) await assertNoPunishment(env, sessionUser, ["site_ban", "account_ban"]);
    }
    if (method === "GET" && pathname === "/captcha") return createCaptchaChallenge(env);
    if (method === "POST" && pathname === "/captcha/verify") return verifyCaptchaChallenge(env, request);
    if (method === "GET" && pathname === "/me") return me(env, request);
    if (method === "POST" && pathname === "/account") return account(env, request);
    if (method === "POST" && pathname === "/login") return login(env, request);
    if (method === "POST" && pathname === "/register") return register(env, request);
    if (method === "POST" && pathname === "/logout") return logout(env, request);
    if (method === "PUT" && pathname === "/me/username") return updateOwnUsername(env, request);
    if (method === "PUT" && pathname === "/me/character") return updateOwnCharacter(env, request);
    if (method === "PUT" && pathname === "/me/password") return updateOwnPassword(env, request);
    if (method === "POST" && pathname === "/me/deletion") return await requestOwnAccountDeletion(env, request);
    if (method === "POST" && pathname === "/me/reports/read-all") return markAllOwnReportsRead(env, request);
    if (method === "POST" && /^\/me\/reports\/(post|comment|player)\/\d+\/read$/.test(pathname)) {
      const [, , , kind, id] = pathname.split("/");
      return markOwnReportRead(env, request, kind, id);
    }
    if (method === "POST" && pathname === "/me/totp/begin") return beginTotp(env, request);
    if (method === "POST" && pathname === "/me/totp/confirm") return confirmTotp(env, request);
    if (method === "DELETE" && pathname === "/me/totp") return disableTotp(env, request);

    if (method === "GET" && pathname === "/announcements") return listAnnouncements(env);
    if (method === "POST" && pathname === "/announcements") return createAnnouncement(env, request);
    if (method === "PUT" && /^\/announcements\/\d+$/.test(pathname)) return updateAnnouncement(env, request, pathname.split("/").at(-1));
    if (method === "DELETE" && /^\/announcements\/\d+$/.test(pathname)) return deleteAnnouncement(env, request, pathname.split("/").at(-1));
    if (method === "POST" && /^\/announcements\/\d+\/restore$/.test(pathname)) return restoreAnnouncement(env, request, pathname.split("/").at(-2));
    if (method === "DELETE" && /^\/announcements\/\d+\/purge$/.test(pathname)) return purgeAnnouncement(env, request, pathname.split("/").at(-2));

    if (method === "GET" && pathname === "/posts") return listPosts(env);
    if (method === "POST" && pathname === "/posts") return createPost(env, request);
    if (method === "GET" && /^\/posts\/\d+\/comments$/.test(pathname)) return listPostComments(env, request, pathname.split("/").at(-2));
    if (method === "POST" && /^\/posts\/\d+\/comments$/.test(pathname)) return createComment(env, request, pathname.split("/").at(-2));
    if (method === "PUT" && /^\/posts\/\d+$/.test(pathname)) return updatePost(env, request, pathname.split("/").at(-1));
    if (method === "PUT" && /^\/posts\/\d+\/pin$/.test(pathname)) return updatePostPinned(env, request, pathname.split("/").at(-2));
    if (method === "PUT" && /^\/posts\/\d+\/highlight$/.test(pathname)) return updatePostHighlighted(env, request, pathname.split("/").at(-2));
    if (method === "POST" && /^\/posts\/\d+\/reports$/.test(pathname)) return reportPost(env, request, pathname.split("/").at(-2));
    if (method === "DELETE" && /^\/posts\/\d+$/.test(pathname)) return deletePost(env, request, pathname.split("/").at(-1));
    if (method === "POST" && /^\/posts\/\d+\/restore$/.test(pathname)) return restorePost(env, request, pathname.split("/").at(-2));
    if (method === "DELETE" && /^\/posts\/\d+\/purge$/.test(pathname)) return purgePost(env, request, pathname.split("/").at(-2));

    if (method === "GET" && /^\/profiles\/[^/]+$/.test(pathname)) {
      return profile(env, request, decodeURIComponent(pathname.split("/").at(-1)));
    }
    if (method === "POST" && /^\/profiles\/[^/]+\/reports$/.test(pathname)) {
      return reportPlayer(env, request, decodeURIComponent(pathname.split("/").at(-2)));
    }
    if (method === "PUT" && /^\/comments\/\d+$/.test(pathname)) return updateComment(env, request, pathname.split("/").at(-1));
    if (method === "DELETE" && /^\/comments\/\d+$/.test(pathname)) return deleteComment(env, request, pathname.split("/").at(-1));
    if (method === "POST" && /^\/comments\/\d+\/restore$/.test(pathname)) return restoreComment(env, request, pathname.split("/").at(-2));
    if (method === "POST" && /^\/comments\/\d+\/reaction$/.test(pathname)) return reactToComment(env, request, pathname.split("/").at(-2));
    if (method === "POST" && /^\/comments\/\d+\/reports$/.test(pathname)) return reportComment(env, request, pathname.split("/").at(-2));

    if (method === "GET" && /^\/minecraft-image\/(avatar|body)\/[^/]+\/\d+$/.test(pathname)) {
      const [, , kind, username, size] = pathname.split("/");
      return minecraftImage(request, waitUntil, kind, decodeURIComponent(username), size);
    }

    if (method === "GET" && pathname === "/server-status") return serverStatus(env, request);

    if (method === "POST" && /^\/track-view\/(announcement|post)\/\d+$/.test(pathname)) {
      const [, , type, id] = pathname.split("/");
      return trackView(env, type, id);
    }

    if (method === "GET" && pathname === "/admin/stats") return stats(env, request);
    if (method === "GET" && pathname === "/admin/settings/server-status") return adminServerStatusSettings(env, request);
    if (method === "PUT" && pathname === "/admin/settings/server-status") return updateServerStatusSettings(env, request);
    if (method === "GET" && pathname === "/admin/users") return listAdminUsers(env, request);
    if (method === "POST" && pathname === "/admin/users") return createAdminAccount(env, request);
    if (method === "PUT" && /^\/admin\/users\/\d+$/.test(pathname)) {
      return updateManagedUser(env, request, pathname.split("/").at(-1));
    }
    if (method === "PUT" && /^\/admin\/users\/\d+\/password$/.test(pathname)) {
      return resetManagedUserPassword(env, request, pathname.split("/").at(-2));
    }
    if (method === "POST" && /^\/admin\/users\/\d+\/deletion\/approve$/.test(pathname)) {
      return await approveManagedAccountDeletion(env, request, pathname.split("/").at(-3));
    }
    if (method === "DELETE" && /^\/admin\/users\/\d+$/.test(pathname)) {
      return await removeManagedUser(env, request, pathname.split("/").at(-1));
    }
    if (method === "GET" && pathname === "/admin/trash") {
      await requireAdmin(env, request);
      const [announcements, posts] = await Promise.all([listAnnouncements(env, { trash: true }), listPosts(env, { trash: true })]);
      return json({ announcements: (await announcements.json()).items, posts: (await posts.json()).items });
    }
    if (method === "GET" && pathname === "/admin/reports") return listPostReports(env, request);
    if (method === "POST" && /^\/admin\/reports\/post\/\d+\/resolve$/.test(pathname)) {
      return resolvePostReport(env, request, pathname.split("/").at(-2));
    }
    if (method === "POST" && /^\/admin\/reports\/comment\/\d+\/resolve$/.test(pathname)) {
      return resolveCommentReport(env, request, pathname.split("/").at(-2));
    }
    if (method === "POST" && /^\/admin\/reports\/player\/\d+\/resolve$/.test(pathname)) {
      return resolvePlayerReport(env, request, pathname.split("/").at(-2));
    }
    if (method === "POST" && /^\/admin\/reports\/\d+\/resolve$/.test(pathname)) {
      return resolvePostReport(env, request, pathname.split("/").at(-2));
    }
    if (method === "PUT" && pathname === "/admin/settings/maintenance") return updateMaintenance(env, request);

    return json({ error: "接口不存在" }, 404);
  } catch (error) {
    console.error("API request failed", pathname, method, error);
    if (
      error instanceof Response ||
      (error && typeof error === "object" && typeof error.status === "number" && error.headers && typeof error.text === "function")
    ) {
      return error;
    }
    return json({ error: messageFromError(error, "服务器错误") }, 500);
  }
}
