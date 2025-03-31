import ExternalJobAutomation from "./automationHandler";

class ExternalJobApply {
  constructor() {
    this.automation = null;
    this.initialized = false;
    console.log("ExternalJobApply constructor");
  }
  static isExternalJobSite() {
    const hostname = window.location.hostname;
    // Don't run on LinkedIn or Indeed
    return (
      !hostname.includes("linkedin.com") && !hostname.includes("indeed.com")
    );
  }
  async handleMessageInSequence(message, sender, sendResponse) {
    if (!ExternalJobApply.isExternalJobSite()) {
      return;
    }

    try {
      console.log("Received message:", message.type);

      // Ensure initialization happens first
      if (message.type !== "INIT_AUTOMATION" && !this.initialized) {
        throw new Error("Automation must be initialized first");
      }

      switch (message.type) {
        case "INIT_AUTOMATION":
          await this.handleInitialization(message.data, sendResponse);
          break;

        case "PROCESS_APPLICATION":
          await this.handleApplicationProcess(message.data, sendResponse);
          break;

        default:
          throw new Error("Unknown message type");
      }
    } catch (error) {
      console.error(`Error handling message ${message.type}:`, error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async handleInitialization(data, sendResponse) {
    try {
      console.log("Initializing automation with data:", data);

      // Create automation instance
      this.automation = new ExternalJobAutomation(data);
      await this.automation.init();

      // Mark as initialized
      this.initialized = true;

      console.log("Automation initialized successfully");
      sendResponse({ success: true });
    } catch (error) {
      this.initialized = false;
      this.automation = null;
      throw error;
    }
  }

  async handleApplicationProcess(data, sendResponse) {
    try {
      console.log("Processing application:", data);

      // 1. Find apply button
      const applyButton = await this.automation.findApplyButton();
      if (!applyButton) {
        throw new Error("Apply button not found");
      }

      // 2. Click apply button
      await this.automation.safeClick(applyButton);

      // 3. Handle application form
      const result = await this.automation.handleApplication(data);

      // 4. Report success
      sendResponse({ success: true, data: result });

      // 5. Notify background of completion
      chrome.runtime.sendMessage({
        type: "APPLICATION_STATUS",
        data: { status: "completed", jobId: data.jobDetails.jobId },
      });
    } catch (error) {
      // Notify background of failure
      chrome.runtime.sendMessage({
        type: "APPLICATION_STATUS",
        data: {
          status: "failed",
          error: error.message,
          jobId: data.jobDetails?.jobId,
        },
      });
      throw error;
    }
  }
}

export default ExternalJobApply;
