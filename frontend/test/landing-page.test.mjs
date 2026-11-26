import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const landing = readFileSync(new URL('../src/landing-page.jsx', import.meta.url), 'utf8');

test('#696: public landing preserves signed-out boundary and Google credential wiring', () => {
  assert.match(main, /if\(auth\.status!=='authenticated'\)return<><SignedOutScreen/);
  const block = main.slice(main.indexOf('function SignedOutScreen('), main.indexOf('function SidebarBadge('));
  assert.ok(block.includes('<GoogleSignIn clientId={clientId} loginHint={loginHint} allowAutoRestore={allowAutoRestore} onCredential={onCredential}'));
  assert.ok(block.includes("disabled={authStatus==='authenticating'}"));
  assert.ok(block.includes('<LandingPage signIn={signIn}'));
  assert.ok(block.includes('<EnvironmentMarker environment={environment}/>'));
  assert.ok(main.includes('onCredential={handleCredential} environment={environment}'));
  assert.ok(main.includes('<ApplicationHeader email={auth.email}'));
});

test('#696: one shared responsive public page, sign-in before features on mobile', () => {
  assert.match(landing, /data-testid="public-landing"/);
  assert.match(landing, /xl:grid-cols-/);
  assert.match(landing, /xl:grid-cols-3/);
  assert.match(landing, /function Logo\(/);
  assert.ok(landing.indexOf('data-testid="landing-signin"') < landing.indexOf('features.map'));
  assert.ok(landing.includes('{signIn}'));
  assert.ok(landing.includes('{environmentMarker}'));
  assert.match(landing, /role="alert"/);
  assert.match(landing, /role="status"/);
  assert.match(landing, /aria-busy=/);
});

test('#696: landing layout does not access private application data or implement auth', () => {
  assert.doesNotMatch(landing, /fetch\(|commandApi\(|localStorage|sessionStorage|\/me\/|\/admin\/|\/applications|google\.accounts/);
  assert.doesNotMatch(landing, /ATS Score|CV parsing|aplicare automată/);
});

test('#696 web mockup: public navigation targets are real and the preview is explicitly illustrative', () => {
  for (const id of ['overview','benefits','security','signin']) {
    assert.ok(landing.includes('href="#'+id+'"'));
    assert.ok(landing.includes('id="'+id+'"'));
  }
  assert.ok(landing.includes('Your job search.'));
  assert.ok(landing.includes('Under control.'));
  assert.ok(landing.includes('Example data · not a live dashboard'));
  assert.ok(landing.includes('See how it works'));
});

test('#696: tablet and mobile follow the compact light reference; desktop keeps the dark reference', () => {
  assert.ok(landing.includes('bg-white text-slate-900 xl:bg-[#071326]'));
  assert.ok(landing.includes('Your Job Search<br/>Under Control.'));
  assert.ok(landing.includes('Find, review, and manage job opportunities in one place.'));
  assert.ok(landing.includes('<CompactWorkspacePreview/>'));
  assert.ok(landing.includes('data-testid="compact-benefits"'));
  for (const label of ['Find relevant jobs','Stay organized','Be more effective','Your data, your control']) assert.ok(landing.includes(label));
  assert.ok(landing.includes('aria-label="Mobile navigation"'));
  assert.equal((landing.match(/\{signIn\}/g)||[]).length,1);
});

test('#696: desktop uses the supplied approved image, while compact layout remains separate', () => {
  const start = landing.indexOf('function WorkspacePreview(){');
  const end = landing.indexOf('export default function LandingPage(', start);
  const preview = landing.slice(start, end);
  assert.ok(landing.includes("import desktopApprovedImage from './assets/jscc-desktop-approved.webp'"));
  assert.ok(preview.includes('src={desktopApprovedImage}'));
  assert.ok(preview.includes('xl:block'));
  assert.ok(preview.includes('Analytics shown are illustrative, not currently available.'));
  assert.ok(landing.includes('<CompactWorkspacePreview/>'));
  const image = readFileSync(new URL('../src/assets/jscc-desktop-approved.webp', import.meta.url));
  assert.equal(image.toString('ascii', 0, 4), 'RIFF');
  assert.equal(image.toString('ascii', 8, 12), 'WEBP');
});
