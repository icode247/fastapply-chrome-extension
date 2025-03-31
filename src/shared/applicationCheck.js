// @shared/applicationCheck.js
import { HOST } from "@shared/constants";

/**
 * Check if a job has already been applied for
 * @param {string} userId - The user ID
 * @param {string} jobId - The job URL
 * @returns {Promise<boolean>} - Returns true if the job has already been applied for, false otherwise
 */
export async function checkIfJobApplied(userId, jobUrl) {
  if (!userId || !jobUrl) {
    console.error("Missing required parameters for checkIfJobApplied");
    return false;
  }

  try {
    // Construct the API URL based on the provided endpoint format
    const apiUrl = `${HOST}/api/applied-jobs?userId=${encodeURIComponent(
      userId
    )}&jobId=${encodeURIComponent(getJobIDFromURL(jobUrl))}`;

    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`API call failed with status: ${response.status}`);
    }

    const data = await response.json();
    return data.applied === true;
  } catch (error) {
    console.error("Error checking if job was applied:", error);
    // On error, we'll assume the job hasn't been applied for to avoid blocking the user
    return false;
  }
}

/**
 * Get current job id from URL
 */

export function getJobIDFromURL(link) {
  const parts = link.split("/");
  const jobId = parts[parts.length - 1];
  return jobId;
}
