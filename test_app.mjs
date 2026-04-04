import { chromium } from 'playwright';

const SCRIPT = `Ich habe diesen Geruchseliminierer bei Galileo gesehen — und dachte erst, ja klar, wieder so ein Luftreiniger, der nichts taugt.
Aber das ist wirklich anders, weil es speziell gegen Zigarettengeruch gemacht ist. Ich hatte früher auch so ein riesigen Luftfilter zu Hause stehen, und der hat gegen den miesen Zigarettenrauch einfach gar nichts gemacht. Und das liegt daran, dass Nikotinpartikel so winzig sind, dass die einfach durch den Filter durchfliegen.
Der ODRx von NorvaHaus funktioniert komplett anders. Der stößt negative Ionen aus — klingt erstmal bescheuert, ich weiß.`;

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[BROWSER ERROR] ${msg.text()}`);
  });
  page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));

  console.log('1. Loading /projects...');
  await page.goto('http://localhost:3000/projects');
  await page.waitForLoadState('networkidle');

  // Check if product buttons loaded
  const productButtons = await page.locator('button:has-text("ODRX")').count();
  console.log(`2. Product buttons found: ${productButtons}`);

  if (productButtons > 0) {
    // Click ODRX V2
    await page.locator('button:has-text("ODRX")').first().click();
    console.log('3. Clicked ODRX V2');
  } else {
    console.log('3. NO PRODUCT BUTTONS FOUND - checking page content...');
    const content = await page.textContent('body');
    console.log(`   Page text (first 500): ${content.substring(0, 500)}`);
  }

  // Fill project name
  const nameInput = page.locator('input[placeholder*="Project name"]');
  if (await nameInput.count() > 0) {
    await nameInput.fill('Test ODRX Ad');
    console.log('4. Filled project name');
  } else {
    console.log('4. Name input NOT FOUND');
  }

  // Fill script
  const scriptArea = page.locator('textarea');
  if (await scriptArea.count() > 0) {
    await scriptArea.fill(SCRIPT);
    console.log(`5. Filled script (${SCRIPT.length} chars)`);
  } else {
    console.log('5. Textarea NOT FOUND');
  }

  // Check button state
  const analyzeBtn = page.locator('button:has-text("Analyze")');
  const btnCount = await analyzeBtn.count();
  console.log(`6. Analyze button found: ${btnCount}`);

  if (btnCount > 0) {
    const isDisabled = await analyzeBtn.isDisabled();
    console.log(`   Button disabled: ${isDisabled}`);

    if (!isDisabled) {
      console.log('7. Clicking Analyze button...');
      await analyzeBtn.click();

      // Wait for results
      console.log('8. Waiting for results (up to 60s)...');
      try {
        await page.waitForSelector('.space-y-4 >> text="#"', { timeout: 60000 });

        // Count result lines
        const resultLines = await page.locator('[class*="border-b border-zinc-800"]').count();
        console.log(`9. Result lines found: ${resultLines}`);

        // Check for thumbnails
        const thumbnails = await page.locator('.aspect-video img').count();
        console.log(`10. Thumbnails found: ${thumbnails}`);

        // Take screenshot
        await page.screenshot({ path: '/Users/mubasel/Downloads/_KEEP/broll-engine/test_result.png', fullPage: true });
        console.log('11. Screenshot saved to test_result.png');

        console.log('\n=== TEST PASSED ===');
      } catch (e) {
        console.log(`9. TIMEOUT waiting for results: ${e.message}`);

        // Check what's on the page
        const bodyText = await page.textContent('body');
        if (bodyText.includes('Analyzing')) {
          console.log('   Page shows "Analyzing..." - API call might be slow');
        }
        if (bodyText.includes('error') || bodyText.includes('Error')) {
          console.log('   Page contains error text');
        }

        await page.screenshot({ path: '/Users/mubasel/Downloads/_KEEP/broll-engine/test_error.png', fullPage: true });
        console.log('   Error screenshot saved to test_error.png');
      }
    } else {
      console.log('7. BUTTON IS DISABLED - cannot click');
      // Debug: check all form values
      const scriptVal = await scriptArea.inputValue();
      console.log(`   Script value length: ${scriptVal.length}`);

      await page.screenshot({ path: '/Users/mubasel/Downloads/_KEEP/broll-engine/test_disabled.png', fullPage: true });
      console.log('   Screenshot saved to test_disabled.png');
    }
  }

  await browser.close();
}

test().catch(e => console.error('Test failed:', e));
