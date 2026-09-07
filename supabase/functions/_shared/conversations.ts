// PM Compose Email + Company Announcements (2026-09-07). Extracted from
// receive-inbound-email's own original inline logic — reused, not duplicated, by both that
// function (inbound: real client_id resolved by looking up the sender's email) and
// send-conversation-reply's new compose mode (outbound: the real client_id is already known,
// since the PM picked a specific client from the real client list, so the lookup is skipped
// in favor of the value the caller already has).
//
// Finds an existing conversation for the given contact_email (Stage 1's own grouping rule —
// a unique index on lower(contact_email)) or creates a new one. When an existing conversation
// is missing a client_id or a subject, both are backfilled — mirrors the exact behavior
// receive-inbound-email already had, now shared rather than copied a second time.
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
      status: 'open'
    })
    .select('id')
    .single();
  if (createErr) throw new Error(createErr.message);
  return { conversationId: created.id, isNew: true };
}
