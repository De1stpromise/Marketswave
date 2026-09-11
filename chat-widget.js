// Unified Communications Inbox — Stage 1 (2026-09-07). Shared live-chat widget, mounted via
// <div id="chat-widget-mount"></div> + initChatWidget() — same mount-point convention this
// project already established for dashboard-sidebar.js/dashboard-notifications.js. Works in
// TWO real contexts from the same file:
//   - AUTHENTICATED (a client dashboard page, engine-core.js + supabase-data.js already
//     loaded): identity comes from the real session, no pre-chat form — mirrors
//     start-chat-conversation's own server-side identity resolution for this exact case.
//   - ANONYMOUS (a public marketing page): a real Supabase Anonymous Sign-in session (see
//     the migration's own header for the full "why") plus a small pre-chat name/email form.
//
// A REAL, DELIBERATE EXCEPTION to the public site's own "no Tailwind, custom CSS only, no
// backend SDK" boundary (CLAUDE.md's own documented rule, previously scoped to
// signup.html/login.html ONLY) — this widget is the second real, disclosed exception, using
// the exact same supabase-config.js bootstrap those two pages already established rather than
// inventing a third one. Styling stays plain CSS (chat-widget.css), never Tailwind, so it
// never blurs the actual styling boundary, only the "which pages load a backend SDK" one —
// and only for this one, narrowly-scoped, genuinely site-wide feature.
(function () {
  'use strict';

  let clientPromise = null;
  function getClient() {
    if (typeof MarketswaveData !== 'undefined') {
      return MarketswaveData.getSupabaseClient();
    }
    if (!clientPromise) {
      clientPromise = import('./supabase-config.js').then(function (mod) { return mod.supabase; });
    }
    return clientPromise;
  }

  function isAuthenticatedContext() {
    return typeof getAuthenticatedClientId === 'function' && !!getAuthenticatedClientId();
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value == null ? '' : value);
    return div.innerHTML;
  }

  function initChatWidget() {
    const mount = document.getElementById('chat-widget-mount');
    if (!mount) return;

    mount.innerHTML =
      '<div id="chat-widget-root">' +
      '  <button type="button" id="chat-widget-bubble" aria-label="Open live chat">' +
      '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>' +
      '    <span id="chat-widget-unread-badge" style="display:none;"></span>' +
      '  </button>' +
      '  <div id="chat-widget-panel">' +
      '    <div id="chat-widget-header">' +
      '      <div><p class="title">Marketswave Live Chat</p><p class="status" id="chat-widget-status">Offline</p></div>' +
      '      <button type="button" id="chat-widget-close" aria-label="Close chat">&times;</button>' +
      '    </div>' +
      '    <div id="chat-widget-precontact">' +
      '      <p>Enter your name and email to start a live chat with our team.</p>' +
      '      <label class="cw-sr-only" for="chat-widget-name">Your name</label>' +
      '      <input type="text" id="chat-widget-name" placeholder="Your name" autocomplete="name">' +
      '      <label class="cw-sr-only" for="chat-widget-email">Your email address</label>' +
      '      <input type="email" id="chat-widget-email" placeholder="you@example.com" autocomplete="email">' +
      '      <p id="chat-widget-precontact-error"></p>' +
      '      <button type="button" id="chat-widget-start-btn">Start Chat</button>' +
      '    </div>' +
      '    <div id="chat-widget-body" style="display:none;"></div>' +
      '    <div id="chat-widget-footer" style="display:none;">' +
      '      <label class="cw-sr-only" for="chat-widget-input">Type a message</label>' +
      '      <input type="text" id="chat-widget-input" placeholder="Type a message...">' +
      '      <button type="button" id="chat-widget-send">Send</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    const bubble = document.getElementById('chat-widget-bubble');
    const unreadBadge = document.getElementById('chat-widget-unread-badge');
    const panel = document.getElementById('chat-widget-panel');
    const closeBtn = document.getElementById('chat-widget-close');
    const statusEl = document.getElementById('chat-widget-status');
    const precontact = document.getElementById('chat-widget-precontact');
    const nameInput = document.getElementById('chat-widget-name');
    const emailInput = document.getElementById('chat-widget-email');
    const precontactError = document.getElementById('chat-widget-precontact-error');
    const startBtn = document.getElementById('chat-widget-start-btn');
    const bodyEl = document.getElementById('chat-widget-body');
    const footerEl = document.getElementById('chat-widget-footer');
    const input = document.getElementById('chat-widget-input');
    const sendBtn = document.getElementById('chat-widget-send');

    let conversationId = null;
    let authorizedForHistory = false;
    let realtimeChannel = null;
    let renderedMessageIds = new Set();
    let unreadCount = 0;
    let panelOpen = false;

    function setStatus(text) { statusEl.textContent = text; }

    function bumpUnread() {
      if (panelOpen) return;
      unreadCount++;
      unreadBadge.textContent = String(unreadCount);
      unreadBadge.style.display = 'flex';
    }
    function clearUnread() {
      unreadCount = 0;
      unreadBadge.style.display = 'none';
    }

    function addSystemMessage(text) {
      const row = document.createElement('div');
      row.className = 'chat-widget-system-msg';
      row.textContent = text;
      bodyEl.appendChild(row);
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }

    function addMessage(msg) {
      if (renderedMessageIds.has(msg.id)) return;
      renderedMessageIds.add(msg.id);
      const row = document.createElement('div');
      row.className = 'chat-widget-msg-row is-' + msg.direction;
      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'chat-widget-msg-bubble';
      bubbleEl.textContent = msg.body;
      row.appendChild(bubbleEl);
      bodyEl.appendChild(row);
      bodyEl.scrollTop = bodyEl.scrollHeight;
      if (msg.direction === 'outbound') bumpUnread();
    }

    function subscribeRealtime(client, convoId) {
      if (realtimeChannel) client.removeChannel(realtimeChannel);
      realtimeChannel = client
        .channel('chat-widget-' + convoId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + convoId }, function (payload) {
          addMessage(payload.new);
        })
        .subscribe(function (status) {
          if (status === 'SUBSCRIBED') setStatus('Online');
        });
    }

    function openConversation(client, resolvedContactName, resolvedContactEmail, resolvedConvoId, history, authorized) {
      conversationId = resolvedConvoId;
      authorizedForHistory = authorized;
      precontact.style.display = 'none';
      bodyEl.style.display = 'flex';
      footerEl.style.display = 'flex';
      bodyEl.innerHTML = '';
      renderedMessageIds = new Set();
      if (authorized && history && history.length) {
        history.forEach(addMessage);
      } else if (authorized) {
        addSystemMessage('Send a message to start the conversation.');
      } else {
        addSystemMessage('Continuing an existing conversation for this email — send a message to reach our team.');
      }
      subscribeRealtime(client, resolvedConvoId);
    }

    async function startChat(anonymousBody) {
      setStatus('Connecting...');
      const client = await getClient();
      if (anonymousBody) {
        const { data: sessionData } = await client.auth.getSession();
        if (!sessionData || !sessionData.session) {
          const { error: anonErr } = await client.auth.signInAnonymously();
          if (anonErr) {
            setStatus('Offline');
            precontactError.textContent = 'Unable to start chat right now. Please try again.';
            precontactError.classList.add('is-visible');
            return;
          }
        }
      }
      const { data, error } = await client.functions.invoke('start-chat-conversation', anonymousBody ? { body: anonymousBody } : undefined);
      if (error || !data) {
        setStatus('Offline');
        precontactError.textContent = 'Unable to start chat right now. Please try again.';
        precontactError.classList.add('is-visible');
        return;
      }
      openConversation(client, data.contactName, data.contactEmail, data.conversationId, data.messages, data.authorizedForHistory);
    }

    async function sendMessage() {
      const text = input.value.trim();
      if (!text || !conversationId) return;
      input.value = '';
      sendBtn.disabled = true;
      const client = await getClient();
      const { data: sent, error } = await client
        .from('messages')
        .insert({ conversation_id: conversationId, channel: 'chat', direction: 'inbound', body: text })
        .select()
        .single();
      sendBtn.disabled = false;
      if (error) {
        addSystemMessage('Message failed to send. Please try again.');
        return;
      }
      addMessage(sent);
      // Best-effort, fire-and-forget — mirrors this project's own established
      // notify-new-document-upload/notify-new-client-application pattern exactly. The real
      // server-side debounce (see notify-new-chat-message's own header) means this is safe
      // to call after every single message with no client-side throttling needed.
      client.functions.invoke('notify-new-chat-message', { body: { conversationId: conversationId } }).catch(function () {});
    }

    bubble.addEventListener('click', function () {
      panelOpen = !panelOpen;
      panel.classList.toggle('is-open', panelOpen);
      if (panelOpen) {
        clearUnread();
        if (!conversationId && isAuthenticatedContext()) {
          startChat(null);
        }
      }
    });
    closeBtn.addEventListener('click', function () {
      panelOpen = false;
      panel.classList.remove('is-open');
    });

    startBtn.addEventListener('click', function () {
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      precontactError.classList.remove('is-visible');
      if (!name) {
        precontactError.textContent = 'Please enter your name.';
        precontactError.classList.add('is-visible');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        precontactError.textContent = 'Please enter a valid email address.';
        precontactError.classList.add('is-visible');
        return;
      }
      startBtn.disabled = true;
      startChat({ contactEmail: email, contactName: name }).finally(function () {
        startBtn.disabled = false;
      });
    });

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendMessage();
    });

    if (isAuthenticatedContext()) {
      precontact.style.display = 'none';
    }
  }

  window.initChatWidget = initChatWidget;
})();
