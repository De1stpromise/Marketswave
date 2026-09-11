// ★ Product catalog — live pricing, part 1 (2026-09-11).
//
// After that change no seeded Stocks & ETFs / Crypto product ticks any more — they are all
// market-priced, and PE / Real Assets move only on a published NAV. The GBM tick still
// exists (pricing_model = 'simulated', legacy-only, not creatable through add-product), and
// several regression suites exist specifically to prove properties OF that tick: settlement
// determinism across the real engine-core.js and the deployed stack, the invertible
// unit-price series, and the row-143 regression that "the classes not carved out still
// tick". Those assertions are still worth keeping, so each such suite now creates a
// temporary, genuinely-simulated product here rather than borrowing PROD-0003/PROD-0004 —
// which would now silently test a product that never ticks.
//
// Inserted directly via service_role (add-product refuses 'simulated' by design). The id is
// deliberately outside the PROD-XXXX numbering so add-product's scan-and-increment never
// sees it. Callers MUST delete it in their own finally block (deleteSimulatedTestProduct).
export async function createSimulatedTestProduct(admin, suffix, overrides = {}) {
  const row = Object.assign({
    id: 'PROD-SIM-' + suffix.toUpperCase(),
    name: 'Simulated Tick Test ' + suffix,
    asset_class: 'Stocks & ETFs',
    investment_type: 'Index Fund',
    risk_tier: 'balanced',
    minimum_investment: 100,
    unit_price: 103.16,
    inception_unit_price: 100,
    created_at: '2026-08-01',
    last_tick_date: new Date().toISOString().slice(0, 10),
    pricing_model: 'simulated',
    ticker: null
  }, overrides);
  const { data, error } = await admin.from('products').insert(row).select().single();
  if (error) throw new Error('createSimulatedTestProduct: ' + error.message);
  return data;
}

export async function deleteSimulatedTestProduct(admin, id) {
  if (!id) return;
  await admin.from('holdings').delete().eq('product_id', id);
  await admin.from('transactions').delete().eq('product_id', id);
  await admin.from('allocation_requests').delete().eq('product_id', id);
  await admin.from('sell_requests').delete().eq('product_id', id);
  await admin.from('nav_publications').delete().eq('product_id', id);
  const { error } = await admin.from('products').delete().eq('id', id);
  if (error) console.log('  cleanup: deleteSimulatedTestProduct(' + id + ') -> ' + error.message);
}
