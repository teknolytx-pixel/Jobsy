import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1440,height:1000} });
const log=(m)=>console.log(m);
const badge = async () => p.evaluate(()=>{
  const r=[...document.querySelectorAll('.row')].find(x=>x.innerText.includes('rescue me'));
  return r ? r.querySelector('.badge').innerText : null;
});
const openSheet = async () => { await p.click('button[aria-label*="rescue me"]'); await p.waitForTimeout(500); };

await p.goto('http://localhost:3166/login',{waitUntil:'networkidle'});
await p.fill('input[type=email]','recruiter@demo.jobsy');
await p.fill('input[type=password]','local-dev-pw');
await p.click('button:has-text("Sign in")');
await p.waitForTimeout(2500);
await p.goto('http://localhost:3166/jobs',{waitUntil:'networkidle'});
log(`  1. draft is listed, badge = ${await badge()}`);

await openSheet();
const sheet = await p.locator('.sheet .inner').innerText();
const offered = ['Publish','Pause','Close','Archive'].filter(x=>new RegExp(`^${x}$`,'m').test(sheet));
log(`  2. moves offered = [${offered.join(', ')}]   (DRAFT may only publish or archive)`);

await p.click('.sheet button:has-text("Publish")');
await p.waitForTimeout(1500);
const err = await p.locator('.sheet .err').innerText().catch(()=>'(no error)');
log(`  3. publish refused → ${err.split('\n')[0].slice(0,110)}`);
const probs = await p.locator('.sheet .err li').allInnerTexts().catch(()=>[]);
log(`     problems listed: ${probs.length}`);

await p.click('.sheet button:has-text("Edit details")');
await p.waitForTimeout(400);
await p.fill('.sheet input[inputmode=numeric] >> nth=0','150');
await p.fill('.sheet input[inputmode=numeric] >> nth=1','190');
await p.fill('.sheet textarea','Health, dental, 401k match and 20 days paid leave.');
await p.click('.sheet button:has-text("Save changes")');
await p.waitForTimeout(2000);
log(`  4. saved salary + benefits inline`);

await p.goto('http://localhost:3166/jobs',{waitUntil:'networkidle'});
await openSheet();
await p.click('.sheet button:has-text("Publish")');
await p.waitForTimeout(2000);
await p.goto('http://localhost:3166/jobs',{waitUntil:'networkidle'});
log(`  5. after publish, badge = ${await badge()}`);
await p.screenshot({ path:'/home/claude/shots/jobs-manage.png', fullPage:true });
await b.close();
