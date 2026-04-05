-- Learnings table: stores editor rejection feedback per product
-- Used to improve B-roll matching over time
CREATE TABLE IF NOT EXISTS learnings (
  id BIGSERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  clip_id INTEGER REFERENCES clips(id),
  script_line TEXT NOT NULL,
  dr_function TEXT,
  rejection_reason TEXT NOT NULL,
  editor_note TEXT,
  brand_id INTEGER REFERENCES brands(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by product (matching improvement queries)
CREATE INDEX IF NOT EXISTS idx_learnings_product ON learnings(product_id);
CREATE INDEX IF NOT EXISTS idx_learnings_brand ON learnings(brand_id);
