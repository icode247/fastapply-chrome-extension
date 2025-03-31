import { GLASSDOOR_URLS, INDEED_URLS } from "./constants";
//LinkedIn Profile {answer this question}`:

export function getJobURL(country) {
  return INDEED_URLS[country];
}

export function getGlassdoorURL(country) {
  return GLASSDOOR_URLS[country];
}

function addBusinessDays(date, days) {
  let d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      added++;
    }
  }
  return d;
}

export function generateBusinessDates(startDate, numberOfDates) {
  const dates = [];
  const time = "10:00 AM";
  let currentDate = new Date(startDate);

  for (let i = 0; i < numberOfDates; i++) {
    const daysAhead = Math.floor(Math.random() * (3 - 2 + 1) + 2);
    const businessDay = addBusinessDays(currentDate, daysAhead);

    const formattedDate =
      businessDay.toLocaleDateString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      }) +
      " at " +
      time;

    dates.push(formattedDate);
    currentDate = new Date(businessDay);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates.join(",\n");
}

export class CreditWarningManager {
  constructor(stateManager) {
    this.warningBannerId = "fastapply-credit-warning";
    this.stateManager = stateManager;
  }

  createWarningElement() {
    const warningDiv = document.createElement("div");
    warningDiv.id = this.warningBannerId;
    warningDiv.className = "fixed z-50 flex items-stretch";
    warningDiv.innerHTML = `
      <div class="flex items-stretch w-full">
        <div class="flex-shrink-0 bg-red-50 flex items-center logo-section">
        <a href="https://fastapply.co/pricing">
          <img src="https://lh3.googleusercontent.com/CoiY2ePs1brwVi1coTvuJvqXHTUlUs6HacDtoPI5A7pC-Rqvz9V0IFYJ7ab7bzmBpDvmvSdCJe3t1HmSa15UUoAgkQ=s120" 
               alt="FastApply Logo" 
               class="w-12 h-12"></a>
        </div>
        <div class="content-section">
            <div class="flex items-center border-l border-red-200 pl-3 bg-red-50">
              <span class="text-red-700 font-medium">No active FastApply credit or subscription.</span>
            </div>
          <button class="close-button" aria-label="Collapse">×</button>
        </div>
      </div>
    `;
    return warningDiv;
  }

  injectStyles() {
    if (!document.getElementById(`${this.warningBannerId}-style`)) {
      const style = document.createElement("style");
      style.id = `${this.warningBannerId}-style`;
      style.textContent = `
        html body #${this.warningBannerId} {
          font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto !important;
          background: rgb(254, 242, 242) !important;
          border: 1px solid rgb(254, 226, 226) !important;
          border-right: none !important;
          border-radius: 6px 0 0 6px !important;
          box-shadow: -2px 2px 5px rgba(0,0,0,0.1) !important;
          overflow: hidden !important;
          position: fixed !important;
          top: 350px !important;
          right: 0 !important;
          z-index: 9999 !important;
          width: fit-content !important;
          margin-right: 10px !important;
          transition: all 0.3s ease !important;
        }

        #${this.warningBannerId} .flex {
          display: flex !important;
        }

        #${this.warningBannerId} .items-stretch {
          align-items: stretch !important;
        }

        #${this.warningBannerId} .items-center {
          align-items: center !important;
        }

        #${this.warningBannerId} .logo-section {
          cursor: pointer !important;
        }

        #${this.warningBannerId} img {
          width: 48px !important;
          height: 48px !important;
          display: block !important;
        }

        #${this.warningBannerId} .content-section {
          display: flex !important;
          align-items: center !important;
          transition: all 0.3s ease !important;
          overflow: hidden !important;
          width: auto !important;
          opacity: 1 !important;
          visibility: visible !important;
        }

        #${this.warningBannerId} .content-section.collapsed {
          width: 0 !important;
          opacity: 0 !important;
          visibility: hidden !important;
          padding: 0 !important;
        }

        #${this.warningBannerId} span {
          color: rgb(185, 28, 28) !important;
          font-weight: 500 !important;
          font-size: 14px !important;
          line-height: 1.5 !important;
          padding-right: 12px !important;
          white-space: nowrap !important;
        }

        #${this.warningBannerId} .border-l {
          border-left: 1px solid rgb(254, 202, 202) !important;
        }

        #${this.warningBannerId} .pl-3 {
          padding-left: 12px !important;
        }

        #${this.warningBannerId} .close-button {
          width: 24px !important;
          height: 24px !important;
          border-radius: 50% !important;
          border: 1px solid rgb(254, 202, 202) !important;
          color: #666 !important;
          font-size: 18px !important;
          font-weight: normal !important;
          cursor: pointer !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          flex-shrink: 0 !important;
          padding: 0 !important;
          line-height: 1 !important;
          margin: 0 8px !important;
        }
      `;
      document.head.appendChild(style);
    }
  }

  toggleCollapse() {
    const contentSection = document.querySelector(
      `#${this.warningBannerId} .content-section`
    );
    contentSection.classList.toggle("collapsed");
  }

  showWarning() {
    if (!document.getElementById(this.warningBannerId)) {
      const warningElement = this.createWarningElement();
      document.body.prepend(warningElement);
      this.injectStyles();

      // Add event listeners
      const closeButton = warningElement.querySelector(".close-button");
      const logoSection = warningElement.querySelector(".logo-section");

      closeButton.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleCollapse();
      });

      logoSection.addEventListener("click", () => {
        const contentSection = warningElement.querySelector(".content-section");
        if (contentSection.classList.contains("collapsed")) {
          this.toggleCollapse();
        }
      });

      document.body.classList.add("show-credit-warning");

      // Force a repaint to ensure styles are applied
      document.body.style.transform = "translateZ(0)";
      requestAnimationFrame(() => {
        document.body.style.transform = "";
      });
    }
  }

  hideWarning() {
    const warning = document.getElementById(this.warningBannerId);
    if (warning) {
      warning.remove();
      document.body.classList.remove("show-credit-warning");
    }
  }

  async checkStatusAndUpdateWarning() {
    try {
      const state = await this.stateManager.getState();
      const hasCredits = state?.credits > 0;
      const hasSubscription =
        state?.userRole === "pro" ||
        state?.userRole === "starter" ||
        state?.userRole === "unlimited";
      if (!hasCredits && !hasSubscription) {
        this.showWarning();
      } else {
        this.hideWarning();
      }
    } catch (error) {
      console.error("Error checking credit status:", error);
    }
  }
}

export class StatusNotificationManager {
  constructor() {
    this.notificationId = "fastapply-status-notification";
    this.notifications = [];
    this.maxNotifications = 3;
  }

  createNotificationElement(message, type = "info") {
    console.log("Creating notification element:", { message, type });
    const notificationDiv = document.createElement("div");
    notificationDiv.id = `${this.notificationId}-${Date.now()}`;
    notificationDiv.className =
      "fixed z-50 flex items-stretch notification-item";

    // Define colors for each type
    const typeStyles = {
      success: {
        background: "#f0fdf4", // Light green background
        border: "#bbf7d0", // Green border
        text: "#15803d", // Dark green text
      },
      error: {
        background: "#fef2f2", // Light red background
        border: "#fecaca", // Red border
        text: "#b91c1c", // Dark red text
      },
      warning: {
        background: "#fefce8", // Light yellow background
        border: "#fef08a", // Yellow border
        text: "#854d0e", // Dark yellow text
      },
      info: {
        background: "#eff6ff", // Light blue background
        border: "#bfdbfe", // Blue border
        text: "#1d4ed8", // Dark blue text
      },
    };

    const style = typeStyles[type];

    notificationDiv.style.cssText = `
      position: fixed !important;
      top: 450px !important;
      right: 0 !important;
      z-index: 99999 !important;
      width: fit-content !important;
      margin-right: 10px !important;
      border-radius: 6px 0 0 6px !important;
      box-shadow: -2px 2px 5px rgba(0,0,0,0.1) !important;
      font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto !important;
      transition: all 0.3s ease !important;
      border: 1px solid ${style.border} !important;
      border-right: none !important;
      overflow: hidden !important;
      background-color: ${style.background} !important;
    `;

    notificationDiv.innerHTML = `
      <div class="flex items-stretch w-full" style="display: flex !important;">
        <div class="flex-shrink-0 flex items-center logo-section" 
             style="display: flex !important; align-items: center !important; background-color: ${style.background} !important;">
          <a href="https://fastapply.co">
            <img src="https://lh3.googleusercontent.com/CoiY2ePs1brwVi1coTvuJvqXHTUlUs6HacDtoPI5A7pC-Rqvz9V0IFYJ7ab7bzmBpDvmvSdCJe3t1HmSa15UUoAgkQ=s120" 
                 alt="FastApply Logo" 
                 style="width: 48px !important; height: 48px !important; display: block !important;">
          </a>
        </div>
        <div class="content-section" style="display: flex !important; align-items: center !important;">
          <div class="flex items-center border-l pl-3" 
               style="display: flex !important; align-items: center !important; padding-left: 12px !important; border-left: 1px solid ${style.border} !important; background-color: ${style.background} !important;">
            <span style="color: ${style.text} !important; font-size: 14px !important; padding-right: 12px !important; white-space: nowrap !important; font-weight: 500 !important;">${message}</span>
          </div>
          <button class="close-button" aria-label="Dismiss" 
                  style="width: 24px !important; height: 24px !important; border-radius: 50% !important; border: 1px solid ${style.border} !important; color: ${style.text} !important; font-size: 18px !important; display: flex !important; align-items: center !important; justify-content: center !important; margin: 0 8px !important; cursor: pointer !important; flex-shrink: 0 !important; opacity: 0.8 !important;">×</button>
        </div>
      </div>
    `;

    return notificationDiv;
  }

  show(message, type = "info", duration = 5000) {
    console.log("Showing notification:", { message, type, duration });

    const notificationElement = this.createNotificationElement(message, type);
    const notificationId = notificationElement.id;

    // Add to notifications array
    this.notifications.push({
      id: notificationId,
      element: notificationElement,
    });

    // Remove oldest if we exceed max
    if (this.notifications.length > this.maxNotifications) {
      const oldest = this.notifications.shift();
      const oldElement = document.getElementById(oldest.id);
      if (oldElement) {
        oldElement.remove();
      }
    }

    // Update positions
    this.updatePositions();

    // Add the new notification
    document.body.appendChild(notificationElement);
    console.log("Notification element added to DOM");

    // Set up close button
    const closeButton = notificationElement.querySelector(".close-button");
    closeButton.addEventListener("click", () => {
      console.log("Close button clicked");
      notificationElement.remove();
      this.notifications = this.notifications.filter(
        (n) => n.id !== notificationId
      );
      this.updatePositions();
    });

    // Add hover effect for close button
    closeButton.addEventListener("mouseover", () => {
      closeButton.style.opacity = "1 !important";
    });
    closeButton.addEventListener("mouseout", () => {
      closeButton.style.opacity = "0.8 !important";
    });

    // Auto remove after duration
    if (duration) {
      setTimeout(() => {
        if (document.getElementById(notificationId)) {
          notificationElement.remove();
          this.notifications = this.notifications.filter(
            (n) => n.id !== notificationId
          );
          this.updatePositions();
        }
      }, duration);
    }

    return notificationId;
  }

  updatePositions() {
    this.notifications.forEach((notification, index) => {
      const element = document.getElementById(notification.id);
      if (element) {
        element.style.top = `${350 + index * 80}px`;
      }
    });
  }

  clearAll() {
    console.log("Clearing all notifications");
    this.notifications.forEach((notification) => {
      const element = document.getElementById(notification.id);
      if (element) {
        element.remove();
      }
    });
    this.notifications = [];
  }
}

export function resumeLoader() {
  // Variables to track state
  let loadingMessage = null;
  let dotsInterval = null;

  // Return an object with start and stop methods
  return {
    // Start showing the loading message
    start: function () {
      // Find the target container
      const container = document.querySelector(
        ".js-jobs-document-upload__container"
      );
      if (!container) return;

      // If already showing, do nothing
      if (loadingMessage) return;

      // Create the loading message
      loadingMessage = document.createElement("p");
      loadingMessage.style.color = "#FF7700";
      loadingMessage.style.fontWeight = "bold";
      loadingMessage.style.margin = "10px 0";
      loadingMessage.style.width = "100%";
      loadingMessage.textContent = "Generating resume, please wait";

      // Create dots element
      const dots = document.createElement("span");
      loadingMessage.appendChild(dots);

      // Add to container
      container.prepend(loadingMessage);

      // Start animation
      let dotsCount = 0;
      dotsInterval = setInterval(() => {
        dotsCount = (dotsCount % 3) + 1;
        dots.textContent = ".".repeat(dotsCount);
      }, 500);
    },

    // Stop showing the loading message
    stop: function () {
      // Clear animation
      if (dotsInterval) {
        clearInterval(dotsInterval);
        dotsInterval = null;
      }

      // Remove element
      if (loadingMessage) {
        loadingMessage.remove();
        loadingMessage = null;
      }
    },
  };
}

// src/shared/StatusManager.js

export class StatusManager {
  constructor() {
    this.STATUS_BLOCK_ID = 'fastapply-status';
    this.createStatusBlock();
  }

  createStatusBlock() {
    if (document.getElementById(this.STATUS_BLOCK_ID)) {
      return;
    }

    let blockEl = document.createElement('div');
    blockEl.id = this.STATUS_BLOCK_ID;

    // Position the status block
    if (window.STATUS_BLOCK_POSITION) {
      switch (window.STATUS_BLOCK_POSITION) {
        case 'top-right':
          blockEl.style.top = 0;
          blockEl.style.right = 0;
          break;
        case 'bottom-right':
          blockEl.style.right = 0;
          blockEl.style.bottom = 0;
          break;
      }
    } else {
      blockEl.style.top = 0;
      blockEl.style.left = 0;
    }

    // Style the status block
    blockEl.style.color = 'white';
    blockEl.style.zIndex = '999999999999';
    blockEl.style.padding = '16px';
    blockEl.style.position = 'fixed';
    blockEl.style.overflow = 'auto';
    blockEl.style.maxWidth = '600px';
    blockEl.style.maxHeight = '500px';
    blockEl.style.background = '#f17777';
    blockEl.style.display = 'flex';
    blockEl.style.flexDirection = 'column';

    // Create title wrapper
    let titleWrapperEl = document.createElement('div');
    titleWrapperEl.style.gap = '50px';
    titleWrapperEl.style.display = 'flex';
    titleWrapperEl.style.alignItems = 'center';
    titleWrapperEl.style.justifyContent = 'space-between';

    // Create title label
    let labelEl = document.createElement('h3');
    labelEl.style.color = 'white';
    labelEl.style.fontWeight = 'bold';
    labelEl.innerText = 'FastApply activity: ';
    titleWrapperEl.append(labelEl);

    // Create timer section
    let timerWrapperEl = document.createElement('p');
    timerWrapperEl.style.display = 'none';

    let timerLabelEl = document.createElement('span');
    timerLabelEl.style.color = 'white';
    timerLabelEl.style.fontWeight = 'bold';
    timerLabelEl.innerText = 'Time left: ';
    timerWrapperEl.append(timerLabelEl);

    let timerValueEl = document.createElement('span');
    timerValueEl.style.color = 'white';
    timerValueEl.style.fontWeight = 'bold';
    timerValueEl.innerText = '00:00';
    timerValueEl.classList.add('fastapply-activity-timer-value');
    timerWrapperEl.append(timerValueEl);

    titleWrapperEl.append(timerWrapperEl);
    blockEl.append(titleWrapperEl);

    // Create list wrapper
    let listWrapperEl = document.createElement('div');
    listWrapperEl.classList.add('fastapply-activity-list-wrapper');
    listWrapperEl.style.overflow = 'auto';
    listWrapperEl.style.marginTop = '16px';
    listWrapperEl.style.paddingRight = '4px';
    blockEl.append(listWrapperEl);

    // Create activity list
    let listEl = document.createElement('div');
    listEl.classList.add('fastapply-activity-list');
    listEl.style.gap = '10px';
    listEl.style.display = 'grid';
    listEl.style.gridTemplateColumns = 'minmax(min-content, auto) minmax(max-content, 162px)';
    listWrapperEl.append(listEl);

    // Add CSS styles
    let styleEl = document.createElement('style');
    styleEl.innerHTML = `
        #${this.STATUS_BLOCK_ID} * {
            margin: 0;
            padding: 0;
        }
    
        #${this.STATUS_BLOCK_ID} .fastapply-activity-list-wrapper::-webkit-scrollbar {
            width: 4px;
            height: 4px;
        }
        
        #${this.STATUS_BLOCK_ID} .fastapply-activity-list-wrapper::-webkit-scrollbar-track {
            -webkit-border-radius: 2px;
            border-radius: 2px;
            background: white; 
        }
        
        #${this.STATUS_BLOCK_ID} .fastapply-activity-list-wrapper::-webkit-scrollbar-thumb {
           -webkit-border-radius: 2px;
           border-radius: 2px;
           background: #63aaf1;
        }
        
        #${this.STATUS_BLOCK_ID} .fastapply-activity-list-wrapper::-webkit-scrollbar-thumb:window-inactive {
            background: #63aaf1;
        }
        
        #${this.STATUS_BLOCK_ID} .fastapply-activity-list .fastapply-activity-item {
            color: white;
            opacity: 0;
            transition: all 0.4s ease-out;
        }
        
        #${this.STATUS_BLOCK_ID} .fastapply-activity-list .fastapply-activity-item.fastapply-activity-item-show {
          opacity: 1;
        }
    `;

    document.head.append(styleEl);
    document.body.append(blockEl);
  }

  appendMessage(statusMessage) {
    if (!document.getElementById(this.STATUS_BLOCK_ID)) {
      this.createStatusBlock();
    }

    let messageItemEl = document.createElement('p');
    messageItemEl.classList.add('fastapply-activity-item');
    messageItemEl.innerText = statusMessage;

    document.querySelector(`#${this.STATUS_BLOCK_ID} .fastapply-activity-list`).append(messageItemEl);

    let timestampItemEl = document.createElement('p');
    timestampItemEl.classList.add('fastapply-activity-item');
    timestampItemEl.innerText = new Date().toLocaleString();

    document.querySelector(`#${this.STATUS_BLOCK_ID} .fastapply-activity-list`).append(timestampItemEl);

    setTimeout(function () {
      messageItemEl.classList.add('fastapply-activity-item-show');
      messageItemEl.scrollIntoView();
      timestampItemEl.classList.add('fastapply-activity-item-show');
      timestampItemEl.scrollIntoView();
    }, 10);
  }

  appendErrorMessage(errorMessage) {
    this.appendMessage(typeof errorMessage === 'string' ? errorMessage : errorMessage.toString());
  }

  remove() {
    if (document.getElementById(this.STATUS_BLOCK_ID)) {
      document.getElementById(this.STATUS_BLOCK_ID).remove();
    }
  }

  updateTimer(value) {
    const element = document.querySelector('.fastapply-activity-timer-value');
    if (!element) {
      console.warn('timer element not found');
      return;
    }
    element.innerText = value;
    element.closest('p').style.display = 'block';
  }

  startCountdownTimer(duration, countDownEnded) {
    this.appendMessage('Timer started');

    let timer = duration;
    let minutes;
    let seconds;

    function stop() {
      timer = -1;
    }

    function addTime(duration) {
      timer += duration;
    }

    let intervalId = setInterval(() => {
      minutes = parseInt(timer / 60, 10);
      seconds = parseInt(timer % 60, 10);

      minutes = minutes < 10 ? "0" + minutes : minutes;
      seconds = seconds < 10 ? "0" + seconds : seconds;

      this.updateTimer(minutes + ":" + seconds);

      if (--timer < 0) {
        clearInterval(intervalId);
        if (typeof countDownEnded === 'function') {
          countDownEnded();
        }
      }

      if (timer % 10 === 0) {
        chrome.runtime.sendMessage({type: "APPLY-TAB-KEEPALIVE"});
      }
    }, 1000);

    return {
      stop,
      addTime,
    };
  }
}

// export class FastApplyUI {
//   constructor(stateManager) {
//     this.stateManager = stateManager;
//     this.controlId = "fastapply-control";
//     this.modalId = "fastapply-navigation-modal";
//     this.originalWidth = null;
//   }

//   createControlButton() {
//     const buttonDiv = document.createElement("div");
//     buttonDiv.id = this.controlId;
//     buttonDiv.className = "fixed z-50";
//     buttonDiv.innerHTML = `
//       <div class="control-container">
//         <div class="logo-section">
//           <img src="https://lh3.googleusercontent.com/CoiY2ePs1brwVi1coTvuJvqXHTUlUs6HacDtoPI5A7pC-Rqvz9V0IFYJ7ab7bzmBpDvmvSdCJe3t1HmSa15UUoAgkQ=s120"
//                alt="FastApply Logo">
//         </div>
//         <div class="content-section">
//           <button class="run-button">Run FastApply</button>
//           <button class="help-button" aria-label="Help">?</button>
//           <button class="close-button" aria-label="Collapse">×</button>
//         </div>
//       </div>
//     `;
//     return buttonDiv;
//   }

//   toggleCollapse() {
//     const container = document.querySelector(
//       `#${this.controlId} .control-container`
//     );
//     const contentSection = container.querySelector(".content-section");

//     if (contentSection.style.width === "0px") {
//       contentSection.style.width = "auto";
//       contentSection.style.opacity = "1";
//       contentSection.style.visibility = "visible";
//       contentSection.style.padding = "0 12px";
//     } else {
//       this.originalWidth = `${contentSection.scrollWidth}px`;
//       contentSection.style.width = "0px";
//       contentSection.style.opacity = "0";
//       contentSection.style.visibility = "hidden";
//       contentSection.style.padding = "0";
//     }
//   }

//   createNavigationModal() {
//     const modal = document.createElement("div");
//     modal.id = this.modalId;
//     modal.innerHTML = `
//       <div class="modal-overlay"></div>
//       <div class="modal-content">
//         <h2 class="modal-title"></h2>
//         <div class="button-group">
//           <button class="primary-button"></button>
//           <div class="secondary-buttons">
//             <button class="secondary-button">OK</button>
//             <button class="help-button">Help</button>
//           </div>
//         </div>
//       </div>
//     `;
//     return modal;
//   }

//   showModal(title, primaryButtonText, primaryAction) {
//     const modal = document.getElementById(this.modalId);
//     if (modal) {
//       modal.querySelector(".modal-title").textContent = title;
//       const primaryButton = modal.querySelector(".primary-button");
//       primaryButton.textContent = primaryButtonText;
//       primaryButton.onclick = () => {
//         primaryAction();
//         this.hideModal();
//       };
//       modal.classList.add("show");
//     }
//   }

//   hideModal() {
//     const modal = document.getElementById(this.modalId);
//     if (modal) {
//       modal.classList.remove("show");
//     }
//   }

//   async handleRunButton() {
//     // First check user details
//     const userDetails = await this.checkUserDetails();
//     if (!userDetails) {
//       this.showModal(
//         "Complete Your Profile",
//         "Go to Onboarding",
//         () => (window.location.href = "https://fastapply.co/onboarding")
//       );
//       return;
//     }

//     // Then check if we're on search jobs page
//     const isJobsPage = window.location.pathname.includes("/jobs/search");
//     if (!isJobsPage) {
//       this.showModal(
//         "Please navigate to jobs search page",
//         "Go To Job Search",
//         () => (window.location.href = "https://www.linkedin.com/jobs/search/")
//       );
//       return;
//     }

//     // Finally check credits/subscription
//     const canProceed = await this.checkStatusAndUpdateWarning();
//     if (canProceed) {
//       this.startAutoApply();
//     }
//   }
//   showHelp() {
//     window.open("https://fastapply.co/help", "_blank");
//   }

//   startAutoApply() {
//     chrome.runtime.sendMessage(
//       {
//         action: "processJobs",
//         userId: null,
//         jobsToApply: 1,
//       },
//       (response) => {
//         if (chrome.runtime.lastError) {
//           console.error("Error starting auto apply:", chrome.runtime.lastError);
//           return;
//         }
//         console.log("Auto apply process started:", response);
//       }
//     );
//   }

//   injectStyles() {
//     if (!document.getElementById(`${this.controlId}-style`)) {
//       const style = document.createElement("style");
//       style.id = `${this.controlId}-style`;
//       style.textContent = `
//         #${this.controlId} {
//           position: fixed !important;
//           top: 350px !important;
//           right: 0 !important;
//           z-index: 9999 !important;
//           width: fit-content !important;
//           margin-right: 10px !important;
//         }

//         #${this.controlId} .control-container {
//           display: flex !important;
//           align-items: stretch !important;
//           background: white !important;
//           border: 1px solid #e0e0e0 !important;
//           border-right: none !important;
//           border-radius: 6px !important;
//           overflow: hidden !important;
//           box-shadow: -2px 2px 5px rgba(0,0,0,0.1) !important;
//         }

//         #${this.controlId} .logo-section {
//           background: #f3f4f6 !important;
//           flex-shrink: 0 !important;
//         }

//         #${this.controlId} .logo-section img {
//           width: 50px !important;
//           height: 50px !important;
//           display: block !important;
//         }

//         #${this.controlId} .content-section {
//           display: flex !important;
//           align-items: center !important;
//           padding: 0 12px !important;
//           gap: 8px !important;
//           border-left: 1px solid #e0e0e0 !important;
//         }

//         #${this.controlId} .run-button {
//           border-radius: 4px !important;
//           color: white !important;
//           border: none !important;
//           background: rgb(44, 45, 47) !important;
//           font-weight: 600 !important;
//           font-size: 14px !important;
//           padding: 8px 12px !important;
//           cursor: pointer !important;
//           flex-grow: 1 !important;
//           text-align: left !important;
//         }

//         #${this.controlId} .run-button:hover {
//           background:rgb(23, 23, 23) !important;
//           border-radius: 4px !important;
//         }

//         #${this.controlId} .help-button {
//           width: 24px !important;
//           height: 24px !important;
//           border-radius: 50% !important;
//           background: #f3f4f6 !important;
//           border: 1px solid #e0e0e0 !important;
//           color: #666 !important;
//           font-weight: bold !important;
//           cursor: pointer !important;
//           display: flex !important;
//           align-items: center !important;
//           justify-content: center !important;
//           flex-shrink: 0 !important;
//         }

//         #${this.controlId} .help-button:hover {
//           background: #e5e7eb !important;
//           color: #333 !important;
//         }

//         #${this.controlId} .close-button {
//           width: 24px !important;
//           height: 24px !important;
//           border-radius: 50% !important;
//           background: #f3f4f6 !important;
//           border: 1px solid #e0e0e0 !important;
//           color: #666 !important;
//           font-size: 18px !important;
//           font-weight: normal !important;
//           cursor: pointer !important;
//           display: flex !important;
//           align-items: center !important;
//           justify-content: center !important;
//           flex-shrink: 0 !important;
//           padding: 0 !important;
//           line-height: 1 !important;
//         }

//         /* Modal Styles */
//         ${this.getModalStyles()}
//       `;
//       document.head.appendChild(style);
//     }
//   }

//   getModalStyles() {
//     return `
//       #${this.modalId} {
//         display: none;
//         position: fixed !important;
//         top: 0 !important;
//         left: 0 !important;
//         right: 0 !important;
//         bottom: 0 !important;
//         z-index: 9999 !important;
//       }

//       #${this.modalId}.show {
//         display: block !important;
//       }

//       #${this.modalId} .modal-overlay {
//         position: fixed !important;
//         top: 0 !important;
//         left: 0 !important;
//         right: 0 !important;
//         bottom: 0 !important;
//         background: rgba(0, 0, 0, 0.5) !important;
//         backdrop-filter: blur(2px) !important;
//       }

//       #${this.modalId} .modal-content {
//         position: fixed !important;
//         top: 50% !important;
//         left: 50% !important;
//         transform: translate(-50%, -50%) !important;
//         background: white !important;
//         padding: 24px !important;
//         border-radius: 8px !important;
//         box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
//         width: 400px !important;
//         max-width: 90vw !important;
//         text-align: center !important;
//       }

//       #${this.modalId} h2 {
//         margin: 0 0 24px 0 !important;
//         font-size: 20px !important;
//         font-weight: 600 !important;
//         color: #1B1F23 !important;
//       }

//       #${this.modalId} .button-group {
//         display: flex !important;
//         flex-direction: column !important;
//         gap: 16px !important;
//       }

//       #${this.modalId} .secondary-buttons {
//         display: flex !important;
//         gap: 12px !important;
//         justify-content: center !important;
//       }

//       #${this.modalId} .primary-button {
//         background: #0A66C2 !important;
//         color: white !important;
//         padding: 10px 20px !important;
//         border-radius: 16px !important;
//         border: none !important;
//         font-weight: 600 !important;
//         cursor: pointer !important;
//         transition: background 0.2s !important;
//         width: 100% !important;
//       }

//       #${this.modalId} .primary-button:hover {
//         background: #004182 !important;
//       }

//       #${this.modalId} .secondary-button,
//       #${this.modalId} .help-button {
//         background: #fff !important;
//         border: 1px solid #e0e0e0 !important;
//         color: #666 !important;
//         padding: 8px 24px !important;
//         border-radius: 16px !important;
//         font-weight: 500 !important;
//         cursor: pointer !important;
//         transition: all 0.2s !important;
//       }

//       #${this.modalId} .secondary-button:hover,
//       #${this.modalId} .help-button:hover {
//         background: #f5f5f5 !important;
//         border-color: #ccc !important;
//       }
//     `;
//   }

//   async checkStatusAndUpdateWarning() {
//     try {
//       const state = await this.stateManager.getState();
//       const hasCredits = state?.credits > 0;
//       const hasSubscription =
//         state?.userRole === "pro" ||
//         state?.userRole === "starter" ||
//         state?.userRole === "unlimited";
//       if (!hasCredits && !hasSubscription) {
//         this.showModal(
//           "No active credit or active subscription",
//           "Get Credits",
//           () => (window.location.href = "https://fastapply.co/pricing")
//         );
//         return false;
//       }
//       return true;
//     } catch (error) {
//       console.error("Error checking credit status:", error);
//       return false;
//     }
//   }

//   async checkUserDetails() {
//     try {
//       const state = await this.stateManager.getState();
//       return state?.userRole;
//     } catch (error) {
//       console.error("Error checking user details:", error);
//       return null;
//     }
//   }

//   async init() {
//     const container = this.createControlButton();
//     document.body.appendChild(container);

//     const modal = this.createNavigationModal();
//     document.body.appendChild(modal);

//     this.injectStyles();

//     // Get and store the initial content width
//     const contentSection = container.querySelector(".content-section");
//     this.contentWidth = `${contentSection.scrollWidth}px`;

//     // Add event listeners
//     const runButton = container.querySelector(".run-button");
//     const helpButton = container.querySelector(".help-button");
//     const closeButton = container.querySelector(".close-button");
//     const logoSection = container.querySelector(".logo-section");

//     runButton.addEventListener("click", () => this.handleRunButton());
//     helpButton.addEventListener("click", (e) => {
//       e.stopPropagation();
//       this.showHelp();
//     });
//     closeButton.addEventListener("click", (e) => {
//       e.stopPropagation();
//       this.toggleCollapse();
//     });

//     logoSection.addEventListener("click", () => {
//       const contentSection = document.querySelector(
//         `#${this.controlId} .content-section`
//       );
//       if (contentSection.style.width === "0px") {
//         this.toggleCollapse();
//       }
//     });

//     // Modal event listeners
//     const modalOK = modal.querySelector(".secondary-button");
//     const modalHelp = modal.querySelector(".help-button");
//     const overlay = modal.querySelector(".modal-overlay");

//     modalOK.addEventListener("click", () => this.hideModal());
//     modalHelp.addEventListener("click", () => this.showHelp());
//     overlay.addEventListener("click", () => this.hideModal());
//   }

//   createNavigationModal() {
//     const modal = document.createElement("div");
//     modal.id = this.modalId;
//     modal.innerHTML = `
//       <div class="modal-overlay"></div>
//       <div class="modal-content">
//         <h2 class="modal-title"></h2>
//         <div class="button-group">
//           <button class="primary-button"></button>
//           <div class="secondary-buttons">
//             <button class="secondary-button">OK</button>
//             <button class="help-button">Help</button>
//           </div>
//         </div>
//       </div>
//     `;
//     return modal;
//   }

//   showModal(title, primaryButtonText, primaryAction) {
//     const modal = document.getElementById(this.modalId);
//     if (modal) {
//       modal.querySelector(".modal-title").textContent = title;
//       const primaryButton = modal.querySelector(".primary-button");
//       primaryButton.textContent = primaryButtonText;
//       primaryButton.onclick = () => {
//         primaryAction();
//         this.hideModal();
//       };
//       modal.classList.add("show");
//     }
//   }

//   hideModal() {
//     const modal = document.getElementById(this.modalId);
//     if (modal) {
//       modal.classList.remove("show");
//     }
//   }
// }
