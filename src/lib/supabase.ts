import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type Clip = {
  id: number
  filename: string
  filepath: string
  filetype: string
  description: string
  dr_function: string
  tags: string[]
  has_product: boolean
  has_person: boolean
  person_gender: string
  person_age_range: string
  mood: string
  palette: string
  setting: string
  camera_movement: string
  reusability: string
  reusability_reason: string
  brand: string
  product_id: number | null
  drive_url: string
  thumbnail_url: string
  created_at: string
}
