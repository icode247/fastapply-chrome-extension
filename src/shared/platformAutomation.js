// src/shared/platformAutomation.js
import { StateManager } from "@shared/stateManager";
import { HOST } from "@shared/constants";

export class PlatformAutomation {
  constructor(platform, config) {
    this.platform = platform;
    this.config = config;
    this.isRunning = false;
    this.currentJobIndex = 0;
    this.startTime = new Date();
    this.stateManager = new StateManager();
    this.jobsToApply = [];
    this.userData = null;
    this.submittedLinks = [];
    this.statusBlock = null;
    
    this.setupMessageListener();
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;
    });
  }

  async handleMessage(message, sender, sendResponse) {
    console.log(`${this.platform} content script received message:`, message);

    try {
      switch (message.action) {
        case "startJobSearch":
          if (!message.userId) {
            sendResponse({
              status: "error",
              message: "Missing required user data"
            });
            return;
          }

          // Initialize and start automation
          await this.initialize(message.userId);
          this.appendStatusMessage(`Starting ${this.platform} automation`);
          await this.startAutomation();
          
          sendResponse({ status: "processing" });
          break;

        case "processJobs":
          this.appendStatusMessage("Processing job list");
          await this.processJobsList(message.jobsToApply);
          sendResponse({ status: "processing" });
          break;

        case "navigateToJob":
          await this.navigateToJobPage(message.url);
          sendResponse({ status: "navigated" });
          break;

        case "fillApplicationForm":
          this.appendStatusMessage("Filling application form");
          await this.fillApplicationForm(message.jobData);
          sendResponse({ status: "processing" });
          break;

        case "stop":
          this.appendStatusMessage("Stopping automation");
          this.stop();
          sendResponse({ status: "stopped" });
          break;
      }
    } catch (error) {
      console.error("Error in content script:", error);
      this.appendStatusErrorMessage(error.message);
      sendResponse({ status: "error", message: error.message });
    }
  }

  async initialize(userId) {
    try {
      const userDetails = await this.fetchUserDetailsFromBackend(userId);
      
      await this.stateManager.saveState({
        userId,
        userDetails,
        preferences: userDetails.jobPreferences || {},
        availableCredits: userDetails.credits || 0,
        applicationsUsed: userDetails.applicationsUsed || 0,
        userRole: userDetails.plan,
        isProcessing: false,
        currentJobIndex: 0,
        platform: this.platform,
        submittedLinks: []
      });

      this.userData = userDetails;
      this.isRunning = true;
      
      this.createStatusBlock();
      this.appendStatusMessage("Initialized");
    } catch (error) {
      console.error("Initialization error:", error);
      throw new Error("Failed to initialize automation");
    }
  }

  async fetchUserDetailsFromBackend(userId) {
    try {
      const response = await fetch(`${HOST}/api/user/${userId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.statusText}`);
      }
      const data = await response.json();
      if (!data) throw new Error("No user data received from backend");
      return data;
    } catch (error) {
      console.error("Error fetching user details:", error);
      throw error;
    }
  }

  // Create status display block in page
  createStatusBlock() {
    const STATUS_BLOCK_ELEMENT_ID = 'fastapply-status';
    
    if (document.getElementById(STATUS_BLOCK_ELEMENT_ID)) {
      return;
    }

    let blockEl = document.createElement('div');
    blockEl.id = STATUS_BLOCK_ELEMENT_ID;
    
    blockEl.style.top = 0;
    blockEl.style.right = 0;
    blockEl.style.color = 'white';
    blockEl.style.zIndex = '999999999999';
    blockEl.style.padding = '16px';
    blockEl.style.position = 'fixed';
    blockEl.style.overflow = 'auto';
    blockEl.style.maxWidth = '600px';
    blockEl.style.maxHeight = '500px';
    blockEl.style.background = '#4361ee';
    blockEl.style.display = 'flex';
    blockEl.style.flexDirection = 'column';
    blockEl.style.borderRadius = '8px';
    blockEl.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';

    let titleWrapperEl = document.createElement('div');
    titleWrapperEl.style.gap = '50px';
    titleWrapperEl.style.display = 'flex';
    titleWrapperEl.style.alignItems = 'center';
    titleWrapperEl.style.justifyContent = 'space-between';

    let labelEl = document.createElement('h3');
    labelEl.style.color = 'white';
    labelEl.style.fontWeight = 'bold';
    labelEl.innerText = `FastApply ${this.platform} automation: `;
    titleWrapperEl.append(labelEl);

    // Timer element
    let timerWrapperEl = document.createElement('p');
    timerWrapperEl.style.display = 'block';

    let timerLabelEl = document.createElement('span');
    timerLabelEl.style.color = 'white';
    timerLabelEl.style.fontWeight = 'bold';
    timerLabelEl.innerText = 'Time: ';
    timerWrapperEl.append(timerLabelEl);

    let timerValueEl = document.createElement('span');
    timerValueEl.style.color = 'white';
    timerValueEl.style.fontWeight = 'bold';
    timerValueEl.innerText = '00:00';
    timerValueEl.classList.add('fastapply-activity-timer-value');
    timerWrapperEl.append(timerValueEl);

    titleWrapperEl.append(timerWrapperEl);
    blockEl.append(titleWrapperEl);

    let listWrapperEl = document.createElement('div');
    listWrapperEl.classList.add('fastapply-activity-list-wrapper');
    listWrapperEl.style.overflow = 'auto';
    listWrapperEl.style.marginTop = '16px';
    listWrapperEl.style.paddingRight = '4px';
    blockEl.append(listWrapperEl);

    let listEl = document.createElement('div');
    listEl.classList.add('fastapply-activity-list');
    listEl.style.gap = '10px';
    listEl.style.display = 'grid';
    listEl.style.gridTemplateColumns = 'minmax(min-content, auto) minmax(max-content, 162px)';
    listWrapperEl.append(listEl);

    // Add styles
    let styleEl = document.createElement('style');
    styleEl.innerHTML = `
    #${STATUS_BLOCK_ELEMENT_ID} * {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    #${STATUS_BLOCK_ELEMENT_ID} .fastapply-activity-list-wrapper::-webkit-scrollbar {
        width: 4px;
        height: 4px;
    }
    
    #${STATUS_BLOCK_ELEMENT_ID} .fastapply-activity-list-wrapper::-webkit-scrollbar-track {
        -webkit-border-radius: 2px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.3);
    }
    
    #${STATUS_BLOCK_ELEMENT_ID} .fastapply-activity-list-wrapper::-webkit-scrollbar-thumb {
       -webkit-border-radius: 2px;
       border-radius: 2px;
       background: rgba(255, 255, 255, 0.7);
    }
    
    #${STATUS_BLOCK_ELEMENT_ID} .fastapply-activity-list .fastapply-activity-item {
        color: white;
        opacity: 0;
        transition: all 0.4s ease-out;
    }
    
    #${STATUS_BLOCK_ELEMENT_ID} .fastapply-activity-list .fastapply-activity-item.fastapply-activity-item-show {
      opacity: 1;
    }
    `;

    document.head.append(styleEl);
    document.body.append(blockEl);
    this.statusBlock = blockEl;

    // Start timer
    this.startTimer();
  }

  // Start countdown timer
  startTimer() {
    let timer = 0;
    let minutes;
    let seconds;
    
    setInterval(() => {
      timer++;
      minutes = parseInt(timer / 60, 10);
      seconds = parseInt(timer % 60, 10);

      minutes = minutes < 10 ? "0" + minutes : minutes;
      seconds = seconds < 10 ? "0" + seconds : seconds;

      const element = document.querySelector('.fastapply-activity-timer-value');
      if (element) {
        element.innerText = minutes + ":" + seconds;
      }
    }, 1000);
  }

  // Log status message to status block
  appendStatusMessage(statusMessage) {
    if (!this.statusBlock) {
      this.createStatusBlock();
    }

    let messageItemEl = document.createElement('p');
    messageItemEl.classList.add('fastapply-activity-item');
    messageItemEl.innerText = statusMessage;

    document.querySelector('.fastapply-activity-list').append(messageItemEl);

    let timestampItemEl = document.createElement('p');
    timestampItemEl.classList.add('fastapply-activity-item');
    timestampItemEl.innerText = new Date().toLocaleTimeString();

    document.querySelector('.fastapply-activity-list').append(timestampItemEl);

    setTimeout(() => {
      messageItemEl.classList.add('fastapply-activity-item-show');
      messageItemEl.scrollIntoView();
      timestampItemEl.classList.add('fastapply-activity-item-show');
      timestampItemEl.scrollIntoView();
    }, 10);
  }

  // Log error message to status block
  appendStatusErrorMessage(errorMessage) {
    this.appendStatusMessage(`ERROR: ${errorMessage}`);
  }

  // Wait for element to appear in DOM
  async waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
      if (document.querySelector(selector)) {
        return resolve(document.querySelector(selector));
      }

      const observer = new MutationObserver((mutations) => {
        if (document.querySelector(selector)) {
          resolve(document.querySelector(selector));
          observer.disconnect();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  // Simulate human-like input
  async simulateHumanInput(element, value) {
    element.focus();
    element.click();
    
    // Type character by character with random delays
    for (let i = 0; i < value.length; i++) {
      element.value += value[i];
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await this.sleep(Math.random() * 50 + 10);
    }
    
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await this.sleep(100);
    element.blur();
  }

  // Sleep function for delays
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Start automation process
  async startAutomation() {
    this.isRunning = true;
    this.appendStatusMessage("Automation started");
    
    try {
      // Platform-specific implementation will be provided by subclasses
      throw new Error("startAutomation() must be implemented by platform automation handler");
    } catch (error) {
      this.appendStatusErrorMessage(error.message);
      throw error;
    }
  }

  // Process a list of jobs
  async processJobsList(jobs) {
    this.appendStatusMessage(`Processing ${jobs.length} jobs`);
    
    // Platform-specific implementation will be provided by subclasses
    throw new Error("processJobsList() must be implemented by platform automation handler");
  }

  // Navigate to a job page
  async navigateToJobPage(url) {
    this.appendStatusMessage(`Navigating to ${url}`);
    window.location.href = url;
  }

  // Fill application form
  async fillApplicationForm(jobData) {
    this.appendStatusMessage(`Filling application form for ${jobData.title}`);
    
    // Platform-specific implementation will be provided by subclasses
    throw new Error("fillApplicationForm() must be implemented by platform automation handler");
  }

  // Stop automation
  stop() {
    this.isRunning = false;
    this.appendStatusMessage("Automation stopped");
  }

  // Upload a file from URL
  async uploadFile(url, fileName, input) {
    this.appendStatusMessage(`Uploading ${fileName}`);
    
    if (!url || !fileName || !input) {
      throw new Error('URL or fileName or input not found');
    }

    try {
      const blob = await fetch(url, {method: 'GET'}).then(res => res.blob());

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([blob], fileName, {type: blob.type, lastModified: new Date()}));

      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('change', {bubbles: true}));
      
      return true;
    } catch (error) {
      this.appendStatusErrorMessage(`Upload failed: ${error.message}`);
      return false;
    }
  }

  // Log application to backend
  async logApplication(jobData, status = "completed", error = null) {
    try {
      const state = await this.stateManager.getState();
      const applicationData = {
        userId: state.userId,
        platform: this.platform,
        jobId: jobData.id || Math.random().toString(36).substring(2, 15),
        title: jobData.title,
        company: jobData.company,
        location: jobData.location,
        jobUrl: jobData.url || window.location.href,
        status: status,
        error: error?.message || null
      };

      const response = await fetch(`${HOST}/api/applied-jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(applicationData),
      });

      if (!response.ok) {
        throw new Error(`Failed to log application: ${response.statusText}`);
      }

      this.appendStatusMessage(`Application logged: ${status}`);
      
      // Update the submitted links
      const currentState = await this.stateManager.getState();
      await this.stateManager.updateState({
        submittedLinks: [...(currentState.submittedLinks || []), jobData.url]
      });
      
      // Send message to background script about application status
      chrome.runtime.sendMessage({
        action: "applicationComplete",
        status: status,
        jobData: applicationData
      });
      
      return true;
    } catch (error) {
      console.error("Error logging application:", error);
      this.appendStatusErrorMessage(`Failed to log application: ${error.message}`);
      return false;
    }
  }

  // Send status update to background script
  sendStatusUpdate(status, message) {
    chrome.runtime.sendMessage({
      action: "statusUpdate",
      status,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}