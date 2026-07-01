/**
 * Typed API client for the frontend.
 *
 * All functions are thin fetch wrappers that return properly typed data or
 * throw an Error with the server's { error: string } message.
 *
 * Usage:
 *   import { api } from "@/lib/api";
 *   const { posts, total } = await api.posts.list({ status: "scheduled" });
 */

import type {
  CreatePostInput,
  CreateAccountInput,
  UpdateAccountInput,
} from "@/lib/validations";

// ── Shared response types ─────────────────────────────────────────────────────

export interface PostAsset {
  id: string;
  filePath: string;
  processedPath: string | null;
  type: string;
  order: number;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSecs: number | null;
}

export interface PublishAttempt {
  id: string;
  platform: string;
  status: string;
  error: string | null;
  screenshotPath: string | null;
  logs: string | null;
  createdAt: string;
}

export interface Post {
  id: string;
  platform: string;
  type: string;
  caption: string;
  status: string;
  scheduledAt: string | null;
  publishedAt?: string | null;
  errorMessage: string | null;
  bullJobId: string | null;
  createdAt: string;
  updatedAt: string;
  socialAccountId: string;
  assets: PostAsset[];
  attempts: PublishAttempt[];
  account?: SocialAccount;
}

export interface SocialAccount {
  id: string;
  platform: string;
  username: string;
  sessionPath: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UploadResult {
  filePath: string;
  filename: string;
  size: number;
  type: string;
}

// ── Base fetch helper ─────────────────────────────────────────────────────────

const BASE_URL =
  typeof window !== "undefined"
    ? "" // relative path in browser
    : process.env.NEXTAUTH_URL || "http://localhost:3000";

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${BASE_URL}${path}`;

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore JSON parse error
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

// ── Posts API ─────────────────────────────────────────────────────────────────

export interface ListPostsParams {
  status?: string;
  platform?: string;
  socialAccountId?: string;
  page?: number;
  limit?: number;
}

async function listPosts(
  params: ListPostsParams = {}
): Promise<PaginatedResponse<Post>> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.platform) qs.set("platform", params.platform);
  if (params.socialAccountId) qs.set("socialAccountId", params.socialAccountId);
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));

  const query = qs.toString();
  return apiFetch<PaginatedResponse<Post>>(`/api/posts${query ? `?${query}` : ""}`);
}

async function createPost(data: CreatePostInput): Promise<Post> {
  return apiFetch<Post>("/api/posts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function getPost(id: string): Promise<Post> {
  return apiFetch<Post>(`/api/posts/${id}`);
}

async function deletePost(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/posts/${id}`, {
    method: "DELETE",
  });
}

async function retryPost(id: string): Promise<Post> {
  return apiFetch<Post>(`/api/posts/${id}/retry`, {
    method: "POST",
  });
}

// ── Accounts API ──────────────────────────────────────────────────────────────

async function listAccounts(): Promise<SocialAccount[]> {
  return apiFetch<SocialAccount[]>("/api/accounts");
}

async function createAccount(data: CreateAccountInput): Promise<SocialAccount> {
  return apiFetch<SocialAccount>("/api/accounts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function getAccount(id: string): Promise<SocialAccount> {
  return apiFetch<SocialAccount>(`/api/accounts/${id}`);
}

async function updateAccount(
  id: string,
  data: UpdateAccountInput
): Promise<SocialAccount> {
  return apiFetch<SocialAccount>(`/api/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

async function deleteAccount(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/accounts/${id}`, {
    method: "DELETE",
  });
}

async function openBrowser(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/accounts/${id}/open-browser`, {
    method: "POST",
  });
}

async function checkSession(id: string): Promise<{ loggedIn: boolean }> {
  return apiFetch<{ loggedIn: boolean }>(`/api/accounts/${id}/check-session`, {
    method: "POST",
  });
}

// ── Upload API ────────────────────────────────────────────────────────────────

async function uploadFile(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);

  const url = `${BASE_URL}/api/upload`;
  const res = await fetch(url, {
    method: "POST",
    body: formData,
    // Do NOT set Content-Type — browser sets it with the correct boundary
  });

  if (!res.ok) {
    let message = `Upload failed with status ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return res.json() as Promise<UploadResult>;
}

// ── Namespaced export ─────────────────────────────────────────────────────────

export const api = {
  posts: {
    list: listPosts,
    create: createPost,
    get: getPost,
    delete: deletePost,
    retry: retryPost,
  },
  accounts: {
    list: listAccounts,
    create: createAccount,
    get: getAccount,
    update: updateAccount,
    delete: deleteAccount,
    openBrowser,
    checkSession,
  },
  upload: {
    file: uploadFile,
  },
};
