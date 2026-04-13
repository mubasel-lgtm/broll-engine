#!/usr/bin/env node
/**
 * Batch B-Roll Indexer
 * Downloads videos from Google Drive, analyzes with Gemini, stores in Supabase.
 *
 * Usage: node batch-index.mjs [folder_name]
 * folder_name: "dog-joint", "digestion", or "teeth" (default: all)
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
const GEMINI_KEY = env.GEMINI_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = env.GOOGLE_DRIVE_REFRESH_TOKEN;

const FOLDERS = {
  'dog-joint': { id: '15A1GjbH56p3wnMcXalrw23qq0zpjll0D', product: 'Dog Joint', product_id: 3 },
  'digestion': { id: '18or234A5qryiaFFZ7JQnVtl0fASqDNpi', product: 'Digestion', product_id: 4 },
  'teeth':    { id: '1Na5rTNDuePZT_RsPBH20ANhN6XH17c71', product: 'Teeth', product_id: 2 },
};

const BRAND = 'PetBloom';
const MAX_VIDEO_SIZE = 15_000_000; // 15MB Gemini limit
const CONCURRENCY = 3; // parallel Gemini requests
const RETRY_LIMIT = 2;
const RETRY_DELAY = 5000;

// --- State tracking ---
const progress = { total: 0, done: 0, skipped: 0, failed: 0, errors: [] };

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

// --- Google Drive ---
async function listFiles(folderId) {
  const token = await getAccessToken();
  let allFiles = [];
  let pageToken = null;

  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    let url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    allFiles = allFiles.concat(data.files || []);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFiles.filter(f => f.mimeType?.startsWith('video/'));
}

async function downloadVideo(fileId) {
  const token = await getAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// --- Supabase ---
async function supabaseQuery(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    }
  });
  return res;
}

async function clipExists(driveFileId, filename) {
  // Check by drive URL
  const res = await supabaseQuery(
    `clips?select=id&or=(drive_url.like.*${driveFileId}*,filename.eq.${encodeURIComponent(filename)})&brand=eq.${BRAND}&limit=1`
  );
  const data = await res.json();
  return data.length > 0;
}

async function insertClip(clipData) {
  const res = await supabaseQuery('clips', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(clipData)
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`DB insert failed: ${err.message || JSON.stringify(err)}`);
  }
  return (await res.json())[0];
}

// --- Gemini categorization ---
async function categorizeVideo(videoBuffer, filename) {
  const parts = [];

  if (videoBuffer && videoBuffer.length <= MAX_VIDEO_SIZE) {
    parts.push({ inline_data: { mime_type: 'video/mp4', data: videoBuffer.toString('base64') } });
  }

  parts.push({
    text: `You are a B-roll clip categorizer for direct-response video ads. Analyze this video and categorize it.
${videoBuffer && videoBuffer.length <= MAX_VIDEO_SIZE ? '' : `\nThe file is: "${filename}" from Google Drive. Since the video is too large to analyze directly, categorize based on the filename and any patterns you recognize. Be conservative.`}

Return JSON with exactly these fields:
{
  "description": "2-3 sentence description of what's visually happening",
  "dr_function": "one of: HOOK, PROBLEM, MECHANISM, PRODUCT, OUTCOME, LIFESTYLE, SOCIAL_PROOF, CTA, OTHER",
  "tags": ["array", "of", "5-10", "visual", "tags"],
  "has_product": true/false,
  "has_person": true/false,
  "person_gender": "male/female/none",
  "person_age_range": "e.g. 25-35 or none",
  "mood": "e.g. frustrated, happy, calm, energetic, scientific",
  "palette": "e.g. bright natural, warm tones, cool tones, neutral",
  "setting": "e.g. living room, kitchen, bathroom, outdoor, studio",
  "camera_movement": "e.g. static, slow zoom, pan, handheld",
  "reusability": "high/medium/low — high if generic enough for multiple scripts",
  "reusability_reason": "why this reusability rating"
}

IMPORTANT:
- dr_function should reflect the VISUAL PURPOSE in a direct-response ad
- Tags should describe what you SEE, not abstract concepts
- Be specific about the setting and mood
- For reusability: product-specific shots = low, generic lifestyle = high`
  });

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return JSON.parse(text);
}

// --- Process a single video ---
async function processVideo(file, product, productId) {
  const driveUrl = `https://drive.google.com/file/d/${file.id}/view`;

  // Check if already indexed
  if (await clipExists(file.id, file.name)) {
    progress.skipped++;
    return;
  }

  let videoBuffer = null;
  const fileSize = parseInt(file.size) || 0;

  // Only download if under 15MB (Gemini limit)
  if (fileSize <= MAX_VIDEO_SIZE) {
    try {
      videoBuffer = await downloadVideo(file.id);
    } catch (e) {
      console.error(`  ⚠ Download failed for ${file.name}: ${e.message}`);
    }
  }

  // Categorize with Gemini
  const category = await categorizeVideo(videoBuffer, file.name);

  // Insert into Supabase
  const clipData = {
    filename: file.name,
    filepath: driveUrl,
    filetype: 'video',
    description: category.description,
    dr_function: category.dr_function,
    tags: category.tags,
    has_product: category.has_product,
    has_person: category.has_person,
    person_gender: category.person_gender || 'none',
    person_age_range: category.person_age_range || 'none',
    mood: category.mood,
    palette: category.palette,
    setting: category.setting,
    camera_movement: category.camera_movement,
    reusability: category.reusability,
    reusability_reason: category.reusability_reason,
    brand: BRAND,
    product_id: productId,
    drive_url: driveUrl,
    thumbnail_url: '',
  };

  await insertClip(clipData);
  progress.done++;
}

async function processVideoWithRetry(file, product, productId) {
  for (let attempt = 0; attempt <= RETRY_LIMIT; attempt++) {
    try {
      await processVideo(file, product, productId);
      return;
    } catch (e) {
      if (attempt < RETRY_LIMIT) {
        const delay = RETRY_DELAY * (attempt + 1);
        console.error(`  ⚠ Retry ${attempt + 1}/${RETRY_LIMIT} for ${file.name}: ${e.message}`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        progress.failed++;
        progress.errors.push({ file: file.name, error: e.message });
        console.error(`  ✗ FAILED ${file.name}: ${e.message}`);
      }
    }
  }
}

// --- Run batch with concurrency control ---
async function runBatch(files, product, productId) {
  const queue = [...files];
  const workers = [];

  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (!file) break;
        await processVideoWithRetry(file, product, productId);

        // Progress log every 10 clips
        const processed = progress.done + progress.skipped + progress.failed;
        if (processed % 10 === 0) {
          console.log(`  📊 Progress: ${processed}/${progress.total} (${progress.done} indexed, ${progress.skipped} skipped, ${progress.failed} failed)`);
        }
      }
    })());
  }

  await Promise.all(workers);
}

// --- Main ---
async function main() {
  const target = process.argv[2]; // optional: "dog-joint", "digestion", "teeth"
  const foldersToProcess = target ? { [target]: FOLDERS[target] } : FOLDERS;

  if (target && !FOLDERS[target]) {
    console.error(`Unknown folder: ${target}. Use: dog-joint, digestion, teeth`);
    process.exit(1);
  }

  console.log('🚀 B-Roll Batch Indexer starting...');
  console.log(`   Brand: ${BRAND}`);
  console.log(`   Folders: ${Object.keys(foldersToProcess).join(', ')}`);
  console.log(`   Concurrency: ${CONCURRENCY}\n`);

  for (const [key, folder] of Object.entries(foldersToProcess)) {
    console.log(`\n📁 Processing: ${folder.product} (${key})`);

    // List videos
    const files = await listFiles(folder.id);
    console.log(`   Found ${files.length} videos`);

    progress.total += files.length;
    await runBatch(files, folder.product, folder.product_id);

    console.log(`   ✅ ${folder.product} done!`);
  }

  console.log('\n' + '='.repeat(50));
  console.log('🏁 BATCH COMPLETE');
  console.log(`   Total: ${progress.total}`);
  console.log(`   Indexed: ${progress.done}`);
  console.log(`   Skipped (already exists): ${progress.skipped}`);
  console.log(`   Failed: ${progress.failed}`);

  if (progress.errors.length > 0) {
    console.log('\n❌ Failed clips:');
    for (const e of progress.errors) {
      console.log(`   - ${e.file}: ${e.error}`);
    }
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
