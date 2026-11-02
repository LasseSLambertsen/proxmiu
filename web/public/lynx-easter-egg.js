(() => {
  let clicks = 0
  let lastClick = 0

  const css = `
    #proxmiu-lynx { position:fixed; right:max(20px,env(safe-area-inset-right)); bottom:24px; z-index:45; width:184px; color:#f5f1e9; font:13px/1.45 system-ui,sans-serif; animation:lynx-arrive .45s cubic-bezier(.16,1,.3,1) both; }
    #proxmiu-lynx * { box-sizing:border-box; }
    #proxmiu-lynx .lynx-message { position:relative; margin:0 0 -5px; padding:12px 30px 12px 14px; border-radius:16px 16px 4px 16px; background:#252a34; box-shadow:0 8px 28px #0003; min-height:60px; }
    #proxmiu-lynx button { appearance:none; border:0; color:inherit; cursor:pointer; font:inherit; }
    #proxmiu-lynx button:focus-visible { outline:2px solid #f0a23a; outline-offset:4px; }
    #proxmiu-lynx .lynx-close { position:absolute; right:5px; top:5px; width:30px; height:30px; padding:7px; border-radius:50%; background:transparent; color:#d5d0c8; }
    #proxmiu-lynx .lynx-close:hover { background:#ffffff14; }
    #proxmiu-lynx .lynx-pet { display:block; width:160px; height:152px; padding:0; margin:0 auto; background:transparent; -webkit-tap-highlight-color:transparent; }
    #proxmiu-lynx .lynx-pet>svg { width:160px; height:150px; overflow:visible; filter:drop-shadow(0 8px 5px #0002); }
    #proxmiu-lynx .lynx-tail { transform-origin:104px 111px; animation:lynx-tail 3.5s ease-in-out infinite; }
    #proxmiu-lynx .lynx-head { transform-origin:80px 98px; animation:lynx-nod 5s ease-in-out infinite; }
    #proxmiu-lynx .lynx-eyes { transform-box:fill-box; transform-origin:center; animation:lynx-blink 5.5s infinite; }
    #proxmiu-lynx .lynx-led { animation:lynx-led 3s ease-in-out infinite; }
    #proxmiu-lynx.is-petted .lynx-head { animation:lynx-purr .8s ease-in-out; }
    #proxmiu-lynx.is-petted .lynx-tail { animation:lynx-tail .35s ease-in-out infinite; }
    @keyframes lynx-arrive { from { opacity:0; transform:translateY(18px) rotate(3deg); } to { opacity:1; transform:translateY(0) rotate(0); } }
    @keyframes lynx-tail { 0%,100% { transform:rotate(-8deg); } 50% { transform:rotate(13deg); } }
    @keyframes lynx-nod { 0%,65%,100% { transform:rotate(0); } 78%,90% { transform:rotate(-5deg) translateY(-2px); } }
    @keyframes lynx-blink { 0%,43%,47%,100% { transform:scaleY(1); } 45% { transform:scaleY(.08); } }
    @keyframes lynx-led { 0%,100% { opacity:.65; } 50% { opacity:1; } }
    @keyframes lynx-purr { 0%,100% { transform:rotate(0); } 25%,75% { transform:rotate(-7deg) translateY(-3px); } 50% { transform:rotate(7deg) translateY(-3px); } }
    @media(max-width:639px) { #proxmiu-lynx { right:max(16px,env(safe-area-inset-right)); bottom:calc(104px + env(safe-area-inset-bottom)); } #proxmiu-lynx .lynx-close { width:36px; height:36px; top:2px; right:2px; } #proxmiu-lynx .lynx-message { padding-right:38px; } }
    @media(prefers-reduced-motion:reduce) { #proxmiu-lynx, #proxmiu-lynx * { animation:none !important; transition:none !important; } }
  `

  function wake(trigger) {
    const existing = document.getElementById('proxmiu-lynx')
    if (existing) {
      existing.querySelector('.lynx-pet').click()
      return
    }
    if (!document.getElementById('proxmiu-lynx-style')) {
      const style = document.createElement('style')
      style.id = 'proxmiu-lynx-style'
      style.textContent = css
      document.head.append(style)
    }
    const panel = document.createElement('aside')
    panel.id = 'proxmiu-lynx'
    panel.setAttribute('aria-label', 'Proxmiu lynx')
    panel.innerHTML = `
      <p class="lynx-message" role="status">Oh, hi. I live here.</p>
      <button type="button" class="lynx-close" aria-label="Dismiss lynx"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg></button>
      <button type="button" class="lynx-pet" aria-label="Pet the lynx">
        <svg viewBox="0 0 160 150" fill="none" aria-hidden="true">
          <ellipse cx="80" cy="136" rx="40" ry="5" fill="#171b23" opacity=".18"/>
          <g class="lynx-tail"><path d="M105 113c38 4 48-29 31-37" stroke="#e38a24" stroke-width="13" stroke-linecap="round"/><path d="M140 82q0-5-4-6" stroke="#252a34" stroke-width="13" stroke-linecap="round"/></g>
          <ellipse cx="80" cy="113" rx="33" ry="22" fill="#e38a24"/>
          <path d="M67 101h26l-5 30H72l-5-30Z" fill="#ffd184"/>
          <rect x="52" y="117" width="17" height="19" rx="8" fill="#f0a23a"/>
          <rect x="91" y="117" width="17" height="19" rx="8" fill="#f0a23a"/>
          <path d="M54 133h13m26 0h13" stroke="#252a34" stroke-width="5" stroke-linecap="round"/>
          <g class="lynx-head"><g transform="translate(28 7) scale(1.65)">
            <path d="m12 8 14 14h12L52 8l3 24 5 9-5-1 2 10-6-3-7 9-5-1-7 4-7-4-5 1-7-9-6 3 2-10-5 1 5-9 3-24Z" fill="#f0a23a"/>
            <path d="m14 15 10 12-11 5 1-17Zm36 0L40 27l11 5-1-17Z" fill="#ffd184"/>
            <path d="m12 8 14 14 6 11-12-8-8-17Zm40 0L38 22l-6 11 12-8 8-17Z" fill="#ffb640"/>
            <path d="m19 30 10 3h6l10-3 8 9-7 7-8 2-6-3-6 3-8-2-7-7 8-9Z" fill="#171b23"/>
            <g class="lynx-eyes"><path d="m17 36 7 2 3 4c-6 1-8-1-10-6Zm30 0-7 2-3 4c6 1 8-1 10-6Z" fill="#ffe1a3"/></g>
            <rect x="29" y="33" width="6" height="3" rx="1" fill="#54504a"/><rect x="29" y="38" width="6" height="3" rx="1" fill="#54504a"/>
            <circle class="lynx-led" cx="34" cy="34.5" r="1.2" fill="#39d8c2"/>
            <path d="m25 48 7 3 7-3-2 7-5 3-5-3-2-7Z" fill="#ffd184"/><path d="m28 49 4 4 4-4h-8Z" fill="#171b23"/>
          </g></g>
        </svg>
      </button>`
    document.body.append(panel)
    let purrTimer
    const dismiss = () => {
      const restoreFocus = panel.contains(document.activeElement)
      clearTimeout(purrTimer)
      panel.remove()
      document.removeEventListener('keydown', onKey)
      if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true })
    }
    const onKey = (event) => { if (event.key === 'Escape') dismiss() }
    panel.querySelector('.lynx-close').addEventListener('click', dismiss)
    panel.querySelector('.lynx-pet').addEventListener('click', () => {
      panel.querySelector('.lynx-message').textContent = 'Purr. All systems cozy.'
      panel.classList.add('is-petted')
      clearTimeout(purrTimer)
      purrTimer = setTimeout(() => panel.classList.remove('is-petted'), 800)
    })
    document.addEventListener('keydown', onKey)
  }

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.button !== 0) return
    const trigger = event.target.closest('[data-lynx-trigger]')
    if (!trigger) return
    if (trigger instanceof HTMLAnchorElement) {
      const target = new URL(trigger.href)
      if (target.origin === location.origin && target.pathname === location.pathname && !target.hash) {
        event.preventDefault()
        if (location.href !== target.href) history.replaceState(null, '', target.href)
        window.scrollTo({ top: 0, behavior: 'instant' })
      }
    }
    const now = performance.now()
    clicks = now - lastClick > 1400 ? 1 : clicks + 1
    lastClick = now
    if (clicks >= 5) {
      clicks = 0
      wake(trigger)
    }
  })
})()
