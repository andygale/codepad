// Maximum code size in bytes (should match server-side configuration)
const MAX_CODE_SIZE_BYTES = 10240; // 10KB

/**
 * Validates that code is within the allowed size limit
 * @param code - The code to validate
 * @returns Validation result with isValid flag and optional error message
 */
export function validateCodeSize(code: string): {
  isValid: boolean;
  error?: string;
  sizeBytes: number;
  maxSizeBytes: number;
} {
  if (typeof code !== 'string') {
    return {
      isValid: false,
      error: 'Code must be a string',
      sizeBytes: 0,
      maxSizeBytes: MAX_CODE_SIZE_BYTES
    };
  }

  // Calculate size in bytes (UTF-8 encoding)
  const sizeBytes = new TextEncoder().encode(code).length;

  if (sizeBytes > MAX_CODE_SIZE_BYTES) {
    return {
      isValid: false,
      error: `Code size (${sizeBytes} bytes) exceeds maximum allowed size of ${MAX_CODE_SIZE_BYTES} bytes (${Math.round(MAX_CODE_SIZE_BYTES / 1024)}KB)`,
      sizeBytes,
      maxSizeBytes: MAX_CODE_SIZE_BYTES
    };
  }

  return {
    isValid: true,
    sizeBytes,
    maxSizeBytes: MAX_CODE_SIZE_BYTES
  };
}

/**
 * Formats bytes to a human-readable string
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.5KB", "250B")
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  return `${(bytes / 1024).toFixed(1)}KB`;
} 