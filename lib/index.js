/**
 * @module @deepseek-ai/dsh-tool-everything
 *
 * The model-facing `everything_search` tool: search the whole Windows
 * filesystem through the Everything index (voidtools). Execution loads the
 * official Everything SDK DLL (`Everything64.dll`, shipped in `native/`) with
 * koffi and talks to the already-running Everything instance over its IPC
 * channel — no HTTP server, no es.exe, no configuration changes on the
 * Everything side. The tool owns the schema, argument validation, the
 * Everything query flags, result sampling, and formatting; the native call is
 * a synchronous FFI round-trip through the Everything SDK.
 *
 * Everything must be running for a query to succeed; `Everything_QueryW`
 * returns FALSE otherwise, which the tool reports as `EVERYTHING_NOT_RUNNING`.
 * The search syntax is Everything's own (wildcards, `path:`, `ext:`, `size:`,
 * `regex:`, `|` alternation, …) — see https://www.voidtools.com/support/everything/searching/
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";

//#region search-core
/**
 * Default cap on results retained inline by one call (the `maxResults` config).
 * Everything can match hundreds of thousands of files; the model only ever
 * sees this many paths inline, and the complete count is reported as `total`.
 */
const DEFAULT_MAX_RESULTS = 100;
/**
 * Default cooperative tool-call timeout budget in milliseconds (the `timeoutMs`
 * config), attached to the tool definition for
 * `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce.
 */
const SEARCH_TIMEOUT_MS = 3e4;
/**
 * Default path buffer size in UTF-16 code units for one result path.
 * Windows long paths can exceed 260 chars; 32768 units (64 KiB) is generous.
 */
const PATH_BUF_UNITS = 32768;

/**
 * Typed search failure. Extends {@link HarnessError} so it carries a stable
 * error code; the tool registry exposes `{ name, code }` on `isError` results.
 */
class EverythingError extends HarnessError {
	code;
	constructor(message, code, options) {
		super(message, code, options);
		this.code = code;
	}
}

/**
 * Memoized SDK handle. Everything64.dll is loaded lazily at the first call so
 * a missing/corrupt DLL fails the first search as `EVERYTHING_SDK_LOAD_FAILED`
 * instead of failing the whole plugin load.
 *
 * @returns the koffi library handle and the bound SDK functions.
 */
function loadSdk(config) {
	const require = createRequire(import.meta.url);
	const koffi = require("koffi");
	const dllPath = config.everythingDllPath ?? fileURLToPath(new URL("../native/Everything64.dll", import.meta.url));
	let lib;
	try {
		lib = koffi.load(dllPath);
	} catch (error) {
		throw new EverythingError(`everything_search could not load the Everything SDK DLL at ${dllPath} (is it present?)`, "EVERYTHING_SDK_LOAD_FAILED", { cause: error });
	}
	const api = {
		SetSearchW: lib.func("void Everything_SetSearchW(const char16_t *search)"),
		SetMatchPath: lib.func("void Everything_SetMatchPath(bool matchPath)"),
		SetMatchCase: lib.func("void Everything_SetMatchCase(bool matchCase)"),
		SetRegex: lib.func("void Everything_SetRegex(bool regex)"),
		SetMax: lib.func("void Everything_SetMax(uint32 max)"),
		SetOffset: lib.func("void Everything_SetOffset(uint32 offset)"),
		QueryW: lib.func("bool Everything_QueryW(bool wait)"),
		GetNumResults: lib.func("uint32 Everything_GetNumResults()"),
		GetTotResults: lib.func("uint32 Everything_GetTotResults()"),
		IsFolderResult: lib.func("bool Everything_IsFolderResult(uint32 index)"),
		GetResultFullPathNameW: lib.func("uint32 Everything_GetResultFullPathNameW(uint32 index, char16_t *buf, uint32 size)"),
		GetResultSize: lib.func("bool Everything_GetResultSize(uint32 index, int64 *size)"),
		GetLastError: lib.func("uint32 Everything_GetLastError()")
	};
	return { koffi, api };
}

let sdkPromise;
function resolveSdk(config) {
	sdkPromise ??= loadSdk(config);
	return sdkPromise;
}

/**
 * Validate value constraints the schema DSL can't express: a non-blank search.
 * Throws a plain `Error` (an ordinary tool argument error) otherwise.
 */
function parseArgs(args) {
	if (args.search.trim().length === 0) throw new Error("search must be a non-empty string");
	return args;
}

/**
 * Compose the Everything search string: an optional `path:` scope is prepended
 * so a relative `path` (e.g. "D:\code") keeps working exactly as written.
 * Everything's own syntax handles the rest (wildcards, functions, operators).
 */
function buildSearch(input) {
	if (input.path === void 0 || input.path.trim().length === 0) return input.search;
	return `${input.search} path:${input.path}`;
}

/** Format one result path with its size/folder marker for the model-facing text. */
function formatItem(item) {
	const size = item.folder ? "<DIR>" : item.size > 0 ? `${item.size} B` : "";
	return `${item.path}${size.length > 0 ? `\t${size}` : ""}`;
}

/**
 * Format the model-facing result: a header line with counts, the retained
 * paths, and a truncation footer when the result was capped.
 */
function formatOutput(value, maxResults) {
	const header = value.truncated
		? `Found ${value.items.length} of ${value.total} results`
		: `Found ${value.total} ${value.total === 1 ? "result" : "results"}`;
	const body = value.items.map(formatItem).join("\n");
	if (!value.truncated) return `${header}\n\n${body}`;
	return `${header}\n\n${body}\n\n(Showing the first ${value.items.length}; narrow the search or raise maxResults to see more.)`;
}

/**
 * Pending-call presentation: a search card titled by the search text.
 */
function presentCall(args) {
	return {
		card: "generic",
		title: `Everything ${args.search}`,
		kind: "search",
		rawInput: args.search
	};
}

/**
 * Completed-call presentation: the search card projected from the result's
 * `presentationMeta` (the retained path list, with the truncation signal).
 */
function presentResult(_args, result) {
	if (result.isError) return void 0;
	const meta = result.meta;
	if (typeof meta !== "object" || meta === null) return void 0;
	const { paths, truncated, total } = meta;
	if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string") || typeof truncated !== "boolean" || typeof total !== "number") return void 0;
	return {
		card: "search",
		shape: "paths",
		paths,
		truncated,
		total
	};
}

/** Query Everything synchronously through the SDK and collect `max` results. */
async function runQuery(ctx, exec, input, caps) {
	if (exec.signal.aborted) throw new EverythingError("everything_search was aborted before completion (tool timeout or caller cancellation)", "SEARCH_ABORTED");
	const { koffi, api } = await resolveSdk(caps);
	const search = buildSearch(input);
	api.SetSearchW(search);
	api.SetMatchPath(false);
	api.SetMatchCase(false);
	api.SetRegex(false);
	api.SetMax(caps.maxResults);
	api.SetOffset(0);
	const ok = api.QueryW(true);
	if (!ok) {
		const lastError = api.GetLastError();
		throw new EverythingError(`everything_search query failed (Everything may not be running; lastError=${lastError})`, "EVERYTHING_NOT_RUNNING");
	}
	const total = api.GetTotResults();
	const count = Math.min(api.GetNumResults(), caps.maxResults);
	const items = [];
	for (let index = 0; index < count; index++) {
		const buf = Buffer.allocUnsafe(PATH_BUF_UNITS * 2);
		const written = api.GetResultFullPathNameW(index, buf, PATH_BUF_UNITS);
		const path = koffi.decode(buf, "char16_t", written);
		const folder = api.IsFolderResult(index);
		const sizeBuf = Buffer.allocUnsafe(8);
		api.GetResultSize(index, sizeBuf);
		const size = Number(koffi.decode(sizeBuf, "int64"));
		items.push({ path, folder, size });
	}
	return {
		items,
		total,
		truncated: total > items.length
	};
}
//#endregion

/**
 * Register the `everything_search` tool and its system-prompt guidance.
 */
function applyTool(ctx, caps) {
	ctx.systemPrompt.section({
		name: "tool:everything_search",
		order: 105,
		text: "Use the everything_search tool to find files anywhere on the Windows system by name through the Everything index — far faster than glob for whole-disk discovery (e.g. locating an app's install folder, a file in another user's directory, or anything outside the workspace). It accepts Everything search syntax (wildcards, path:, ext:, size:, regex:, | alternation). Everything must be running."
	});
	const tool = defineTool({
		name: "everything_search",
		description: `Search the entire Windows filesystem by name using the Everything index. Accepts Everything search syntax: plain text matches anywhere in the name; wildcards like *.pdf or *report*; path: to scope to a directory (path:D:\\code), ext:zip, size:>10mb, | for OR, ! for NOT, regex: for regular expressions. Returns up to ${caps.maxResults} matching paths with size/folder markers; a capped result reports the total and says so. Everything must be running.`,
		parameters: {
			search: {
				type: "string",
				required: true,
				description: "Everything search expression (e.g. \"*.pdf\", \"report*\", \"path:C:\\Users\\roxyy\\Downloads *.zip\")."
			},
			path: {
				type: "string",
				description: `Optional directory scope prepended as path:<value> to the search (e.g. "D:\\code"). Use when you know the containing folder.`
			},
			maxResults: {
				type: "number",
				description: `How many paths to return at most. Defaults to ${caps.maxResults}.`
			}
		},
		timeoutMs: caps.timeoutMs,
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					items: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								path: { type: "string", required: true },
								folder: { type: "boolean", required: true },
								size: { type: "number", required: true }
							}
						}
					},
					total: { type: "number", required: true },
					truncated: { type: "boolean", required: true }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: formatOutput(value, caps.maxResults)
			}],
			presentationMeta: (_args, value) => ({
				paths: value.items.map((item) => item.path),
				truncated: value.truncated,
				total: value.total
			})
		},
		async execute(args, exec) {
			const input = parseArgs(args);
			const maxResults = input.maxResults !== void 0 ? Math.max(1, Math.floor(input.maxResults)) : caps.maxResults;
			return await runQuery(ctx, exec, input, { ...caps, maxResults });
		},
		presentCall,
		presentResult
	});
	ctx.tools.register(tool);
}

//#region plugin
/** Cordis plugin name used by loader diagnostics. */
const name = "tool-everything";
/** Services required by the tool. */
const inject = [
	"tools",
	"systemPrompt"
];

const Config = z.object({
	maxResults: z.number().default(DEFAULT_MAX_RESULTS),
	timeoutMs: z.number().default(SEARCH_TIMEOUT_MS),
	everythingDllPath: z.string()
});

function assertPositiveInteger(field, value) {
	if (!Number.isInteger(value) || value < 1) throw new Error(`tool-everything: ${field} must be a positive integer`);
}

/**
 * Register the `everything_search` tool. The Everything SDK DLL ships with
 * the package, so registration is unconditional; a broken DLL fails at the
 * first search call, not at plugin load.
 */
async function apply(ctx, config) {
	const resolved = config;
	assertPositiveInteger("maxResults", resolved.maxResults);
	assertPositiveInteger("timeoutMs", resolved.timeoutMs);
	if (resolved.timeoutMs > MAX_TIMER_DELAY_MS) throw new Error(`tool-everything: timeoutMs must be no greater than ${MAX_TIMER_DELAY_MS}`);
	sdkPromise = void 0;
	applyTool(ctx, {
		maxResults: resolved.maxResults,
		timeoutMs: resolved.timeoutMs,
		everythingDllPath: resolved.everythingDllPath
	});
}
//#endregion

export { Config, DEFAULT_MAX_RESULTS, EverythingError, SEARCH_TIMEOUT_MS, apply, applyTool, buildSearch, formatOutput, inject, name, parseArgs, presentCall, presentResult, resolveSdk, runQuery };
