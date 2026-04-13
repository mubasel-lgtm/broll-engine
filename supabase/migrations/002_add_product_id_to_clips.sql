-- Add product_id to clips for per-product filtering
ALTER TABLE clips ADD COLUMN IF NOT EXISTS product_id integer REFERENCES products(id);

-- Backfill existing clips using drive_url → product.drive_folder_id mapping
-- Each clip's drive_url contains the Drive file ID from a specific product folder.
-- We match by checking if the clip's drive_url file ID appears in the product's Drive folder.
-- Since we can't query Drive from SQL, we use the known folder structure:
-- NorvaHaus ODRX V2 (product 1) = all clips with brand 'NorvaHaus'
UPDATE clips SET product_id = 1 WHERE brand = 'NorvaHaus' AND product_id IS NULL;

-- PetBloom products need to be matched by their Drive folder.
-- The batch-index.mjs indexed clips from specific folders, so we can identify them
-- by checking which folder their drive_url file appears in.
-- This will be done via the backfill script (backfill-product-ids.mjs) since it requires Drive API calls.

-- Create index for faster product-filtered queries
CREATE INDEX IF NOT EXISTS idx_clips_product_id ON clips(product_id);
CREATE INDEX IF NOT EXISTS idx_clips_brand ON clips(brand);
