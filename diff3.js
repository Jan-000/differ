console.log("running diff3");

(function (exports) {
	function applyStyle(divId, style) {
		const div = document.getElementById(divId);
		if (!div) return;

		div.focus();

		let command = null;
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
			default:
				break;
		}

		if (command) {
			document.execCommand(command, false, null);
		}
	}



	function applyBgColor(divId) {
		const div = document.getElementById(divId);
		const selection = window.getSelection();
		if (!div || !selection || !selection.rangeCount) return;

		const range = selection.getRangeAt(0);
		if (range.collapsed) return;
		if (!div.contains(range.commonAncestorContainer)) return;

		const newSpan = document.createElement("span");
		newSpan.style.backgroundColor = "#20bfd4";

		try {
			range.surroundContents(newSpan);
		} catch (error) {
			const fragment = range.extractContents();
			newSpan.appendChild(fragment);
			range.insertNode(newSpan);
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// STAGE 1 — HTML Parsing → Tokenization
	// Parse raw HTML strings into flat arrays of { text, marks } tokens,
	// preserving inline formatting (bold, italic, underline, spans).
	// ─────────────────────────────────────────────────────────────────────────

	function normalizeStyle(styleValue) {
		return String(styleValue || "")
			.split(";")
			.map((part) => part.trim())
			.filter((part) => {
				const colonIndex = part.indexOf(":");
				if (colonIndex === -1) return true;
				const propertyName = part.slice(0, colonIndex).trim().toLowerCase();
				return propertyName !== "font-size";
			})
			.filter(Boolean)
			.join("; ");
	}

	function buildMarkDescriptor(element) {
		const tagName = element.tagName.toLowerCase();

		if (tagName === "b" || tagName === "strong") {
			return { type: "b" };
		}

		if (tagName === "i" || tagName === "em") {
			return { type: "i" };
		}

		if (tagName === "u") {
			return { type: "u" };
		}

		if (tagName === "span") {
			const style = normalizeStyle(element.getAttribute("style"));
			return {
				type: "span",
				...(style ? { style } : {}),
			};
		}

		return null;
	}

	function serializeMarks(marks) {
		return JSON.stringify(marks);
	}

	function flattenHtmlToTokens(html) {
		const template = document.createElement("template");
		template.innerHTML = html;

		const tokens = [];

		function pushToken(text, marks) {
			if (!text) return;

			const normalizedMarks = marks.map((mark) => ({ ...mark }));
			const previous = tokens[tokens.length - 1];

			if (previous && serializeMarks(previous.marks) === serializeMarks(normalizedMarks)) {
				previous.text += text;
				return;
			}

			tokens.push({
				text,
				marks: normalizedMarks,
			});
		}

		function walk(node, activeMarks) {
			if (node.nodeType === Node.TEXT_NODE) {
				pushToken(node.textContent || "", activeMarks);
				return;
			}

			if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
				return;
			}

			let nextMarks = activeMarks;

			if (node.nodeType === Node.ELEMENT_NODE) {
				const mark = buildMarkDescriptor(node);
				if (mark) {
					nextMarks = activeMarks.concat(mark);
				}
			}

			node.childNodes.forEach((childNode) => {
				walk(childNode, nextMarks);
			});
		}

		walk(template.content, []);
		return tokens;
	}

	function escapeHtml(text) {
		const map = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#039;",
		};

		return String(text).replace(/[&<>"']/g, (match) => map[match]);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// STAGE 2 — Text Extraction (Flattening)
	// Concatenate token texts into a single plain string so the diff
	// algorithm can operate on raw words without markup noise.
	// ─────────────────────────────────────────────────────────────────────────

	function concatenateTokensToText(tokens) {
		return tokens.map((token) => token.text).join("");
	}

	// ─────────────────────────────────────────────────────────────────────────
	// STAGE 3 — Diff Computation (Word-level)
	// Run a word-level diff on the two plain text strings and produce a list
	// of { value, removed|added|equal } parts.
	// ─────────────────────────────────────────────────────────────────────────

	function computeWordDiff(beforeText, afterText) {
		const parts = Diff.diffWords(beforeText, afterText);

		return parts
			.filter((part) => part.value)
			.map((part) => {
				if (part.removed) {
					return { value: part.value, removed: true };
				}

				if (part.added) {
					return { value: part.value, added: true };
				}

				return { value: part.value, equal: true };
			});
	}

	// ─────────────────────────────────────────────────────────────────────────
	// STAGE 4 — Token Alignment (Splitting to Diff Boundaries)
	// Walk both token sequences in lockstep with the diff parts and split
	// tokens at chunk boundaries, preserving their inline formatting marks.
	// ─────────────────────────────────────────────────────────────────────────

	function createTokenCursor(tokens) {
		return {
			tokens,
			tokenIndex: 0,
			offsetInToken: 0,
		};
	}

	function cloneMarks(marks) {
		return (marks || []).map((mark) => ({ ...mark }));
	}

	function consumeTokenSlices(cursor, expectedText, sourceLabel) {
		const slices = [];
		let remaining = String(expectedText || "");

		while (remaining.length > 0) {
			if (cursor.tokenIndex >= cursor.tokens.length) {
				throw new Error(`Ran out of ${sourceLabel} tokens while consuming diff chunk.`);
			}

			const token = cursor.tokens[cursor.tokenIndex];
			const tokenText = token.text || "";
			const available = tokenText.slice(cursor.offsetInToken);

			if (!available) {
				cursor.tokenIndex += 1;
				cursor.offsetInToken = 0;
				continue;
			}

			let takeLength = 0;
			const maxLength = Math.min(available.length, remaining.length);

			while (takeLength < maxLength && available[takeLength] === remaining[takeLength]) {
				takeLength += 1;
			}

			if (takeLength === 0) {
				const expectedPreview = JSON.stringify(remaining.slice(0, 20));
				const actualPreview = JSON.stringify(available.slice(0, 20));
				throw new Error(
					`Diff mismatch for ${sourceLabel}. Expected ${expectedPreview}, got ${actualPreview}.`,
				);
			}

			const pieceText = available.slice(0, takeLength);
			slices.push({
				text: pieceText,
				marks: cloneMarks(token.marks),
			});

			remaining = remaining.slice(takeLength);
			cursor.offsetInToken += takeLength;

			if (cursor.offsetInToken >= tokenText.length) {
				cursor.tokenIndex += 1;
				cursor.offsetInToken = 0;
			}
		}

		return slices;
	}

	function alignDiffChunksWithTokenSlices(diffParts, beforeTokens, afterTokens) {
		const beforeCursor = createTokenCursor(beforeTokens);
		const afterCursor = createTokenCursor(afterTokens);

		return diffParts.map((part) => {
			const value = String(part.value || "");
			const alignedPart = { ...part };

			if (part.removed || part.equal) {
				alignedPart.beforeTokens = consumeTokenSlices(beforeCursor, value, "before");
			}

			if (part.added || part.equal) {
				alignedPart.afterTokens = consumeTokenSlices(afterCursor, value, "after");
			}

			return alignedPart;
		});
	}

	function escapeAttr(value) {
		return escapeHtml(String(value || "")).replace(/"/g, '&quot;');
	}

	// ─────────────────────────────────────────────────────────────────────────
	// STAGE 5 — Slice Rendering (Inline Markup Reconstruction)
	// Rebuild inline formatting for each aligned text slice (b/i/u/span),
	// preserving original marks while keeping text safely escaped.
	// ─────────────────────────────────────────────────────────────────────────

	function renderMarksWrapped(text, marks) {
		let html = escapeHtml(text);
		if (!marks || !marks.length) return html;

		// Wrap in marks in document order
		marks.forEach((mark) => {
			switch (mark.type) {
				case "b":
					html = `<b>${html}</b>`;
					break;
				case "i":
					html = `<i>${html}</i>`;
					break;
				case "u":
					html = `<u>${html}</u>`;
					break;
				case "span":
					if (mark.style) {
						html = `<span style="${escapeAttr(mark.style)}">${html}</span>`;
					} else {
						html = `<span>${html}</span>`;
					}
					break;
				default:
					break;
			}
		});

		return html;
	}

	function renderSlicesToHtml(slices) {
		if (!slices || !slices.length) return "";
		return slices.map((s) => renderMarksWrapped(s.text, s.marks)).join("");
	}

	function isWhitespaceOnly(text) {
		return /^\s+$/.test(String(text || ""));
	}

	// ─────────────────────────────────────────────────────────────────────────
	// STAGE 6 — Segment Merging + Side HTML Assembly
	// Build both outputs from aligned diff parts in one pass, merge
	// replacement runs, and assign corresponding-change attributes to
	// changed marks using adjacent unchanged-run context.
	// ─────────────────────────────────────────────────────────────────────────

	function wrapEqualHtml(equalHtml, unchangedIndex) {
		if (!equalHtml) return "";
		return `<mark diffing-unchanged-${unchangedIndex}>${equalHtml}</mark>`;
	}

	function getCorrespondingChangeAttrName(unchangedIndex, side) {
		if (!unchangedIndex) return "";
		const numericIndex = Number(unchangedIndex);
		if (!Number.isFinite(numericIndex)) return "";

		const changeIndex = side === "left" ? numericIndex * 2 - 1 : numericIndex * 2;
		return `corresponding-change-${changeIndex}`;
	}

	function renderChangedMark(className, html, attrNames) {
		if (!html) return "";

		const uniqueAttrNames = Array.from(new Set((attrNames || []).filter(Boolean)));
		const attrs = uniqueAttrNames.map((name) => ` ${name}`).join("");
		return `<mark class="${className}"${attrs}>${html}</mark>`;
	}

	function buildBothSideHtmlFromAligned(alignedParts) {
		let leftHtml = "";
		let rightHtml = "";

		let activeLeftChanged = "";
		let activeRightChanged = "";
		let unchangedIndex = 1;
		let previousUnchangedIndex = 0;
		let changedBlockLeftNeighborUnchangedIndex = 0;

		function ensureChangedBlockStarted() {
			if (activeLeftChanged || activeRightChanged) return;
			changedBlockLeftNeighborUnchangedIndex = previousUnchangedIndex;
		}

		function flushChanged(rightNeighborUnchangedIndex) {
			if (!activeLeftChanged && !activeRightChanged) return;

			const sideCandidates = [];
			if (changedBlockLeftNeighborUnchangedIndex) {
				sideCandidates.push(
					getCorrespondingChangeAttrName(changedBlockLeftNeighborUnchangedIndex, "left"),
				);
			}

			if (rightNeighborUnchangedIndex) {
				sideCandidates.push(getCorrespondingChangeAttrName(rightNeighborUnchangedIndex, "right"));
			}

			const sharedAttrNames = sideCandidates.length ? [sideCandidates[0]] : [];

			if (activeLeftChanged) {
				leftHtml += renderChangedMark("deleted", activeLeftChanged, sharedAttrNames);
			}

			if (activeRightChanged) {
				rightHtml += renderChangedMark("added", activeRightChanged, sharedAttrNames);
			}

			activeLeftChanged = "";
			activeRightChanged = "";
			changedBlockLeftNeighborUnchangedIndex = 0;
		}

		alignedParts.forEach((part, index) => {
			if (part.removed) {
				ensureChangedBlockStarted();
				activeLeftChanged += renderSlicesToHtml(part.beforeTokens);
				return;
			}

			if (part.added) {
				ensureChangedBlockStarted();
				activeRightChanged += renderSlicesToHtml(part.afterTokens);
				return;
			}

			if (part.equal) {
				const nextPart = alignedParts[index + 1];
				const nextIsChanged = Boolean(nextPart && (nextPart.removed || nextPart.added));
				const hasActiveReplacement = Boolean(activeLeftChanged && activeRightChanged);

				// Keep bridge whitespace inside one replacement block so pairing attrs stay stable.
				if (hasActiveReplacement && nextIsChanged && isWhitespaceOnly(part.value)) {
					activeLeftChanged += renderSlicesToHtml(part.beforeTokens);
					activeRightChanged += renderSlicesToHtml(part.afterTokens);
					return;
				}

				flushChanged(unchangedIndex);

				const leftEqualHtml = renderSlicesToHtml(part.beforeTokens);
				const rightEqualHtml = renderSlicesToHtml(part.afterTokens);

				leftHtml += wrapEqualHtml(leftEqualHtml, unchangedIndex);
				rightHtml += wrapEqualHtml(rightEqualHtml, unchangedIndex);
				previousUnchangedIndex = unchangedIndex;
				unchangedIndex += 1;
			}
		});

		flushChanged(0);

		return {
			left: leftHtml || '<span style="color:#aaa">(none)</span>',
			right: rightHtml || '<span style="color:#aaa">(none)</span>',
		};
	}

	function showDiff() {
		const inputA = document.getElementById("inputA");
		const inputB = document.getElementById("inputB");
		const diffLeft = document.getElementById("diff-left");
		const diffRight = document.getElementById("diff-right");

		if (!inputA || !inputB || !diffLeft || !diffRight) return;

		const beforeHtml = inputA.innerHTML;
		const afterHtml = inputB.innerHTML;

		// — Stage 1: HTML Parsing → Tokenization —
		const beforeTokens = flattenHtmlToTokens(beforeHtml);
		const afterTokens = flattenHtmlToTokens(afterHtml);

		// — Stage 2: Text Extraction (Flattening) —
		const beforeText = concatenateTokensToText(beforeTokens);
		const afterText = concatenateTokensToText(afterTokens);

		// — Stage 3: Diff Computation (Word-level) —
		const diffParts = computeWordDiff(beforeText, afterText);

		// — Stage 4: Token Alignment (Splitting to Diff Boundaries) —
		const alignedDiffParts = alignDiffChunksWithTokenSlices(diffParts, beforeTokens, afterTokens);

		// — Stage 5: Slice Rendering (Inline Markup Reconstruction) —
		// Implemented during rendering via renderSlicesToHtml/renderMarksWrapped.
		// — Stage 6: Segment Merging + Side HTML Assembly —
		const sideHtml = buildBothSideHtmlFromAligned(alignedDiffParts);

		console.log("diff3 before tokens:", beforeTokens);
		console.log("diff3 after tokens:", afterTokens);
		console.log("diff3 beforeText:", beforeText);
		console.log("diff3 afterText:", afterText);
		console.log("diff3 diffWords:", diffParts);
		console.log("diff3 alignedDiffParts:", alignedDiffParts);

		// — Stage 7: Final Output Generation (Before / After Views) —
		diffLeft.innerHTML = sideHtml.left;
		diffRight.innerHTML = sideHtml.right;
	}

	exports.applyStyle = applyStyle;
	exports.applyBgColor = applyBgColor;
	exports.showDiff = showDiff;
	exports.escapeHtml = escapeHtml;
	exports.flattenHtmlToTokens = flattenHtmlToTokens;
	exports.concatenateTokensToText = concatenateTokensToText;
	exports.computeWordDiff = computeWordDiff;
	exports.alignDiffChunksWithTokenSlices = alignDiffChunksWithTokenSlices;

	try {
		window.DiffNewest = exports;
	} catch (error) { }
})(typeof window !== "undefined" ? {} : {});
