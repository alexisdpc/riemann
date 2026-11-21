/* Progressive enhancement: the complete narrative remains in the HTML. */
(() => {
  const toggle = document.querySelector('#menu-toggle');
  const nav = document.querySelector('#main-nav');
  const closeMenu = () => { toggle?.setAttribute('aria-expanded', 'false'); nav?.classList.remove('is-open'); };
  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open)); nav?.classList.toggle('is-open', open);
  });
  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') { closeMenu(); toggle.focus(); } });
  matchMedia('(min-width: 901px)').addEventListener('change', closeMenu);
  const progress = document.querySelector('#reading-progress');
  let scheduled = false;
  const updateProgress = () => {
    const available = document.documentElement.scrollHeight - innerHeight;
    if (progress) progress.style.width = `${available > 0 ? Math.min(100, Math.max(0, scrollY / available * 100)) : 0}%`;
    scheduled = false;
  };
  addEventListener('scroll', () => { if (!scheduled) { scheduled = true; requestAnimationFrame(updateProgress); } }, { passive: true });
  addEventListener('resize', updateProgress); addEventListener('load', updateProgress); updateProgress();
  const map = document.querySelector('#proof-map');
  const tabs = [...document.querySelectorAll('[data-step]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  if (map && tabs.length && panels.every(Boolean)) {
    const select = (index, focus = false) => {
      tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; panels[i].hidden = i !== index; });
      if (focus) tabs[index].focus();
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(index));
      tab.addEventListener('keydown', event => {
        const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
        if (next !== undefined) { event.preventDefault(); select(next, true); }
      });
    });
    select(0); map.dataset.enhanced = 'true';
  }
  const slider = document.querySelector('#sigma');
  const updateReflection = () => {
    const sigma = Number(slider.value), reflected = 1 - sigma;
    const x = value => 80 + value * 380;
    document.querySelector('#sigma-value').textContent = sigma.toFixed(2);
    document.querySelector('#point-original').setAttribute('cx', x(sigma));
    document.querySelector('#point-reflected').setAttribute('cx', x(reflected));
    document.querySelector('#label-original').setAttribute('x', x(sigma));
    document.querySelector('#label-reflected').setAttribute('x', x(reflected));
    document.querySelector('#reflection-join').setAttribute('x1', x(sigma));
    document.querySelector('#reflection-join').setAttribute('x2', x(reflected));
    document.querySelector('#point-original-coordinate').textContent = `${sigma.toFixed(2)} + it`;
    document.querySelector('#point-reflected-coordinate').textContent = `${reflected.toFixed(2)} − it`;
    document.querySelector('#reflection-summary').textContent = sigma < .5
      ? `A zero at real part ${sigma.toFixed(2)} would give a zero for the inverse character at real part ${reflected.toFixed(2)}. The nonvanishing input excludes that reflected zero.`
      : 'At real part 0.50, reflection stays on the critical line. The input excludes zeros strictly to its right, so it gives no contradiction here.';
    document.querySelector('#reflection-diagram').setAttribute('aria-label', `Hypothetical zero at real part ${sigma.toFixed(2)}, reflected to real part ${reflected.toFixed(2)} for the inverse character. Imaginary parts have opposite signs.`);
  };
  if (slider) { slider.addEventListener('input', updateReflection); updateReflection(); }
})();
