#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write

/**
 * Deno CLI script to manage RSS presets.
 * Supports checking live status of feeds and updating presets from a CSV report.
 */

import { parse } from "https://deno.land/std@0.224.0/csv/parse.ts";

const PRESET_PATH = new URL("../../data/preset.json", import.meta.url).pathname;
const PRESET_FULL_PATH = new URL("../../data/preset-full.json", import.meta.url).pathname;
const CSV_REPORT_PATH = new URL("../../data/rss-feeds-report.csv", import.meta.url).pathname;

const FETCH_TIMEOUT = 10000; // 10 seconds
const CONCURRENCY = 20; // Number of concurrent fetches

// Map CSV categories to preset.json categories
const CATEGORY_MAP: Record<string, string> = {
	// World news
	politics: "world",
	us: "world",
	europe: "world",
	middleeast: "world",
	gov: "world",
	thinktanks: "world",
	crisis: "world",
	africa: "world",
	latam: "world",
	asia: "world",
	gccNews: "world",

	// Technology
	tech: "technology",
	startups: "technology",
	vcblogs: "technology",
	regionalStartups: "technology",
	github: "technology",
	hardware: "technology",
	cloud: "technology",
	dev: "technology",

	// AI
	ai: "ai",

	// Business & Finance
	finance: "business",
	energy: "business",
	layoffs: "business",
	markets: "business",
	forex: "business",
	bonds: "business",
	commodities: "business",
	crypto: "crypto",
	centralbanks: "business",
	economic: "business",
	ipo: "business",
	derivatives: "business",
	fintech: "business",
	regulation: "business",
	institutional: "business",
	analysis: "business",
	funding: "business",
	unicorns: "business",
	accelerators: "business",

	// Security
	security: "technology",

	// Policy & Think Tanks
	policy: "world",

	// Podcasts & Media
	podcasts: "technology",
	producthunt: "technology",

	// Outages & Status
	outages: "technology",

	// Science & Health
	science: "science",
	nature: "science",
	health: "health",

	// Positive & Inspiring
	positive: "world",
	inspiring: "world",
};

interface CheckResult {
	category: string;
	url: string;
	status: "OK" | "DEAD" | "STALE" | "EMPTY";
	error?: string;
	newestDate?: string;
}

interface FeedEntry {
	category: string;
	name: string;
	url: string;
}

// --- Utilities ---

async function readPreset(path: string): Promise<Record<string, string[]>> {
	try {
		const content = await Deno.readTextFile(path);
		return JSON.parse(content);
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) {
			return {};
		}
		throw error;
	}
}

async function writePreset(path: string, preset: Record<string, string[]>): Promise<void> {
	const content = JSON.stringify(preset, null, 2);
	await Deno.writeTextFile(path, content + "\n");
}

function getBaseDomain(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

// --- Check Mode Logic ---

function shouldSkip(url: string): boolean {
	return url.includes("news.google.com/rss");
}

async function fetchWithTimeout(
	url: string,
	timeout: number
): Promise<{ ok: boolean; status?: number; error?: string; content?: string }> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				"User-Agent": "Mozilla/5.0 (compatible; RSSFeedChecker/1.0; +https://example.com/bot)",
				"Accept": "application/rss+xml, application/xml, application/atom+xml, text/xml, */*",
			},
		});
		clearTimeout(timeoutId);

		const content = await response.text();
		return {
			ok: response.ok,
			status: response.status,
			content,
		};
	} catch (error) {
		clearTimeout(timeoutId);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			error: errorMessage,
		};
	}
}

function extractDatesFromRSS(content: string): Date[] {
	const dates: Date[] = [];
	const patterns = [
		/<pubDate>([^<]+)<\/pubDate>/gi,
		/<lastBuildDate>([^<]+)<\/lastBuildDate>/gi,
		/<updated>([^<]+)<\/updated>/gi,
		/date="([^"]+)"/gi,
		/published="([^"]+)"/gi,
	];

	for (const pattern of patterns) {
		const matches = content.matchAll(pattern);
		for (const match of matches) {
			const dateStr = match[1];
			const date = new Date(dateStr);
			if (!isNaN(date.getTime())) {
				dates.push(date);
			}
		}
	}
	return dates;
}

function getNewestDate(dates: Date[]): string | undefined {
	if (dates.length === 0) return undefined;
	const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
	return maxDate.toISOString().split("T")[0];
}

function isStale(dateStr?: string): boolean {
	if (!dateStr) return true;
	const date = new Date(dateStr);
	const now = new Date();
	const daysDiff = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
	return daysDiff > 30;
}

async function checkFeed(category: string, url: string): Promise<CheckResult> {
	const result: CheckResult = { category, url, status: "OK" };
	const fetchResult = await fetchWithTimeout(url, FETCH_TIMEOUT);

	if (!fetchResult.ok) {
		if (fetchResult.error?.includes("abort")) {
			result.status = "DEAD";
			result.error = "Timeout";
		} else if (fetchResult.error?.includes("error sending request")) {
			result.status = "DEAD";
			result.error = "Connection failed";
		} else if (fetchResult.status && fetchResult.status >= 400) {
			result.status = "DEAD";
			result.error = `HTTP ${fetchResult.status}`;
		} else {
			result.status = "DEAD";
			result.error = fetchResult.error || "Unknown error";
		}
		return result;
	}

	const content = fetchResult.content || "";
	if (!content.trim()) {
		result.status = "EMPTY";
		result.error = "Empty response";
		return result;
	}

	const dates = extractDatesFromRSS(content);
	const newestDate = getNewestDate(dates);
	result.newestDate = newestDate;

	if (!newestDate) {
		result.status = "EMPTY";
		result.error = "No dates found";
		return result;
	}

	if (isStale(newestDate)) {
		result.status = "STALE";
		result.error = "Stale";
		return result;
	}

	return result;
}

async function runCheck(): Promise<void> {
	console.log("Reading preset-full.json...");
	const preset = await readPreset(PRESET_FULL_PATH);

	const urlsToCheck: { category: string; url: string }[] = [];
	for (const [category, urls] of Object.entries(preset)) {
		for (const url of urls) {
			if (!shouldSkip(url)) {
				urlsToCheck.push({ category, url });
			}
		}
	}

	console.log(`Checking ${urlsToCheck.length} URLs (skipping Google News RSS)...\n`);

	const results: CheckResult[] = [];
	const stats = { ok: 0, dead: 0, stale: 0, empty: 0 };

	for (let i = 0; i < urlsToCheck.length; i += CONCURRENCY) {
		const batch = urlsToCheck.slice(i, i + CONCURRENCY);
		const batchPromises = batch.map(({ category, url }) => checkFeed(category, url));
		const batchResults = await Promise.all(batchPromises);

		for (const result of batchResults) {
			results.push(result);
			switch (result.status) {
				case "OK":
					stats.ok++;
					console.log(`✓ [${result.category}] ${result.url}`);
					break;
				case "DEAD":
					stats.dead++;
					console.log(`✗ [${result.category}] ${result.url} - ${result.error}`);
					break;
				case "STALE":
					stats.stale++;
					console.log(`⚠ [${result.category}] ${result.url} - ${result.error} (${result.newestDate})`);
					break;
				case "EMPTY":
					stats.empty++;
					console.log(`⚠ [${result.category}] ${result.url} - ${result.error}`);
					break;
			}
		}
		console.log(`Progress: ${Math.min(i + CONCURRENCY, urlsToCheck.length)}/${urlsToCheck.length}`);
	}

	const newPreset: Record<string, string[]> = {};
	const domainSeen = new Map<string, string>();
	const dedupStats = { removed: 0 };

	for (const result of results) {
		if (result.status !== "OK") continue;

		const baseDomain = getBaseDomain(result.url);
		const existingUrl = domainSeen.get(baseDomain);

		if (existingUrl) {
			dedupStats.removed++;
			console.log(`⊘ Duplicate domain: ${result.url} (keeping ${existingUrl})`);
			continue;
		}

		domainSeen.set(baseDomain, result.url);

		if (!newPreset[result.category]) {
			newPreset[result.category] = [];
		}
		newPreset[result.category].push(result.url);
	}

	await writePreset(PRESET_PATH, newPreset);

	const reportPath = PRESET_PATH.replace(".json", "-check-report.csv");
	const csvLines = [
		"Category,URL,Status,Error,NewestDate",
		...results.map((r) => `"${r.category}","${r.url}","${r.status}","${r.error || ""}","${r.newestDate || ""}"`),
	];
	await Deno.writeTextFile(reportPath, csvLines.join("\n"));

	console.log("\n--- Summary ---");
	console.log(`OK: ${stats.ok}`);
	console.log(`DEAD (removed): ${stats.dead}`);
	console.log(`STALE (removed): ${stats.stale}`);
	console.log(`EMPTY (removed): ${stats.empty}`);
	console.log(`Duplicates (removed): ${dedupStats.removed}`);
	console.log(`Total kept: ${Object.values(newPreset).flat().length}`);
	console.log(`\nOutput written to: ${PRESET_PATH}`);
	console.log(`Report saved to: ${reportPath}`);
}

// --- Update Mode Logic ---

function parseCSVLine(line: string): string[] {
	const result: string[] = [];
	let current = "";
	let inQuotes = false;
	
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === ',' && !inQuotes) {
			result.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	result.push(current);
	return result;
}

async function readCSVFeeds(): Promise<FeedEntry[]> {
	const content = await Deno.readTextFile(CSV_REPORT_PATH);
	const lines = content.split("\n");
	const feeds: FeedEntry[] = [];
	
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;
		const fields = parseCSVLine(line);
		if (fields.length < 8) continue;
		
		const category = fields[2]?.trim() || "";
		const name = fields[3]?.replace(/^"|"$/g, "").trim() || "";
		const status = fields[4]?.trim() || "";
		const url = fields[7]?.trim() || "";
		
		if (status !== "OK") continue;
		if (!url || url.startsWith("http")) {
			feeds.push({ category, name, url });
		}
	}
	return feeds;
}

async function runUpdate(): Promise<void> {
	console.log("Reading RSS feeds from CSV...");
	const feeds = await readCSVFeeds();
	console.log(`Found ${feeds.length} OK status feeds in CSV`);
	
	console.log("Reading preset.json...");
	const preset = await readPreset(PRESET_PATH);
	
	let addedCount = 0;
	const skippedCount = { duplicate: 0, noCategory: 0 };
	
	for (const feed of feeds) {
		const targetCategory = CATEGORY_MAP[feed.category];
		
		if (!targetCategory) {
			console.log(`⚠️  No mapping for category: "${feed.category}" (${feed.name})`);
			skippedCount.noCategory++;
			continue;
		}
		
		if (!preset[targetCategory]) {
			preset[targetCategory] = [];
		}
		
		if (preset[targetCategory].includes(feed.url)) {
			skippedCount.duplicate++;
			continue;
		}
		
		preset[targetCategory].push(feed.url);
		addedCount++;
		console.log(`✓ Added "${feed.name}" to ${targetCategory}`);
	}
	
	await writePreset(PRESET_PATH, preset);
	
	console.log("\n--- Summary ---");
	console.log(`Added: ${addedCount}`);
	console.log(`Skipped (duplicate): ${skippedCount.duplicate}`);
	console.log(`Skipped (no category mapping): ${skippedCount.noCategory}`);
	console.log(`\nPreset updated: ${PRESET_PATH}`);
}

// --- Main ---

async function main(): Promise<void> {
	const mode = Deno.args[0];

	if (mode === "check") {
		await runCheck();
	} else if (mode === "update") {
		await runUpdate();
	} else {
		console.log("Usage: manage-presets.ts [check|update]");
		Deno.exit(1);
	}
}

if (import.meta.main) {
	await main();
}
