import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, Button, CssVarsProvider, useColorScheme } from "@mui/joy";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/inter";
import "../styles/popup.css";
import Dashboard from "./pages/dashboard";
import { HashRouter, Routes, Route } from "react-router-dom";
import Settings from "./pages/settings";

function App() {
  const { setMode } = useColorScheme();

  useEffect(() => {
    setMode("dark"); // Set default mode to dark
  }, [setMode]);

  return (
    <div className="popup-fullscreen">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
        {/* Other routes... */}
        {/* <Route path="*" element={<NotFound />} />{" "} */}
        {/* A 404 Not Found component */}
      </Routes>
    </div>
  );
}

// Render the App
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <CssVarsProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </CssVarsProvider>
  </React.StrictMode>
);
