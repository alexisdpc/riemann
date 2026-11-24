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
  const branches = [...document.querySelectorAll('.toc-toggle')].map(button => ({
    button, list: document.getElementById(button.getAttribute('aria-controls')),
    link: button.parentElement.querySelector('a'),
  }));
  const branchByList = new Map(branches.map(branch => [branch.list.id, branch]));
  const branchByLink = new Map(branches.map(branch => [branch.link, branch]));
  const setBranch = (branch, open) => {
    branch.list.hidden = !open;
    branch.button.setAttribute('aria-expanded', String(open));
    branch.button.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} subsections of ${branch.link.dataset.noteNumber}`);
    branch.button.querySelector('span').textContent = open ? '−' : '+';
  };
  const ancestors = link => {
    const result = [];
    for (let list = link.closest('.toc-children'); list; list = list.parentElement.closest('.toc-children')) {
      result.push(branchByList.get(list.id));
    }
    return result;
  };
  const reveal = link => {
    ancestors(link).forEach(branch => setBranch(branch, true));
    if (branchByLink.has(link)) setBranch(branchByLink.get(link), true);
    requestAnimationFrame(() => {
      if (compact.matches && !contents.open) return;
      const scroller = document.querySelector(compact.matches ? '.technical-toc nav' : '.technical-toc');
      const bounds = scroller.getBoundingClientRect();
      const item = link.getBoundingClientRect();
      if (item.bottom > bounds.bottom) scroller.scrollTop += item.bottom - bounds.bottom + 12;
      else if (item.top < bounds.top) scroller.scrollTop += item.top - bounds.top - 12;
    });
  };
  branches.forEach(branch => {
    branch.button.hidden = false;
    setBranch(branch, false);
    branch.button.addEventListener('click', () => setBranch(branch, branch.list.hidden));
  });
  const actions = document.querySelector('.toc-actions');
  if (actions) {
    actions.hidden = false;
    actions.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
      const open = button.dataset.tocAction === 'expand';
      branches.forEach(branch => setBranch(branch, open));
    }));
  }
  const revealHash = () => {
    let id;
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    let index = sections.findIndex(section => section === target || target.contains(section));
    // Older links may target a section wrapper or a checklist row rather than a heading.
    if (index < 0) {
      sections.forEach((section, i) => {
        if (section.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) index = i;
      });
    }
    if (index >= 0) reveal(links[index]);
  };
  links.forEach(link => link.addEventListener('click', () => {
    reveal(link);
    if (compact.matches && contents) contents.open = false;
  }));
  window.addEventListener('hashchange', revealHash);
  contents?.addEventListener('toggle', () => {
    if (contents.open && compact.matches) revealHash();
  });
  revealHash();
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
        link.classList.remove('is-current-path');
      });
      if (links[current]) ancestors(links[current]).forEach(branch => branch.link.classList.add('is-current-path'));
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
