import type { DefuddleOptions } from "defuddle/node";

export interface MarkhqWarning {
  code: string;
  message: string;
  url?: string;
}

export interface HeaderValue {
  name: string;
  value: string;
}

export interface ConvertHtmlOptions {
  html: string;
  url: string | URL;
  defuddle?: Omit<DefuddleOptions, "markdown" | "url">;
}

export interface ConvertedPage {
  markdown: string;
  metadata: PageMetadata;
}

export interface PageMetadata {
  title?: string;
  description?: string;
  author?: string;
  published?: string;
  site?: string;
  domain?: string;
  language?: string;
  image?: string;
  favicon?: string;
  wordCount?: number;
}

export interface GetPageOptions {
  url: string | URL;
  root?: string;
  configPath?: string;
  update?: boolean;
  headers?: HeaderValue[];
  userAgent?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  useAsync?: boolean;
  now?: () => Date;
  onWarning?: (warning: MarkhqWarning) => void;
}

export interface AssetResult {
  sourceUrl: string;
  finalUrl?: string;
  path?: string;
  status: "saved" | "reused" | "failed";
  error?: string;
}

export interface GetPageResult {
  requestedUrl: string;
  sourceUrl: string;
  path: string;
  status: "saved" | "updated" | "skipped";
  assets: AssetResult[];
  warnings: MarkhqWarning[];
}
