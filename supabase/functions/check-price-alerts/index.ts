// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — THE SCHEDULED ALERT SWEEP.
//
// Runs two minutes after refresh-market-data on the same quarter-hour cycle, so it always
// reads prices that run has already written rather than racing it.
//
// DELIBERATELY A SEPARATE FUNCTION FROM THE REFRESH, not a tail section of it: one provider
// being unreachable must not also silence every alert the OTHER provider's prices would
// legitimately have fired.
//
// ★ FIRE ONCE, THEN CLEAR — the rule the whole alert feature is built around, enforced in
// the one place a race could break it: the status flip is an UPDATE conditioned on
// status = 'active' with .select(), so two overlapping sweeps cannot both claim the same
// alert, and an email is only sent for an alert this run genuinely won. A repeating alert
// on a volatile symbol would be a spam machine, and this sends real email.
//
// ★ ALERTS INHERIT THE ROUND-ROBIN REFRESH (2026-09-12). This sweep compares against the
// CACHED price, and the refresh now prices the oldest N stock symbols per cycle rather than
// all of them. An alert on a stock symbol the rotation reaches every 45 minutes can only
// fire with 45-minute granularity: a target crossed and re-crossed between two refreshes
// is never seen, and one crossed for good fires on the next cycle that reaches the symbol —
// later, never wrongly. Crypto is unaffected (every coin refreshes every cycle). Recorded in
// the Backend Requirements Register alongside the alert feature so a delayed alert is read
// as this design, not as a bug.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { authorizeScheduledCall } from '../_shared/scheduler-auth.ts';
import { sendEmail, renderEmail, siteLink } from '../_shared/send-email.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const auth = await authorizeScheduledCall(req);
    if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: alerts, error: alertErr } = await admin
      .from('price_alerts')
      .select('*')
      .eq('status', 'active');
    if (alertErr) return jsonResponse({ error: alertErr.message }, 500);

    if (!alerts || alerts.length === 0) {
      return jsonResponse({ checked: 0, fired: 0, alerts: [], via: auth.via }, 200);
    }

    const symbols = Array.from(new Set(alerts.map((a: Record<string, unknown>) => a.symbol as string)));
    const { data: prices, error: priceErr } = await admin
      .from('market_data_cache')
      .select('symbol, value, name, asset_type, last_updated')
      .in('symbol', symbols);
    if (priceErr) return jsonResponse({ error: priceErr.message }, 500);

    const priceBySymbol: Record<string, Record<string, unknown>> = {};
    for (const row of prices || []) priceBySymbol[row.symbol as string] = row;

    const fired: Array<Record<string, unknown>> = [];

    for (const alert of alerts) {
      const row = priceBySymbol[alert.symbol as string];
      // No cached price means the refresh has not managed to price this symbol yet. Not
      // firing is the only honest option — the alternative is inventing a comparison.
      if (!row || row.value == null) continue;

      const price = Number(row.value);
      const target = Number(alert.target_price);
      const hit = alert.direction === 'above' ? price >= target : price <= target;
      if (!hit) continue;

      // The claim: flip this alert to fired, but only if it is STILL active. A second
      // concurrent sweep gets zero rows back here and sends nothing.
      const { data: claimed, error: claimErr } = await admin
        .from('price_alerts')
        .update({ status: 'fired', fired_at: new Date().toISOString(), fired_price: price })
        .eq('id', alert.id)
        .eq('status', 'active')
        .select();
      if (claimErr || !claimed || claimed.length === 0) continue;

      fired.push({ id: alert.id, symbol: alert.symbol, direction: alert.direction, target, price });

      // Best-effort email, exactly like every other notification in this project: the alert
      // has genuinely fired and genuinely cleared regardless of whether the mail lands, and
      // sendEmail() records a real 'failed' row rather than throwing.
      const { data: client } = await admin
        .from('clients')
        .select('name, email')
        .eq('id', alert.client_id)
        .maybeSingle();
      if (!client || !client.email) continue;

      const displayName = (row.name as string) || (alert.symbol as string);
      const formattedPrice = formatUsd(price, row.asset_type as string);
      const formattedTarget = formatUsd(target, row.asset_type as string);
      const directionWord = alert.direction === 'above' ? 'risen above' : 'fallen below';

      const { html, text } = renderEmail({
        heading: alert.symbol + ' has ' + directionWord + ' your target',
        introParagraphs: [
          'Hi ' + (client.name || 'there') + ', the price alert you set on ' + displayName +
            ' (' + alert.symbol + ') has been reached.'
        ],
        detailRows: [
          { label: 'Symbol', value: alert.symbol + ' — ' + displayName },
          { label: 'Your alert', value: (alert.direction === 'above' ? 'Rises above ' : 'Falls below ') + formattedTarget },
          { label: 'Price when it fired', value: formattedPrice }
        ],
        callout: {
          title: 'This alert has now cleared',
          body: 'Price alerts fire once and then clear, so you will not receive this again. ' +
            'Set a new alert from your dashboard whenever you want to watch this symbol again.'
        },
        cta: { text: 'Open your dashboard', href: siteLink('dashboard.html') },
        footerType: 'investment'
      });

      await sendEmail(admin, {
        to: client.email,
        subject: alert.symbol + ' has ' + directionWord + ' ' + formattedTarget,
        html,
        text,
        relatedEntityType: 'price_alert',
        relatedEntityId: alert.id as string
      });
    }

    return jsonResponse({ checked: alerts.length, fired: fired.length, alerts: fired, via: auth.via }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Crypto is quoted whole-dollar in this project's own card convention; an equity quote
// keeps its cents. Same rule the dashboard card itself uses, so the email and the screen
// never disagree about what a price looks like.
function formatUsd(value: number, assetType: string): string {
  if (assetType === 'crypto') {
    return '$' + Math.round(value).toLocaleString('en-US');
  }
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
