'use strict';

(function (root) {
  var keywordPattern = /\b(games|game)\b/gi;
  var characterMap = {
    a: '\u0430',
    o: '\u043e',
    e: '\u0435'
  };

  function transformKeywordText(value) {
    return String(value || '').replace(keywordPattern, function (word) {
      return word.replace(/[aoe]/gi, function (character) {
        return characterMap[character.toLowerCase()];
      });
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { transformKeywordText: transformKeywordText };
  }

  var document = root && root.document;
  if (!document) return;

  var skippedElements = {
    CODE: true,
    NOSCRIPT: true,
    PRE: true,
    SCRIPT: true,
    STYLE: true,
    TEXTAREA: true
  };
  var textAttributes = ['alt', 'aria-label', 'placeholder', 'title'];

  function shouldSkip(node) {
    var element = node && (node.nodeType === 1 ? node : node.parentElement);
    return Boolean(element && (
      skippedElements[element.tagName]
      || element.isContentEditable
      || (element.closest && element.closest('script,style,noscript,code,pre,textarea,[contenteditable="true"]'))
    ));
  }

  function transformTextNode(node) {
    if (!node || shouldSkip(node)) return;
    var transformed = transformKeywordText(node.nodeValue);
    if (transformed !== node.nodeValue) node.nodeValue = transformed;
  }

  function transformElement(element) {
    if (!element || element.nodeType !== 1) return;
    if (skippedElements[element.tagName] && element.tagName !== 'TEXTAREA') return;
    if (element.isContentEditable
        || (element.closest && element.closest('script,style,noscript,code,pre,[contenteditable="true"]'))) {
      return;
    }
    for (var i = 0; i < textAttributes.length; i += 1) {
      var attribute = textAttributes[i];
      if (!element.hasAttribute(attribute)) continue;
      var value = element.getAttribute(attribute);
      var transformed = transformKeywordText(value);
      if (transformed !== value) element.setAttribute(attribute, transformed);
    }
    if (element.tagName === 'META' && element.hasAttribute('content')) {
      var key = String(element.getAttribute('name') || element.getAttribute('property') || '').toLowerCase();
      if (/^(description|keywords|og:title|og:description|twitter:title|twitter:description)$/.test(key)) {
        var content = element.getAttribute('content');
        var transformedContent = transformKeywordText(content);
        if (transformedContent !== content) element.setAttribute('content', transformedContent);
      }
    }
  }

  function transformTree(rootNode) {
    if (!rootNode) return;
    if (rootNode.nodeType === 3) {
      transformTextNode(rootNode);
      return;
    }
    transformElement(rootNode);
    if (!document.createTreeWalker) return;
    var walker = document.createTreeWalker(
      rootNode,
      root.NodeFilter ? root.NodeFilter.SHOW_ELEMENT | root.NodeFilter.SHOW_TEXT : 5
    );
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) transformTextNode(node);
      else transformElement(node);
    }
  }

  function start() {
    transformTree(document.documentElement);
    if (!root.MutationObserver) return;
    new root.MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i += 1) {
        var mutation = mutations[i];
        if (mutation.type === 'characterData') {
          transformTextNode(mutation.target);
        } else if (mutation.type === 'attributes') {
          transformElement(mutation.target);
        } else {
          for (var j = 0; j < mutation.addedNodes.length; j += 1) {
            transformTree(mutation.addedNodes[j]);
          }
        }
      }
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: textAttributes.concat(['content']),
      characterData: true,
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : this);