import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";
import App from "./App";

// Apply default dark theme before first paint
document.documentElement.setAttribute("data-theme", "dark");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);