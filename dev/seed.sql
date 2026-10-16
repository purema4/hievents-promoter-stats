-- Minimal slice of the Hi.Events schema with sample data, for local development only.
CREATE TABLE events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id integer NOT NULL, title varchar(255) NOT NULL,
  start_date timestamp, timezone varchar, currency varchar(3) NOT NULL DEFAULT 'CAD', status varchar(20) NOT NULL DEFAULT 'LIVE',
  deleted_at timestamp
);
CREATE TABLE event_occurrences (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event_id bigint NOT NULL REFERENCES events, start_date timestamp NOT NULL,
  end_date timestamp, deleted_at timestamp
);
CREATE TABLE promo_codes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, code varchar(50) NOT NULL, event_id bigint NOT NULL REFERENCES events,
  order_usage_count integer NOT NULL DEFAULT 0, deleted_at timestamp
);
CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event_id integer NOT NULL REFERENCES events, promo_code_id integer REFERENCES promo_codes,
  status varchar NOT NULL, total_before_additions numeric(14,2) NOT NULL DEFAULT 0, total_gross numeric(14,2) NOT NULL DEFAULT 0,
  total_refunded numeric(14,2) NOT NULL DEFAULT 0, first_name varchar(50), email varchar(255),
  created_at timestamp NOT NULL DEFAULT now(), deleted_at timestamp
);
CREATE TABLE order_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id integer NOT NULL REFERENCES orders, item_name varchar,
  quantity integer NOT NULL, price numeric(14,2) NOT NULL, price_before_discount numeric(14,2), deleted_at timestamp
);
CREATE TABLE images (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, entity_id bigint, entity_type varchar(120), type varchar(40),
  path text, deleted_at timestamp
);
CREATE TABLE attendees (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id integer NOT NULL REFERENCES orders, event_id integer NOT NULL REFERENCES events,
  status varchar(20) NOT NULL, email varchar(255) NOT NULL DEFAULT 'guest@example.com', deleted_at timestamp
);

-- Dates are relative to today so the sandbox always has one past event and two upcoming ones.
INSERT INTO events (account_id, title, timezone) VALUES
  (1, 'Warehouse Night', 'America/Toronto'),
  (1, 'Winter Opening', 'America/Toronto'),
  (2, 'Someone else''s event', 'America/Toronto'),
  (1, 'Summer Rooftop', 'America/Toronto');
-- Not published yet: kept off promoters' public pages.
INSERT INTO events (account_id, title, timezone, status) VALUES (1, 'Secret Afterparty', 'America/Toronto', 'DRAFT');

-- Hi.Events keeps dates per occurrence; Winter Opening runs two nights.
INSERT INTO event_occurrences (event_id, start_date, end_date) VALUES
  (1, date_trunc('day', now()) + interval '17 days 3 hours', date_trunc('day', now()) + interval '17 days 9 hours'),
  (2, date_trunc('day', now()) + interval '60 days 3 hours', date_trunc('day', now()) + interval '60 days 9 hours'),
  (2, date_trunc('day', now()) + interval '61 days 3 hours', date_trunc('day', now()) + interval '61 days 9 hours'),
  (3, date_trunc('day', now()) + interval '37 days 3 hours', NULL),
  (4, date_trunc('day', now()) - interval '70 days' + interval '23 hours', date_trunc('day', now()) - interval '69 days' + interval '5 hours'),
  (5, date_trunc('day', now()) + interval '20 days 3 hours', date_trunc('day', now()) + interval '20 days 9 hours');

INSERT INTO promo_codes (code, event_id, order_usage_count) VALUES
  ('DJMAX', 1, 4), ('djmax', 2, 1), ('LUNA', 1, 1), ('DJMAX', 3, 1), ('DJMAX', 4, 2);
-- For public pages: on an upcoming event, a past one and a draft; no sales.
INSERT INTO promo_codes (code, event_id) VALUES ('NOVA', 1), ('NOVA', 4), ('NOVA', 5);

-- total_before_additions is after discounts, before taxes and fees; total_gross adds those on top.
-- Each $25 ticket was bought with a 10% code, so it sold for $22.50 (price_before_discount 25.00).
INSERT INTO orders (event_id, promo_code_id, status, total_before_additions, total_gross, total_refunded, first_name, email, created_at) VALUES
  (1, 1, 'COMPLETED', 45.00, 51.75, 0, 'Ana', 'ana@example.com', now() - interval '12 days'),                 -- 2 tickets
  (1, 1, 'COMPLETED', 45.00, 51.75, 25.875, 'Ben', 'ben@example.com', now() - interval '9 days'),            -- 1 of 2 refunded
  (1, 1, 'AWAITING_OFFLINE_PAYMENT', 22.50, 25.88, 0, 'Cy', 'cy@example.com', now() - interval '2 days'),    -- pending
  (1, 1, 'CANCELLED', 22.50, 25.88, 25.88, 'Di', 'di@example.com', now() - interval '8 days'),               -- ignored
  (2, 2, 'COMPLETED', 9.00, 10.35, 0, 'Ed', 'ed@example.com', now() - interval '1 day'),                     -- $10 ticket, 10% off
  (1, 3, 'COMPLETED', 22.50, 25.88, 0, 'Fi', 'fi@example.com', now() - interval '5 days'),                   -- other promoter
  (3, 4, 'COMPLETED', 90.00, 99.00, 0, 'Gu', 'gu@example.com', now() - interval '4 days'),                   -- other account
  (1, NULL, 'COMPLETED', 25.00, 28.75, 0, 'Ho', 'ho@example.com', now() - interval '3 days'),                -- no code
  (4, 5, 'COMPLETED', 67.50, 77.63, 0, 'Iv', 'iv@example.com', now() - interval '85 days'),                  -- past event, 3 tickets
  (1, 1, 'COMPLETED', 22.50, 25.88, 0, 'Jo', 'jo@example.com', now());                                       -- today

INSERT INTO order_items (order_id, item_name, quantity, price, price_before_discount) VALUES
  (1, 'GA', 2, 22.50, 25.00), (2, 'GA', 2, 22.50, 25.00), (3, 'GA', 1, 22.50, 25.00), (4, 'GA', 1, 22.50, 25.00),
  (5, 'GA', 1, 9.00, 10.00), (6, 'GA', 1, 22.50, 25.00), (7, 'GA', 2, 45.00, 50.00), (8, 'GA', 1, 25.00, NULL),
  (9, 'GA', 3, 22.50, 25.00), (10, 'GA', 1, 22.50, 25.00);

INSERT INTO attendees (order_id, event_id, status) VALUES
  (1, 1, 'ACTIVE'), (1, 1, 'ACTIVE'),
  (2, 1, 'ACTIVE'), (2, 1, 'CANCELLED'),
  (3, 1, 'AWAITING_PAYMENT'),
  (4, 1, 'CANCELLED'),
  (5, 2, 'ACTIVE'),
  (6, 1, 'ACTIVE'),
  (7, 3, 'ACTIVE'), (7, 3, 'ACTIVE'),
  (8, 1, 'ACTIVE'),
  (9, 4, 'ACTIVE'), (9, 4, 'ACTIVE'), (9, 4, 'ACTIVE'),
  (10, 1, 'ACTIVE');

-- Event covers, served in the sandbox by the "cdn" container from dev/covers.
INSERT INTO images (entity_id, entity_type, type, path) VALUES
  (1, 'HiEvents\DomainObjects\EventDomainObject', 'EVENT_COVER', 'event_cover/warehouse.png'),
  (2, 'HiEvents\DomainObjects\EventDomainObject', 'EVENT_COVER', 'event_cover/winter.png'),
  (4, 'HiEvents\DomainObjects\EventDomainObject', 'EVENT_COVER', 'event_cover/rooftop.png');
