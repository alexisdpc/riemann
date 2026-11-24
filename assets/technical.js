/* Navigation only: all technical content and equations load independently. */
(() => {
  const toggle = document.querySelector('#menu-toggle');
  const nav = document.querySelector('#main-nav');
  const closeMenu = () => {
    toggle?.setAttribute('aria-expanded', 'false');
    nav?.classList.remove('is-open');
  };
  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    nav?.classList.toggle('is-open', open);
  });
  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      toggle.focus();
    }
  });
  window.matchMedia('(min-width: 901px)').addEventListener('change', closeMenu);

  const contents = document.querySelector('.technical-toc > details');
  const compact = window.matchMedia('(max-width: 850px)');
  if (contents && compact.matches) contents.open = false;
  compact.addEventListener('change', event => {
    if (contents) contents.open = !event.matches;
  });
  const links = [...document.querySelectorAll('.toc-tree a[data-note-number]')];
  const sections = links.map(link => document.getElementById(link.hash.slice(1)));
  // Native disclosures start closed, including when arriving at a deep article link.
  const chapters = [...document.querySelectorAll('.toc-tree > li > .toc-branch')];
  const summaries = [...document.querySelectorAll('.toc-branch > summary')];
  chapters.forEach(chapter => chapter.addEventListener('toggle', () => {
    if (chapter.open) chapters.forEach(other => {
      if (other !== chapter) other.open = false;
    });
  }));
  const ancestors = link => {
    const result = [];
    for (let branch = link.closest('.toc-branch'); branch; branch = branch.parentElement.closest('.toc-branch')) {
      result.push(branch.firstElementChild);
    }
    return result;
  };
  links.forEach(link => link.addEventListener('click', () => {
    if (compact.matches && contents) contents.open = false;
  }));
  const progress = document.querySelector('#reading-progress');
  let scheduled = false;
  let previous = -1;
  const update = () => {
    const available = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = `${available > 0 ? Math.min(100, Math.max(0, window.scrollY / available * 100)) : 0}%`;
    let current = 0;
    sections.forEach((section, index) => {
      if (section && section.getBoundingClientRect().top <= 150) current = index;
    });
    if (current !== previous) {
      links.forEach((link, index) => {
        if (index === current) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
      summaries.forEach(summary => summary.classList.remove('is-current-path'));
      if (links[current]) ancestors(links[current]).forEach(summary => summary.classList.add('is-current-path'));
      previous = current;
    }
    scheduled = false;
  };
  const schedule = () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule, { once: true });
  update();
})();
