import React from 'react';

const features = [
  {
    number: '01',
    title: 'Găsește oportunități',
    description: 'Explorează joburile și filtrează rezultatele după criteriile tale de selecție.',
    icon: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
  },
  {
    number: '02',
    title: 'Evaluează relevanța',
    description: 'Compară oportunitățile cu preferințele tale, prin scorul FIT explicabil.',
    icon: <><path d="M4 19h16M7 15v-4m5 4V5m5 10V8"/><circle cx="7" cy="8" r="1"/></>,
  },
  {
    number: '03',
    title: 'Organizează aplicările',
    description: 'Păstrează joburile de analizat, înregistrează aplicările și arhivează oportunitățile.',
    icon: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M9 5V3h6v2m-6 8 2 2 4-4"/></>,
  },
];

export default function LandingPage({ signIn, environmentMarker, authError, authStatus }) {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 sm:px-8 lg:px-12">
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 py-5 safe-top">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/icons/icon-192.svg" width="44" height="44" alt="" className="h-11 w-11 shrink-0 rounded-xl"/>
            <div className="min-w-0">
              <p className="font-display text-base font-extrabold tracking-tight sm:text-lg">Job Search</p>
              <p className="text-xs font-medium text-slate-400">Command Center</p>
            </div>
          </div>
          {environmentMarker}
        </header>

        <main className="flex flex-1 flex-col justify-center gap-8 py-10 sm:gap-12 sm:py-14 lg:py-16" data-testid="public-landing">
          <div className="grid min-w-0 items-center gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)] lg:gap-16">
            <section aria-labelledby="landing-title" className="min-w-0">
              <p className="mb-4 text-xs font-bold uppercase tracking-widest text-blue-300">Job Search Command Center</p>
              <h1 id="landing-title" className="font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                Căutarea ta de joburi.<br className="hidden sm:block"/> <span className="text-blue-300">Sub control.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
                Descoperă oportunități, evaluează relevanța lor și urmărește aplicările. Totul într-un singur spațiu de lucru.
              </p>
            </section>

            <section aria-labelledby="landing-signin-title" aria-busy={authStatus === 'authenticating'} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl sm:p-8" data-testid="landing-signin">
              <p className="text-xs font-bold uppercase tracking-widest text-blue-700">Spațiul tău de lucru</p>
              <h2 id="landing-signin-title" className="mt-3 font-display text-2xl font-extrabold tracking-tight">Bine ai venit</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">Accesează aplicația cu contul Google autorizat.</p>
              <div className="mt-6 flex min-h-11 min-w-0 items-center" data-testid="landing-google-control">{signIn}</div>
              {authStatus === 'authenticating' && <p role="status" className="mt-3 text-sm text-slate-600">Se verifică sesiunea...</p>}
              {authError && <div role="alert" className="mt-4 break-words rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{authError}</div>}
              <div className="mt-6 flex items-start gap-2 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-600">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="mt-0.5 h-4 w-4 shrink-0"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
                <span>Acces securizat. Datele personale sunt disponibile numai după autentificare.</span>
              </div>
            </section>
          </div>

          <section aria-label="Funcționalitățile aplicației" className="grid min-w-0 gap-3 sm:grid-cols-3 sm:gap-4">
            {features.map(feature => (
              <article key={feature.number} className="min-w-0 rounded-xl border border-slate-700 bg-slate-900 p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-blue-600 text-white">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">{feature.icon}</svg>
                  </span>
                  <span aria-hidden="true" className="text-xs font-semibold tabular-nums text-slate-400">{feature.number}</span>
                </div>
                <h2 className="font-display text-lg font-bold">{feature.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{feature.description}</p>
              </article>
            ))}
          </section>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 py-5 text-xs text-slate-400 safe-bottom">
          <span>JSCC · Job Search Command Center</span>
          <span>Web &amp; Mobile</span>
        </footer>
      </div>
    </div>
  );
}
