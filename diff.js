(function (exports) {
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

  function findEnclosingMark(range) {
    const startNode =
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer;
    let candidate = startNode.closest("mark");
    while (candidate) {
      if (
        candidate.contains(range.startContainer) &&
        candidate.contains(range.endContainer)
      ) {
        return candidate;
      }
      candidate = candidate.parentElement
        ? candidate.parentElement.closest("mark")
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

    const markToToggle = findEnclosingMark(range);
    if (markToToggle && markToToggle.style.background === "#e1d1ff") {
      const parent = markToToggle.parentNode;
      while (markToToggle.firstChild) {
        parent.insertBefore(markToToggle.firstChild, markToToggle);
      }
      parent.removeChild(markToToggle);
      return;
    }

    const mark = document.createElement("mark");
    mark.style.background = "#e1d1ff";
    try {
      range.surroundContents(mark);
    } catch (err) {
      const fragment = range.cloneContents();
      mark.appendChild(fragment);
      range.deleteContents();
      range.insertNode(mark);
    }

    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStartAfter(mark);
    newRange.collapse(true);
    selection.addRange(newRange);
  }

  function annotateTagState(diffObjectsArray) {
    let inTag = false;
    diffObjectsArray.forEach((diffObject) => {
      diffObject.startsInsideTag = inTag;
      for (const ch of diffObject.value) {
        if (ch === "<" && !inTag) {
          inTag = true;
        } else if (ch === ">" && inTag) {
          inTag = false;
        }
      }
      diffObject.endsInsideTag = inTag;
    });
    return diffObjectsArray;
  }

  function hasTextOutsideTags(value, startsInsideTag) {
    let inTag = startsInsideTag;
    for (const ch of value) {
      if (ch === "<" && !inTag) {
        inTag = true;
        continue;
      }
      if (ch === ">" && inTag) {
        inTag = false;
        continue;
      }
      if (!inTag) {
        return true;
      }
    }
    return false;
  }

  function prepareItemsForWrapping(diffObjectsArray) {
    // First annotate tag state so we know whether each chunk starts inside a tag.
    annotateTagState(diffObjectsArray);

    return diffObjectsArray.map((diffObject) => {
      // If the chunk contains any text outside of tags, it is safe to wrap.
      diffObject.considerForWrapping = hasTextOutsideTags(
        diffObject.value,
        diffObject.startsInsideTag,
      );
      return diffObject;
    });
  }

  function wrapTextOutsideTags(value, className, startsInsideTag) {
    let inTag = startsInsideTag;
    let buffer = "";
    let output = "";

    const flushBuffer = () => {
      if (!buffer) return;
      if (inTag) {
        output += buffer;
      } else {
        output += `<mark class='${className}'>${buffer}</mark>`;
      }
      buffer = "";
    };

    for (const ch of value) {
      if (ch === "<" && !inTag) {
        flushBuffer();
        inTag = true;
        buffer += ch;
        continue;
      }
      if (ch === ">" && inTag) {
        buffer += ch;
        flushBuffer();
        inTag = false;
        continue;
      }
      buffer += ch;
    }

    flushBuffer();
    return output;
  }

  function buildDiffHtml(processedArray, isDeletion) {
    let html = "";
    processedArray.forEach((part) => {
      if (isDeletion ? part.removed : part.added) {
        if (part.considerForWrapping) {
          const className = isDeletion ? "removed" : "added";
          html += wrapTextOutsideTags(
            part.value,
            className,
            part.startsInsideTag,
          );
        } else {
          html += part.value; // Don't wrap if not safe
        }
      } else {
        html += part.value; // Common parts are always added plain
      }
    });
    return html;
  }

  function showDiff() {
    const a = document.getElementById("inputA").innerHTML;
    const b = document.getElementById("inputB").innerHTML;
    const diff = Diff.diffWords(a, b);
    console.log("Diff output:", diff);
    // Create arrays for additions+common and deletions+common parts
    const additionsCommon = diff.filter((part) => !part.removed);
    const deletionsCommon = diff.filter((part) => !part.added);
    console.log("Additions + existing:", additionsCommon);
    console.log("Deletions + existing:", deletionsCommon);

    // Process each array to flag parts for wrapping
    const processedAdditions = prepareItemsForWrapping(additionsCommon);
    const processedDeletions = prepareItemsForWrapping(deletionsCommon);

    // Build the HTML strings, wrapping parts that are safe to wrap
    const left = buildDiffHtml(processedDeletions, true);
    const right = buildDiffHtml(processedAdditions, false);

    console.log("Wrapped deletions HTML:", left);
    console.log("Wrapped additions HTML:", right);

    document.getElementById("diff-left").innerHTML =
      left || '<span style="color:#aaa">(none)</span>';
    document.getElementById("diff-right").innerHTML =
      right || '<span style="color:#aaa">(none)</span>';
  }

  function escapeHtml(text) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
    // Note: escapeHtml is now only used for textarea input, not for rendering output
  }

  // expose a minimal API so this file can be used alongside diff2.js
  exports.applyStyle = applyStyle;
  exports.applyBgColor = applyBgColor;
  exports.showDiff = showDiff;
  exports.escapeHtml = escapeHtml;

  // attach to window for easy runtime access
  try {
    window.DiffAlt = exports;
  } catch (e) {}
})(typeof window !== "undefined" ? {} : {});
