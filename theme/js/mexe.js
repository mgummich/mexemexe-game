// Theme behaviour: nav toggle, palette toggle, search, code copy, ToC highlight.
(function () {
  var base = window.MEXE_BASE || '.';
  if (base && !/\/$/.test(base)) base += '/';

  /* ---- mobile navigation ---- */
  var navToggle = document.getElementById('nav-toggle');
  if (navToggle) {
    navToggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
  }

  /* ---- light / dark ---- */
  var themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var root = document.documentElement;
      var dark = root.dataset.theme
        ? root.dataset.theme === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('mexe-theme', root.dataset.theme); } catch (e) {}
    });
  }

  /* ---- search ----
     Scored substring match over the index the built-in search plugin emits.
     ponytail: fine for a few dozen pages; swap in lunr.js if the corpus grows
     enough that stemming and ranking start to matter. */
  var input = document.getElementById('search-input');
  var results = document.getElementById('search-results');
  var navTree = document.getElementById('nav-tree');
  var index = null, loading = null;

  function loadIndex() {
    if (loading) return loading;
    loading = fetch(base + 'search/search_index.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        index = (data.docs || []).filter(function (d) { return d.text; });
        return index;
      })
      .catch(function () { index = []; return index; });
    return loading;
  }

  function score(doc, q) {
    var title = doc.title.toLowerCase(), text = doc.text.toLowerCase();
    if (title === q) return 100;
    if (title.indexOf(q) === 0) return 50;
    if (title.indexOf(q) > -1) return 25;
    var at = text.indexOf(q);
    return at > -1 ? 10 - Math.min(9, at / 400) : 0;
  }

  function excerpt(doc, q) {
    var at = doc.text.toLowerCase().indexOf(q);
    if (at < 0) return doc.text.slice(0, 90);
    var from = Math.max(0, at - 30);
    return (from ? '…' : '') + doc.text.slice(from, from + 90);
  }

  function render(query) {
    var q = query.trim().toLowerCase();
    if (!q) {
      results.hidden = true;
      results.textContent = '';
      if (navTree) navTree.hidden = false;
      return;
    }
    if (navTree) navTree.hidden = true;
    results.hidden = false;
    var hits = (index || [])
      .map(function (d) { return { doc: d, s: score(d, q) }; })
      .filter(function (h) { return h.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, 10);

    results.textContent = '';
    if (!hits.length) {
      var none = document.createElement('div');
      none.className = 'empty';
      none.textContent = 'No matches.';
      results.appendChild(none);
      return;
    }
    hits.forEach(function (h) {
      var a = document.createElement('a');
      a.href = base + h.doc.location;
      var t = document.createElement('span');
      t.className = 'hit-title';
      t.textContent = h.doc.title;
      var x = document.createElement('span');
      x.className = 'hit-text';
      x.textContent = excerpt(h.doc, q);
      a.appendChild(t);
      a.appendChild(x);
      results.appendChild(a);
    });
  }

  if (input && results) {
    input.addEventListener('input', function () {
      loadIndex().then(function () { render(input.value); });
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.value = ''; render(''); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== input) {
        e.preventDefault();
        input.focus();
      }
    });
  }

  /* ---- copy button on code blocks ---- */
  if (navigator.clipboard) {
    document.querySelectorAll('main pre > code').forEach(function (code) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn';
      btn.textContent = 'copy';
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(code.textContent).then(function () {
          btn.textContent = 'copied';
          setTimeout(function () { btn.textContent = 'copy'; }, 1200);
        });
      });
      code.parentNode.appendChild(btn);
    });
  }

  /* ---- highlight the heading currently on screen ---- */
  var tocLinks = document.querySelectorAll('.toc a');
  if (tocLinks.length && window.IntersectionObserver) {
    var byId = {};
    tocLinks.forEach(function (a) { byId[decodeURIComponent(a.hash.slice(1))] = a; });
    var headings = Object.keys(byId)
      .map(function (id) { return document.getElementById(id); })
      .filter(Boolean);
    var visible = new Set();
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) visible.add(e.target.id); else visible.delete(e.target.id);
      });
      var first = headings.find(function (h) { return visible.has(h.id); });
      tocLinks.forEach(function (a) { a.classList.remove('active'); });
      if (first && byId[first.id]) byId[first.id].classList.add('active');
    }, { rootMargin: '0px 0px -70% 0px' });
    headings.forEach(function (h) { observer.observe(h); });
  }
})();
