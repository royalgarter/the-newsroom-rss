#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Deno CLI script to read RSS feeds from rss-feeds-report.csv
 * and append them to preset.json by category.
 */

import { parse } from "https://deno.land/std@0.224.0/csv/parse.ts";

const CSV_PATH = new URL("./rss-feeds-report.csv", import.meta.url).pathname;
const PRESET_PATH = new URL("./preset.json", import.meta.url).pathname;

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

interface FeedEntry {
  category: string;
  name: string;
  url: string;
}

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
  const content = await Deno.readTextFile(CSV_PATH);
  const lines = content.split("\n");
  const feeds: FeedEntry[] = [];
  
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const fields = parseCSVLine(line);
    
    // CSV format: #,Variant,Category,Feed Name,Status,Newest Date,Error,URL
    if (fields.length < 8) continue;
    
    const category = fields[2]?.trim() || "";
    const name = fields[3]?.replace(/^"|"$/g, "").trim() || "";
    const status = fields[4]?.trim() || "";
    const url = fields[7]?.trim() || "";
    
    // Only include OK status feeds
    if (status !== "OK") continue;
    
    // Skip if URL is empty or malformed
    if (!url || url.startsWith("http")) {
      feeds.push({ category, name, url });
    }
  }
  
  return feeds;
}

async function readPreset(): Promise<Record<string, string[]>> {
  const content = await Deno.readTextFile(PRESET_PATH);
  return JSON.parse(content);
}

async function writePreset(preset: Record<string, string[]>): Promise<void> {
  const content = JSON.stringify(preset, null, 2);
  await Deno.writeTextFile(PRESET_PATH, content + "\n");
}

async function main(): Promise<void> {
  console.log("Reading RSS feeds from CSV...");
  const feeds = await readCSVFeeds();
  console.log(`Found ${feeds.length} OK status feeds in CSV`);
  
  console.log("Reading preset.json...");
  const preset = await readPreset();
  
  let addedCount = 0;
  const skippedCount = { duplicate: 0, noCategory: 0 };
  
  for (const feed of feeds) {
    const targetCategory = CATEGORY_MAP[feed.category];
    
    if (!targetCategory) {
      console.log(`⚠️  No mapping for category: "${feed.category}" (${feed.name})`);
      skippedCount.noCategory++;
      continue;
    }
    
    // Ensure category exists in preset
    if (!preset[targetCategory]) {
      preset[targetCategory] = [];
    }
    
    // Check for duplicates
    if (preset[targetCategory].includes(feed.url)) {
      skippedCount.duplicate++;
      continue;
    }
    
    // Add the feed
    preset[targetCategory].push(feed.url);
    addedCount++;
    console.log(`✓ Added "${feed.name}" to ${targetCategory}`);
  }
  
  await writePreset(preset);
  
  console.log("\n--- Summary ---");
  console.log(`Added: ${addedCount}`);
  console.log(`Skipped (duplicate): ${skippedCount.duplicate}`);
  console.log(`Skipped (no category mapping): ${skippedCount.noCategory}`);
  console.log(`\nPreset updated: ${PRESET_PATH}`);
}

await main();
