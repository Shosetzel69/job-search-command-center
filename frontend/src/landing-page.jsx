import React from 'react';

const features = [
  { number:'01', title:'Find what is new', description:'Surface relevant opportunities using your own search criteria.', icon:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></> },
  { number:'02', title:'Review efficiently', description:'Keep a focused review queue and understand each job’s FIT score.', icon:<><path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5"/></> },
  { number:'03', title:'Stay on top of applications', description:'Organize your applications and keep track of your next steps.', icon:<><rect x="4" y="13" width="3" height="7" rx=".5"/><rect x="10" y="8" width="3" height="12" rx=".5"/><rect x="16" y="3" width="3" height="17" rx=".5"/></> },
];

function Logo(){
  return <span className="flex shrink-0 items-center gap-2 font-display text-xl font-extrabold tracking-tight"><svg aria-hidden="true" viewBox="0 0 48 40" className="h-9 w-10" fill="none"><path d="M15 3h17a4 4 0 0 1 3.5 6L22 29H5a4 4 0 0 1-3.5-6L15 3Z" fill="#1685f8"/><path d="M26 12h17a4 4 0 0 1 3.5 6L33 38H16a4 4 0 0 1-3.5-6L26 12Z" fill="#39bdf8"/><path d="m26 12-12 17h8l12-17h-8Z" fill="#8edaff" opacity=".65"/></svg>JSCC</span>;
}

function WorkspacePreview(){
  // Illustrative presentation only: no data requests, metrics or live account content.
  const jobs=[['Delivery Manager','Hybrid','FIT 85%'],['IT Project Manager','Remote','FIT 80%'],['Service Manager','Onsite','FIT 70%']];
  return <figure aria-label="Illustrative JSCC workspace preview" className="relative isolate min-w-0 py-6 sm:px-3 sm:py-10">
    <div aria-hidden="true" className="absolute inset-x-5 inset-y-4 -z-10 -rotate-3 rounded-3xl border border-blue-400/60 bg-gradient-to-br from-indigo-700/40 to-cyan-500/40 shadow-[0_0_60px_#0ea5e966]"/>
    <div aria-hidden="true" className="absolute inset-x-1 inset-y-9 -z-10 rotate-2 rounded-3xl border border-blue-600/60 bg-blue-900/30"/>
    <div className="relative min-w-0 rounded-2xl border border-sky-300/80 bg-[#0d192d] shadow-[0_0_24px_#0ea5e955,0_18px_60px_#020617] sm:rounded-3xl">
      <div className="flex items-center justify-between gap-2 border-b border-slate-700/70 px-3 py-3 sm:px-5">
        <div className="flex gap-1.5" aria-hidden="true"><span className="h-2 w-2 rounded-full bg-red-400"/><span className="h-2 w-2 rounded-full bg-amber-300"/><span className="h-2 w-2 rounded-full bg-emerald-400"/></div>
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-300">Illustrative preview</span>
      </div>
      <div className="grid min-w-0 grid-cols-1 sm:grid-cols-[112px_minmax(0,1fr)]">
        <div className="hidden border-r border-slate-700/70 bg-slate-950/50 px-3 py-4 sm:block">
          <Logo/>
          <div className="mt-5 space-y-2 text-[11px] text-slate-300">
            {['Jobs','Review queue','Applications','Archived','Preferences'].map((item,i)=><div key={item} className={'rounded-md px-2 py-2 '+(i===0?'bg-blue-800/70 text-sky-100':'')}>{item}</div>)}
          </div>
        </div>
        <div className="min-w-0 space-y-3 p-3 sm:p-4 lg:p-5">
          <div><h2 className="font-display text-base font-bold sm:text-lg">Job Search Command Center</h2><p className="mt-1 text-[11px] text-slate-300">Your opportunities, decisions and applications in one place.</p></div>
          <div className="grid grid-cols-3 gap-2">
            {['New jobs','Review queue','Applications'].map((item,i)=><div key={item} className={'min-w-0 rounded-lg border p-2 sm:p-3 '+['border-blue-400/40 bg-blue-900/40','border-violet-400/40 bg-violet-900/30','border-cyan-400/40 bg-cyan-900/30'][i]}><p className="break-words text-[10px] font-semibold sm:text-xs">{item}</p><p className="mt-2 font-display text-xl font-bold sm:text-2xl">{['24','8','17'][i]}</p></div>)}
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-bold">Job opportunities</h3><span className="rounded bg-blue-900/70 px-2 py-1 text-[10px] text-sky-200">FIT score</span></div>
            <div className="mt-2 divide-y divide-slate-700">{jobs.map(([title,mode,fit])=><div key={title} className="flex min-w-0 items-center gap-2 py-3"><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{title}</p><p className="mt-1 text-[10px] text-slate-400">{mode}</p></div><span className="shrink-0 rounded bg-emerald-900/60 px-2 py-1 text-[10px] font-semibold text-emerald-200">{fit}</span></div>)}</div>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] text-slate-300"><span className="rounded-md border border-slate-600 px-2 py-1">Review</span><span className="rounded-md border border-slate-600 px-2 py-1">Apply</span><span className="rounded-md border border-slate-600 px-2 py-1">Archive</span></div>
        </div>
      </div>
    </div>
    <figcaption className="mt-3 text-center text-xs text-slate-400">Example data · not a live dashboard</figcaption>
  </figure>;
}

export default function LandingPage({ signIn, environmentMarker, authError, authStatus }) {
  return (
    <div className="min-h-screen bg-[#071326] text-slate-50" style={{backgroundImage:'radial-gradient(ellipse at 82% 33%, #103b68 0%, transparent 46%), radial-gradient(ellipse at 37% 100%, #1e2354 0%, transparent 50%)'}}>
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 sm:px-8 lg:px-14">
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-5 safe-top">
          <div className="flex min-w-0 items-center gap-4"><a href="#overview" aria-label="JSCC overview"><Logo/></a><span className="hidden border-l border-slate-500 pl-4 text-sm text-slate-200 xl:inline">Job Search Command Center</span>{environmentMarker}</div>
          <nav aria-label="Public navigation" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold sm:gap-x-7">
            <a className="hidden hover:text-sky-300 sm:inline" href="#overview">Overview</a>
            <a className="hidden hover:text-sky-300 sm:inline" href="#benefits">Benefits</a>
            <a className="hidden hover:text-sky-300 sm:inline" href="#security">Security</a>
            <a href="#signin" className="inline-flex min-h-11 items-center rounded-full border border-sky-400 px-5 text-white shadow-[0_0_16px_#0ea5e950] hover:bg-blue-900/70">Sign in</a>
          </nav>
        </header>

        <main id="overview" className="flex flex-1 flex-col justify-center gap-8 py-8 sm:gap-12 sm:py-14 lg:py-16" data-testid="public-landing">
          <div className="grid min-w-0 items-center gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)] lg:gap-10">
            <section aria-labelledby="landing-title" className="min-w-0">
              <h1 id="landing-title" className="font-display text-[clamp(2.25rem,4.5vw,4.25rem)] font-extrabold leading-[1.08] tracking-tight">Your job search.<br/><span className="text-sky-400">Under control.</span></h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-300 sm:text-xl">Review opportunities, organize decisions, and track applications in one focused workspace.</p>
              <section id="signin" aria-label="Google sign in" aria-busy={authStatus === 'authenticating'} className="mt-8 min-w-0 scroll-mt-4" data-testid="landing-signin">
                <div className="flex min-h-11 min-w-0 items-center" data-testid="landing-google-control">{signIn}</div>
                {authStatus === 'authenticating' && <p role="status" className="mt-3 text-sm text-slate-300">Verifying your session...</p>}
                {authError && <div role="alert" className="mt-4 break-words rounded-lg border border-red-400/60 bg-red-950/70 px-3 py-2 text-sm text-red-100">{authError}</div>}
                <a href="#benefits" className="mt-4 inline-flex min-h-12 w-full max-w-sm items-center justify-center gap-3 rounded-xl border border-slate-400 bg-slate-800/50 px-4 font-semibold hover:border-sky-300 hover:bg-slate-800"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m8 4 12 8-12 8V4Z"/></svg>See how it works</a>
              </section>
            </section>
            <WorkspacePreview/>
          </div>

          <section id="benefits" aria-label="Benefits" className="relative isolate grid min-w-0 gap-3 border-t border-sky-500/40 pt-7 sm:grid-cols-3 sm:gap-5 lg:pt-10">
            <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-1 bg-gradient-to-r from-transparent via-sky-400 to-transparent shadow-[0_0_30px_#38bdf8]"/>
            {features.map(feature => (
              <article key={feature.number} className="flex min-w-0 items-start gap-4 rounded-xl border border-slate-700/60 bg-slate-900/35 p-4 lg:border-0 lg:bg-transparent">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-sky-300/50 bg-gradient-to-br from-blue-800/60 to-slate-900 text-white shadow-inner sm:h-14 sm:w-14"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">{feature.icon}</svg></span>
                <div className="min-w-0"><h2 className="font-display text-lg font-bold leading-tight">{feature.title}</h2><p className="mt-2 text-sm leading-relaxed text-slate-300">{feature.description}</p></div>
              </article>
            ))}
          </section>
          <section id="security" aria-labelledby="security-title" className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 sm:px-6">
            <h2 id="security-title" className="font-display text-base font-bold">Secure access</h2><p className="mt-1 text-sm text-slate-300">Sign in with your authorized Google account. Your personal workspace is available only after authentication.</p>
          </section>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 py-5 text-xs text-slate-400 safe-bottom"><span>JSCC · Job Search Command Center</span><span>Web &amp; Mobile</span></footer>
      </div>
    </div>
  );
}
