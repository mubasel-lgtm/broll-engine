import { chromium } from 'playwright';

const SCRIPT = `Ich habe diesen Geruchseliminierer bei Galileo gesehen — und dachte erst, ja klar, wieder so ein Luftreiniger, der nichts taugt.
Aber das ist wirklich anders, weil es speziell gegen Zigarettengeruch gemacht ist. Ich hatte früher auch so ein riesigen Luftfilter zu Hause stehen, und der hat gegen den miesen Zigarettenrauch einfach gar nichts gemacht. Und das liegt daran, dass Nikotinpartikel so winzig sind, dass die einfach durch den Filter durchfliegen.
Der ODRx von NorvaHaus funktioniert komplett anders. Der stößt negative Ionen aus — klingt erstmal bescheuert, ich weiß. Aber das ist genau dasselbe was passiert wenn nach einem Gewitter die Luft draußen so unglaublich frisch riecht. Diese Ionen binden sich an die ganzen Gift- und Geruchsstoffe in der Luft und neutralisieren sie einfach. Ich hab das zwei Wochen getestet und ich schwör dir, es funktioniert, meine Wohnung riecht, als hätte ich nie darin geraucht, obwohl ich seit 7 Jahren hier wohne.
Früher wenn Besuch kam bin ich wie eine Verrückte durch die Wohnung gerannt, hab alles vollgesprüht, Fenster aufgerissen — und trotzdem dieser Blick wenn die reinkommen. Den kenn ich zu gut.
Seit ich den ODRx habe, mach ich gar nichts mehr. Letztens kam meine Freundin spontan vorbei und hat mich ernsthaft gefragt, ob ich aufgehört hab in meiner Wohnung zu rauchen.
Und das Beste ist, du steckst das einmal ein, musst keinen Filter wechseln, nichts nachkaufen — du vergisst einfach, dass es da steht.
Ich kann dir gar nicht sagen, wie viele Leute ich das schon weiterempfohlen hab. Wenn du Raucher bist — klick einfach auf den Link und schau es dir an.`;

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.log(`[ERR] ${msg.text()}`); });

  console.log('Loading projects page...');
  await page.goto('http://localhost:3000/projects');
  await page.waitForLoadState('networkidle');

  // Select ODRX
  await page.locator('button:has-text("ODRX")').first().click();
  console.log('Selected ODRX V2');

  // Fill script
  await page.locator('textarea').fill(SCRIPT);
  console.log('Filled script');

  // Click analyze
  await page.locator('button:has-text("Analyze")').click();
  console.log('Clicked Analyze - waiting for results...');

  // Wait for the loading to finish and results to appear
  await page.waitForFunction(() => {
    return document.querySelectorAll('[class*="rounded-lg overflow-hidden"]').length > 3;
  }, { timeout: 90000 });

  console.log('Results loaded!');

  // Count everything
  const scriptLines = await page.locator('text="HOOK"').count() +
    await page.locator('text="PROBLEM"').count() +
    await page.locator('text="MECHANISM"').count() +
    await page.locator('text="PRODUCT"').count() +
    await page.locator('text="OUTCOME"').count() +
    await page.locator('text="CTA"').count() +
    await page.locator('text="SOCIAL_PROOF"').count() +
    await page.locator('text="LIFESTYLE"').count();

  const thumbnails = await page.locator('.aspect-video img').count();
  const useButtons = await page.locator('button:has-text("Use this")').count();

  console.log(`Script lines with DR tags: ${scriptLines}`);
  console.log(`Video thumbnails: ${thumbnails}`);
  console.log(`"Use this" buttons: ${useButtons}`);

  // Test clicking "Use this" on first match
  if (useButtons > 0) {
    await page.locator('button:has-text("Use this")').first().click();
    const selected = await page.locator('button:has-text("Selected")').count();
    console.log(`After clicking "Use this": ${selected} clips selected`);
  }

  // Test video preview - click a thumbnail
  if (thumbnails > 0) {
    await page.locator('.aspect-video').first().click();
    await page.waitForTimeout(1000);
    const modal = await page.locator('[class*="fixed inset-0"]').count();
    console.log(`Video preview modal: ${modal > 0 ? 'OPENED' : 'NOT OPENED'}`);

    if (modal > 0) {
      const iframe = await page.locator('iframe').count();
      const driveLink = await page.locator('text="Open in Drive"').count();
      console.log(`  Drive video iframe: ${iframe > 0 ? 'YES' : 'NO'}`);
      console.log(`  "Open in Drive" link: ${driveLink > 0 ? 'YES' : 'NO'}`);

      // Close modal
      await page.locator('text="×"').click();
    }
  }

  // Take final screenshot
  await page.screenshot({ path: '/Users/mubasel/Downloads/_KEEP/broll-engine/test_final.png', fullPage: true });
  console.log('Final screenshot saved');

  if (thumbnails > 0 && useButtons > 0) {
    console.log('\n=== ALL TESTS PASSED ===');
  } else {
    console.log('\n=== SOME TESTS FAILED ===');
  }

  await browser.close();
}

test().catch(e => console.error('Test failed:', e));
