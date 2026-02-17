import https from 'https';
import http from 'http';
import { URL } from 'url';

/**
 * Validate that an asset URL is accessible and returns the expected content type
 * @param {string} url - The asset URL to validate
 * @param {string} expectedType - Expected type ('image' or 'video')
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns {Promise<{valid: boolean, contentType?: string, error?: string}>}
 */
export async function validateAssetUrl(url, expectedType, timeoutMs = 10000) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const request = client.request(
        url,
        {
          method: 'HEAD', // Only get headers, not the full content
          timeout: timeoutMs,
        },
        (response) => {
          const contentType = response.headers['content-type'] || '';
          const contentLength = response.headers['content-length'];

          // Check if we got a successful response
          if (response.statusCode >= 200 && response.statusCode < 300) {
            // Validate content type matches expected type
            const isImage = contentType.startsWith('image/');
            const isVideo = contentType.startsWith('video/');

            if (expectedType === 'image' && !isImage) {
              resolve({
                valid: false,
                error: `Expected image but got content-type: ${contentType}`,
              });
              return;
            }

            if (expectedType === 'video' && !isVideo) {
              resolve({
                valid: false,
                error: `Expected video but got content-type: ${contentType}`,
              });
              return;
            }

            // Check if content length is reasonable (not empty, not too large)
            if (contentLength) {
              const sizeBytes = parseInt(contentLength);
              if (sizeBytes === 0) {
                resolve({
                  valid: false,
                  error: 'Asset appears to be empty (0 bytes)',
                });
                return;
              }

              // Warn about very large files (>100MB)
              if (sizeBytes > 100 * 1024 * 1024) {
                console.warn(
                  `[assetValidation] Large asset detected: ${(sizeBytes / 1024 / 1024).toFixed(1)}MB`
                );
              }
            }

            resolve({
              valid: true,
              contentType,
              contentLength: contentLength ? parseInt(contentLength) : undefined,
            });
          } else {
            resolve({
              valid: false,
              error: `HTTP ${response.statusCode}: ${response.statusMessage}`,
            });
          }
        }
      );

      request.on('error', (error) => {
        resolve({
          valid: false,
          error: `Network error: ${error.message}`,
        });
      });

      request.on('timeout', () => {
        request.destroy();
        resolve({
          valid: false,
          error: `Request timeout after ${timeoutMs}ms`,
        });
      });

      request.end();
    } catch (error) {
      resolve({
        valid: false,
        error: `Invalid URL: ${error.message}`,
      });
    }
  });
}

/**
 * Quick validation that just checks if URL is accessible (faster)
 * @param {string} url - The asset URL to validate
 * @param {number} timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
export async function quickValidateAssetUrl(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const request = client.request(
        url,
        {
          method: 'HEAD',
          timeout: timeoutMs,
        },
        (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({ valid: true });
          } else {
            resolve({
              valid: false,
              error: `HTTP ${response.statusCode}`,
            });
          }
        }
      );

      request.on('error', (error) => {
        resolve({
          valid: false,
          error: error.message,
        });
      });

      request.on('timeout', () => {
        request.destroy();
        resolve({
          valid: false,
          error: 'Timeout',
        });
      });

      request.end();
    } catch (error) {
      resolve({
        valid: false,
        error: error.message,
      });
    }
  });
}
