// UI Wiring — Stage 1 (2026-09-03). Shared async data-fetching + loading/error UI helper for
// client-facing dashboard pages wiring to real Supabase Edge Functions/tables. dashboard.html
// is the FIRST page wired to any Supabase backend logic (identity already flowed through the
// hybrid bridge — see dashboard.html's own inline script for that investigation's
// conclusion); this file is the canonical, reusable pattern every subsequent UI-wiring stage
// should import and reuse rather than re-deriving its own loading/error handling.
//
// Plain classic script (window.MarketswaveData), same loading convention as
// dashboard-sidebar.js/dashboard-notifications.js — NOT an ES module itself, so every
// existing page keeps loading it with a plain <script src="supabase-data.js"></script> tag,
// no new <script type="module"> needed anywhere. It reaches the real Supabase client the
// exact same way dashboard-sidebar.js's own signOutOfSupabaseAuth() already does: a dynamic
// import('./supabase-config.js') at the moment a real call is first made, not eagerly at page
// load — supabase-config.js remains the single source of truth for which Supabase project
// (local stack vs. real staging) and which session-persistence policy is in effect; this file
// deliberately does not duplicate that logic.
//
// ---- THE REUSABLE LOADING/ERROR PATTERN, documented here so future wiring stages can cite
// this comment directly instead of re-deriving the same design: ----
//
// MarketswaveData.renderAsyncBundle(regions, { load, render, skeletonHTML }) owns one or more
// DOM containers ("regions") for the duration of one async data load:
//   1. Immediately (synchronously) paints a Tailwind `animate-pulse` skeleton into every
//      region — Tailwind is already this page family's entire design system (loaded via the
//      CDN script tag every dashboard page already has), so this reuses an existing utility
//      class rather than inventing new CSS or a new visual language.
//   2. Calls `load()` (expected to return a Promise) exactly once.
//   3. On success, calls `render(data)` — the caller's own job is to paint whatever it wants
//      into the regions it owns; renderAsyncBundle does not prescribe a rendering shape.
//   4. On failure, paints a consistent error card (red-50/red-600, this project's own
//      existing error-color language — e.g. documents.html's own deadline-badge/support.html's
//      dispute-error already use this exact palette) into every region, with a "Try Again"
//      button that re-runs the WHOLE sequence from step 1. A failed call never leaves a
//      region silently blank or stuck on its last-good content.
// `regions` may be a single element or an array of elements that should all show the same
// loading/error state together (typically because they're fed by one combined data fetch —
// e.g. dashboard.html's TPV/allocation/risk/activity widgets, which all depend on the same
// account_state+holdings+products+transactions bundle and have no meaningful independent
// retry). For a widget with its OWN independent data source, call renderAsyncBundle again
// with its own `load`/`render` pair — nothing about this helper assumes one call per page.
//
// ---- THE REUSABLE WRITE-ACTION PATTERN (added UI Wiring Stage 2, 2026-09-03) — a genuine
// extension, not a page-specific fork, per instruction: asset-collection.html's Request
// Allocation and asset-performance.html's Sell are this project's first two real WRITE
// actions against Supabase, and renderAsyncBundle's own retry-by-re-running-`load()`
// semantics are the WRONG fit for a write — retrying a GET is safe to repeat automatically;
// blindly "retrying" a write the same way risks a real double-submission (two separate
// pending request rows from one logical attempt). A write action's real retry is just the
// user clicking the same button again, deliberately, not an automatic re-run. ----
//
// MarketswaveData.withButtonBusy(button, busyLabel, fn) wraps a single write attempt:
// disables `button`, swaps its label to a small inline `animate-spin` indicator + busyLabel
// (Tailwind again — no new spinner CSS invented, matching signup.html's own established
// "small spinning circle" convention for a button mid-submit, expressed via a Tailwind
// utility instead of that page's own custom CSS class), calls `fn()` (expected to return a
// Promise), and restores the button's original label/disabled state once `fn()` settles —
// success or failure. The CALLER still owns what happens on success/failure (a toast, a
// modal close, whatever fits) — this helper only owns the button's own in-flight visual
// state, exactly mirroring how renderAsyncBundle only owns a region's loading/error visual
// state and leaves `render()` to the caller.
//
// Error messages are classified (network/auth/forbidden/server/client) by classifyError()
// below so every page's error card reads a genuinely useful message instead of a raw
// exception string, without every page having to re-derive that classification itself.
(function () {
  var clientPromise = null;

  // Lazily creates (once) and reuses a single Supabase client instance for the lifetime of
  // the page — mirrors dashboard-sidebar.js's own dynamic-import technique exactly. Reusing
  // supabase-config.js means this file never has to know which project (local stack vs. real
  // staging) is active, or which session-persistence policy applies — that decision lives in
  // exactly one place, unchanged by this stage.
  function getSupabaseClient() {
    if (!clientPromise) {
      clientPromise = import('./supabase-config.js').then(function (mod) {
        return mod.supabase;
      });
    }
    return clientPromise;
  }

  // ---- useAdminClient() (added Admin UI Wiring Stage 1, 2026-09-03) — the "small, clearly-
  // scoped extension" investigated and confirmed necessary before this stage: every other
  // function in this file (callFunction/selectTable/insertRow/updateRow/deleteRow/
  // renderAsyncBundle/withButtonBusy/writeErrorMessage) already funnels through the ONE lazy
  // `clientPromise` above, so redirecting THAT to resolve to a real admin-authenticated
  // Supabase session is the entire extension needed — none of those other functions needed
  // any change at all. Admin pages call this ONCE, as the very first thing their own inline
  // script does, before any other MarketswaveData call.
  //
  // Reuses admin-supabase-config.js — rather than building a second, parallel
  // admin-Supabase-auth module. ensureSupabaseAdminSignedIn() is awaited before resolving, so
  // every subsequent call through this shared client is guaranteed to already carry a real
  // admin-claimed JWT — no caller of selectTable()/callFunction() needs its own "is the admin
  // session ready yet" check.
  //
  // ★ Admin Auth Consolidation (2026-09-05): ensureSupabaseAdminSignedIn() used to actively
  // SIGN IN here (local: silently, with a hardcoded credential; staging: a password-prompt
  // modal), since a real session wasn't otherwise guaranteed to exist yet. Now that a real
  // email/password sign-in on admin-login.html is the ONLY way to reach any admin page at all
  // (admin-sidebar.js's own gate redirects immediately otherwise), a real session already
  // exists by the time this function is ever called — ensureSupabaseAdminSignedIn() is now a
  // pure defense-in-depth confirmation, never an attempt to establish one itself. This
  // function's own call site/contract didn't need to change at all — see
  // admin-supabase-config.js's own header for the full writeup.
  function useAdminClient() {
    clientPromise = import('./admin-supabase-config.js').then(function (mod) {
      return mod.ensureSupabaseAdminSignedIn().then(function () {
        return mod.supabase;
      });
    });
  }

  // Normalizes a failed supabase-js call (Edge Function or direct table query) into a
  // consistent Error shape every page's error UI can branch on via `.kind`, without each page
  // re-deriving its own classification logic. `realMessage`, when given, wins over the raw
  // supabase-js error's own `.message` — see callFunction()'s own comment for why that's
  // usually necessary, not optional.
  function classifyError(error, realMessage) {
    var status = error && error.context && error.context.status;
    var e = new Error(realMessage || (error && error.message) || 'Request failed.');
    e.status = status || null;
    if (!status) e.kind = 'network';
    else if (status === 401) e.kind = 'auth';
    else if (status === 403) e.kind = 'forbidden';
    else if (status >= 500) e.kind = 'server';
    else e.kind = 'client';
    return e;
  }

  // Calls a real Edge Function. supabase-js automatically forwards the current session's
  // Authorization header — the caller of this function never handles a JWT directly, same
  // as every server-side function in this project already assumes a caller identity arrives
  // via the request's own Authorization header, never a client-supplied parameter.
  //
  // ---- A real gap found and fixed here in UI Wiring Stage 2, not present as a bug in
  // Stage 1's own page (dashboard.html never needed a write action's real validation
  // message) but load-bearing for every write action from this stage on: a failed Edge
  // Function call surfaces as a `FunctionsHttpError` whose OWN `.message` is ALWAYS the
  // literal, generic string "Edge Function returned a non-2xx status code" — confirmed
  // directly against the installed @supabase/functions-js source
  // (dist/module/types.js:69), not assumed. supabase-js does NOT parse the real response
  // body for you; every one of this project's own Edge Functions returns its real, specific
  // validation message as real JSON (`{ error: "..." }`), reachable only via
  // `error.context.json()` — `.context` is the raw fetch Response object (confirmed via
  // FunctionsClient.js:271, `throw new FunctionsHttpError(response)`). Without this fix,
  // every failed write action in this project would show the same useless generic string
  // instead of e.g. "Allocation amount exceeds current unallocated capital." — exactly the
  // real, specific, server-authoritative message this project's whole design depends on
  // showing. A network failure (FunctionsFetchError) passes a plain metadata object as
  // `.context`, not a Response — the `typeof ctx.json === 'function'` guard below correctly
  // skips reading a body that was never there. ----
  function callFunction(name, body) {
    return getSupabaseClient().then(function (client) {
      return client.functions.invoke(name, body === undefined ? undefined : { body: body });
    }).then(function (result) {
      if (result.error) {
        var ctx = result.error.context;
        if (ctx && typeof ctx.json === 'function') {
          return ctx.json().catch(function () { return null; }).then(function (parsedBody) {
            throw classifyError(result.error, parsedBody && parsedBody.error);
          });
        }
        throw classifyError(result.error);
      }
      return result.data;
    });
  }

  // Direct, RLS-authorized table read — for the established "RLS itself already permits this
  // read, no Edge Function needed" cases (e.g. products, browsable by every authenticated
  // client per Stage 1's own migration). `applyQuery(query)` may return a refined query
  // builder (e.g. .eq()/.order()); if it returns nothing, the base `select('*')` query runs
  // as-is.
  function selectTable(table, applyQuery) {
    return getSupabaseClient().then(function (client) {
      var query = client.from(table).select('*');
      if (typeof applyQuery === 'function') {
        var refined = applyQuery(query);
        if (refined) query = refined;
      }
      return query;
    }).then(function (result) {
      if (result.error) throw classifyError(result.error);
      return result.data || [];
    });
  }

  function friendlyMessage(err) {
    if (err && err.kind === 'auth') return 'Your session may have expired. Try refreshing the page.';
    if (err && err.kind === 'forbidden') return 'You don’t have access to this data.';
    if (err && err.kind === 'network') return 'Could not reach the server. Check your connection and try again.';
    if (err && err.kind === 'server') return 'The server ran into a problem. Please try again shortly.';
    return 'Something went wrong loading this data.';
  }

  function defaultSkeletonHTML() {
    return '<div class="animate-pulse space-y-2">' +
      '<div class="h-4 bg-slate-200 rounded w-3/4"></div>' +
      '<div class="h-4 bg-slate-200 rounded w-1/2"></div>' +
      '</div>';
  }

  function errorCardHTML(err) {
    return '<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm">' +
      '<p class="text-red-700 font-medium mb-1">Couldn’t load this data</p>' +
      '<p class="text-red-600 mb-3">' + friendlyMessage(err) + '</p>' +
      '<button type="button" data-retry class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition">Try Again</button>' +
      '</div>';
  }

  // regions: a single DOM element, or an array of DOM elements, that together represent one
  // logical async data load. options.load(): () => Promise<data>. options.render(data):
  // called once on success, responsible for painting real content into whichever of the
  // given regions it wants. options.skeletonHTML: optional override for the loading markup.
  function renderAsyncBundle(regions, options) {
    var list = Array.isArray(regions) ? regions : [regions];
    var load = options.load;
    var render = options.render;
    var skeletonHTML = options.skeletonHTML || defaultSkeletonHTML();

    function paint(html) {
      list.forEach(function (el) {
        if (el) el.innerHTML = html;
      });
    }

    function wireRetry() {
      list.forEach(function (el) {
        if (!el) return;
        var btn = el.querySelector('[data-retry]');
        if (btn) btn.addEventListener('click', attempt);
      });
    }

    function attempt() {
      paint(skeletonHTML);
      load().then(function (data) {
        render(data);
      }).catch(function (err) {
        paint(errorCardHTML(err));
        wireRetry();
      });
    }

    attempt();
  }

  // See this file's own "REUSABLE WRITE-ACTION PATTERN" header above for the full design —
  // owns only the button's in-flight visual state; the caller's `fn()` promise resolution/
  // rejection is what the caller itself reacts to (toast, modal close, etc.).
  function withButtonBusy(button, busyLabel, fn) {
    var originalHTML = button.innerHTML;
    var originalDisabled = button.disabled;
    button.disabled = true;
    button.innerHTML = '<span class="inline-flex items-center justify-center gap-1.5">' +
      '<span class="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>' +
      busyLabel + '</span>';
    return fn().finally(function () {
      button.disabled = originalDisabled;
      button.innerHTML = originalHTML;
    });
  }

  // For a write action's own error toast/message specifically: a 400/409 is a real,
  // server-computed business-rule rejection with a genuinely useful specific message (e.g.
  // "Allocation amount exceeds current unallocated capital.") — callFunction() above already
  // ensures `err.message` IS that real text, so it's shown verbatim, exactly matching how
  // this project's write actions have always shown a thrown validation error's own message.
  // A 401/403/network/500 has no useful business-specific text (there was no business logic
  // reached at all) — friendlyMessage()'s own generic-but-accurate copy is shown instead.
  function writeErrorMessage(err) {
    // 'client' covers every 4xx classifyError() doesn't special-case (400, 404, 409, etc.) —
    // 401/'auth' and 403/'forbidden' are their own kinds and correctly fall through to the
    // generic friendlyMessage() below instead, since those never reach real business logic.
    if (err && err.kind === 'client') return err.message;
    return friendlyMessage(err);
  }

  // ---- Direct RLS-authorized table WRITES (added UI Wiring Stage 4, 2026-09-03) — a genuine
  // extension, not a page-specific fork: every write action wired in Stages 2-3 went through a
  // real Edge Function (callFunction() above), because every one of those domains is a
  // request-then-approve queue deliberately gated server-side. Documents (Phase B Stage 6) is
  // architecturally different — a client's own upload/sign/remove are real, narrowly-scoped
  // direct table INSERT/UPDATE/DELETE, enforced by RLS policies alone, with no Edge Function in
  // front of them at all (see supabase/migrations/20260902160000_create_documents_and_support.sql's
  // own header for the full "why" — Documents & Support are not Approval Gate queues). These
  // three helpers are the first place this project's UI-wiring effort needs to perform a write
  // that ISN'T an Edge Function call, so they're added here rather than duplicated per-page.
  //
  // A rejected direct table write surfaces as a PostgREST error object (`{ message, details,
  // hint, code }`), a structurally different shape from a rejected Edge Function call — there is
  // no `.context` Response to read a real custom JSON error body from, since there's no
  // server-authored error text behind a raw table write the way every Edge Function's own
  // `{ error: "..." }` body provides; RLS itself never explains WHY a row was rejected, only
  // that it was. classifyPostgrestError() maps the real Postgres/PostgREST error codes this
  // project's own RLS policies and CHECK constraints can actually produce into the SAME
  // classifyError() `.kind` scheme, so writeErrorMessage()/renderAsyncBundle's error card stay
  // consistent regardless of which write mechanism a given page uses.
  function classifyPostgrestError(error) {
    if (!error) {
      var networkErr = new Error('Request failed.');
      networkErr.status = null;
      networkErr.kind = 'network';
      return networkErr;
    }
    var e = new Error(error.message || 'Request failed.');
    e.status = null;
    if (error.code === '42501') {
      // insufficient_privilege — an RLS policy's `using`/`with check` clause rejected the row.
      // Rewritten to a genuinely useful message, since Postgres's own raw text here
      // ("new row violates row-level security policy...") is implementation detail, not
      // something a client should ever see verbatim.
      e.kind = 'client';
      e.message = 'This action isn’t allowed for this document.';
    } else if (error.code === '23514' || error.code === '23502' || error.code === '23503') {
      // check_violation / not_null_violation / foreign_key_violation — a genuine, if generic,
      // business-rule rejection (e.g. an invalid category value) — real enough to show verbatim
      // via writeErrorMessage(), same as a 400/409 from an Edge Function.
      e.kind = 'client';
    } else if (error.code === 'PGRST301' || error.code === '401') {
      e.kind = 'auth';
    } else {
      e.kind = 'client';
    }
    return e;
  }

  // insertRow(table, values) — a client's own real, RLS-authorized INSERT. Returns the inserted
  // row (selected back, mirroring an Edge Function's own toClientShape() convenience).
  function insertRow(table, values) {
    return getSupabaseClient().then(function (client) {
      return client.from(table).insert(values).select().single();
    }).then(function (result) {
      if (result.error) throw classifyPostgrestError(result.error);
      return result.data;
    });
  }

  // updateRow(table, match, patch) — a client's own real, RLS-authorized UPDATE, scoped by
  // `match` (e.g. { id: docId }) exactly like supabase-js's own `.match()`. RLS's `using` clause
  // is what actually confines this to rows the caller is allowed to touch — `match` here is
  // just which row, not a substitute for that server-side check.
  function updateRow(table, match, patch) {
    return getSupabaseClient().then(function (client) {
      return client.from(table).update(patch).match(match).select().single();
    }).then(function (result) {
      if (result.error) throw classifyPostgrestError(result.error);
      return result.data;
    });
  }

  // deleteRow(table, match) — a client's own real, RLS-authorized DELETE, scoped by `match`.
  //
  // ★ A real gap found and fixed during UI Wiring Stage 4's own verification, not a bug in the
  // test: unlike an INSERT/UPDATE's `with check` (which genuinely THROWS when a row is rejected,
  // since the row would otherwise be written), a DELETE's `using` clause fails SILENTLY — a row
  // that doesn't satisfy the policy is simply not matched, not an error. Confirmed directly: a
  // client attempting to delete a document RLS scopes them out of (e.g. a "from Marketswave"
  // document, whose DELETE policy is scoped to direction='upload' only) got back a plain success
  // with zero rows affected — meaning the ORIGINAL version of this function would have resolved
  // successfully and the caller would have shown a genuine "Document Removed" toast for a
  // document that was never actually removed, a real false-success risk this project has treated
  // as seriously as a false-nonzero-value bug in every prior stage (e.g. the sidebar doc-badge
  // fix, register row 78). Fixed by chaining `.select()` after `.delete()` (the client already
  // has SELECT access to any row visible to them) and treating a genuinely empty result as a
  // real, thrown rejection — the same 'client'-kind classification an INSERT/UPDATE's own
  // WITH CHECK violation already produces, so writeErrorMessage() handles it identically.
  function deleteRow(table, match) {
    return getSupabaseClient().then(function (client) {
      return client.from(table).delete().match(match).select();
    }).then(function (result) {
      if (result.error) throw classifyPostgrestError(result.error);
      if (!result.data || result.data.length === 0) {
        var e = new Error('This action isn’t allowed for this document.');
        e.status = null;
        e.kind = 'client';
        throw e;
      }
      return true;
    });
  }

  // ---- Real Supabase Storage helpers (added 2026-09-04, Documents Storage integration) —
  // the reusable pattern for any page needing genuine file upload/download, cited directly
  // here rather than re-derived per page. Storage errors are a real, DIFFERENT shape from
  // both a rejected Edge Function call and a rejected PostgREST table write — confirmed
  // directly against the installed @supabase/storage-js source (src/lib/common/errors.ts):
  // a StorageError/StorageApiError carries `.status` (a real HTTP status number) and
  // `.message`, with no `.context` Response (unlike callFunction()'s errors) and no Postgres
  // error `.code` like '42501' (unlike insertRow()/updateRow()/deleteRow()'s errors) — so
  // classifyPostgrestError() above doesn't apply here; classifyStorageError() below reuses
  // classifyError()'s own status-number-to-kind mapping instead, the one part of that shape
  // storage errors and Edge Function errors genuinely share.
  function classifyStorageError(error) {
    if (!error) {
      var networkErr = new Error('Request failed.');
      networkErr.status = null;
      networkErr.kind = 'network';
      return networkErr;
    }
    var status = error.status;
    var e = new Error(error.message || 'Request failed.');
    e.status = status || null;
    if (!status) e.kind = 'network';
    else if (status === 401) e.kind = 'auth';
    else if (status === 403) e.kind = 'forbidden';
    else if (status >= 500) e.kind = 'server';
    else e.kind = 'client';
    return e;
  }

  // uploadFile(bucket, path, file) — a client's own real, RLS-authorized Storage upload
  // (`file` may be a browser File/Blob, uploaded as-is — supabase-js handles the body directly,
  // no manual base64/ArrayBuffer conversion needed for a client-side upload; an Edge Function
  // uploading on a caller's behalf, e.g. publish-document, base64-encodes instead, since its
  // own request body is plain JSON). Returns the real `{ path, id, fullPath }` the Storage API
  // hands back.
  function uploadFile(bucket, path, file) {
    return getSupabaseClient().then(function (client) {
      return client.storage.from(bucket).upload(path, file, {
        contentType: file.type || undefined,
        upsert: false
      });
    }).then(function (result) {
      if (result.error) throw classifyStorageError(result.error);
      return result.data;
    });
  }

  // getSignedDownloadUrl(bucket, path, expiresInSeconds) — the real, time-limited download
  // mechanism (Supabase Storage's standard `createSignedUrl`). Requires the caller's own
  // session to pass the bucket's real SELECT policy on storage.objects — RLS-enforced, exactly
  // like selectTable() above, not a bypass. Defaults to a short 60-second expiry: the caller is
  // expected to use the URL immediately (open it / trigger a download), not persist or share it.
  function getSignedDownloadUrl(bucket, path, expiresInSeconds) {
    return getSupabaseClient().then(function (client) {
      return client.storage.from(bucket).createSignedUrl(path, expiresInSeconds || 60);
    }).then(function (result) {
      if (result.error) throw classifyStorageError(result.error);
      return result.data.signedUrl;
    });
  }

  // deleteFile(bucket, path) — a client's own real, RLS-authorized Storage delete. Unlike
  // deleteRow() above, Storage's own remove() genuinely reports a rejected/no-op removal as a
  // real error rather than a silent empty success, so no analogous empty-result workaround is
  // needed here.
  function deleteFile(bucket, path) {
    return getSupabaseClient().then(function (client) {
      return client.storage.from(bucket).remove([path]);
    }).then(function (result) {
      if (result.error) throw classifyStorageError(result.error);
      return true;
    });
  }

  window.MarketswaveData = {
    getSupabaseClient: getSupabaseClient,
    useAdminClient: useAdminClient,
    callFunction: callFunction,
    selectTable: selectTable,
    insertRow: insertRow,
    updateRow: updateRow,
    deleteRow: deleteRow,
    uploadFile: uploadFile,
    getSignedDownloadUrl: getSignedDownloadUrl,
    deleteFile: deleteFile,
    renderAsyncBundle: renderAsyncBundle,
    withButtonBusy: withButtonBusy,
    classifyError: classifyError,
    friendlyMessage: friendlyMessage,
    writeErrorMessage: writeErrorMessage
  };
})();
