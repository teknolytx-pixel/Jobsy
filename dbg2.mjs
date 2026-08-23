import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1440,height:1000} });
await p.goto('http://localhost:3166/login',{waitUntil:'networkidle'});
await p.fill('input[type=email]','recruiter@demo.jobsy');
await p.fill('input[type=password]','local-dev-pw');
await p.click('button:has-text("Sign in")');
await p.waitForTimeout(2500);
await p.goto('http://localhost:3166/jobs',{waitUntil:'networkidle'});
const info = await p.evaluate(()=>{
  const rows=[...document.querySelectorAll('.row')];
  return rows.map(r=>({
    text: r.innerText.split('\n')[0],
    buttons: [...r.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')||b.className),
  }));
});
console.log(JSON.stringify(info,null,1));
await b.close();
