/**
 * GitHub Service
 *
 * OAuth Device Flow authentication for GitHub.
 * Allows users to authenticate by entering a code at github.com/login/device
 */

import { invoke } from '@tauri-apps/api/core';

// Constants
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';
const TOKEN_FILE = '.one-term/github-token';

// GitHub OAuth App Client ID (public, safe to include)
// Users should register their own OAuth App at https://github.com/settings/applications/new
// For development, we use a placeholder that should be replaced
const GITHUB_CLIENT_ID = 'Ov23linMkQ6TMUPEj2X3';

// Types
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
  email: string | null;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  updated_at: string;
}

// Error types
export class GitHubAuthError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'GitHubAuthError';
    this.code = code;
  }
}

/**
 * Get the home directory path
 */
async function getHomeDir(): Promise<string> {
  const result = await invoke<string>('execute_command', {
    cmd: 'echo $HOME',
    cwd: '/',
  });
  return result.trim();
}

/**
 * Start the OAuth Device Flow
 * Returns device code and user code for the user to enter at github.com
 */
export async function startDeviceFlow(clientId?: string): Promise<DeviceCodeResponse> {
  const id = clientId || GITHUB_CLIENT_ID;
  const cmd = `curl -s -X POST "${GITHUB_DEVICE_CODE_URL}" -H "Accept: application/json" -d "client_id=${id}" -d "scope=repo,read:user"`;

  console.log('[GitHub] Starting device flow with command:', cmd);

  try {
    const response = await invoke<string>('execute_command', {
      cmd,
      cwd: '/',
    });

    console.log('[GitHub] Response:', response);
    const data = JSON.parse(response);

    if (data.error) {
      throw new GitHubAuthError(data.error_description || data.error, data.error);
    }

    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires_in: data.expires_in,
      interval: data.interval,
    };
  } catch (error) {
    console.error('[GitHub] Error:', error);
    if (error instanceof GitHubAuthError) throw error;
    throw new GitHubAuthError(
      `Failed to start device flow: ${error}`,
      'DEVICE_FLOW_FAILED'
    );
  }
}

/**
 * Poll for access token after user has entered the code
 * Returns the access token when user completes authentication
 */
export async function pollForToken(
  deviceCode: string,
  interval: number = 5,
  clientId?: string,
  onPending?: () => void
): Promise<string> {
  const id = clientId || GITHUB_CLIENT_ID;
  const pollInterval = Math.max(interval, 5) * 1000; // Minimum 5 seconds

  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await invoke<string>('execute_command', {
          cmd: `curl -s -X POST "${GITHUB_ACCESS_TOKEN_URL}" -H "Accept: application/json" -d "client_id=${id}" -d "device_code=${deviceCode}" -d "grant_type=urn:ietf:params:oauth:grant-type:device_code"`,
          cwd: '/',
        });

        const data = JSON.parse(response);

        if (data.access_token) {
          // Success! Save token and return
          await saveToken(data.access_token);
          resolve(data.access_token);
          return;
        }

        if (data.error) {
          switch (data.error) {
            case 'authorization_pending':
              // User hasn't entered code yet, keep polling
              onPending?.();
              setTimeout(poll, pollInterval);
              break;

            case 'slow_down':
              // Rate limited, increase interval
              setTimeout(poll, pollInterval + 5000);
              break;

            case 'expired_token':
              reject(new GitHubAuthError('Device code expired. Please restart.', 'EXPIRED'));
              break;

            case 'access_denied':
              reject(new GitHubAuthError('User denied access.', 'ACCESS_DENIED'));
              break;

            default:
              reject(new GitHubAuthError(data.error_description || data.error, data.error));
          }
        }
      } catch (error) {
        reject(new GitHubAuthError(`Polling failed: ${error}`, 'POLL_FAILED'));
      }
    };

    // Start polling
    poll();
  });
}

/**
 * Save the access token securely
 */
async function saveToken(token: string): Promise<void> {
  const home = await getHomeDir();
  const tokenPath = `${home}/${TOKEN_FILE}`;
  const dir = `${home}/.one-term`;

  // Create directory if needed
  await invoke<string>('execute_command', {
    cmd: `mkdir -p "${dir}" && chmod 700 "${dir}"`,
    cwd: '/',
  });

  // Save token with restricted permissions (use btoa for browser compatibility)
  const encodedToken = btoa(token);
  await invoke<string>('execute_command', {
    cmd: `echo "${encodedToken}" > "${tokenPath}" && chmod 600 "${tokenPath}"`,
    cwd: '/',
  });
}

/**
 * Load saved access token
 */
export async function loadToken(): Promise<string | null> {
  try {
    const home = await getHomeDir();
    const tokenPath = `${home}/${TOKEN_FILE}`;

    const encoded = await invoke<string>('execute_command', {
      cmd: `cat "${tokenPath}" 2>/dev/null || echo ""`,
      cwd: '/',
    });

    const trimmed = encoded.trim();
    if (!trimmed) return null;

    // Use atob for browser compatibility
    return atob(trimmed);
  } catch {
    return null;
  }
}

/**
 * Delete saved token (logout)
 */
export async function deleteToken(): Promise<void> {
  const home = await getHomeDir();
  const tokenPath = `${home}/${TOKEN_FILE}`;

  await invoke<string>('execute_command', {
    cmd: `rm -f "${tokenPath}"`,
    cwd: '/',
  });
}

/**
 * Validate token by fetching user info
 */
export async function validateToken(token: string): Promise<GitHubUser | null> {
  try {
    const response = await invoke<string>('execute_command', {
      cmd: `curl -s -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" "${GITHUB_API_URL}/user"`,
      cwd: '/',
    });

    const data = JSON.parse(response);

    if (data.message === 'Bad credentials') {
      return null;
    }

    if (data.login) {
      return {
        login: data.login,
        id: data.id,
        avatar_url: data.avatar_url,
        name: data.name,
        email: data.email,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get current authenticated user
 * Returns null if not authenticated
 */
export async function getCurrentUser(): Promise<GitHubUser | null> {
  const token = await loadToken();
  if (!token) return null;
  return validateToken(token);
}

/**
 * List user's repositories
 */
export async function listRepositories(
  token?: string,
  options?: {
    visibility?: 'all' | 'public' | 'private';
    sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    per_page?: number;
    page?: number;
  }
): Promise<GitHubRepo[]> {
  const accessToken = token || (await loadToken());
  if (!accessToken) {
    throw new GitHubAuthError('Not authenticated', 'NOT_AUTHENTICATED');
  }

  const { visibility = 'all', sort = 'updated', per_page = 30, page = 1 } = options || {};

  try {
    const response = await invoke<string>('execute_command', {
      cmd: `curl -s -H "Authorization: Bearer ${accessToken}" -H "Accept: application/vnd.github+json" "${GITHUB_API_URL}/user/repos?visibility=${visibility}&sort=${sort}&per_page=${per_page}&page=${page}"`,
      cwd: '/',
    });

    const data = JSON.parse(response);

    if (data.message) {
      throw new GitHubAuthError(data.message, 'API_ERROR');
    }

    return data.map((repo: Record<string, unknown>) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      description: repo.description,
      clone_url: repo.clone_url,
      ssh_url: repo.ssh_url,
      default_branch: repo.default_branch,
      updated_at: repo.updated_at,
    }));
  } catch (error) {
    if (error instanceof GitHubAuthError) throw error;
    throw new GitHubAuthError(`Failed to list repositories: ${error}`, 'LIST_REPOS_FAILED');
  }
}

/**
 * Clone a repository using the saved token
 */
export async function cloneRepository(
  repoUrl: string,
  targetPath: string,
  token?: string
): Promise<void> {
  const accessToken = token || (await loadToken());

  // Parse the URL to inject token for HTTPS
  let cloneUrl = repoUrl;

  if (accessToken && repoUrl.startsWith('https://github.com/')) {
    // Inject token into HTTPS URL for private repos
    cloneUrl = repoUrl.replace(
      'https://github.com/',
      `https://${accessToken}@github.com/`
    );
  }

  try {
    await invoke<string>('execute_command', {
      cmd: `git clone "${cloneUrl}" "${targetPath}"`,
      cwd: '/',
    });
  } catch (error) {
    throw new GitHubAuthError(`Clone failed: ${error}`, 'CLONE_FAILED');
  }
}

/**
 * Search repositories
 */
export async function searchRepositories(
  query: string,
  token?: string,
  per_page: number = 10
): Promise<GitHubRepo[]> {
  const accessToken = token || (await loadToken());

  const authHeader = accessToken
    ? `-H "Authorization: Bearer ${accessToken}"`
    : '';

  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await invoke<string>('execute_command', {
      cmd: `curl -s ${authHeader} -H "Accept: application/vnd.github+json" "${GITHUB_API_URL}/search/repositories?q=${encodedQuery}&per_page=${per_page}"`,
      cwd: '/',
    });

    const data = JSON.parse(response);

    if (data.message) {
      throw new GitHubAuthError(data.message, 'API_ERROR');
    }

    return (data.items || []).map((repo: Record<string, unknown>) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      description: repo.description,
      clone_url: repo.clone_url,
      ssh_url: repo.ssh_url,
      default_branch: repo.default_branch,
      updated_at: repo.updated_at,
    }));
  } catch (error) {
    if (error instanceof GitHubAuthError) throw error;
    throw new GitHubAuthError(`Search failed: ${error}`, 'SEARCH_FAILED');
  }
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const user = await getCurrentUser();
  return user !== null;
}

/**
 * Full authentication flow helper
 * Returns user info on success
 */
export async function authenticate(
  clientId?: string,
  callbacks?: {
    onDeviceCode?: (code: string, uri: string) => void;
    onPolling?: () => void;
    onSuccess?: (user: GitHubUser) => void;
    onError?: (error: GitHubAuthError) => void;
  }
): Promise<GitHubUser> {
  try {
    // Step 1: Start device flow
    const deviceFlow = await startDeviceFlow(clientId);
    callbacks?.onDeviceCode?.(deviceFlow.user_code, deviceFlow.verification_uri);

    // Step 2: Poll for token
    const token = await pollForToken(
      deviceFlow.device_code,
      deviceFlow.interval,
      clientId,
      callbacks?.onPolling
    );

    // Step 3: Get user info
    const user = await validateToken(token);
    if (!user) {
      throw new GitHubAuthError('Failed to get user info', 'USER_INFO_FAILED');
    }

    callbacks?.onSuccess?.(user);
    return user;
  } catch (error) {
    const authError =
      error instanceof GitHubAuthError
        ? error
        : new GitHubAuthError(String(error), 'UNKNOWN_ERROR');
    callbacks?.onError?.(authError);
    throw authError;
  }
}
