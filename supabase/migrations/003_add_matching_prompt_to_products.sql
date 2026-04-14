-- Add per-product matching prompt for analyze-script
-- Stores product-specific examples + context that replace the generic block
-- in the analyze-script prompt. Null = fall back to generic examples.

alter table products add column if not exists matching_prompt text;
