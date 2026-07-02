/* Allotted live cloud provider (Phase 2).
   ------------------------------------------------------------------
   This file is the ONLY place in the app that talks to the network.
   It implements window.AllottedCloud - the provider contract the app's
   service layer (AuthService / SyncService / HouseholdService in
   www/index.html) was built against in Phase 1.

   - If www/cloud-config.js is absent or empty, this file defines
     NOTHING and the app automatically stays in local mock/test mode.
   - It speaks Supabase's stable HTTP endpoints directly (GoTrue auth +
     PostgREST + RPC), mirroring the Supabase JS v2 calls:
       auth.signUp                -> POST /auth/v1/signup
       auth.signInWithPassword    -> POST /auth/v1/token?grant_type=password
       auth.signOut               -> POST /auth/v1/logout
       auth.getSession/refresh    -> POST /auth/v1/token?grant_type=refresh_token
       auth.resetPasswordForEmail -> POST /auth/v1/recover
       from(table).select/upsert  -> /rest/v1/<table>
       rpc("join_household")      -> POST /rest/v1/rpc/join_household
     To swap in the official @supabase/supabase-js SDK later, replace
     only the bodies of the methods below - the contract stays the same
     (see docs/cloud-accounts.md, "Replacing this client with the SDK").
   - Only the anon public key is ever used here. Row Level Security in
     docs/supabase-schema.sql is what protects the data.
   ------------------------------------------------------------------ */
(function () {
  "use strict";
  var cfg = window.ALLOTTED_CLOUD_CONFIG;
  if (!cfg || !cfg.url || !cfg.anonKey) return; // no config -> mock mode

  var BASE = String(cfg.url).replace(/\/+$/, "");
  var ANON = String(cfg.anonKey);
  var TOK_KEY = "allotted-supabase-session-v1";

  function loadTok() { try { var r = localStorage.getItem(TOK_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function saveTok(t) { try { if (t) localStorage.setItem(TOK_KEY, JSON.stringify(t)); else localStorage.removeItem(TOK_KEY); } catch (e) {} }
  var tok = loadTok();

  function niceError(msg, status) {
    var m = String(msg || "");
    if (/invalid login credentials/i.test(m)) return "Email or password is incorrect";
    if (/already registered|already been registered/i.test(m)) return "An account with that email already exists. Sign in instead.";
    if (/email not confirmed/i.test(m)) return "Confirm your email first - check your inbox for the link, then sign in.";
    if (/password should be at least/i.test(m)) return "Password needs at least 6 characters";
    if (/rate limit/i.test(m)) return "Too many attempts. Wait a minute and try again.";
    if (/invalid or expired invite/i.test(m)) return "That invite code is not valid";
    if (status === 401 || status === 403) return "You do not have access to that. Sign in again if this keeps happening.";
    return m || "Request failed (" + status + ")";
  }

  function req(path, opts) {
    opts = opts || {};
    var headers = { apikey: ANON, "Content-Type": "application/json" };
    headers.Authorization = "Bearer " + (opts.auth === false ? ANON : (tok && tok.access_token ? tok.access_token : ANON));
    if (opts.headers) for (var k in opts.headers) headers[k] = opts.headers[k];
    var p;
    try {
      p = fetch(BASE + path, { method: opts.method || "GET", headers: headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    } catch (e) { return Promise.reject(new Error("You appear to be offline. Try again when you have a connection.")); }
    return p.then(function (r) {
      return r.text().then(function (t) {
        var d = null; try { d = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) {
          var raw = (d && (d.msg || d.message || d.error_description || d.error || (d.details ? d.details : ""))) || "";
          var err = new Error(niceError(raw, r.status)); err.status = r.status; throw err;
        }
        return d;
      });
    }, function () { throw new Error("You appear to be offline. Try again when you have a connection."); });
  }

  function normSession(d) {
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      user: d.user ? { id: d.user.id, email: d.user.email } : (tok && tok.user)
    };
  }

  function ensureFreshToken() {
    if (!tok) return Promise.resolve(null);
    var now = Math.floor(Date.now() / 1000);
    if (tok.expires_at && tok.expires_at - now > 60) return Promise.resolve(tok);
    if (!tok.refresh_token) return Promise.resolve(tok);
    return req("/auth/v1/token?grant_type=refresh_token", { method: "POST", auth: false, body: { refresh_token: tok.refresh_token } })
      .then(function (d) { tok = normSession(d); saveTok(tok); return tok; })
      .catch(function () { tok = null; saveTok(null); return null; });
  }
  function authed(fn) {
    return ensureFreshToken().then(function (t) {
      if (!t) throw new Error("Your session expired. Sign out and sign in again.");
      return fn();
    });
  }

  function rest(pathq, opts) { return req("/rest/v1" + pathq, opts); }
  function upsert(table, rows, conflict) {
    return rest("/" + table + (conflict ? "?on_conflict=" + conflict : ""), {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: rows
    });
  }

  var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  function genCode() { var c = ""; for (var i = 0; i < 8; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]; return c; }

  function memberList(hid) {
    return rest("/household_members?household_id=eq." + hid + "&select=user_id,role,joined_at").then(function (ms) {
      ms = ms || [];
      if (!ms.length) return [];
      var ids = ms.map(function (m) { return m.user_id; }).join(",");
      return rest("/profiles?id=in.(" + ids + ")&select=id,email").catch(function () { return []; }).then(function (ps) {
        var emap = {}; (ps || []).forEach(function (p) { emap[p.id] = p.email; });
        return ms.map(function (m) { return { id: m.user_id, email: emap[m.user_id] || "household member", role: m.role, joinedAt: Date.parse(m.joined_at) || Date.now() }; });
      });
    });
  }

  function latestInvite(hid) {
    return rest("/household_invites?household_id=eq." + hid + "&select=code,expires_at&order=created_at.desc&limit=1")
      .catch(function () { return []; })
      .then(function (rows) { return rows && rows[0] ? rows[0].code : ""; });
  }

  function nowIso() { return new Date().toISOString(); }
  function scopeHouseholdId(scope) { return String(scope).indexOf("house:") === 0 ? String(scope).slice(6) : null; }

  // Best-effort mirror of the snapshot into the normalized tables so the
  // database matches docs/supabase-schema.sql row-for-row. Snapshot push is
  // the source of truth; mirror failures never fail a sync.
  function mirrorRows(rows, hid) {
    if (!rows) return Promise.resolve();
    var uid = tok.user.id, ts = nowIso();
    function m(table, list, map) {
      if (!list || !list.length) return Promise.resolve();
      return upsert(table, list.slice(0, 500).map(map), "id").catch(function () {});
    }
    return Promise.all([
      m("bills", rows.bills, function (r) { return { id: r.id, user_id: uid, household_id: hid, month: r.month, name: r.name, amount: r.planned || 0, due_date: r.dueDate || null, repeat: r.repeat || "monthly", updated_by: uid, updated_at: ts }; }),
      m("income", rows.income, function (r) { return { id: r.id, user_id: uid, household_id: hid, month: r.month, name: r.name, amount: r.amount || 0, updated_by: uid, updated_at: ts }; }),
      m("expenses", rows.expenses, function (r) { return { id: r.id, user_id: uid, household_id: hid, bill_or_category_id: r.itemId || null, month: r.month, spent_on: r.date, amount: r.amount || 0, updated_by: uid, updated_at: ts }; }),
      m("subscriptions", rows.subscriptions, function (r) { return { id: r.id, user_id: uid, household_id: hid, name: r.name, amount: r.planned || 0, status: r.status || "active", updated_by: uid, updated_at: ts }; }),
      m("debts", rows.debts, function (r) { return { id: r.id, user_id: uid, household_id: hid, name: r.name, balance: r.balance || 0, apr: r.apr || 0, min_payment: r.minPayment || 0, updated_by: uid, updated_at: ts }; }),
      m("notes", rows.notes, function (r) { return { id: r.id, user_id: uid, household_id: hid, ref_id: r.refId || null, body: r.body || "", updated_by: uid, updated_at: ts }; })
    ]);
  }

  window.AllottedCloud = {
    name: "supabase",

    /* ---- auth ---- */
    signUp: function (email, pass) {
      return req("/auth/v1/signup", { method: "POST", auth: false, body: { email: String(email || "").trim().toLowerCase(), password: String(pass || "") } })
        .then(function (d) {
          if (d && d.access_token) { tok = normSession(d); saveTok(tok); return { user: tok.user }; }
          // Email confirmation is enabled on the project: no session yet.
          throw new Error("Account created. Check your email for the confirmation link, then sign in.");
        });
    },
    signIn: function (email, pass) {
      return req("/auth/v1/token?grant_type=password", { method: "POST", auth: false, body: { email: String(email || "").trim().toLowerCase(), password: String(pass || "") } })
        .then(function (d) { tok = normSession(d); saveTok(tok); return { user: tok.user }; });
    },
    signOut: function () {
      var t = tok; tok = null; saveTok(null);
      if (!t || !t.access_token) return Promise.resolve(true);
      return req("/auth/v1/logout", { method: "POST", headers: { Authorization: "Bearer " + t.access_token } })
        .catch(function () {}).then(function () { return true; });
    },
    getSession: function () {
      return ensureFreshToken().then(function (t) { return t && t.user ? { user: t.user } : null; });
    },
    resetPassword: function (email) {
      return req("/auth/v1/recover", { method: "POST", auth: false, body: { email: String(email || "").trim().toLowerCase() } })
        .then(function () { return { message: "Password reset email sent. Check your inbox." }; });
    },

    /* ---- sync ---- */
    push: function (scope, payload) {
      return authed(function () {
        var hid = scopeHouseholdId(scope);
        var row = { scope: scope, user_id: tok.user.id, household_id: hid, payload: payload, updated_at: nowIso() };
        return upsert("budget_snapshots", [row], "scope")
          .then(function () { return mirrorRows(payload && payload.rows, hid); })
          .then(function () { return Date.now(); });
      });
    },
    pull: function (scope) {
      return authed(function () {
        return rest("/budget_snapshots?scope=eq." + encodeURIComponent(scope) + "&select=payload,updated_at")
          .then(function (rows) {
            if (!rows || !rows.length) return null;
            return { payload: rows[0].payload, updatedAt: Date.parse(rows[0].updated_at) || Date.now() };
          });
      });
    },

    /* ---- household ---- */
    createHousehold: function (user, name) {
      return authed(function () {
        return rest("/households?select=id,name,created_by", {
          method: "POST", headers: { Prefer: "return=representation" },
          body: [{ name: (name || "").trim() || "Our household", created_by: user.id }]
        }).then(function (hs) {
          var h = hs[0];
          return rest("/household_members", { method: "POST", headers: { Prefer: "return=minimal" }, body: [{ household_id: h.id, user_id: user.id, role: "owner" }] })
            .then(function () {
              function tryInvite(attempt) {
                var code = genCode();
                return rest("/household_invites", { method: "POST", headers: { Prefer: "return=minimal" }, body: [{ code: code, household_id: h.id, created_by: user.id }] })
                  .then(function () { return code; })
                  .catch(function (e) { if (attempt < 3 && e && e.status === 409) return tryInvite(attempt + 1); throw e; });
              }
              return tryInvite(0);
            })
            .then(function (code) {
              return memberList(h.id).then(function (ms) {
                return { id: h.id, name: h.name, code: code, createdBy: h.created_by, members: ms };
              });
            });
        });
      });
    },
    joinHousehold: function (user, code) {
      return authed(function () {
        return req("/rest/v1/rpc/join_household", { method: "POST", body: { invite_code: String(code || "").trim().toUpperCase() } })
          .then(function (rows) {
            var r = rows && rows[0];
            if (!r) throw new Error("That invite code is not valid");
            return window.AllottedCloud.getHousehold(r.household_id);
          });
      });
    },
    getHousehold: function (hid) {
      return authed(function () {
        return rest("/households?id=eq." + hid + "&select=id,name,created_by").then(function (hs) {
          var h = hs && hs[0];
          if (!h) return null;
          return Promise.all([memberList(hid), latestInvite(hid)]).then(function (res) {
            return { id: h.id, name: h.name, code: res[1], createdBy: h.created_by, members: res[0] };
          });
        });
      });
    },
    leaveHousehold: function (user, hid) {
      return authed(function () {
        return rest("/household_members?household_id=eq." + hid + "&user_id=eq." + user.id, { method: "DELETE", headers: { Prefer: "return=minimal" } })
          .then(function () { return true; });
      });
    }
  };
})();
