-- 0002: locations, website settings, opening hours.
-- Weekdays use ISO numbering: 1 = Monday ... 7 = Sunday.
-- No real hours, addresses or rules are stored by migrations. The owner enters them in the admin dashboard.

CREATE TABLE locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  street      text NOT NULL,
  suburb      text NOT NULL,
  city        text NOT NULL,
  region      text NOT NULL,
  postal_code text NOT NULL,
  phone       text,
  email       citext,
  timezone    text NOT NULL DEFAULT 'Africa/Johannesburg',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER locations_touch BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE site_settings (
  location_id uuid PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  tagline     text,
  description text,
  social      jsonb NOT NULL DEFAULT '{}'::jsonb,
  legal_text  text,
  age_notice  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER site_settings_touch BEFORE UPDATE ON site_settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Several rows per weekday are allowed (split shifts). closes_next_day handles past-midnight service.
CREATE TABLE opening_hours (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  weekday         smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  opens_at        time NOT NULL,
  closes_at       time NOT NULL,
  closes_next_day boolean NOT NULL DEFAULT false,
  sort            smallint NOT NULL DEFAULT 0,
  CHECK (closes_next_day OR closes_at > opens_at)
);
CREATE INDEX opening_hours_lookup ON opening_hours (location_id, weekday);

-- Public holidays, private events, closures. A row for a date REPLACES the weekly hours for that date.
CREATE TABLE special_hours (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  on_date         date NOT NULL,
  is_closed       boolean NOT NULL DEFAULT false,
  opens_at        time,
  closes_at       time,
  closes_next_day boolean NOT NULL DEFAULT false,
  label           text,
  UNIQUE (location_id, on_date),
  CHECK (is_closed OR (opens_at IS NOT NULL AND closes_at IS NOT NULL
                       AND (closes_next_day OR closes_at > opens_at)))
);
