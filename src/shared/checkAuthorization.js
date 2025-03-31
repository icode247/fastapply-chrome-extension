import { HOST, PLAN_LIMITS } from "./constants";
import { StateManager } from "./stateManager";

const stateManager = new StateManager();

export async function checkUserRole(userId) {
  try {
    const response = await fetch(`${HOST}/api/user/${userId}/role`);
    if (!response.ok) {
      throw new Error("Failed to fetch user role");
    }
    const data = await response.json();
    // Calculate application limit based on plan
    let applicationLimit;
    switch (data.userRole) {
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
        applicationLimit = Math.floor(data.credits / 1);
        break;
      default:
        applicationLimit = PLAN_LIMITS.FREE;
    }

    await stateManager.updateState({
      userRole: data.userRole,
      applicationLimit,
      credits: data.credits || 0,
      subscription: data.subscription,
      applicationsUsed: data.applicationsUsed,
    });
  } catch (error) {
    throw error;
  }
}

export function canApplyMore(state) {
  if (!state || !state.userRole) return false;

  if (state.subscription) {
    const subscriptionEnd = new Date(state.subscription.currentPeriodEnd);
    if (subscriptionEnd < new Date()) {
      return false;
    }
  }

  switch (state.userRole) {
    case "unlimited":
      return true;

    case "starter":
      return state.applicationsUsed < PLAN_LIMITS.STARTER;

    case "pro":
      return state.applicationsUsed < PLAN_LIMITS.PRO;

    case "credit":
      return state.credits >= 1;
    case "free":
      return state.applicationsUsed < PLAN_LIMITS.FREE;

    default:
      return false;
  }
}

export function getRemainingApplications(state) {
  if (!state || !state.userRole) return 0;

  switch (state.userRole) {
    case "unlimited":
      return Infinity;

    case "starter":
      return PLAN_LIMITS.STARTER - (state.applicationsUsed || 0);

    case "pro":
      return PLAN_LIMITS.PRO - (state.applicationsUsed || 0);

    case "credit":
      return Math.floor(state.credits / 1);

    case "free":
      return PLAN_LIMITS.FREE - (state.applicationsUsed || 0);

    default:
      return 0;
  }
}
