(function () {
  'use strict';

  var ARTICLES = [
    {
      id: 'nature', category: 'science', label: 'Nature lab', time: '3 min read',
      title: 'A leaf is a tiny solar kitchen',
      summary: 'Follow the surprising path from sunlight to the food that keeps a plant growing.',
      accent: 'sun', symbol: '☀',
      body: [
        'A leaf looks still, but it is busy all day. Inside its cells are tiny green structures that catch light. They use that light to help combine water from the roots with carbon dioxide from the air.',
        'The result is sugar: stored energy the plant can use to grow a new stem, make a flower, or repair a torn edge. Oxygen is released along the way, which is one reason forests and houseplants matter to the air around us.',
        'Thinking of a leaf as a solar kitchen is useful because it turns an invisible process into a chain of clues: light arrives, ingredients move in, and energy is saved for later.'
      ],
      tryIt: 'Find two leaves that grew in different amounts of light. What differences do you notice in color, size, or texture?'
    },
    {
      id: 'patterns', category: 'math', label: 'Pattern play', time: '4 min read',
      title: 'Patterns are math’s way of making predictions',
      summary: 'A pattern is more than a repeat—it is a rule you can use to see what comes next.',
      accent: 'lilac', symbol: '✳',
      body: [
        'Patterns help the brain compress a lot of information into one useful rule. If the tiles on a floor repeat blue, blue, gold, you can predict the next color without memorizing every tile.',
        'In math, a pattern can grow instead of simply repeat. A row of dots might add one dot each time. The important question is not only “what comes next?” but “what is changing, and by how much?”',
        'That question appears outside a notebook too: in a savings goal, a bus schedule, a rhythm, or the shadow of a sundial. A pattern becomes powerful when it helps you make a reasonable prediction.'
      ],
      tryIt: 'Make a four-step pattern using coins, colors, or claps. Then describe the rule without showing the pattern.'
    },
    {
      id: 'stories', category: 'writing', label: 'Story studio', time: '4 min read',
      title: 'A story changes when someone else tells it',
      summary: 'The narrator is not a camera. They choose what to notice, what to miss, and what to believe.',
      accent: 'blue', symbol: '✎',
      body: [
        'Imagine a rainy walk home. One person might remember wet socks. Another might remember how the streetlights shimmered in puddles. Both experienced the same weather, but each story gathers different details.',
        'That is why point of view matters. A narrator carries their knowledge, hopes, and blind spots into every sentence. Changing the narrator can turn the same event into a mystery, a joke, or a warning.',
        'When you read, ask whose voice is guiding you. When you write, decide what your narrator notices first. That small choice gives a story its particular shape.'
      ],
      tryIt: 'Write two sentences about a lost backpack: one from the owner’s view and one from the backpack’s view.'
    },
    {
      id: 'maps', category: 'world', label: 'World window', time: '3 min read',
      title: 'Maps are arguments made with symbols',
      summary: 'Every map highlights some clues and leaves others quiet. Learning to read it means asking what it chose to show.',
      accent: 'peach', symbol: '⌁',
      body: [
        'A map is a helpful shortcut, not a complete copy of a place. A subway map makes lines easy to follow, even if the stations are not placed at their exact real-world angles. A weather map highlights movement in the sky but not every street below.',
        'The legend tells you the map’s language: colors, dots, lines, and shapes are symbols standing in for a much larger world. The scale tells you how a small distance on paper relates to a real distance outside.',
        'A strong map reader asks two questions: “What can this map help me understand?” and “What might be missing because it was not this map’s job to show it?”'
      ],
      tryIt: 'Draw a map from your door to your favorite nearby place. Add a legend for two details only you would know.'
    },
    {
      id: 'sound', category: 'science', label: 'Sound lab', time: '3 min read',
      title: 'Sound is a moving message',
      summary: 'A vibrating object nudges the air, and your ears translate those tiny pushes into meaning.',
      accent: 'mint', symbol: '≈',
      body: [
        'Pluck a rubber band and you can see sound starting: the band moves back and forth. That movement nudges nearby air, which nudges more air, creating a traveling wave.',
        'Your ear catches those waves and turns them into signals your brain can interpret. Faster vibrations generally create higher pitches; bigger vibrations usually feel louder.',
        'Even quiet rooms contain sound. Paying attention to it is a way of noticing motion that is usually invisible.'
      ],
      tryIt: 'Tap three objects made of different materials. Which one makes the shortest sound, and what might explain it?'
    },
    {
      id: 'questions', category: 'writing', label: 'Thinking toolkit', time: '2 min read',
      title: 'A better question opens more than one door',
      summary: 'The most useful questions are specific enough to explore and open enough to surprise you.',
      accent: 'lilac', symbol: '?',
      body: [
        'A question such as “Is this good?” can start a conversation, but it is hard to investigate. Try adding a lens: “Good for whom?” “Good compared with what?” or “What evidence would change my mind?”',
        'Good questions are not fancy. They make the next step visible. They help you look, read, test, compare, or ask someone else.',
        'Curiosity is not about already knowing the answer. It is about choosing a question worth following for a little longer.'
      ],
      tryIt: 'Choose something ordinary near you and write three questions about it that begin with how, why, and what if.'
    }
  ].concat(Array.isArray(window.EDUNO_LIBRARY) ? window.EDUNO_LIBRARY : []);

  var LIST_KEY = 'eduno-reading-list';
  var DAY_KEY = 'eduno-daily-checks-' + new Date().toISOString().slice(0, 10);
  var grid = document.getElementById('article-grid');
  var search = document.getElementById('eduno-search');
  var count = document.getElementById('article-count');
  var empty = document.getElementById('empty-results');
  var dialog = document.querySelector('[data-article-dialog]');
  var shelf = document.querySelector('[data-shelf-dialog]');
  var activeFilter = 'all';
  var activeArticle = null;
  var searchTimer = null;

  function hideBackground(node) {
    node._edunoHiddenSiblings = [];
    Array.prototype.forEach.call(document.body.children, function (sibling) {
      if (sibling === node || sibling.tagName === 'SCRIPT') return;
      node._edunoHiddenSiblings.push({
        node: sibling,
        ariaHidden: sibling.getAttribute('aria-hidden'),
        inert: Boolean(sibling.inert)
      });
      sibling.setAttribute('aria-hidden', 'true');
      if ('inert' in sibling) sibling.inert = true;
    });
  }

  function restoreBackground(node) {
    (node._edunoHiddenSiblings || []).forEach(function (saved) {
      if (saved.ariaHidden === null) saved.node.removeAttribute('aria-hidden');
      else saved.node.setAttribute('aria-hidden', saved.ariaHidden);
      if ('inert' in saved.node) saved.node.inert = saved.inert;
    });
    node._edunoHiddenSiblings = [];
  }

  function focusableElements(node) {
    return Array.prototype.filter.call(
      node.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      function (element) { return element.offsetParent !== null; }
    );
  }

  function restoreFocus(node) {
    if (node._edunoReturnFocus && node._edunoReturnFocus.isConnected) {
      node._edunoReturnFocus.focus();
    }
    node._edunoReturnFocus = null;
  }

  function openDialog(node, returnFocus) {
    node._edunoReturnFocus = returnFocus || document.activeElement;
    node._edunoRestoreOnClose = true;
    if (typeof node.showModal === 'function') {
      node.showModal();
    } else {
      node.setAttribute('open', '');
      node.classList.add('dialog-fallback');
      node.setAttribute('role', 'dialog');
      node.setAttribute('aria-modal', 'true');
      document.body.classList.add('modal-open');
      hideBackground(node);
    }
    setTimeout(function () {
      var closeButton = node.querySelector('.icon-button');
      if (closeButton) closeButton.focus();
    }, 0);
  }

  function closeDialog(node, shouldRestoreFocus) {
    if (!node || (!node.open && !node.hasAttribute('open'))) return;
    if (node.classList.contains('dialog-fallback')) {
      node.removeAttribute('open');
      node.classList.remove('dialog-fallback');
      node.removeAttribute('role');
      node.removeAttribute('aria-modal');
      restoreBackground(node);
      if (!dialog.hasAttribute('open') && !shelf.hasAttribute('open')) document.body.classList.remove('modal-open');
      if (shouldRestoreFocus !== false) restoreFocus(node);
    } else if (typeof node.close === 'function') {
      node._edunoRestoreOnClose = shouldRestoreFocus !== false;
      node.close();
    }
    else node.removeAttribute('open');
  }

  function savedIds() {
    try {
      var stored = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      return Array.isArray(stored) ? stored.filter(function (id) { return ARTICLES.some(function (article) { return article.id === id; }); }) : [];
    } catch (e) { return []; }
  }

  function writeSaved(ids) {
    try { localStorage.setItem(LIST_KEY, JSON.stringify(ids)); } catch (e) {}
  }

  function articleById(id) {
    return ARTICLES.find(function (article) { return article.id === id; });
  }

  function updateSavedCount() {
    var total = savedIds().length;
    document.querySelectorAll('[data-saved-count]').forEach(function (node) { node.textContent = total; });
  }

  function renderArticles() {
    var term = String(search.value || '').trim().toLowerCase();
    var visible = ARTICLES.filter(function (article) {
      var matchesFilter = activeFilter === 'all' || article.category === activeFilter;
      var haystack = [
        article.title, article.summary, article.label, article.category,
        article.tryIt, (article.body || []).join(' ')
      ].join(' ').toLowerCase();
      return matchesFilter && (!term || haystack.indexOf(term) !== -1);
    });
    grid.innerHTML = '';
    visible.forEach(function (article) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'article-card accent-' + article.accent;
      card.setAttribute('data-open-article', article.id);
      card.innerHTML = '<span class="article-card-icon" aria-hidden="true">' + article.symbol + '</span>' +
        '<span class="article-card-meta">' + article.label + ' <i>·</i> ' + article.time + '</span>' +
        '<strong>' + article.title + '</strong><small>' + article.summary + '</small>' +
        '<span class="article-card-link">Read lesson <b aria-hidden="true">→</b></span>';
      grid.appendChild(card);
    });
    count.textContent = visible.length === ARTICLES.length ? ARTICLES.length + ' original lessons' : visible.length + ' lesson match' + (visible.length === 1 ? '' : 'es');
    empty.hidden = visible.length !== 0;
  }

  function selectFilter(filter) {
    activeFilter = filter;
    document.querySelectorAll('[data-filter]').forEach(function (pill) {
      var selected = pill.getAttribute('data-filter') === filter;
      pill.classList.toggle('is-active', selected);
      pill.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    renderArticles();
  }

  function isSaved(id) { return savedIds().indexOf(id) !== -1; }

  function setSaveButton() {
    var button = document.querySelector('[data-save-article]');
    if (!activeArticle) return;
    button.textContent = isSaved(activeArticle.id) ? 'Remove from saved lessons' : 'Save this lesson';
    button.classList.toggle('is-saved', isSaved(activeArticle.id));
  }

  function openArticle(id, returnFocus) {
    var article = articleById(id);
    if (!article) return;
    activeArticle = article;
    dialog.querySelector('[data-dialog-category]').textContent = article.label + ' · ' + article.category;
    dialog.querySelector('[data-dialog-time]').textContent = article.time;
    dialog.querySelector('[data-dialog-title]').textContent = article.title;
    dialog.querySelector('[data-dialog-try]').textContent = article.tryIt;
    var body = dialog.querySelector('[data-dialog-body]');
    body.innerHTML = '';
    article.body.forEach(function (paragraph) {
      var p = document.createElement('p');
      p.textContent = paragraph;
      body.appendChild(p);
    });
    setSaveButton();
    openDialog(dialog, returnFocus);
  }

  function renderShelf() {
    var list = shelf.querySelector('[data-shelf-list]');
    var emptyState = shelf.querySelector('[data-shelf-empty]');
    var ids = savedIds();
    list.innerHTML = '';
    emptyState.hidden = ids.length > 0;
    ids.forEach(function (id) {
      var article = articleById(id);
      var row = document.createElement('div');
      row.className = 'shelf-row';
      row.innerHTML = '<button type="button" data-open-article="' + article.id + '"><span>' + article.label + '</span><strong>' + article.title + '</strong></button>' +
        '<button class="remove-saved" type="button" data-remove-saved="' + article.id + '" aria-label="Remove ' + article.title + ' from my shelf">×</button>';
      list.appendChild(row);
    });
    updateSavedCount();
  }

  function toggleSaved() {
    if (!activeArticle) return;
    var ids = savedIds();
    var position = ids.indexOf(activeArticle.id);
    if (position === -1) ids.push(activeArticle.id);
    else ids.splice(position, 1);
    writeSaved(ids);
    setSaveButton();
    renderShelf();
  }

  function removeSaved(id) {
    writeSaved(savedIds().filter(function (saved) { return saved !== id; }));
    renderShelf();
    setSaveButton();
  }

  function setupDailyStation() {
    var prompts = [
      'Find an everyday object and ask what problem its shape is trying to solve.',
      'Read one paragraph twice: once for the facts, once for the question it leaves behind.',
      'Explain something you learned recently as if you were telling it to a friendly robot.',
      'Notice one pattern on your walk, in a song, or in a room. What is the rule?',
      'Choose one word you like. Where might it have come from, and what does it make you picture?'
    ];
    var prompt = document.querySelector('[data-daily-prompt]');
    var index = new Date().getDate() % prompts.length;
    prompt.textContent = prompts[index];
    document.querySelector('[data-next-prompt]').addEventListener('click', function () {
      index = (index + 1) % prompts.length;
      prompt.textContent = prompts[index];
    });

    var state = {};
    try { state = JSON.parse(localStorage.getItem(DAY_KEY) || '{}') || {}; } catch (e) {}
    var checks = document.querySelectorAll('[data-daily-check]');
    function showProgress() {
      var done = Array.prototype.filter.call(checks, function (checkbox) { return checkbox.checked; }).length;
      document.querySelector('[data-check-progress]').textContent = done === 3 ? 'A thoughtful little session—nicely done.' : done + ' of 3 small moves chosen';
    }
    checks.forEach(function (checkbox) {
      checkbox.checked = Boolean(state[checkbox.getAttribute('data-daily-check')]);
      checkbox.addEventListener('change', function () {
        state[checkbox.getAttribute('data-daily-check')] = checkbox.checked;
        try { localStorage.setItem(DAY_KEY, JSON.stringify(state)); } catch (e) {}
        showProgress();
      });
    });
    showProgress();
  }

  document.addEventListener('click', function (event) {
    var target = event.target.closest && event.target.closest('[data-open-article], [data-article], [data-shelf-open], [data-close-article], [data-close-shelf], [data-save-article], [data-remove-saved]');
    if (!target) return;
    if (target.hasAttribute('data-open-article')) {
      var returnFocus = null;
      if (shelf.open || shelf.hasAttribute('open')) {
        returnFocus = shelf._edunoReturnFocus;
        closeDialog(shelf, false);
      }
      openArticle(target.getAttribute('data-open-article'), returnFocus);
    } else if (target.hasAttribute('data-article')) {
      openArticle(target.getAttribute('data-article'));
    } else if (target.hasAttribute('data-shelf-open')) {
      renderShelf();
      openDialog(shelf);
    } else if (target.hasAttribute('data-close-article')) {
      closeDialog(dialog);
    } else if (target.hasAttribute('data-close-shelf')) {
      closeDialog(shelf);
    } else if (target.hasAttribute('data-save-article')) {
      toggleSaved();
    } else if (target.hasAttribute('data-remove-saved')) {
      removeSaved(target.getAttribute('data-remove-saved'));
    }
  });

  document.querySelectorAll('[data-filter]').forEach(function (button) {
    button.addEventListener('click', function () {
      selectFilter(button.getAttribute('data-filter'));
    });
  });

  document.querySelectorAll('[data-learning-path]').forEach(function (button) {
    button.addEventListener('click', function () {
      search.value = '';
      selectFilter(button.getAttribute('data-learning-path'));
      document.getElementById('journal').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderArticles, 75);
  });
  document.querySelector('.discovery-form').addEventListener('submit', function (event) {
    event.preventDefault();
    renderArticles();
    document.getElementById('journal').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  dialog.addEventListener('click', function (event) { if (event.target === dialog) closeDialog(dialog); });
  shelf.addEventListener('click', function (event) { if (event.target === shelf) closeDialog(shelf); });
  [dialog, shelf].forEach(function (node) {
    node.addEventListener('cancel', function (event) {
      event.preventDefault();
      closeDialog(node);
    });
    node.addEventListener('close', function () {
      if (node._edunoRestoreOnClose !== false) restoreFocus(node);
      node._edunoRestoreOnClose = true;
    });
  });
  document.addEventListener('keydown', function (event) {
    var fallback = dialog.classList.contains('dialog-fallback') ? dialog :
      (shelf.classList.contains('dialog-fallback') ? shelf : null);
    if (!fallback) return;
    if (event.key === 'Escape') {
      closeDialog(fallback);
    } else if (event.key === 'Tab') {
      var controls = focusableElements(fallback);
      if (!controls.length) return;
      var first = controls[0];
      var last = controls[controls.length - 1];
      if (!fallback.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  renderArticles();
  updateSavedCount();
  setupDailyStation();
})();