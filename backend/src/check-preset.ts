#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write

/**
 * Deno CLI script to check if RSS URLs in preset-full.json are live.
 * Removes dead links and keeps only 1 link per base domain.
 * Outputs to preset.json.
 * Skips news.google.com/rss URLs.
 */

const INPUT_PATH = new URL("./preset-full.json", import.meta.url).pathname;
const OUTPUT_PATH = new URL("./preset.json", import.meta.url).pathname;
const REPORT_PATH = new URL("./rss-feeds-report.csv", import.meta.url).pathname;

const FETCH_TIMEOUT = 10000; // 10 seconds
const CONCURRENCY = 20; // Number of concurrent fetches

interface CheckResult {
  category: string;
  url: string;
  status: "OK" | "DEAD" | "STALE" | "EMPTY";
  error?: string;
  newestDate?: string;
}

async function readPreset(): Promise<Record<string, string[]>> {
  const content = await Deno.readTextFile(INPUT_PATH);
  return JSON.parse(content);
}

function shouldSkip(url: string): boolean {
  // Skip Google News RSS URLs
  return url.includes("news.google.com/rss");
}

function getBaseDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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
        "User-Agent":
          "Mozilla/5.0 (compatible; RSSFeedChecker/1.0; +https://example.com/bot)",
        "Accept":
          "application/rss+xml, application/xml, application/atom+xml, text/xml, */*",
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

  // Match common RSS date patterns
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
  return daysDiff > 30; // Consider stale if older than 30 days
}

async function checkFeed(
  category: string,
  url: string
): Promise<CheckResult> {
  const result: CheckResult = {
    category,
    url,
    status: "OK",
  };

  const fetchResult = await fetchWithTimeout(url, FETCH_TIMEOUT);

  if (!fetchResult.ok) {
    if (fetchResult.error?.includes("abort")) {
      result.status = "DEAD";
      result.error = "Timeout";
    } else if (fetchResult.error?.includes("error sending request")) {
      result.status = "DEAD";
      result.error = "Connection failed";
    } else if (
      fetchResult.error?.includes("404") ||
      fetchResult.status === 404
    ) {
      result.status = "DEAD";
      result.error = "HTTP 404";
    } else if (
      fetchResult.error?.includes("403") ||
      fetchResult.status === 403
    ) {
      result.status = "DEAD";
      result.error = "HTTP 403";
    } else if (
      fetchResult.error?.includes("451") ||
      fetchResult.status === 451
    ) {
      result.status = "DEAD";
      result.error = "HTTP 451";
    } else if (fetchResult.status && fetchResult.status >= 400) {
      result.status = "DEAD";
      result.error = `HTTP ${fetchResult.status}`;
    } else {
      result.status = "DEAD";
      result.error = fetchResult.error || "Unknown error";
    }
    return result;
  }

  // Check content
  const content = fetchResult.content || "";
  if (!content.trim()) {
    result.status = "EMPTY";
    result.error = "Empty response";
    return result;
  }

  // Extract dates and check if stale
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

async function main(): Promise<void> {
  console.log("Reading preset-full.json...");
  const preset = await readPreset();

  // Collect all URLs with their categories
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
  const stats = {
    ok: 0,
    dead: 0,
    stale: 0,
    empty: 0,
  };

  // Process with concurrency limit
  for (let i = 0; i < urlsToCheck.length; i += CONCURRENCY) {
    const batch = urlsToCheck.slice(i, i + CONCURRENCY);
    const batchPromises = batch.map(({ category, url }) =>
      checkFeed(category, url)
    );
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
          console.log(
            `✗ [${result.category}] ${result.url} - ${result.error}`
          );
          break;
        case "STALE":
          stats.stale++;
          console.log(
            `⚠ [${result.category}] ${result.url} - ${result.error} (${result.newestDate})`
          );
          break;
        case "EMPTY":
          stats.empty++;
          console.log(
            `⚠ [${result.category}] ${result.url} - ${result.error}`
          );
          break;
      }
    }

    console.log(
      `Progress: ${Math.min(i + CONCURRENCY, urlsToCheck.length)}/${urlsToCheck.length}`
    );
  }

  // Build new preset with only OK feeds and deduplicated by domain
  const newPreset: Record<string, string[]> = {};
  const domainSeen = new Map<string, string>(); // domain -> url
  const dedupStats = { removed: 0 };

  for (const result of results) {
    if (result.status !== "OK") continue;

    const baseDomain = getBaseDomain(result.url);
    const existingUrl = domainSeen.get(baseDomain);

    if (existingUrl) {
      // Skip duplicate domain
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

  // Write output
  const outputContent = JSON.stringify(newPreset, null, 2) + "\n";
  await Deno.writeTextFile(OUTPUT_PATH, outputContent);

  // Write report
  const csvLines = [
    "Category,URL,Status,Error,NewestDate",
    ...results.map(
      (r) =>
        `"${r.category}","${r.url}","${r.status}","${r.error || ""}","${r.newestDate || ""}"`
    ),
  ];

  await Deno.writeTextFile(
    OUTPUT_PATH.replace(".json", "-check-report.csv"),
    csvLines.join("\n")
  );

  // Print summary
  console.log("\n--- Summary ---");
  console.log(`OK: ${stats.ok}`);
  console.log(`DEAD (removed): ${stats.dead}`);
  console.log(`STALE (removed): ${stats.stale}`);
  console.log(`EMPTY (removed): ${stats.empty}`);
  console.log(`Duplicates (removed): ${dedupStats.removed}`);
  console.log(`Total kept: ${Object.values(newPreset).flat().length}`);
  console.log(`\nOutput written to: ${OUTPUT_PATH}`);
  console.log(
    `Report saved to: ${OUTPUT_PATH.replace(".json", "-check-report.csv")}`
  );
}

await main();
