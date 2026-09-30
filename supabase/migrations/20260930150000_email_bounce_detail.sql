-- ★ Email delivery status in the inbox: the bounce reason (2026-09-30, register row 293).
--
-- receive-inbound-email has handled Resend's delivery events since the inbox consolidation (row
-- 217/218) — same endpoint, same Svix-verified secret — but the Resend webhook was only ever
-- subscribed to email.received, so delivery_status stayed NULL. The fix is to subscribe the
-- existing webhook to email.delivered / email.bounced / email.complained. What the schema lacked
-- was WHY a message bounced and WHEN: a bounce means the client did not receive that email, and a
-- PM needs the reason to act on it.
--
-- Opens are NOT tracked (operator's decision): email.opened is acknowledged and ignored from now
-- on. opened_at stays for the rows already written before this change.

alter table public.messages
  add column bounced_at timestamptz,
  add column bounce_reason text,
  add column complained_at timestamptz;
