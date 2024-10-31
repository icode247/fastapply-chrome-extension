document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("userDetailsForm");
  const statusDiv = document.getElementById("status");

  if (form) {
    // Load saved user details
    chrome.storage.sync.get("userDetails", function (data) {
      if (data.userDetails) {
        document.getElementById("firstName").value =
          data.userDetails.firstName || "";
        document.getElementById("lastName").value =
          data.userDetails.lastName || "";
        document.getElementById("email").value = data.userDetails.email || "";
        document.getElementById("phone").value = data.userDetails.phone || "";
      }
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const userDetails = {
        firstName: document.getElementById("firstName").value,
        lastName: document.getElementById("lastName").value,
        email: document.getElementById("email").value,
        phone: document.getElementById("phone").value,
      };

      chrome.storage.sync.set({ userDetails: userDetails }, function () {
        statusDiv.textContent = "Options saved";
        setTimeout(() => {
          statusDiv.textContent = "";
        }, 3000);
      });
    });
  }
});
