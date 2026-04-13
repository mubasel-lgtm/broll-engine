#!/usr/bin/env node
/**
 * Backfill product_id on existing clips.
 * Lists files in each product's Drive folder and matches them to clips via drive_url.
 *
 * Usage: node backfill-product-ids.mjs
 * Requires: .env.local with Google OAuth + Supabase credentials
 */

import fs from 'fs';

// --- Load env ---
const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)="(.*)"$/);
  if (match) env[match[1].trim()] = match[2].replace(/\\n/g, '');
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = env.GOOGLE_DRIVE_REFRESH_TOKEN;

// Product ID → Drive folder ID mapping (from products table)
const PRODUCTS = [
  { product_id: 1, name: 'ODRX V2',    folder_id: '19B5_90zVZJIirJGPpklArzp2C-JzSugC', brand: 'NorvaHaus' },
  { product_id: 2, name: 'Teeth',       folder_id: '1Na5rTNDuePZT_RsPBH20ANhN6XH17c71', brand: 'PetBloom' },
  { product_id: 3, name: 'Dog Joint',   folder_id: '15A1GjbH56p3wnMcXalrw23qq0zpjll0D', brand: 'PetBloom' },
  { product_id: 4, name: 'Digestion',   folder_id: '18or234A5qryiaFFZ7JQnVtl0fASqDNpi', brand: 'PetBloom' },
];

// --- Google OAuth ---
let accessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry - 60000) return accessToken;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('OAuth failed: ' + JSON.stringify(data));
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return accessToken;
}

// --- Google Drive: list all file IDs in a folder ---
async function listFileIds(folderId) {
  const token = await getAccessToken();
  const ids = [];
  let pageToken = null;

  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    let url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    for (const f of data.files || []) ids.push(f.id);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return ids;
}

// --- Supabase helpers ---
async function supabaseQuery(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    }
  });
}

async function updateClipProductId(driveFileId, productId) {
  const res = await supabaseQuery(
    `clips?drive_url=like.*${driveFileId}*&product_id=is.null`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ product_id: productId })
    }
  );
  const data = await res.json();
  return Array.isArray(data) ? data.length : 0;
}

// --- Main ---
async function main() {
  console.log('🔄 Backfilling product_id on clips...\n');

  let totalUpdated = 0;

  for (const product of PRODUCTS) {
    console.log(`📁 ${product.name} (product_id: ${product.product_id})`);

    const fileIds = await listFileIds(product.folder_id);
    console.log(`   Found ${fileIds.length} files in Drive folder`);

    // Batch update: 20 concurrent requests at a time
    let updated = 0;
    const BATCH = 20;
    for (let i = 0; i < fileIds.length; i += BATCH) {
      const batch = fileIds.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(fileId => updateClipProductId(fileId, product.product_id))
      );
      updated += results.reduce((sum, c) => sum + c, 0);
      if ((i + BATCH) % 100 === 0 || i + BATCH >= fileIds.length) {
        console.log(`   Progress: ${Math.min(i + BATCH, fileIds.length)}/${fileIds.length} checked, ${updated} updated`);
      }
    }

    console.log(`   ✅ Updated ${updated} clips\n`);
    totalUpdated += updated;
  }

  // Check for any remaining clips without product_id
  const res = await supabaseQuery('clips?select=id&product_id=is.null&limit=1');
  const orphans = await res.json();

  console.log('='.repeat(50));
  console.log(`🏁 Done! Updated ${totalUpdated} clips total.`);
  if (orphans.length > 0) {
    console.log('⚠️  Some clips still have no product_id — they may not be in any known Drive folder.');
  } else {
    console.log('✅ All clips have a product_id!');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
