/**
 * Formats user data from database into standardized profile and session objects
 * @param {Object} userData - Raw user data from database
 * @param {string} userId - User ID
 * @param {string} sessionToken - Authentication token
 * @param {number} jobsToApply - Number of jobs to apply to
 * @param {string} platform - Platform name (e.g., "lever", "greenhouse")
 * @param {string} baseUrl - API base URL
 * @param {boolean} devMode - Whether to enable development mode
 * @returns {Object} Formatted user data for job application
 */
function formatUserDataForJobApplication(
  userData,
  userId,
  sessionToken,
  jobsToApply = 10,
  platform = "lever",
  baseUrl = "https://api.fastapply.co",
  devMode = false
) {
  // Handle case where userData might be null or undefined
  if (!userData) {
    console.error("User data is null or undefined");
    return {
      profile: {},
      session: { userId, platform },
      avatarUrl: "",
      submittedLinks: [],
      devMode,
    };
  }

  // Format profile information
  const profile = {
    firstName: userData.firstName || "",
    lastName: userData.lastName || "",
    email: userData.email || "",
    phoneNumber: userData.phoneNumber || "",
    phoneCountryCode: userData.phoneCountryCode || "",
    country: userData.country || "",
    jobPreferences: userData.jobPreferences || {},
    cv: {
      url: userData.resumeUrl || "",
    },
    currentCompany:
      userData.fullPositions?.[0]?.company || userData.recentEmployer || "",
    yearsOfExperience: userData.yearsOfExperience || "",
    fullPosition:
      userData.fullPosition || userData.fullPositions?.[0]?.role || "",
    linkedIn: userData.linkedIn || userData.linkedinProfileUrl || "",
    website: userData.website || "",
    github: userData.githubURL || "",
    coverLetter: userData.coverLetter || "",
    currentCity: userData.currentCity || "",
    streetAddress: userData.streetAddress || "",
    desiredSalary: userData.desiredSalary || "",
    noticePeriod: userData.noticePeriod || "",
    education: formatEducation(userData),
    headline: userData.headline || "",
    summary: userData.summary || "",
  };

  // Format session information
  const session = {
    userId,
    country: getLocationData(userData),
    workplace: userData?.jobPreferences?.remoteOnly,
    role: getJobRole(userData),
    platform,
    jobType: getJobType(userData?.jobPreferences?.jobType),
    jobAge: userData?.jobPreferences?.datePosted?.value,
    minSalary: userData?.jobPreferences?.salary[0],
    maxSalary: userData?.jobPreferences?.salary[1],
    minRating: userData?.jobPreferences?.companyRating,
    apiKey: sessionToken || "",
    liftsLimit: jobsToApply,
    liftsCurrent: userData.applicationsUsed || 0,
  };

  return {
    profile,
    session,
    avatarUrl: userData.image || "",
    serverBaseUrl: baseUrl,
    submittedLinks: [], // Empty array by default, could be populated from backend if needed
    devMode,
  };
}

/**
 * Helper function to extract education information
 * @param {Object} userData - User data from database
 * @returns {Object} Formatted education data
 */
function formatEducation(userData) {
  if (!userData.education) return null;

  return {
    school: userData.education.school || "",
    degree: userData.education.degree || "",
    major: userData.education.major || "",
    startDate:
      userData.education.educationStartMonth &&
      userData.education.educationStartYear
        ? `${userData.education.educationStartMonth} ${userData.education.educationStartYear}`
        : "",
    endDate:
      userData.education.educationEndMonth &&
      userData.education.educationEndYear
        ? `${userData.education.educationEndMonth} ${userData.education.educationEndYear}`
        : "",
  };
}

/**
 * Processes job type value to standardized format
 *
 * @param {string|string[]|undefined} jobType - The job type value (can be string, array, or undefined)
 * @returns {string|undefined} - Standardized job type (dashes replaced with underscores) or undefined if input is falsy
 */
const getJobType = (jobType) => {
  // Handle null or undefined cases
  if (!jobType) {
    return undefined;
  }

  // Get the value (first item if array, direct value otherwise)
  const value = Array.isArray(jobType) ? jobType[0] : jobType;

  // Handle empty string or empty first array item
  if (!value) {
    return undefined;
  }

  // Replace dashes with underscores (e.g., "full-time" to "full_time")
  return value.replace(/-/g, "_");
};

/**
 * Helper function to get user's preferred location
 * @param {Object} userData - User data from database
 * @returns {string} Location preference
 */
function getLocationData(userData) {
  // First try job preferences location array
  if (
    userData.jobPreferences?.location &&
    Array.isArray(userData.jobPreferences.location) &&
    userData.jobPreferences.location.length > 0
  ) {
    return userData.jobPreferences.location[0];
  }

  // Then try job preferences location as string
  if (
    userData.jobPreferences?.location &&
    typeof userData.jobPreferences.location === "string"
  ) {
    return userData.jobPreferences.location;
  }

  // Then try current city's country component
  if (userData.currentCity && userData.currentCity.includes(",")) {
    const cityParts = userData.currentCity.split(",");
    if (cityParts.length > 1) {
      return cityParts[cityParts.length - 1].trim();
    }
  }

  // Then try country field
  if (userData.country) {
    return userData.country;
  }

  return "";
}

/**
 * Helper function to get user's preferred workplace type
 * @param {Object} userData - User data from database
 * @returns {string} Workplace preference
 */
function getWorkplacePreference(userData) {
  if (
    userData.jobPreferences?.workMode &&
    Array.isArray(userData.jobPreferences.workMode) &&
    userData.jobPreferences.workMode.length > 0
  ) {
    return userData.jobPreferences.workMode[0];
  }

  return "ANY"; // Default to ANY if no preference specified
}

/**
 * Helper function to get user's preferred job role
 * @param {Object} userData - User data from database
 * @returns {string} Job role
 */
function getJobRole(userData) {
  if (
    userData.jobPreferences?.positions &&
    Array.isArray(userData.jobPreferences.positions) &&
    userData.jobPreferences.positions.length > 0
  ) {
    return userData.jobPreferences.positions[0];
  }

  return "Software Engineer"; // Default role
}

/**
 * Transforms application records from database format to submittedLinks format
 * required by the automation system
 *
 * @param {Array} applications - Array of application records from database
 * @param {string} platform - Platform filter (e.g., "lever", "linkedin", "greenhouse")
 * @returns {Array} Array of application records in submittedLinks format
 */
function formatApplicationsToSubmittedLinks(applications, platform = null) {
  if (!applications || !Array.isArray(applications)) {
    return [];
  }

  return applications
    .filter(
      (app) =>
        !platform ||
        app.trackingData?.applicationPlatform?.toLowerCase() ===
          platform.toLowerCase()
    )
    .map((app) => {
      // Map status from database to automation status
      let status = "SUCCESS"; // Default to SUCCESS for applied jobs
      if (app.status === "pending" || app.status === "processing") {
        status = "PROCESSING";
      } else if (app.status === "error" || app.status === "failed") {
        status = "ERROR";
      } else if (app.status === "skipped") {
        status = "SKIPPED";
      }

      // Convert timestamp if present
      let timestamp = Date.now();
      if (app.appliedAt) {
        if (typeof app.appliedAt === "object" && app.appliedAt.seconds) {
          // Firestore timestamp format
          timestamp = app.appliedAt.seconds * 1000;
        } else if (typeof app.appliedAt === "string") {
          // String timestamp format
          timestamp = new Date(app.appliedAt).getTime();
        } else if (typeof app.appliedAt === "number") {
          // Unix timestamp in milliseconds
          timestamp = app.appliedAt;
        }
      }

      // Create the submittedLink object
      return {
        url: app.jobUrl || "",
        status: status,
        timestamp: timestamp,
        //   details: {
        //     title: app.title || "",
        //     company: app.company || "",
        //     jobId: app.jobId || "",
        //     location: app.location || "",
        //     salary: app.salary || app.workplace || "",
        //     platform: app.trackingData?.applicationPlatform || "",
        //     method: app.trackingData?.applicationMethod || ""
        //   }
      };
    });
}

export { formatUserDataForJobApplication, formatApplicationsToSubmittedLinks };
