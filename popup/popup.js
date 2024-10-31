// // document.addEventListener("DOMContentLoaded", function () {
// //   const form = document.getElementById("userDetailsForm");
// //   const statusDiv = document.getElementById("status");

// //   // Load saved user details and preferences
// //   chrome.storage.sync.get(["userDetails", "preferences"], function (data) {
// //     if (data.userDetails) {
// //       document.getElementById("firstName").value =
// //         data.userDetails.firstName || "";
// //       document.getElementById("lastName").value =
// //         data.userDetails.lastName || "";
// //       document.getElementById("email").value = data.userDetails.email || "";
// //       document.getElementById("phone").value = data.userDetails.phone || "";
// //     }
// //     if (data.preferences) {
// //       document.getElementById("jobTitle").value =
// //         data.preferences.jobTitle || "";
// //       document.getElementById("location").value =
// //         data.preferences.location || "";
// //       document.getElementById("jobType").value = data.preferences.jobType || "";
// //       document.getElementById("experienceLevel").value =
// //         data.preferences.experienceLevel || "";
// //       document.getElementById("coverLetter").value =
// //         data.preferences.coverLetter || "";
// //     }
// //   });

// //   form.addEventListener("submit", function (e) {
// //     e.preventDefault();
// //     const userDetails = {
// //       firstName: document.getElementById("firstName").value,
// //       lastName: document.getElementById("lastName").value,
// //       email: document.getElementById("email").value,
// //       phone: document.getElementById("phone").value,
// //     };
// //     const preferences = {
// //       jobTitle: document.getElementById("jobTitle").value,
// //       location: document.getElementById("location").value,
// //       jobType: document.getElementById("jobType").value,
// //       experienceLevel: document.getElementById("experienceLevel").value,
// //       coverLetter: document.getElementById("coverLetter").value,
// //     };

// //     // Handle resume file
// //     const resumeFile = document.getElementById("resume").files[0];
// //     if (resumeFile) {
// //       const reader = new FileReader();
// //       reader.onload = function (e) {
// //         preferences.resumeData = e.target.result;
// //         saveData(userDetails, preferences);
// //       };
// //       reader.readAsDataURL(resumeFile);
// //     } else {
// //       saveData(userDetails, preferences);
// //     }
// //   });

// //   function saveData(userDetails, preferences) {
// //     chrome.storage.sync.set(
// //       { userDetails: userDetails, preferences: preferences },
// //       function () {
// //         statusDiv.textContent = "Options saved";
// //         setTimeout(() => {
// //           statusDiv.textContent = "";
// //         }, 3000);
// //       }
// //     );
// //   }
// // });

// // popup.js
console.log("full screen");

document.addEventListener("DOMContentLoaded", () => {
  const startButton = document.getElementById("startJobSearch");
  const logButton = document.getElementById("logMessage");
  chrome.windows.create({
    state: "fullscreen",
    url: location.url,
  });
  // Function to go fullscreen
  function goFullscreen() {
    chrome.windows.getCurrent({}, function (window) {
      chrome.windows.update(window.id, { state: "fullscreen" }, function () {
        console.log("full screen");
        statusDiv.textContent = "Entered fullscreen mode.";
      });
    });
  }

  // Go fullscreen immediately when the popup opens
  goFullscreen();

  // Send "startJobSearch" message
  startButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "startJobSearch" }, (response) => {
      console.log("Response from background:", response.status);
    });
  });

  // Send "log" message
  logButton.addEventListener("click", () => {
    chrome.runtime.sendMessage(
      { action: "log", message: "Test log message from popup." },
      (response) => {
        console.log("Log response:", response.status);
      }
    );
  });
});

chrome.windows.getCurrent((window) => {
  chrome.windows.update(window.id, {
    state: "fullscreen",
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    chrome.windows.getCurrent((window) => {
      chrome.windows.update(window.id, {
        state: "normal",
      });
    });
  }
});

document.addEventListener("DOMContentLoaded", function () {
  chrome.windows.create({
    url: chrome.runtime.getURL("maximized.html"),
    type: "popup",
    width: 800,
    height: 600,
  });
  window.close(); // Close the small default popup
});
