-- 001_users_locations_audit.sql
-- Module 1 foundation: users, staff allowlist, farmer/buyer profiles,
-- verification history, districts/upazilas, addresses, audit log.
-- Money is NOT in this file. (Later: integer poisha, 1 BDT = 100.)

-- ---------- helper: auto-update updated_at ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- enums ----------
-- ASSUMPTION: users.role = general_user until admin APPROVES a farmer/buyer
-- application; on approval the role becomes 'farmer' or 'buyer'.
-- So "role = farmer" always means "approved farmer".
CREATE TYPE user_role           AS ENUM ('general_user', 'farmer', 'buyer', 'admin', 'operator');
CREATE TYPE account_status      AS ENUM ('active', 'suspended', 'banned');
CREATE TYPE verification_status AS ENUM ('pending', 'approved', 'rejected', 'correction_requested');
CREATE TYPE business_type       AS ENUM ('wholesaler', 'retailer', 'restaurant', 'hotel', 'other');
CREATE TYPE profile_kind        AS ENUM ('farmer', 'buyer');
CREATE TYPE verification_action AS ENUM ('submitted', 'resubmitted', 'approved', 'rejected', 'correction_requested');

-- ---------- locations ----------
CREATE TABLE districts (
  id      SMALLINT PRIMARY KEY,
  name_en TEXT NOT NULL UNIQUE,
  name_bn TEXT NOT NULL UNIQUE
);

CREATE TABLE upazilas (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  district_id SMALLINT NOT NULL REFERENCES districts(id),
  name_en     TEXT NOT NULL,
  name_bn     TEXT NOT NULL,
  UNIQUE (district_id, name_en),
  -- lets addresses prove "this upazila really belongs to this district"
  UNIQUE (id, district_id)
);
CREATE INDEX idx_upazilas_district ON upazilas(district_id);

-- ---------- users ----------
CREATE TABLE users (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  google_sub         TEXT NOT NULL UNIQUE,          -- Google's permanent user id
  email              TEXT NOT NULL UNIQUE,
  full_name          TEXT NOT NULL,
  avatar_url         TEXT,
  mobile             TEXT,                           -- NOT OTP-verified (FR-1 v2)
  preferred_language TEXT NOT NULL DEFAULT 'bn',
  role               user_role      NOT NULL DEFAULT 'general_user',
  status             account_status NOT NULL DEFAULT 'active',
  status_reason      TEXT,                           -- why suspended/banned
  token_version      INTEGER NOT NULL DEFAULT 0,     -- logout/suspend bumps this => old JWTs die
  last_login_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_mobile_format   CHECK (mobile IS NULL OR mobile ~ '^01[3-9][0-9]{8}$'),
  CONSTRAINT users_language_valid  CHECK (preferred_language IN ('bn', 'en'))
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Emails an admin has pre-approved to become admin/operator on first Google login.
CREATE TABLE staff_allowlist (
  email      TEXT PRIMARY KEY,
  role       user_role NOT NULL,
  added_by   BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT staff_role_valid      CHECK (role IN ('admin', 'operator'))
);

-- ---------- farmer profile (FR-3) ----------
CREATE TABLE farmer_profiles (
  user_id                     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name                   TEXT NOT NULL,
  farmer_card_number_enc      TEXT NOT NULL,        -- AES-256-GCM encrypted by the app
  farmer_card_last4           TEXT NOT NULL,        -- for masked display "****1234"
  farmer_card_hash            TEXT NOT NULL UNIQUE, -- HMAC of the number: detects duplicate cards
  farmer_card_image_id        TEXT NOT NULL,        -- Cloudinary private asset id
  district_id                 SMALLINT NOT NULL REFERENCES districts(id),
  upazila_id                  INTEGER  NOT NULL,
  village                     TEXT,
  verification_status         verification_status NOT NULL DEFAULT 'pending',
  review_reason               TEXT,                 -- required when rejected/correction_requested
  reviewed_by                 BIGINT REFERENCES users(id),
  reviewed_at                 TIMESTAMPTZ,
  submitted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (upazila_id, district_id) REFERENCES upazilas(id, district_id),
  CONSTRAINT farmer_reason_required CHECK (
    verification_status NOT IN ('rejected', 'correction_requested') OR review_reason IS NOT NULL
  )
);
CREATE INDEX idx_farmer_profiles_status ON farmer_profiles(verification_status);
CREATE TRIGGER trg_farmer_profiles_updated BEFORE UPDATE ON farmer_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- buyer profile (FR-4) ----------
CREATE TABLE buyer_profiles (
  user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  business_name       TEXT NOT NULL,
  business_type       business_type NOT NULL,
  contact_person      TEXT NOT NULL,
  mobile              TEXT NOT NULL,
  address_line        TEXT NOT NULL,
  district_id         SMALLINT NOT NULL REFERENCES districts(id),
  upazila_id          INTEGER  NOT NULL,
  verification_status verification_status NOT NULL DEFAULT 'pending',
  review_reason       TEXT,
  reviewed_by         BIGINT REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (upazila_id, district_id) REFERENCES upazilas(id, district_id),
  CONSTRAINT buyer_mobile_format  CHECK (mobile ~ '^01[3-9][0-9]{8}$'),
  CONSTRAINT buyer_reason_required CHECK (
    verification_status NOT IN ('rejected', 'correction_requested') OR review_reason IS NOT NULL
  )
);
CREATE INDEX idx_buyer_profiles_status ON buyer_profiles(verification_status);
CREATE TRIGGER trg_buyer_profiles_updated BEFORE UPDATE ON buyer_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- verification history (FR-3b/3c/3d, FR-4b) ----------
-- Every submit / resubmit / approve / reject is a new row. Never edited.
CREATE TABLE verification_events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),   -- no CASCADE: history must never vanish
  kind       profile_kind NOT NULL,
  action     verification_action NOT NULL,
  reason     TEXT,
  actor_id   BIGINT REFERENCES users(id),   -- who did it (farmer for submit, admin for review)
  snapshot   JSONB,                          -- profile data at that moment (card number NEVER inside)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_verification_events_user ON verification_events(user_id, created_at DESC);

-- ---------- addresses (FR-3g) ----------
-- Later, orders will reference addresses with ON DELETE RESTRICT,
-- so an address used by an order cannot be deleted.
CREATE TABLE addresses (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,                -- "Home", "Warehouse", "Farm pickup"
  address_line  TEXT NOT NULL,
  district_id   SMALLINT NOT NULL REFERENCES districts(id),
  upazila_id    INTEGER  NOT NULL,
  contact_phone TEXT,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (upazila_id, district_id) REFERENCES upazilas(id, district_id),
  CONSTRAINT address_phone_format CHECK (contact_phone IS NULL OR contact_phone ~ '^01[3-9][0-9]{8}$')
);
CREATE INDEX idx_addresses_user ON addresses(user_id);
-- at most ONE default address per user
CREATE UNIQUE INDEX uq_addresses_one_default ON addresses(user_id) WHERE is_default;
CREATE TRIGGER trg_addresses_updated BEFORE UPDATE ON addresses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- audit log (FR-36, auditability NFR) ----------
CREATE TABLE audit_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    BIGINT REFERENCES users(id),
  action      TEXT NOT NULL,              -- e.g. 'farmer.approved', 'user.suspended'
  entity_type TEXT NOT NULL,              -- e.g. 'farmer_profile'
  entity_id   TEXT NOT NULL,
  reason      TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_actor  ON audit_logs(actor_id, created_at DESC);

-- Audit rows can never be changed or deleted (not even by a bug in our code).
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed (append-only table)', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER trg_verif_events_append_only BEFORE UPDATE OR DELETE ON verification_events
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
