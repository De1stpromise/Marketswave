-- ★ PM tool revamp, part 7 (2026-09-17) — PayPal USD joins the deposit routes.
--
-- ONE ROW IS THE WHOLE CHANGE, and that is the point of `deposit_routes` existing as a table
-- rather than a constant somewhere. Everything downstream reads it generically:
--
--   validation      — address_format 'evm', the SAME rule ETH and USDT-ERC-20 already use.
--                     add-deposit-address looks the format up from this row and hands it to
--                     _shared/deposit-address-validation.ts, so no validation code changes.
--                     Confirmed by test rather than assumed: verify-supabase-deposit-address-book
--                     adds a real PYUSD address, and refuses a TRON address on this route.
--   client picker   — deploy-capital.html renders the routes it reads from this table
--                     (selectTable('deposit_routes')), so the option appears with no page change.
--   request-deposit — validates the submitted currency+network against this table, not a list.
--   address book    — same generic read.
--
--   logo            — there is none, and none is invented. PYUSD is not a product and not a
--                     watchlist symbol, so nothing in the asset-logos chain has resolved a mark
--                     for it; AssetMark renders its monogram, exactly as it does for any symbol
--                     whose provider had nothing. If PYUSD is ever added to the catalogue as a
--                     real product, the existing chain resolves it then with no change here.
--
-- ★ PYUSD IS ERC-20 ONLY, DELIBERATELY. PayPal USD also exists on Solana, and that would be a
-- SECOND row with its own address format — Solana addresses are base58, neither 'evm' nor
-- 'tron', so it would need a real new validation rule. It is not added, because no Solana route
-- exists anywhere in this project and a route a client can pick must have an address format
-- that is genuinely validated. One currency, one network, one row.
insert into public.deposit_routes (currency, network, currency_name, network_label, address_format, display_order)
values ('PYUSD', 'ERC-20', 'PayPal USD', 'ERC-20 · Ethereum', 'evm', 5)
on conflict (currency, network) do nothing;
