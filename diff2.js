function applyStyle(divId, style) {
  const div = document.getElementById(divId);
  div.focus();
  let command;
  switch (style) {
    case "bold":
      command = "bold";
      break;
    case "italic":
      command = "italic";
      break;
    case "underline":
      command = "underline";
      break;
  }
  if (command) {
    document.execCommand(command, false, null);
  }
}

function findEnclosingBgSpan(range) {
  const startNode =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
  let candidate = startNode.closest("span");
  while (candidate) {
    if (
      candidate.contains(range.startContainer) &&
      candidate.contains(range.endContainer) &&
      candidate.getAttribute("data-bg") === "blue-highlight"
    ) {
      return candidate;
    }
    candidate = candidate.parentElement
      ? candidate.parentElement.closest("span")
      : null;
  }
  return null;
}

function applyBgColor(divId) {
  const div = document.getElementById(divId);
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return;
  if (!div.contains(range.commonAncestorContainer)) return;

  const spanToToggle = findEnclosingBgSpan(range);
  if (spanToToggle) {
    if (
      spanToToggle.childNodes.length === 1 &&
      spanToToggle.firstChild.nodeType === Node.TEXT_NODE &&
      range.startContainer === spanToToggle.firstChild &&
      range.endContainer === spanToToggle.firstChild
    ) {
      const textNode = spanToToggle.firstChild;
      const text = textNode.textContent || "";
      const start = range.startOffset;
      const end = range.endOffset;
      if (start >= 0 && end <= text.length && start < end) {
        const beforeText = text.slice(0, start);
        const middleText = text.slice(start, end);
        const afterText = text.slice(end);

        const parent = spanToToggle.parentNode;
        const frag = document.createDocumentFragment();

        if (beforeText) {
          const beforeSpan = spanToToggle.cloneNode(false);
          beforeSpan.textContent = beforeText;
          frag.appendChild(beforeSpan);
        }

        if (middleText) {
          frag.appendChild(document.createTextNode(middleText));
        }

        if (afterText) {
          const afterSpan = spanToToggle.cloneNode(false);
          afterSpan.textContent = afterText;
          frag.appendChild(afterSpan);
        }

        parent.replaceChild(frag, spanToToggle);

        selection.removeAllRanges();
        const newRange = document.createRange();
        if (afterText) {
          const afterNode =
            parent.childNodes[
            Array.prototype.indexOf.call(parent.childNodes, frag.lastChild)
            ];
          newRange.setStartAfter(afterNode.previousSibling);
        } else {
          newRange.setStart(parent, parent.childNodes.length);
        }
        selection.addRange(newRange);
      }
    }
  } else {
    const newSpan = document.createElement("span");
    newSpan.setAttribute("data-bg", "blue-highlight");
    newSpan.style.backgroundColor = "#20bfd4";

    const text = range.toString();
    const collatedText = text.replace(/(\S)(\s+)/g, "$1$2"); // Collate spaces with preceding words
    newSpan.textContent = collatedText;

    range.deleteContents();
    range.insertNode(newSpan);
  }
}

function tokenizeSentence(root) {
  const tokens = [];

  function walk(node, styleState) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      const regex = /(\S+)(\s*)/g;
      let match;

      while ((match = regex.exec(text)) !== null) {
        const word = match[1];
        const spaceAfter = match[2] || "";
        if (!word) continue;

        tokens.push({
          word,
          spaceAfter,
          bold: styleState.bold,
          background: styleState.background,
        });
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const nextStyle = { ...styleState };

    if (node.tagName === "B" || node.tagName === "STRONG") {
      nextStyle.bold = true;
    }

    if (node.tagName === "SPAN") {
      const bg = node.style.background || node.style.backgroundColor;
      if (bg) nextStyle.background = bg;
    }

    for (const child of node.childNodes) {
      walk(child, nextStyle);
    }
  }

  walk(root, {
    bold: false,
    background: null,
  });

  return tokens;
}

function renderToken(token) {
  let html = escapeHtml(token.word);

  if (token.bold) {
    html = `<b>${html}</b>`;
  }

  if (token.background) {
    html = `<span style="background:${token.background}">${html}</span>`;
  }

  return html;
}

function buildSideHtml(parts, side, tokensA, tokensB) {
  let html = "";

  // Third pass: actually build HTML, grouping unchanged by run index
  let unchangedBuffer = "";
  let nextUnchangedGroupIndex = 0;

  function flushUnchangedBuffer() {
    if (!unchangedBuffer) return;
    nextUnchangedGroupIndex += 1;
    html += `<mark unchanged="${nextUnchangedGroupIndex}">${unchangedBuffer}</mark>`;
    unchangedBuffer = "";
  }

  parts.forEach((part) => {
    const isRemoval = !!part.removed;
    const isAddition = !!part.added;

    if (isRemoval && side === "left") {
      flushUnchangedBuffer();
      part.value.forEach((t) => {
        const space = t.spaceAfter != null ? t.spaceAfter : " ";
        const correspondingAttr =
          part.correspondingId != null
            ? ` corresponding="${part.correspondingId}"`
            : "";

        // If there is no trailing space on this token and the current
        // HTML also does not end with whitespace, inject a single leading
        // space so words like "one two" vs "one" don't collapse to "onetwo".
        const needsLeadingSpace = !/\s$/.test(html) && !space && html !== "";
        const leading = needsLeadingSpace ? " " : "";

        html += `${leading}<mark class="removed"${correspondingAttr}>${renderToken(
          t,
        )}</mark>${space}`;
      });
    } else if (isAddition && side === "right") {
      flushUnchangedBuffer();
      part.value.forEach((t) => {
        const space = t.spaceAfter != null ? t.spaceAfter : " ";
        const correspondingAttr =
          part.correspondingId != null
            ? ` corresponding="${part.correspondingId}"`
            : "";

        const needsLeadingSpace = !/\s$/.test(html) && !space && html !== "";
        const leading = needsLeadingSpace ? " " : "";

        html += `${leading}<mark class="added"${correspondingAttr}>${renderToken(
          t,
        )}</mark>${space}`;
      });
    } else if (!isRemoval && !isAddition) {
      const unchangedLen = Array.isArray(part.value) ? part.value.length : 0;
      for (let i = 0; i < unchangedLen; i++) {
        const t =
          side === "left" ? tokensA[part.aStart + i] : tokensB[part.bStart + i];
        if (!t) continue;
        const space = t.spaceAfter != null ? t.spaceAfter : " ";
        unchangedBuffer += renderToken(t) + space;
      }
    }
  });

  flushUnchangedBuffer();

  return html.trim();
}

function showDiff() {
  const aEl = document.getElementById("inputA");
  const bEl = document.getElementById("inputB");

  const tokensA = tokenizeSentence(aEl);
  const tokensB = tokenizeSentence(bEl);

  const parts = Diff.diffArrays(tokensA, tokensB, {
    comparator: (x, y) => x.word === y.word,
  });

  // Annotate each diff part with the token index ranges it covers
  annotateTokenRanges(parts, tokensA, tokensB);

  annotateCorrespondingChanges(parts);

  console.log("Token diff result:", parts);
  document.getElementById("diff-left").innerHTML = buildSideHtml(parts, "left", tokensA, tokensB);
  document.getElementById("diff-right").innerHTML = buildSideHtml(parts, "right", tokensA, tokensB);

  setupRevertButtons();

  // Persist last diff state so that revert operations can update inputB
  window._lastDiffState = {
    tokensA,
    tokensB,
    parts,
  };
}

function annotateTokenRanges(parts, tokensA, tokensB) {
  let indexA = 0;
  let indexB = 0;

  parts.forEach((part) => {
    const len = Array.isArray(part.value) ? part.value.length : 0;

    part.aStart = indexA;
    part.bStart = indexB;

    if (part.removed && !part.added) {
      // Tokens only exist in A
      indexA += len;
    } else if (part.added && !part.removed) {
      // Tokens only exist in B
      indexB += len;
    } else {
      // Unchanged tokens exist in both sequences
      indexA += len;
      indexB += len;
    }

    part.aEnd = indexA;
    part.bEnd = indexB;
  });
}

function annotateCorrespondingChanges(parts) {
  // First pass: assign an index to each unchanged run (common part)
  let currentUnchangedIndex = 0;
  const unchangedIndexByPart = {}; // part index -> unchanged group id

  parts.forEach((part, idx) => {
    const isRemoval = !!part.removed;
    const isAddition = !!part.added;
    if (!isRemoval && !isAddition && part.value && part.value.length > 0) {
      currentUnchangedIndex += 1;
      part.unchangedGroupIndex = currentUnchangedIndex;
      unchangedIndexByPart[idx] = currentUnchangedIndex;
    }
  });

  // Second pass: for each unchanged run, look separately at the nearest
  // deletion/addition on the LEFT, and the nearest deletion/addition on the RIGHT.
  // Left neighbour on left box (deletion) is paired with left neighbour on right
  // box (addition). Analogously for right neighbours.
  Object.keys(unchangedIndexByPart).forEach((idxStr) => {
    const idx = parseInt(idxStr, 10);
    const groupId = unchangedIndexByPart[idx];

    // ---- LEFT side neighbours ----
    let leftRemovalIdx = -1;
    for (let j = idx - 1; j >= 0; j--) {
      if (parts[j].removed && !parts[j].added) {
        leftRemovalIdx = j;
        break;
      }
      if (!parts[j].removed && !parts[j].added) {
        // hit another unchanged block; stop, because visually that would be a different group
        break;
      }
    }

    let leftAdditionIdx = -1;
    for (let j = idx - 1; j >= 0; j--) {
      if (parts[j].added && !parts[j].removed) {
        leftAdditionIdx = j;
        break;
      }
      if (!parts[j].removed && !parts[j].added) {
        break;
      }
    }

    if (leftRemovalIdx !== -1 && leftAdditionIdx !== -1) {
      // deterministic id for "left" pair of this unchanged group
      const pairIdLeft = groupId * 2 - 1;
      parts[leftRemovalIdx].correspondingId = pairIdLeft;
      parts[leftAdditionIdx].correspondingId = pairIdLeft;
    }

    // ---- RIGHT side neighbours ----
    let rightRemovalIdx = -1;
    for (let j = idx + 1; j < parts.length; j++) {
      if (parts[j].removed && !parts[j].added) {
        rightRemovalIdx = j;
        break;
      }
      if (!parts[j].removed && !parts[j].added) {
        break;
      }
    }

    let rightAdditionIdx = -1;
    for (let j = idx + 1; j < parts.length; j++) {
      if (parts[j].added && !parts[j].removed) {
        rightAdditionIdx = j;
        break;
      }
      if (!parts[j].removed && !parts[j].added) {
        break;
      }
    }

    if (rightRemovalIdx !== -1 && rightAdditionIdx !== -1) {
      // deterministic id for "right" pair of this unchanged group
      const pairIdRight = groupId * 2;
      parts[rightRemovalIdx].correspondingId = pairIdRight;
      parts[rightAdditionIdx].correspondingId = pairIdRight;
    }
  });
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>\"']/g, (m) => map[m]);
  // Note: escapeHtml is now only used for textarea input, not for rendering output
}

let currentRevertButton = null;
let currentRevertTarget = null;

function removeRevertButton() {
  if (currentRevertButton && currentRevertButton.parentNode) {
    currentRevertButton.parentNode.removeChild(currentRevertButton);
  }
  currentRevertButton = null;
  currentRevertTarget = null;
}

function createRevertButton(targetMark) {
  removeRevertButton();

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "revert";

  // Base class
  btn.className = "revert-button";
  // Color per side
  const container = targetMark.closest("#diff-left, #diff-right");
  if (container && container.id === "diff-left") {
    btn.classList.add("revert-button-left");
  } else if (container && container.id === "diff-right") {
    btn.classList.add("revert-button-right");
  }

  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    // Perform revert when there is a corresponding change
    if (!currentRevertTarget) return;
    const corrId = currentRevertTarget.getAttribute("corresponding");
    if (!corrId) return;

    applyRevertForCorrespondingChange(parseInt(corrId, 10));
    removeRevertButton();
  });

  // Position absolutely under the clicked mark, without breaking layout
  const containerRect = container.getBoundingClientRect();
  const markRect = targetMark.getBoundingClientRect();

  const topOffset = markRect.bottom - containerRect.top + 4;
  const leftOffset = Math.max(markRect.left - containerRect.left, 0);

  btn.style.top = `${topOffset}px`;
  btn.style.left = `${leftOffset}px`;

  container.appendChild(btn);
  currentRevertButton = btn;
  currentRevertTarget = targetMark;
}

function applyRevertForCorrespondingChange(correspondingId) {
  const state = window._lastDiffState;
  if (!state) return;

  const { tokensA, tokensB, parts } = state;
  if (!tokensA || !tokensB || !parts) return;

  // Find the removal and addition parts that share this corresponding id
  let removalPart = null;
  let additionPart = null;

  parts.forEach((part) => {
    if (part.correspondingId !== correspondingId) return;
    if (part.removed && !part.added) {
      removalPart = part;
    } else if (part.added && !part.removed) {
      additionPart = part;
    }
  });

  if (!removalPart || !additionPart) {
    return;
  }

  // Replace the tokens in B that correspond to the "addition" with the
  // tokens from A that correspond to the "removal".
  const aSlice = tokensA.slice(removalPart.aStart, removalPart.aEnd);
  const before = tokensB.slice(0, additionPart.bStart);
  const after = tokensB.slice(additionPart.bEnd);
  const newTokensB = before.concat(aSlice, after);

  // Rebuild the right input HTML from the updated token sequence
  const bEl = document.getElementById("inputB");
  if (!bEl) return;

  let newHtml = "";
  newTokensB.forEach((t) => {
    const space = t.spaceAfter != null ? t.spaceAfter : " ";
    let piece = escapeHtml(t.word);
    if (t.bold) {
      piece = `<b>${piece}</b>`;
    }
    if (t.background) {
      piece = `<span style="background:${t.background}">${piece}</span>`;
    }
    newHtml += piece + space;
  });

  bEl.innerHTML = newHtml.trim();

  // Rerun the diff so that both output boxes are refreshed and the internal
  // diff state is updated for any further reverts.
  showDiff();
}

function setupRevertButtons() {
  const left = document.getElementById("diff-left");
  const right = document.getElementById("diff-right");

  const handler = (event) => {
    const mark = event.target.closest("mark.added, mark.removed");
    if (!mark) return;
    event.stopPropagation();

    if (currentRevertTarget === mark) {
      return;
    }

    createRevertButton(mark);
  };

  if (left) {
    left.addEventListener("click", handler);
  }
  if (right) {
    right.addEventListener("click", handler);
  }

  document.addEventListener("click", removeRevertButton);
}

function normalizeToTextNode(node, offset) {
  if (!node) return null;

  if (node.nodeType === Node.TEXT_NODE) {
    return { node, offset };
  }

  const children = node.childNodes;
  if (!children || children.length === 0) {
    return null;
  }

  let idx = Math.min(offset, children.length - 1);
  let current = children[idx];

  // Descend to a text node if possible
  while (current && current.nodeType !== Node.TEXT_NODE) {
    if (current.childNodes && current.childNodes.length > 0) {
      current = current.childNodes[0];
    } else {
      break;
    }
  }

  if (!current || current.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  return {
    node: current,
    offset: Math.min(offset, current.textContent.length),
  };
}

function getWordBoundaries(text, index) {
  if (!text || index < 0 || index > text.length) {
    return null;
  }

  const isWhitespace = (ch) => /\s/.test(ch);

  // Prefer character to the left as the "current" one when possible
  const leftIndex = index > 0 ? index - 1 : index;
  const rightIndex = index < text.length ? index : text.length - 1;

  const leftChar = text[leftIndex];
  const rightChar = text[rightIndex];

  // If we're adjacent to or on whitespace, select the contiguous whitespace run
  if (leftChar && isWhitespace(leftChar)) {
    let start = leftIndex;
    while (start > 0 && isWhitespace(text[start - 1])) {
      start--;
    }
    let end = leftIndex + 1;
    while (end < text.length && isWhitespace(text[end])) {
      end++;
    }
    return { start, end };
  }

  if (rightChar && isWhitespace(rightChar)) {
    let start = rightIndex;
    while (start > 0 && isWhitespace(text[start - 1])) {
      start--;
    }
    let end = rightIndex + 1;
    while (end < text.length && isWhitespace(text[end])) {
      end++;
    }
    return { start, end };
  }

  // Otherwise, select the contiguous non-whitespace "word" run
  let i = index;
  if (i === text.length) {
    i = text.length - 1;
  }

  if (isWhitespace(text[i])) {
    return null;
  }

  let start = i;
  while (start > 0 && !isWhitespace(text[start - 1])) {
    start--;
  }
  let end = i + 1;
  while (end < text.length && !isWhitespace(text[end])) {
    end++;
  }

  return { start, end };
}

function enforceWordSelectionWithin(container) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  // Ensure both anchor and focus are inside the container
  const anchorNorm = normalizeToTextNode(sel.anchorNode, sel.anchorOffset);
  const focusNorm = normalizeToTextNode(sel.focusNode, sel.focusOffset);
  if (!anchorNorm || !focusNorm) return;
  if (
    !container.contains(anchorNorm.node) ||
    !container.contains(focusNorm.node)
  ) {
    return;
  }

  const anchorText = anchorNorm.node.textContent;
  const focusText = focusNorm.node.textContent;
  const anchorBounds = getWordBoundaries(anchorText, anchorNorm.offset);
  const focusBounds = getWordBoundaries(focusText, focusNorm.offset);
  if (!anchorBounds || !focusBounds) return;

  const newRange = document.createRange();
  // Make selection direction-agnostic: figure out which end is first in the DOM.
  const tmpA = document.createRange();
  tmpA.setStart(anchorNorm.node, anchorNorm.offset);
  tmpA.collapse(true);
  const tmpB = document.createRange();
  tmpB.setStart(focusNorm.node, focusNorm.offset);
  tmpB.collapse(true);

  const cmp = tmpA.compareBoundaryPoints(Range.START_TO_START, tmpB);
  if (cmp <= 0) {
    // Anchor comes before focus in the document
    newRange.setStart(anchorNorm.node, anchorBounds.start);
    newRange.setEnd(focusNorm.node, focusBounds.end);
  } else {
    // Focus comes before anchor – swap
    newRange.setStart(focusNorm.node, focusBounds.start);
    newRange.setEnd(anchorNorm.node, anchorBounds.end);
  }

  sel.removeAllRanges();
  sel.addRange(newRange);
}

if (!window.__diffEditorBindingsInitialized) {
  ["inputA", "inputB"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    // Mouse selection snapping (can be revisited separately)
    el.addEventListener("mouseup", () => enforceWordSelectionWithin(el));

    // Keyboard selection: only snap when using Shift + Arrow keys
    el.addEventListener("keyup", (event) => {
      const arrowKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      if (!event.shiftKey || !arrowKeys.includes(event.key)) {
        return;
      }
      enforceWordSelectionWithin(el);
    });

    // Use Tab to move focus between the two inputs (instead of inserting tab)
    el.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      const targetId = id === "inputA" ? "inputB" : "inputA";
      const other = document.getElementById(targetId);
      if (other) {
        other.focus();
      }
    });

    // Automatically rerun diff whenever the right input changes
    // if (id === "inputB") {
    //   el.addEventListener("input", () => {
    //     try {
    //       showDiff();
    //     } catch (e) {
    //       console.error("Error running showDiff from inputB change:", e);
    //     }
    //   });
    // }
  });

  // Global keyboard shortcut: Cmd+R to run "Show Diff" without reloading the page
  window.addEventListener("keydown", (event) => {
    if (!event.metaKey) return;
    if (event.key !== "e" && event.key !== "E") return;

    event.preventDefault();
    try {
      showDiff();
    } catch (e) {
      console.error("Error running showDiff from Cmd+R:", e);
    }
  });

  window.__diffEditorBindingsInitialized = true;
}

// TODO:
// - rerun diff upon resolving

// ---------------- Theme handling ----------------
function getPreferredTheme() {
  const stored = localStorage.getItem("theme");
  if (stored === "dark" || stored === "light") return stored;
  if (
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  )
    return "dark";
  return "light";
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.setAttribute("aria-pressed", theme === "dark");
    // Simplified icon toggle: show sun when current theme is dark (indicates switch to light),
    // show moon when current theme is light (indicates switch to dark)
    const sun = btn.querySelector('.icon-sun');
    const moon = btn.querySelector('.icon-moon');
    if (sun) sun.style.display = theme === 'dark' ? 'inline-block' : 'none';
    if (moon) moon.style.display = theme === 'dark' ? 'none' : 'inline-block';
  }
}

function toggleTheme() {
  const active =
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  const next = active === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("theme", next);
  } catch (e) { }
}

function initTheme() {
  const theme = getPreferredTheme();
  applyTheme(theme);
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.addEventListener("click", toggleTheme);

  // If user hasn't explicitly chosen, follow OS changes
  if (!localStorage.getItem("theme") && window.matchMedia) {
    try {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", (e) => {
          applyTheme(e.matches ? "dark" : "light");
        });
    } catch (e) {
      // some browsers use remove/addListener older API; ignore if not available
    }
  }
}

window.DiffTokens = {
  applyStyle,
  applyBgColor,
  showDiff,
  escapeHtml,
};

// initialize theme on script load
try {
  if (!window.__diffThemeInitialized) {
    initTheme();
    window.__diffThemeInitialized = true;
  }
} catch (e) {
  console.error("Theme init error", e);
}
