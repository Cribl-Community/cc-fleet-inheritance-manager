/**
 * Cribl Platform Global Type Declarations
 * These globals are set by the Cribl platform and available in all app contexts
 */

declare global {
  interface Window {
    /**
     * Base URL for Cribl API calls
     * @example "https://localhost:9000/api/v1"
     */
    CRIBL_API_URL?: string;

    /**
     * The base path this app is mounted at within Cribl
     * @example "/app-ui/my-app"
     */
    CRIBL_BASE_PATH?: string;

    /**
     * Gets the currently signed-in Cribl user's information
     * Returns a Promise that resolves to user profile data
     */
    getCriblUser?(): Promise<CriblUser>;
  }

  interface CriblUser {
    id: string;
    username: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    initials?: string;
  }
}

export {};
