-- 0003: menu. Mirrors the structure of frontend/lib/menu-data.ts
-- (book -> section -> group -> item -> prices / add-ons / trade-ups). Money is stored in cents.
-- Migrations contain NO menu data; the owner manages it in the dashboard (the verified menu is loaded in a later milestone).

CREATE TABLE menu_books (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug    text NOT NULL UNIQUE,
  label   text NOT NULL,
  tagline text,
  sort    smallint NOT NULL DEFAULT 0
);

CREATE TABLE menu_sections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id       uuid NOT NULL REFERENCES menu_books(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  title         text NOT NULL,
  subtitle      text,
  note          text,
  price_label_1 text,           -- e.g. "Glass"
  price_label_2 text,           -- e.g. "Bottle"
  sort          smallint NOT NULL DEFAULT 0,
  UNIQUE (book_id, slug)
);

CREATE TABLE menu_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES menu_sections(id) ON DELETE CASCADE,
  title      text,
  note       text,
  sort       smallint NOT NULL DEFAULT 0
);

CREATE TABLE menu_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id               uuid NOT NULL REFERENCES menu_groups(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  description            text,
  note                   text,
  is_vegetarian          boolean NOT NULL DEFAULT false,
  is_marked              boolean NOT NULL DEFAULT false,   -- the printed "N" badge (meaning unconfirmed)
  alcohol_free_price_cents integer CHECK (alcohol_free_price_cents >= 0),
  is_active              boolean NOT NULL DEFAULT true,
  sort                   smallint NOT NULL DEFAULT 0,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER menu_items_touch BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE menu_item_prices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  label        text NOT NULL DEFAULT '',          -- '' for a single price, otherwise "Glass", "Bottle", ...
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  sort         smallint NOT NULL DEFAULT 0,
  UNIQUE (item_id, label)
);

CREATE TABLE menu_item_addons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  label        text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  sort         smallint NOT NULL DEFAULT 0
);

CREATE TABLE menu_item_tradeups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name        text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0)
);

-- One row: the owner switches the "N" badge on once its meaning is officially confirmed.
CREATE TABLE menu_settings (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  flag_enabled boolean NOT NULL DEFAULT false,
  flag_label   text NOT NULL DEFAULT ''
);
INSERT INTO menu_settings DEFAULT VALUES;

CREATE TABLE menu_price_history (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id    uuid NOT NULL,
  label      text NOT NULL,
  old_cents  integer,
  new_cents  integer NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX menu_price_history_item ON menu_price_history (item_id, changed_at DESC);

CREATE FUNCTION log_menu_price_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents THEN
    INSERT INTO menu_price_history (item_id, label, old_cents, new_cents, changed_by)
    VALUES (NEW.item_id, NEW.label,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.amount_cents END,
            NEW.amount_cents,
            NULLIF(current_setting('app.actor_id', true), '')::uuid);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER menu_item_prices_history
  AFTER INSERT OR UPDATE ON menu_item_prices
  FOR EACH ROW EXECUTE FUNCTION log_menu_price_change();

CREATE TRIGGER menu_price_history_append_only
  BEFORE UPDATE OR DELETE ON menu_price_history
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
