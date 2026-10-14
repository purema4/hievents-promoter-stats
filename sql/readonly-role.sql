-- Run once against the Hi.Events database as a superuser / the database owner.
-- Creates a login that can only read the columns this app needs: no customer names, emails or addresses.
-- Replace the password before running. Run it connected to the Hi.Events database (whatever its name).

CREATE ROLE promoter_stats LOGIN PASSWORD 'change-me';
ALTER ROLE promoter_stats SET default_transaction_read_only = on;

DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO promoter_stats', current_database()); END $$;
GRANT USAGE ON SCHEMA public TO promoter_stats;

GRANT SELECT (id, account_id, title, start_date, timezone, currency, deleted_at) ON events TO promoter_stats;
GRANT SELECT (event_id, start_date, end_date, deleted_at) ON event_occurrences TO promoter_stats;
GRANT SELECT (id, code, event_id, order_usage_count, deleted_at) ON promo_codes TO promoter_stats;
GRANT SELECT (id, entity_id, entity_type, type, path, deleted_at) ON images TO promoter_stats;
GRANT SELECT (id, event_id, promo_code_id, status, total_before_additions, total_gross, total_refunded, created_at, deleted_at) ON orders TO promoter_stats;
GRANT SELECT (order_id, quantity, price, price_before_discount, deleted_at) ON order_items TO promoter_stats;
GRANT SELECT (id, order_id, event_id, status, deleted_at) ON attendees TO promoter_stats;

-- To remove it later:
--   REVOKE ALL ON events, event_occurrences, promo_codes, orders, order_items, attendees, images FROM promoter_stats;
--   REVOKE ALL ON SCHEMA public FROM promoter_stats;
--   DO $$ BEGIN EXECUTE format('REVOKE ALL ON DATABASE %I FROM promoter_stats', current_database()); END $$;
--   DROP ROLE promoter_stats;
