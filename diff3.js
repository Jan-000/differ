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
	// Build per-side HTML and merge adjacent changed runs. If a whitespace-only
	// equal chunk sits between two changed runs on the same side, absorb it so
	// highlights read as one continuous phrase.
	// ─────────────────────────────────────────────────────────────────────────

	function buildSideHtmlFromAligned(alignedParts, side) {
		let html = "";

		const isChangedForSide = (part) => (side === "left" ? !!part.removed : !!part.added);
		const getSlicesForSide = (part) => (side === "left" ? part.beforeTokens : part.afterTokens);
		const markClass = side === "left" ? "deleted" : "added";

		let activeChangedHtml = "";

		function flushActiveChanged() {
			if (!activeChangedHtml) return;
			html += `<mark class="${markClass}">${activeChangedHtml}</mark>`;
			activeChangedHtml = "";
		}

		function hasUpcomingChangedForSide(fromIndex) {
			for (let lookahead = fromIndex; lookahead < alignedParts.length; lookahead += 1) {
				const candidate = alignedParts[lookahead];

				if (isChangedForSide(candidate)) {
					return true;
				}

				if (candidate.equal) {
					return false;
				}

				// Opposite-side changes do not render on this side; skip them.
			}

			return false;
		}

		for (let index = 0; index < alignedParts.length; index += 1) {
			const part = alignedParts[index];

			if (isChangedForSide(part)) {
				activeChangedHtml += renderSlicesToHtml(getSlicesForSide(part));
				continue;
			}

			if (part.equal) {
				const equalHtml = renderSlicesToHtml(getSlicesForSide(part));
				const bridgeWhitespace =
					activeChangedHtml &&
					isWhitespaceOnly(part.value) &&
					hasUpcomingChangedForSide(index + 1);

				if (bridgeWhitespace) {
					activeChangedHtml += equalHtml;
					continue;
				}

				flushActiveChanged();
				html += equalHtml;
				continue;
			}

			if (part.added || part.removed) {
				// Opposite-side changes should not split highlight runs on this side.
				continue;
			}

			flushActiveChanged();
		}

		flushActiveChanged();

		return html || '<span style="color:#aaa">(none)</span>';
	}

	function isMarkNode(node) {
		return node && node.nodeType === Node.ELEMENT_NODE && node.tagName === "MARK";
	}

	function isNonePlaceholder(container) {
		if (!container) return false;
		if (container.childNodes.length !== 1) return false;

		const onlyChild = container.firstChild;
		if (!onlyChild || onlyChild.nodeType !== Node.ELEMENT_NODE) return false;

		return String(onlyChild.textContent || "").trim() === "(none)";
	}

	function collectUnmarkedRuns(container) {
		const runs = [];
		let currentRun = [];

		Array.from(container.childNodes).forEach((node) => {
			if (isMarkNode(node)) {
				if (currentRun.length) {
					runs.push(currentRun);
					currentRun = [];
				}
				return;
			}

			currentRun.push(node);
		});

		if (currentRun.length) {
			runs.push(currentRun);
		}

		return runs;
	}

	function wrapRunInMark(runNodes, attrName) {
		if (!runNodes || !runNodes.length) return;

		const firstNode = runNodes[0];
		const parent = firstNode.parentNode;
		if (!parent) return;

		const wrapper = document.createElement("mark");
		wrapper.setAttribute(attrName, "");

		parent.insertBefore(wrapper, firstNode);
		runNodes.forEach((node) => wrapper.appendChild(node));
	}

	function wrapUnchangedOutputs(leftContainer, rightContainer) {
		if (!leftContainer || !rightContainer) return;
		if (isNonePlaceholder(leftContainer) || isNonePlaceholder(rightContainer)) return;

		const leftRuns = collectUnmarkedRuns(leftContainer);
		const rightRuns = collectUnmarkedRuns(rightContainer);

		const pairedCount = Math.min(leftRuns.length, rightRuns.length);
		let nextUnpairedId = pairedCount + 1;

		for (let index = 0; index < pairedCount; index += 1) {
			const sharedId = index + 1;
			wrapRunInMark(leftRuns[index], `diffing-unchanged-${sharedId}`);
			wrapRunInMark(rightRuns[index], `diffing-unchanged-${sharedId}`);
		}

		for (let index = pairedCount; index < leftRuns.length; index += 1) {
			wrapRunInMark(leftRuns[index], `diffing-unchanged-${nextUnpairedId}`);
			nextUnpairedId += 1;
		}

		for (let index = pairedCount; index < rightRuns.length; index += 1) {
			wrapRunInMark(rightRuns[index], `diffing-unchanged-${nextUnpairedId}`);
			nextUnpairedId += 1;
		}
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
		const leftHtml = buildSideHtmlFromAligned(alignedDiffParts, "left");
		const rightHtml = buildSideHtmlFromAligned(alignedDiffParts, "right");

		console.log("diff3 before tokens:", beforeTokens);
		console.log("diff3 after tokens:", afterTokens);
		console.log("diff3 beforeText:", beforeText);
		console.log("diff3 afterText:", afterText);
		console.log("diff3 diffWords:", diffParts);
		console.log("diff3 alignedDiffParts:", alignedDiffParts);

		// — Stage 7: Final Output Generation (Before / After Views) —
		diffLeft.innerHTML = leftHtml;
		diffRight.innerHTML = rightHtml;

		// — Stage 8: Post-processing unchanged runs across both outputs —
		wrapUnchangedOutputs(diffLeft, diffRight);
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
