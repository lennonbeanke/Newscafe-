-- 0004: media, promotions, function packages and enquiries, events, contact messages, gallery.
-- Customer-facing tables carry is_test and a consent timestamp (POPIA). Production rejects @example.invalid e-mails.

-- Images are stored in the database for the R0 setup (small, resized files). storage_kind = 'external'
-- lets a later paid setup move them to object storage without changing the rest of the schema.
CREATE TABLE media_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename     text NOT NULL,
  mime         text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  bytes        integer NOT NULL CHECK (bytes > 0 AND bytes <= 2000000),
  width        integer CHECK (width > 0),
  height       integer CHECK (height > 0),
  alt_text     text NOT NULL CHECK (length(alt_text) > 0),
  storage_kind text NOT NULL DEFAULT 'database' CHECK (storage_kind IN ('database', 'external')),
  data         bytea,
  external_url text,
  uploaded_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((storage_kind = 'database' AND data IS NOT NULL AND external_url IS NULL)
      OR (storage_kind = 'external' AND external_url IS NOT NULL AND data IS NULL))
);

-- Rush Hour, Orchid Mist and similar. status 'awaiting_confirmation' = details not yet confirmed by the owner.
CREATE TABLE promotions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  kind          text NOT NULL DEFAULT 'promo',
  title         text NOT NULL,
  blurb         text,
  price_cents   integer CHECK (price_cents >= 0),
  days_of_week  smallint[] CHECK (days_of_week <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  starts_at_time time,
  ends_at_time   time,
  valid_from    date,
  valid_to      date,
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'active', 'awaiting_confirmation', 'archived')),
  is_published  boolean NOT NULL DEFAULT false,
  media_id      uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE TRIGGER promotions_touch BEFORE UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE promotion_items (
  promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, menu_item_id)
);

CREATE TABLE function_packages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  price_cents  integer CHECK (price_cents >= 0),
  includes     text,
  is_published boolean NOT NULL DEFAULT false,
  sort         smallint NOT NULL DEFAULT 0
);
CREATE TABLE package_courses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES function_packages(id) ON DELETE CASCADE,
  title      text NOT NULL,
  sort       smallint NOT NULL DEFAULT 0
);
CREATE TABLE package_course_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES package_courses(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  is_vegetarian boolean NOT NULL DEFAULT false,
  sort          smallint NOT NULL DEFAULT 0
);

CREATE TABLE function_enquiries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  company     text,
  email       citext NOT NULL,
  phone       text,
  event_date  date,
  guests      integer CHECK (guests > 0),
  package_id  uuid REFERENCES function_packages(id) ON DELETE SET NULL,
  message     text,
  status      text NOT NULL DEFAULT 'new'
              CHECK (status IN ('new', 'contacted', 'quoted', 'confirmed', 'declined', 'closed')),
  owner_notes text,
  is_test     boolean NOT NULL DEFAULT false,
  consent_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER function_enquiries_touch BEFORE UPDATE ON function_enquiries
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER function_enquiries_no_fake_email BEFORE INSERT OR UPDATE ON function_enquiries
  FOR EACH ROW EXECUTE FUNCTION reject_fake_email('email');
CREATE INDEX function_enquiries_status ON function_enquiries (status, created_at DESC);

CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('Promo', 'Menu', 'Bar', 'Functions')),
  blurb        text,
  starts_at    timestamptz,
  ends_at      timestamptz,
  recurrence   text,
  is_published boolean NOT NULL DEFAULT false,
  media_id     uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);

CREATE TABLE contact_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  surname    text,
  phone      text,
  email      citext NOT NULL,
  type       text NOT NULL DEFAULT 'General'
             CHECK (type IN ('Complaint', 'Compliment', 'Suggestion', 'General')),
  message    text NOT NULL,
  status     text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'replied', 'archived')),
  is_test    boolean NOT NULL DEFAULT false,
  consent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER contact_messages_no_fake_email BEFORE INSERT OR UPDATE ON contact_messages
  FOR EACH ROW EXECUTE FUNCTION reject_fake_email('email');
CREATE INDEX contact_messages_status ON contact_messages (status, created_at DESC);

CREATE TABLE gallery_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id     uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  category     text NOT NULL CHECK (category IN ('Cocktails', 'Food', 'Venue', 'Nights')),
  ratio        numeric(5,3) NOT NULL CHECK (ratio > 0),
  sort         smallint NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false
);
