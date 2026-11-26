import React from 'react';
import desktopApprovedImage from './assets/jscc-desktop-approved.webp';

const features = [
  { number:'01', title:'Find what is new', description:'Surface relevant opportunities using your own search criteria.', icon:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></> },
  { number:'02', title:'Review efficiently', description:'Keep a focused review queue and understand each job’s FIT score.', icon:<><path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5"/></> },
  { number:'03', title:'Stay on top of applications', description:'Organize your applications and keep track of your next steps.', icon:<><rect x="4" y="13" width="3" height="7" rx=".5"/><rect x="10" y="8" width="3" height="12" rx=".5"/><rect x="16" y="3" width="3" height="17" rx=".5"/></> },
];

const compactFeatures = [
  { ...features[0], title:'Find relevant jobs' },
  { ...features[1], title:'Stay organized' },
  { ...features[2], title:'Be more effective' },
  { number:'04', title:'Your data, your control', description:'Secure, personal and private workspace.', icon:<path d="M12 3 21 7v5c0 5-4 8-9 10-5-2-9-5-9-10V7l9-4Z"/> },
];

function CompactWorkspacePreview(){
  return <figure className="mx-auto w-full max-w-[440px] px-3 pt-3 xl:hidden" aria-label="Illustrative laptop preview of JSCC">
    <div className="relative isolate mx-auto w-full max-w-[390px]">
      <div aria-hidden="true" className="absolute -inset-x-4 bottom-1 top-8 -z-10 rounded-[50%] bg-blue-100/80"/>
      <div className="mx-auto w-[91%] rounded-t-xl border-[5px] border-slate-950 bg-slate-950 p-0.5 shadow-xl sm:border-[7px]">
        <div className="grid aspect-[1.75] grid-cols-[31%_minmax(0,1fr)] overflow-hidden rounded-t-md bg-white text-[9px] leading-tight sm:text-[11px]">
          <div className="min-w-0 bg-[#0d294b] px-1.5 py-2 text-white sm:px-2.5">
            <p className="mb-2 font-bold">JSCC</p>
            {['Joburi noi','De analizat','Aplicări','Arhivate'].map((item,i)=><div key={item} className={'mb-1 rounded px-1 py-1.5 '+(i===0?'bg-blue-600':'')}>{item}</div>)}
          </div>
          <div className="min-w-0 space-y-2 bg-slate-100 p-2 sm:p-3">
            <div className="flex items-center justify-between"><span className="font-bold text-slate-800">Joburi</span><span aria-hidden="true" className="h-2 w-9 rounded-full bg-blue-200"/></div>
            {['Delivery Manager','IT Project Manager','Service Manager'].map((title,i)=><div key={title} className="flex items-center gap-1.5 rounded-md bg-white p-1.5 text-slate-800 sm:p-2"><span aria-hidden="true" className="h-5 w-5 shrink-0 rounded bg-blue-100"/><div className="min-w-0 flex-1"><p className="truncate font-semibold">{title}</p><span aria-hidden="true" className="mt-1 block h-1 w-3/4 rounded bg-slate-200"/></div><span className="shrink-0 rounded bg-blue-50 p-1 text-blue-700">{[85,80,70][i]}%</span></div>)}
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="mx-auto h-2 w-full rounded-b-[50%] rounded-t-sm bg-gradient-to-b from-slate-300 to-slate-500 shadow-md"><div className="mx-auto h-1 w-1/4 rounded-b bg-slate-400"/></div>
    </div>
    <figcaption className="mt-2 text-center text-[10px] text-slate-500">Illustrative preview · example data</figcaption>
  </figure>;
}

function CompactLogo(){
  return <span className="flex shrink-0 items-center gap-1.5 font-display text-xl font-extrabold text-white"><svg aria-hidden="true" viewBox="0 0 30 30" className="h-7 w-7"><rect x="2" y="16" width="7" height="12" rx="1" fill="#0783ed"/><rect x="11" y="9" width="7" height="19" rx="1" fill="#168efa"/><rect x="20" y="2" width="7" height="26" rx="1" fill="#209cff"/></svg>JSCC</span>;
}

function Logo(){
  return <span className="flex shrink-0 items-center gap-2 font-display text-xl font-extrabold tracking-tight"><svg aria-hidden="true" viewBox="0 0 48 40" className="h-9 w-10" fill="none"><path d="M15 3h17a4 4 0 0 1 3.5 6L22 29H5a4 4 0 0 1-3.5-6L15 3Z" fill="#1685f8"/><path d="M26 12h17a4 4 0 0 1 3.5 6L33 38H16a4 4 0 0 1-3.5-6L26 12Z" fill="#39bdf8"/><path d="m26 12-12 17h8l12-17h-8Z" fill="#8edaff" opacity=".65"/></svg>JSCC</span>;
}

function WorkspacePreview(){
  return <figure aria-label="Approved desktop design concept" className="hidden min-w-0 xl:block" data-testid="desktop-approved-preview">
    <img src={desktopApprovedImage} width={885} height={660} alt="JSCC desktop design concept showing an illustrative dashboard, summary cards and application charts" className="block h-auto w-full rounded-xl object-contain" decoding="async"/>
    <figcaption className="mt-3 text-center text-xs leading-relaxed text-slate-300">Concept illustration. Example data · not a live dashboard. Analytics shown are illustrative, not currently available.</figcaption>
  </figure>;
}

export default function LandingPage({ signIn, environmentMarker, authError, authStatus }) {
  return (
    <div className="relative isolate min-h-screen bg-white text-slate-900 xl:bg-[#071326] xl:text-slate-50" lang="en">
      <div aria-hidden="true" className="absolute inset-0 -z-10 hidden xl:block" style={{backgroundImage:'radial-gradient(ellipse at 82% 33%, #103b68 0%, transparent 46%), radial-gradient(ellipse at 37% 100%, #1e2354 0%, transparent 50%)'}}/>
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 sm:px-8 lg:px-14">
        <header className="-mx-4 flex min-w-0 flex-wrap items-center justify-between gap-2 bg-[#0d294b] px-4 py-3 text-white sm:-mx-8 sm:px-8 lg:-mx-14 lg:px-14 xl:mx-0 xl:bg-transparent xl:px-0 xl:py-5 safe-top">
          <div className="flex min-w-0 items-center gap-4"><a href="#overview" aria-label="JSCC overview"><span className="xl:hidden"><CompactLogo/></span><span className="hidden xl:inline"><Logo/></span></a><span className="hidden text-sm text-slate-200 sm:inline xl:border-l xl:border-slate-500 xl:pl-4">Job Search Command Center</span>{environmentMarker}</div>
          <nav aria-label="Public navigation" className="hidden flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold sm:flex sm:gap-x-7">
            <a className="hidden hover:text-sky-300 xl:inline" href="#overview">Overview</a>
            <a className="hidden hover:text-sky-300 xl:inline" href="#benefits">Benefits</a>
            <a className="hidden hover:text-sky-300 xl:inline" href="#security">Security</a>
            <a href="#signin" className="inline-flex min-h-11 items-center rounded-full border border-sky-400 px-5 text-white shadow-[0_0_16px_#0ea5e950] hover:bg-blue-900/70">Sign in</a>
          </nav>
          <details className="relative sm:hidden">
            <summary aria-label="Open navigation menu" className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-sky-300 [&::-webkit-details-marker]:hidden"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h16"/></svg></summary>
            <nav aria-label="Mobile navigation" className="absolute right-0 top-full z-20 min-w-40 rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900 shadow-lg">
              {['overview','benefits','security','signin'].map((id,i)=><a key={id} href={'#'+id} onClick={event=>event.currentTarget.closest('details')?.removeAttribute('open')} className="flex min-h-11 items-center rounded px-3 hover:bg-blue-50">{['Overview','Benefits','Security','Sign in'][i]}</a>)}
            </nav>
          </details>
        </header>

        <main id="overview" className="flex flex-1 flex-col gap-5 py-5 sm:gap-8 sm:py-10 xl:justify-center xl:gap-12 xl:py-16" data-testid="public-landing">
          <div className="grid min-w-0 items-center gap-3 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)] xl:gap-10">
            <section aria-labelledby="landing-title" className="min-w-0 text-center xl:text-left">
              <h1 id="landing-title" className="font-display text-[clamp(1.65rem,5.5vw,2.6rem)] font-extrabold leading-[1.12] tracking-tight xl:text-[clamp(2.25rem,4.5vw,4.25rem)] xl:leading-[1.08]"><span className="xl:hidden">Your Job Search<br/>Under Control.</span><span className="hidden xl:inline">Your job search.<br/><span className="text-sky-400">Under control.</span></span></h1>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-700 sm:text-lg xl:mx-0 xl:mt-6 xl:text-xl xl:text-slate-300"><span className="xl:hidden">Find, review, and manage job opportunities in one place.</span><span className="hidden xl:inline">Review opportunities, organize decisions, and track applications in one focused workspace.</span></p>
              <section id="signin" aria-label="Google sign in" aria-busy={authStatus === 'authenticating'} className="mt-4 min-w-0 scroll-mt-4 sm:mt-6 xl:mt-8" data-testid="landing-signin">
                <div className="flex min-h-11 min-w-0 items-center justify-center xl:justify-start" data-testid="landing-google-control">{signIn}</div>
                {authStatus === 'authenticating' && <p role="status" className="mt-3 text-sm text-slate-600 xl:text-slate-300">Verifying your session...</p>}
                {authError && <div role="alert" className="mt-4 break-words rounded-lg border border-red-400/60 bg-red-950/70 px-3 py-2 text-sm text-red-100">{authError}</div>}
                <a href="#benefits" className="mt-4 hidden min-h-12 w-full max-w-sm items-center justify-center gap-3 xl:inline-flex rounded-xl border border-slate-400 bg-slate-800/50 px-4 font-semibold hover:border-sky-300 hover:bg-slate-800"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m8 4 12 8-12 8V4Z"/></svg>See how it works</a>
              </section>
            </section>
            <CompactWorkspacePreview/>
            <WorkspacePreview/>
          </div>

          <section id="benefits" aria-label="Benefits" className="relative isolate min-w-0">
            <div className="mx-auto w-full max-w-[460px] divide-y divide-slate-200 xl:hidden" data-testid="compact-benefits">{compactFeatures.map(feature=><article key={feature.number} className="flex items-center gap-4 py-3"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 shrink-0 text-blue-600">{feature.icon}</svg><h2 className="text-sm font-bold sm:text-base">{feature.title}</h2></article>)}</div>
            <div className="relative isolate hidden gap-5 border-t border-sky-500/40 pt-10 xl:grid xl:grid-cols-3">
            <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-1 bg-gradient-to-r from-transparent via-sky-400 to-transparent shadow-[0_0_30px_#38bdf8]"/>
            {features.map(feature => (
              <article key={feature.number} className="flex min-w-0 items-start gap-4 rounded-xl border border-slate-700/60 bg-slate-900/35 p-4 lg:border-0 lg:bg-transparent">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-sky-300/50 bg-gradient-to-br from-blue-800/60 to-slate-900 text-white shadow-inner sm:h-14 sm:w-14"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">{feature.icon}</svg></span>
                <div className="min-w-0"><h2 className="font-display text-lg font-bold leading-tight">{feature.title}</h2><p className="mt-2 text-sm leading-relaxed text-slate-300">{feature.description}</p></div>
              </article>
            ))}
            </div>
          </section>
          <section id="security" aria-labelledby="security-title" className="mx-auto w-full max-w-[460px] rounded-xl border border-slate-200 bg-slate-50 p-4 sm:px-6 xl:max-w-none xl:border-slate-700/60 xl:bg-slate-900/40">
            <h2 id="security-title" className="font-display text-base font-bold">Secure access</h2><p className="mt-1 text-sm text-slate-600 xl:text-slate-300">Sign in with your authorized Google account. Your personal workspace is available only after authentication.</p>
          </section>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 py-4 text-xs text-slate-500 xl:border-slate-800 xl:text-slate-400 safe-bottom"><span>JSCC · Job Search Command Center</span><span>Web &amp; Mobile</span></footer>
      </div>
    </div>
  );
}
