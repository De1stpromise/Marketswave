-- ★★ RETIRE, NEVER DELETE — products (2026-09-16, PM tool revamp part 6).
--
-- A product that is no longer offered still has holders. Deleting it would orphan every
-- holding row (holdings.product_id references products(id) with no cascade) and, worse,
-- make every holder's portfolio unpriceable — `_shared/client-list.ts` already treats a
-- holding whose product is missing as "value unavailable", so a delete would turn a real
-- portfolio into an error state rather than a number.
--
-- Retirement is therefore a STATUS on the row:
--   * The product stays in the catalogue and stays priced, forever, for its holders.
--   * A holder can still SELL (execute-sell is deliberately NOT gated on this).
--   * No NEW allocation is accepted — enforced in request-allocation AND execute-buy,
--     so an already-pending request cannot be approved into a retired product either.
--
-- ★ WHAT DELIBERATELY DOES NOT CHANGE, because each would break a holder:
--   * refresh-market-data keeps pricing a retired market product. Stopping would freeze
--     every holder's value at the moment of retirement with nothing saying why.
--   * settleProduct()/settleAllProducts() are untouched — a retired appraisal product can
--     still receive a published NAV, which is the only way its holders' value moves at all.
--   * No cached figure references a product's status, so retiring one leaves nothing stale:
--     allocated_capital is derived from units x price on every read, and the price does not
--     change at retirement.
alter table public.products
  add column status text not null default 'active'
    check (status in ('active', 'retired')),
  add column retired_at timestamptz,
  add column retired_by uuid references auth.users(id),
  add column retired_by_email text,
  add column retired_reason text;

-- A retired row must carry its timestamp; an active one must not pretend to.
alter table public.products
  add constraint products_retired_requires_timestamp
    check ((status = 'retired') = (retired_at is not null));

create index if not exists products_status_idx on public.products (status);

comment on column public.products.status is
  'active | retired. Retired products keep their holders and keep being priced; they accept no new allocation (enforced in request-allocation and execute-buy). Never delete a product.';
