-- 003_crops_listings_prices.sql
-- Modules 2 + 3 (FR-5 to FR-12) and Module 10 (FR-33, FR-34):
-- crop master data, listings, listing images (+ AI check result), markets, retail prices.
-- Money = integer poisha. Quantity = numeric(12,3).
-- Also turns ON row level security for every table (see the bottom of this file).

-- ---------- enums ----------
-- draft -> pending_review -> live <-> paused ; pending_review -> rejected -> (edit) -> pending_review ; any -> archived
CREATE TYPE listing_status     AS ENUM ('draft', 'pending_review', 'live', 'paused', 'rejected', 'archived');
CREATE TYPE listing_unit       AS ENUM ('kg', 'maund', 'sack', 'crate', 'piece', 'dozen', 'bundle');
CREATE TYPE image_check_result AS ENUM ('match', 'mismatch', 'uncertain', 'failed');   -- FR-11
CREATE TYPE image_state        AS ENUM ('ok', 'flagged', 'admin_approved', 'admin_rejected');
CREATE TYPE image_source       AS ENUM ('upload', 'camera');
CREATE TYPE price_kind         AS ENUM ('retail', 'farm_gate');                         -- farm_gate is used later by FR-42
CREATE TYPE price_unit         AS ENUM ('kg', 'dozen', 'piece');

-- ---------- crops (admin-managed master list, FR-36 "essential crop data") ----------
CREATE TABLE crops (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name_en    TEXT NOT NULL,
  name_bn    TEXT NOT NULL,
  category   TEXT NOT NULL,
  aliases    TEXT[] NOT NULL DEFAULT '{}',      -- other spellings used by search (FR-6), e.g. {'eggplant','begun'}
  is_active  BOOLEAN NOT NULL DEFAULT true,     -- inactive = cannot be chosen for NEW listings, old listings keep working
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crops_category_valid CHECK (category IN ('vegetable','fruit','grain','pulse','spice','oilseed','other')),
  CONSTRAINT crops_names_not_blank CHECK (length(btrim(name_en)) > 0 AND length(btrim(name_bn)) > 0)
);
CREATE UNIQUE INDEX uq_crops_name_en ON crops (lower(name_en));
CREATE UNIQUE INDEX uq_crops_name_bn ON crops (name_bn);
CREATE TRIGGER trg_crops_updated BEFORE UPDATE ON crops FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- markets (retail price scope, clarification C6) ----------
CREATE TABLE markets (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  district_id SMALLINT NOT NULL REFERENCES districts(id),
  name_en     TEXT NOT NULL,
  name_bn     TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (district_id, name_en),
  CONSTRAINT markets_names_not_blank CHECK (length(btrim(name_en)) > 0 AND length(btrim(name_bn)) > 0)
);
CREATE TRIGGER trg_markets_updated BEFORE UPDATE ON markets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- listings (FR-8, FR-9, FR-12) ----------
CREATE TABLE listings (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farmer_id           BIGINT NOT NULL REFERENCES farmer_profiles(user_id),
  crop_id             INTEGER NOT NULL REFERENCES crops(id),
  variety             TEXT,
  description         TEXT,
  -- pickup location. Clarification C1: this district + crop is the aggregation group later.
  district_id         SMALLINT NOT NULL REFERENCES districts(id),
  upazila_id          INTEGER  NOT NULL,
  village             TEXT,
  unit                listing_unit NOT NULL,
  -- stated weight of ONE unit in kg. kg = 1, maund = 40 (set by the app), sack/crate = stated by the farmer (FR-9),
  -- piece/dozen/bundle = NULL (counted, never compared per kg: clarification C8).
  unit_weight_kg      NUMERIC(10,3),
  quantity_available  NUMERIC(12,3) NOT NULL,   -- in `unit`. Later modules reduce it with race-safe UPDATEs.
  min_purchase_qty    NUMERIC(12,3) NOT NULL,   -- in `unit`
  available_from      DATE NOT NULL,            -- availability or harvest date
  asking_price_poisha BIGINT,                   -- per `unit`. NULL = "Price negotiable" (FR-7)
  farmer_grade        CHAR(1),                  -- farmer-provided, NOT verified (FR-7)
  status              listing_status NOT NULL DEFAULT 'draft',
  review_reason       TEXT,
  reviewed_by         BIGINT REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  submitted_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (upazila_id, district_id) REFERENCES upazilas(id, district_id),
  CONSTRAINT listing_quantity_range  CHECK (quantity_available >= 0 AND quantity_available <= 10000000),
  CONSTRAINT listing_min_qty_range   CHECK (min_purchase_qty > 0 AND min_purchase_qty <= 10000000),
  CONSTRAINT listing_price_range     CHECK (asking_price_poisha IS NULL OR (asking_price_poisha > 0 AND asking_price_poisha <= 100000000)),
  CONSTRAINT listing_grade_valid     CHECK (farmer_grade IS NULL OR farmer_grade IN ('A', 'B', 'C')),
  -- "Packaging units shall include stated weight" (FR-9): weight is required exactly for kg/maund/sack/crate
  CONSTRAINT listing_unit_weight     CHECK ((unit IN ('piece', 'dozen', 'bundle')) = (unit_weight_kg IS NULL)
                                            AND (unit_weight_kg IS NULL OR unit_weight_kg > 0)
                                            AND (unit <> 'kg' OR unit_weight_kg = 1)),
  CONSTRAINT listing_reason_required CHECK (status <> 'rejected' OR review_reason IS NOT NULL),
  CONSTRAINT listing_submitted_set   CHECK (status = 'draft' OR submitted_at IS NOT NULL),
  CONSTRAINT listing_text_lengths    CHECK (length(coalesce(variety, '')) <= 80 AND length(coalesce(description, '')) <= 2000
                                            AND length(coalesce(village, '')) <= 100)
);
CREATE INDEX idx_listings_farmer ON listings (farmer_id, status);
CREATE INDEX idx_listings_status ON listings (status, submitted_at);
-- browsing only ever looks at live listings
CREATE INDEX idx_listings_live_place ON listings (district_id, upazila_id, crop_id) WHERE status = 'live';
CREATE INDEX idx_listings_live_crop  ON listings (crop_id) WHERE status = 'live';
CREATE TRIGGER trg_listings_updated BEFORE UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- listing images (FR-9, FR-10, FR-11) ----------
CREATE TABLE listing_images (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id       BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  position         SMALLINT NOT NULL,                       -- 1..6 : the database itself limits a listing to 6 photos
  storage_id       TEXT NOT NULL,                           -- id in the storage adapter (file name / Cloudinary public_id)
  url              TEXT NOT NULL,
  byte_size        INTEGER NOT NULL,
  original_name    TEXT,                                    -- file name the farmer uploaded (used when the AI check is repeated)
  source           image_source NOT NULL DEFAULT 'upload',
  gps_lat          NUMERIC(9,6),                            -- camera capture metadata (FR-10). Never shown publicly.
  gps_lng          NUMERIC(9,6),
  captured_at      TIMESTAMPTZ,
  check_result     image_check_result,                      -- AI-assisted check (FR-11). NOT proof of ownership/quantity/quality.
  check_confidence NUMERIC(4,3),
  check_provider   TEXT,
  checked_at       TIMESTAMPTZ,
  state            image_state NOT NULL DEFAULT 'flagged',  -- safe default: needs a human look
  review_reason    TEXT,
  reviewed_by      BIGINT REFERENCES users(id),
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, position),
  CONSTRAINT image_position_range CHECK (position BETWEEN 1 AND 6),
  CONSTRAINT image_size_positive  CHECK (byte_size > 0),
  CONSTRAINT image_name_length    CHECK (original_name IS NULL OR length(original_name) <= 200),
  CONSTRAINT image_gps_pair       CHECK ((gps_lat IS NULL) = (gps_lng IS NULL)),
  CONSTRAINT image_gps_range      CHECK ((gps_lat IS NULL) OR (gps_lat BETWEEN -90 AND 90 AND gps_lng BETWEEN -180 AND 180)),
  CONSTRAINT image_confidence     CHECK (check_confidence IS NULL OR check_confidence BETWEEN 0 AND 1)
);
CREATE INDEX idx_listing_images_state ON listing_images (state) WHERE state = 'flagged';

-- ---------- retail prices (FR-33, FR-34, FR-42) ----------
CREATE TABLE retail_prices (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  crop_id       INTEGER NOT NULL REFERENCES crops(id),
  market_id     INTEGER NOT NULL REFERENCES markets(id),
  kind          price_kind NOT NULL DEFAULT 'retail',
  price_poisha  BIGINT NOT NULL,
  unit          price_unit NOT NULL DEFAULT 'kg',
  observed_on   DATE NOT NULL,
  valid_until   DATE NOT NULL,                              -- after this date the price is "old" and is not shown as current
  source        TEXT NOT NULL,                              -- who/what the price came from (shown to users)
  created_by    BIGINT NOT NULL REFERENCES users(id),
  expired_at    TIMESTAMPTZ,                                -- set when an admin expires the entry by hand
  expired_by    BIGINT REFERENCES users(id),
  expire_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT price_range        CHECK (price_poisha > 0 AND price_poisha <= 100000000),
  CONSTRAINT price_validity     CHECK (valid_until >= observed_on),
  CONSTRAINT price_source_set   CHECK (length(btrim(source)) >= 2),
  CONSTRAINT price_expire_pair  CHECK ((expired_at IS NULL) = (expired_by IS NULL))
);
-- one active observation per crop + market + kind + day (an admin corrects it instead of adding a second one)
CREATE UNIQUE INDEX uq_retail_active_day ON retail_prices (crop_id, market_id, kind, observed_on) WHERE expired_at IS NULL;
CREATE INDEX idx_retail_prices_lookup ON retail_prices (market_id, crop_id, observed_on DESC);
CREATE TRIGGER trg_retail_prices_updated BEFORE UPDATE ON retail_prices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- seed: crops ----------
INSERT INTO crops (name_en, name_bn, category, aliases) VALUES
 ('Potato',        'আলু',          'vegetable', '{aloo,alu}'),
 ('Tomato',        'টমেটো',        'vegetable', '{বিলাতি,tomatoes}'),
 ('Onion',         'পেঁয়াজ',      'spice',     '{পেয়াজ,piyaj}'),
 ('Garlic',        'রসুন',         'spice',     '{roshun}'),
 ('Ginger',        'আদা',          'spice',     '{ada}'),
 ('Turmeric',      'হলুদ',         'spice',     '{holud}'),
 ('Green chili',   'কাঁচা মরিচ',   'spice',     '{মরিচ,chilli,chili}'),
 ('Brinjal',       'বেগুন',        'vegetable', '{eggplant,begun,aubergine}'),
 ('Cauliflower',   'ফুলকপি',       'vegetable', '{fulkopi}'),
 ('Cabbage',       'বাঁধাকপি',     'vegetable', '{bandhakopi}'),
 ('Pumpkin',       'মিষ্টি কুমড়া', 'vegetable', '{কুমড়া,kumra}'),
 ('Bottle gourd',  'লাউ',          'vegetable', '{lau}'),
 ('Bitter gourd',  'করলা',         'vegetable', '{korola,karela}'),
 ('Okra',          'ঢেঁড়স',       'vegetable', '{"ladies finger",dherosh,bhindi}'),
 ('Cucumber',      'শসা',          'vegetable', '{shosha}'),
 ('Carrot',        'গাজর',         'vegetable', '{gajor}'),
 ('Radish',        'মুলা',         'vegetable', '{mula}'),
 ('Spinach',       'পালং শাক',     'vegetable', '{palong,শাক}'),
 ('Red amaranth',  'লাল শাক',      'vegetable', '{lal shak,শাক}'),
 ('Pointed gourd', 'পটল',          'vegetable', '{potol}'),
 ('Snake gourd',   'চিচিঙ্গা',     'vegetable', '{chichinga}'),
 ('Yardlong bean', 'বরবটি',        'vegetable', '{borboti,"long bean"}'),
 ('Taro',          'কচু',          'vegetable', '{kochu}'),
 ('Sweet potato',  'মিষ্টি আলু',   'vegetable', '{"misti alu"}'),
 ('Papaya',        'পেঁপে',        'fruit',     '{pepe}'),
 ('Mango',         'আম',           'fruit',     '{aam}'),
 ('Banana',        'কলা',          'fruit',     '{kola}'),
 ('Jackfruit',     'কাঁঠাল',       'fruit',     '{kathal}'),
 ('Litchi',        'লিচু',         'fruit',     '{lychee}'),
 ('Guava',         'পেয়ারা',      'fruit',     '{peyara}'),
 ('Watermelon',    'তরমুজ',        'fruit',     '{tormuj}'),
 ('Lemon',         'লেবু',         'fruit',     '{lebu,lime}'),
 ('Rice (paddy)',  'ধান',          'grain',     '{paddy,dhan,চাল,rice}'),
 ('Wheat',         'গম',           'grain',     '{gom}'),
 ('Maize',         'ভুট্টা',       'grain',     '{corn,bhutta}'),
 ('Lentil',        'মসুর ডাল',     'pulse',     '{masoor,মসুর}'),
 ('Mustard',       'সরিষা',        'oilseed',   '{shorisha,"mustard seed"}');

-- ---------- seed: one demo market per demo district (+ a second one in Dhaka) ----------
INSERT INTO markets (district_id, name_en, name_bn)
SELECT d.id, d.name_en || ' Sadar Bazar', d.name_bn || ' সদর বাজার'
FROM districts d
WHERE d.name_en IN ('Dhaka','Gazipur','Narsingdi','Cumilla','Chattogram','Rajshahi','Bogura','Rangpur','Dinajpur','Jashore');

INSERT INTO markets (district_id, name_en, name_bn)
SELECT d.id, 'Karwan Bazar', 'কারওয়ান বাজার' FROM districts d WHERE d.name_en = 'Dhaka';

-- ---------- security hardening ----------
-- Supabase publishes every table in the "public" schema through its REST API using a public (anon) key.
-- Our Express server connects directly to Postgres (it is the table owner and bypasses RLS), so we turn RLS ON
-- for every table and add NO policies: that blocks all access through the public REST API.
-- RULE for later migrations: every new table needs "ALTER TABLE ... ENABLE ROW LEVEL SECURITY".
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Functions with a fixed search_path cannot be hijacked by a different schema (Supabase security advisor).
ALTER FUNCTION set_updated_at() SET search_path = '';
ALTER FUNCTION forbid_change()  SET search_path = '';
