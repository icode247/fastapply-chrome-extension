// @shared/leverAuthorization.js
import { HOST } from "@shared/constants";

// Plan limits for different user roles
export const PLAN_LIMITS = {
  FREE: 5,
  STARTER: 50,
  PRO: 200,
  UNLIMITED: Infinity,
};

/**
 * Check user role and update Lever's store with user data
 * @param {string} userId - The user ID
 * @param {Object} store - The Lever store object reference
 * @returns {Promise<Object>} - The updated user data
 */
export async function checkLeverUserLimits(userId, store) {
  if (!userId) {
    throw new Error("Missing userId in checkLeverUserLimits");
  }

  try {
    const response = await fetch(`${HOST}/api/user/${userId}/role`);

    if (!response.ok) {
      throw new Error(`Failed to fetch user role: ${response.status}`);
    }

    const userData = await response.json();

    // Calculate application limit based on plan
    let applicationLimit;
    switch (userData.userRole) {
      case "starter":
        applicationLimit = PLAN_LIMITS.STARTER;
        break;
      case "pro":
        applicationLimit = PLAN_LIMITS.PRO;
        break;
      case "unlimited":
        applicationLimit = PLAN_LIMITS.UNLIMITED;
        break;
      case "credit":
        applicationLimit = Math.floor(userData.credits / 1);
        break;
      default:
        applicationLimit = PLAN_LIMITS.FREE;
    }

    // Update store with user information
    if (store && typeof store === "object") {
      if (!store.user) store.user = {};

      store.user = {
        ...store.user,
        userRole: userData.userRole,
        applicationLimit,
        applicationsUsed: userData.applicationsUsed || 0,
        credits: userData.credits || 0,
        subscription: userData.subscription,
        remainingApplications: getRemaining(userData),
      };
    }

    return userData;
  } catch (error) {
    console.error("Error checking user limits:", error);
    throw error;
  }
}

/**
 * Check if user can apply for more jobs
 * @param {Object} userData - The user data object
 * @returns {boolean} - Whether the user can apply for more jobs
 */
export function canUserApplyMore(userData) {
  if (!userData || !userData.userRole) return false;

  // Check subscription validity
  if (userData.subscription) {
    const subscriptionEnd = new Date(userData.subscription.currentPeriodEnd);
    if (subscriptionEnd < new Date()) {
      return false;
    }
  }

  // Check different user roles and their limits
  switch (userData.userRole) {
    case "unlimited":
      return true;

    case "starter":
      return (userData.applicationsUsed || 0) < PLAN_LIMITS.STARTER;

    case "pro":
      return (userData.applicationsUsed || 0) < PLAN_LIMITS.PRO;

    case "credit":
      return (userData.credits || 0) >= 1;

    case "free":
      return (userData.applicationsUsed || 0) < PLAN_LIMITS.FREE;

    default:
      return false;
  }
}

/**
 * Get remaining application count
 * @param {Object} userData - The user data object
 * @returns {number} - The number of remaining applications
 */
function getRemaining(userData) {
  if (!userData || !userData.userRole) return 0;

  switch (userData.userRole) {
    case "unlimited":
      return Infinity;

    case "starter":
      return PLAN_LIMITS.STARTER - (userData.applicationsUsed || 0);

    case "pro":
      return PLAN_LIMITS.PRO - (userData.applicationsUsed || 0);

    case "credit":
      return Math.floor(userData.credits || 0);

    case "free":
      return PLAN_LIMITS.FREE - (userData.applicationsUsed || 0);

    default:
      return 0;
  }
}
