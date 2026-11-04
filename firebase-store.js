(() => {
  "use strict";

  const SDK_ROOT = "https://www.gstatic.com/firebasejs/12.5.0";
  const LEGACY_URL = "https://qqzrvdscnwdmpdrqdqtz.supabase.co/rest/v1/shared_scores";
  const LEGACY_KEY = "sb_publishable_KZgbYMI3wmd4KE2FVyW_Xg_TH04wI69";
  const BOOK_IDS = ["mahjong-scorebook", "golf-scorebook", "uex-golf-club-scorebook"];
  const MAX_PAYLOAD_BYTES = 900 * 1024;
  let backendPromise;

  function failure(code, message) {
    return Object.assign(new Error(message), { code });
  }

  function configuration() {
    const config = window.SCOREBOOK_FIREBASE_CONFIG;
    if (!config || typeof config.enabled !== "boolean") {
      throw failure("config", "共有 DB の設定ファイルを読み込めません。再読み込みしてください。");
    }
    return config;
  }

  function isFirebase() {
    return configuration().enabled;
  }

  async function backend() {
    if (!backendPromise) {
      backendPromise = (async () => {
        const config = configuration();
        if (!config.enabled || ["apiKey", "authDomain", "projectId", "appId"].some((key) => !config[key]?.trim())) {
          throw failure("config", "Firebase の接続情報が未設定です。管理者に確認してください。");
        }
        const [appSdk, dbSdk] = await Promise.all([
          import(`${SDK_ROOT}/firebase-app.js`),
          import(`${SDK_ROOT}/firebase-firestore.js`)
        ]);
        const { apiKey, authDomain, projectId, appId } = config;
        const app = appSdk.initializeApp({ apiKey, authDomain, projectId, appId }, "scorebooks");
        return { db: dbSdk.getFirestore(app), dbSdk };
      })().catch((error) => {
        backendPromise = undefined;
        throw error;
      });
    }
    return backendPromise;
  }

  function errorMessage(error) {
    if (error?.code === "permission-denied") {
      return "共有 DB への接続が拒否されました。管理者に Firebase の接続情報と Security Rules の確認を依頼してください。";
    }
    return error?.message || "共有 DB に接続できません。通信状態と設定を確認してください。";
  }

  function create({ id, normalize, merge }) {
    if (!BOOK_IDS.includes(id)) throw new Error("Unknown scorebook ID");
    const revisions = new WeakMap();
    let writeTail = Promise.resolve();
    let acknowledgedRevision;

    function valid(value) {
      const data = normalize(value);
      if (!data) throw failure("data", "共有データの形式を確認できません。上書きせずに処理を中止しました。");
      return data;
    }

    function payload(data) {
      const text = JSON.stringify(valid(data));
      if (new TextEncoder().encode(text).byteLength > MAX_PAYLOAD_BYTES) {
        throw failure("size", "共有データが 900 KiB を超えています。バックアップを保存し、管理者に確認してください。");
      }
      return text;
    }

    function revisionKey() {
      return `scorebook-firebase-revision:${configuration().projectId}:${id}`;
    }

    function remember(revision) {
      acknowledgedRevision = revision;
      localStorage.setItem(revisionKey(), String(revision));
    }

    function expectedRevision() {
      if (acknowledgedRevision !== undefined) return acknowledgedRevision;
      const value = localStorage.getItem(revisionKey());
      const revision = Number(value);
      acknowledgedRevision = value !== null && Number.isSafeInteger(revision) && revision > 0 ? revision : null;
      return acknowledgedRevision;
    }

    function unpack(snapshot) {
      if (!snapshot.exists()) return null;
      const row = snapshot.data();
      if (row.formatVersion !== 1 || !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.payload !== "string") {
        throw failure("data", "Firebase の共有データ形式が一致しません。上書きせずに処理を中止しました。");
      }
      const data = valid(JSON.parse(row.payload));
      revisions.set(data, row.revision);
      return { data, revision: row.revision };
    }

    function accept(data) {
      if (!isFirebase()) return;
      const revision = revisions.get(data);
      if (!revision) throw new Error("Cannot accept an unread Firebase revision");
      remember(revision);
    }

    async function readLegacy() {
      const response = await fetch(`${LEGACY_URL}?id=eq.${encodeURIComponent(id)}&select=data`, {
        headers: { apikey: LEGACY_KEY, Authorization: `Bearer ${LEGACY_KEY}` },
        cache: "no-store",
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw failure("legacy", `Supabase の取得に失敗しました（HTTP ${response.status}）。`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw failure("data", "Supabase の応答形式が一致しません。");
      return rows.length ? valid(rows[0].data) : null;
    }

    async function read() {
      if (!isFirebase()) return readLegacy();
      const { db, dbSdk } = await backend();
      const row = unpack(await dbSdk.getDocFromServer(dbSdk.doc(db, "scorebooks", id)));
      return row?.data || null;
    }

    async function writeLegacy(data, replace) {
      const next = merge && !replace ? merge(data, await readLegacy()) : data;
      const response = await fetch(`${LEGACY_URL}?on_conflict=id`, {
        method: "POST",
        headers: {
          apikey: LEGACY_KEY,
          Authorization: `Bearer ${LEGACY_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({ id, data: next, updated_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw failure("legacy", `Supabase の更新に失敗しました（HTTP ${response.status}）。`);
      return next;
    }

    async function writeFirebase(data, { replace = false, createOnly = false } = {}) {
      const { db, dbSdk } = await backend();
      const reference = dbSdk.doc(db, "scorebooks", id);
      const result = await dbSdk.runTransaction(db, async (transaction) => {
        const current = unpack(await transaction.get(reference));
        if (createOnly && current) {
          throw failure("exists", "Firebase に共有データがあるため、移行を中止しました。[最新データを取得] で確認してください。");
        }
        if (!createOnly && !current) {
          throw failure("empty", "Firebase に共有データがありません。端末のバックアップを保存し、管理者に復旧を依頼してください。");
        }
        if (!createOnly && (!merge || replace) && expectedRevision() !== current.revision) {
          throw failure("conflict", "別の端末の更新、または未取得の共有データがあります。端末のバックアップを保存し、[最新データを取得] で確認してください。");
        }
        const next = current && merge && !replace ? valid(merge(data, current.data)) : data;
        const revision = current ? current.revision + 1 : 1;
        transaction.set(reference, {
          formatVersion: 1,
          payload: payload(next),
          revision,
          updatedAt: dbSdk.serverTimestamp()
        });
        return { data: next, revision };
      });
      revisions.set(result.data, result.revision);
      remember(result.revision);
      return result.data;
    }

    function enqueue(operation) {
      const task = writeTail.then(operation);
      // Keep later writes usable; the original task still rejects to its caller.
      writeTail = task.then(() => undefined, () => undefined);
      return task;
    }

    function write(value, { replace = false } = {}) {
      const data = valid(JSON.parse(JSON.stringify(value)));
      return enqueue(() => isFirebase() ? writeFirebase(data, { replace }) : writeLegacy(data, replace));
    }

    async function migrate(value) {
      if (!isFirebase()) throw failure("config", "先に Firebase の接続情報を設定してください。");
      const data = valid(JSON.parse(JSON.stringify(value)));
      return enqueue(() => writeFirebase(data, { createOnly: true, replace: true }));
    }

    expectedRevision();
    return { isFirebase, read, write, accept, readLegacy, migrate, errorMessage };
  }

  window.ScorebookDatabase = Object.freeze({ create, errorMessage });
})();
