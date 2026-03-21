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
	// STAGE 5 — Diff Annotation (Assign Types)
	// Wrap aligned token slices in <mark class="deleted|added"> elements
	// according to their diff type, rebuilding inline markup around each slice.
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

	// ─────────────────────────────────────────────────────────────────────────
	// STAGE 6 — Final Output Generation (Before / After Views)
	// Annotate diff parts with <mark class="deleted|added"> and assemble the
	// full HTML string for each side (left = before, right = after).
	// ─────────────────────────────────────────────────────────────────────────

	function buildSideHtmlFromAligned(alignedParts, side) {
		let html = "";
		alignedParts.forEach((part) => {
			if (side === "left") {
				if (part.removed) {
					html += `<mark class="deleted">${renderSlicesToHtml(part.beforeTokens)}</mark>`;
				} else if (part.equal) {
					html += renderSlicesToHtml(part.beforeTokens);
				}
			} else if (side === "right") {
				if (part.added) {
					html += `<mark class="added">${renderSlicesToHtml(part.afterTokens)}</mark>`;
				} else if (part.equal) {
					html += renderSlicesToHtml(part.afterTokens);
				}
			}
		});
		return html || '<span style="color:#aaa">(none)</span>';
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

		// — Stage 5: Diff Annotation (Assign Types) —
		// Implemented during rendering via buildSideHtmlFromAligned/renderSlicesToHtml.
		// TODO — Stage 7: Segment Merging (Normalize Adjacent Blocks) —

		console.log("diff3 before tokens:", beforeTokens);
		console.log("diff3 after tokens:", afterTokens);
		console.log("diff3 beforeText:", beforeText);
		console.log("diff3 afterText:", afterText);
		console.log("diff3 diffWords:", diffParts);
		console.log("diff3 alignedDiffParts:", alignedDiffParts);

		// — Stage 6: Final Output Generation (Before / After Views) —
		diffLeft.innerHTML = buildSideHtmlFromAligned(alignedDiffParts, "left");
		diffRight.innerHTML = buildSideHtmlFromAligned(alignedDiffParts, "right");
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
