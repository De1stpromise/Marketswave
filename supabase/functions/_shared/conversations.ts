// PM Compose Email + Company Announcements (2026-09-07). Extracted from
// receive-inbound-email's own original inline logic — reused, not duplicated, by both that
// function (inbound: real client_id resolved by looking up the sender's email) and
// send-conversation-reply's new compose mode (outbound: the real client_id is already known,
// since the PM picked a specific client from the real client list, so the lookup is skipped
// in favor of the value the caller already has).
//
// ★ PM tool revamp, part 1 (2026-09-14) — tickets are conversations now (`kind = 'ticket'`),
// and the grouping rule is "one GENERAL thread per contact_email", not "one conversation":
// every lookup here excludes tickets, or a `.maybeSingle()` would throw the moment a client
// filed their first ticket beside their chat. Two helpers were added for the same reason:
// `nextTicketDisplayId()` (DISP-0001, sequential per client — support_requests' own rule,
// now scanning conversations) and `resolveInboundConversation()` (which thread an inbound
// email belongs to: the message it replies to first, then a DISP id in its subject, then the
// sender's general thread — never a new, unlinked conversation for a reply to a ticket).
export async function findOrCreateConversation(
  admin: any,
  params: {
    email: string;
    name: string | null;
    subject: string | null;
    // If the caller already knows the real client (e.g. a PM picked one from the real client
    // list), pass it directly — skips the email-based lookup. If omitted, resolved by looking
    // up a real `clients` row matching `email` (the inbound-webhook case, where there is no
    // authenticated caller to already know this from).
    clientId?: string | null;
    // How a NEW thread starts, when one has to be created: 'email' for an inbound email or a
    // PM compose, 'chat' otherwise. Ignored when the contact's general thread already exists —
    // rail placement follows the most recent message, not this column.
    kind?: 'chat' | 'email';
  }
): Promise<{ conversationId: string; isNew: boolean }> {
  const { email, name, subject } = params;

  let realClientId: string | null = params.clientId ?? null;
  if (realClientId === null && params.clientId === undefined) {
    const { data: matchingClient } = await admin.from('clients').select('id').ilike('email', email).maybeSingle();
    realClientId = matchingClient ? matchingClient.id : null;
  }

  const { data: existing, error: findErr } = await admin
    .from('conversations')
    .select('id, client_id, subject')
    .ilike('contact_email', email)
    .neq('kind', 'ticket')
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (realClientId && !existing.client_id) patch.client_id = realClientId;
    if (subject && !existing.subject) patch.subject = subject;
    if (Object.keys(patch).length) {
      await admin.from('conversations').update(patch).eq('id', existing.id);
    }
    return { conversationId: existing.id, isNew: false };
  }

  const { data: created, error: createErr } = await admin
    .from('conversations')
    .insert({
      client_id: realClientId,
      contact_email: email,
      contact_name: name || email,
      subject: subject,
      status: 'open',
      kind: params.kind || 'chat'
    })
    .select('id')
    .single();
  if (createErr) throw new Error(createErr.message);
  return { conversationId: created.id, isNew: true };
}

// DISP-0001, DISP-0002 … per client — the same scan-max-and-increment support_requests used,
// over the tickets this client already has in `conversations` (migrated ones included, so a
// client whose old queue reached DISP-0003 files DISP-0004 next, never a second DISP-0001).
export async function nextTicketDisplayId(admin: any, clientId: string): Promise<string> {
  const { data: existing, error } = await admin
    .from('conversations')
    .select('display_id')
    .eq('client_id', clientId)
    .eq('kind', 'ticket');
  if (error) throw new Error(error.message);
  let maxNum = 0;
  const re = /^DISP-(\d+)$/;
  (existing || []).forEach((r: { display_id: string | null }) => {
    const match = r.display_id ? re.exec(r.display_id) : null;
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  });
  return 'DISP-' + String(maxNum + 1).padStart(4, '0');
}

// Which conversation does an inbound email belong to? In order:
//   1. the message it replies to — any id in In-Reply-To / References that matches a stored
//      messages.message_id (a PM's own reply, or a ticket status email) names the thread
//      exactly, ticket or general;
//   2. a ticket id in the subject ("Re: DISP-0003 · Transaction Issue") from the client who
//      owns that ticket — covers a client who starts a fresh email quoting their case id;
//   3. the sender's general thread, created if none exists (a cold email from anyone).
// Returns the id plus which rule matched, so a caller can say why.
export async function resolveInboundConversation(
  admin: any,
  params: { fromEmail: string; fromName: string | null; subject: string | null; inReplyTo: string | null; references: string | null }
): Promise<{ conversationId: string; matchedBy: 'reply-header' | 'subject-ticket-id' | 'contact-email'; isNew: boolean }> {
  const ids = new Set<string>();
  for (const raw of [params.inReplyTo, params.references]) {
    if (!raw) continue;
    raw.split(/\s+/).map((x) => x.trim()).filter(Boolean).forEach((x) => ids.add(x));
  }
  if (ids.size) {
    const { data: hit } = await admin
      .from('messages')
      .select('conversation_id')
      .in('message_id', Array.from(ids))
      .limit(1)
      .maybeSingle();
    if (hit && hit.conversation_id) return { conversationId: hit.conversation_id, matchedBy: 'reply-header', isNew: false };
  }

  const subjectId = params.subject ? /\bDISP-\d{4}\b/.exec(params.subject) : null;
  if (subjectId) {
    const { data: ticket } = await admin
      .from('conversations')
      .select('id')
      .eq('kind', 'ticket')
      .eq('display_id', subjectId[0])
      .ilike('contact_email', params.fromEmail)
      .limit(1)
      .maybeSingle();
    if (ticket) return { conversationId: ticket.id, matchedBy: 'subject-ticket-id', isNew: false };
  }

  const general = await findOrCreateConversation(admin, { email: params.fromEmail, name: params.fromName, subject: params.subject, kind: 'email' });
  return { conversationId: general.conversationId, matchedBy: 'contact-email', isNew: general.isNew };
}
