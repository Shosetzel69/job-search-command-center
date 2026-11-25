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
  assert.match(landing, /lg:grid-cols-/);
  assert.match(landing, /sm:grid-cols-3/);
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
