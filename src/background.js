
// src/background.js
import { IndeedJobApplyManager } from "./platforms/indeed/background";
import { LinkedInJobApplyManager } from "./platforms/linkedin/background";
import { GlassdoorsApplyManager } from "./platforms/glassdoor/background";
import { LeverJobApplyManager } from "./platforms/lever/background";
import { WorkableJobApplyManager } from "./platforms/workable/background";
// import { MonsterJobApplyManager } from "./platforms/monster/background";
// import { RecruiteeJobApplyManager } from "./platforms/recruitee/background";

const PLATFORMS = {
  LINKEDIN: "linkedin",
  INDEED: "indeed",
  EXTERNAL: "external",
  GLASSDOOR: "glassdoor",
  LEVER: "lever",
  WORKABLE: "workable",
  // MONSTER: "monster",
  RECRUITEE: "recruitee"
};

const WEB_APP_URL = "https://fastapply.co";

const PlatformRouter = {
  handlers: {
    [PLATFORMS.LINKEDIN]: LinkedInJobApplyManager,
    [PLATFORMS.INDEED]: IndeedJobApplyManager,
    [PLATFORMS.GLASSDOOR]: GlassdoorsApplyManager,
    [PLATFORMS.LEVER]: LeverJobApplyManager,
    [PLATFORMS.WORKABLE]: WorkableJobApplyManager,
    // [PLATFORMS.MONSTER]: MonsterJobApplyManager,
    // [PLATFORMS.RECRUITEE]: RecruiteeJobApplyManager
  },

  activeHandler: null,
  activePlatform: null,

  async init() {
    try {
      // Setup extension listeners
      chrome.action.onClicked.addListener(() => {
        chrome.tabs.create({ url: WEB_APP_URL });
      });

      chrome.runtime.onMessageExternal.addListener(
        this.handleExternalMessage.bind(this)
      );

      chrome.runtime.onMessage.addListener(
        this.handleInternalMessage.bind(this)
      );
    } catch (error) {
      console.error("Failed to initialize PlatformRouter:", error);
    }
  },

  async activatePlatformHandler(platform) {
    // If this platform is already active, return its handler
    if (platform === this.activePlatform && this.activeHandler) {
      return this.activeHandler;
    }

    // Clean up previous handler if it exists
    if (this.activeHandler && typeof this.activeHandler.cleanup === 'function') {
      await this.activeHandler.cleanup();
    }

    const handler = this.handlers[platform];
    if (!handler) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    // Initialize the new handler
    if (typeof handler.init === 'function' && !handler.isInitialized) {
      await handler.init();
      handler.isInitialized = true;
    }

    // Update active handler state
    this.activeHandler = handler;
    this.activePlatform = platform;

    console.log(`Activated ${platform} handler`);
    return handler;
  },

  async handleExternalMessage(request, sender, sendResponse) {
    const { platform } = request;
    console.log("External message received for platform:", platform);

    try {
      const handler = await this.activatePlatformHandler(platform);

      await handler.handleMessage(request, sender, sendResponse);
    } catch (error) {
      console.error(`Error in ${platform} handler:`, error);
      const errorMessage = error.message === "Failed to initialize automation"
        ? "Unable to start automation. Please refresh the page and try again."
        : error.message;

      sendResponse({
        status: "error",
        message: errorMessage,
        code: error.code || "AUTOMATION_ERROR",
      });
    }
    return true;
  },

  async handleInternalMessage(message, sender, sendResponse) {
    const url = sender.tab?.url || "";
    const platform = this.detectPlatform(url);

    if (platform) {
      try {
        const handler = await this.activatePlatformHandler(platform);
        return handler.handleMessage(message, sender, sendResponse);
      } catch (error) {
        console.error(`Error handling internal message for ${platform}:`, error);
        return false;
      }
    }
    return false;
  },

  detectPlatform(url) {
    const platformDomains = {
      "linkedin.com": PLATFORMS.LINKEDIN,
      "indeed.com": PLATFORMS.INDEED,
      "glassdoor.com": PLATFORMS.GLASSDOOR,
      "lever.co": PLATFORMS.LEVER,
      "workable.com": PLATFORMS.WORKABLE,
      "monster.com": PLATFORMS.MONSTER,
      "recruitee.com": PLATFORMS.RECRUITEE
    };
    return Object.entries(platformDomains).find(([domain]) =>
      url.includes(domain)
    )?.[1] || null;
  }
};

// Initialize router
PlatformRouter.init();
