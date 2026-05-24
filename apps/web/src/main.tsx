import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { NuqsAdapter } from "nuqs/adapters/react-router/v6";

import "@gitcurriculo/ui/src/styles.css";
import "./index.css";
import App from "./App";

document.documentElement.setAttribute(
  "data-theme",
  (localStorage.getItem("gc-theme") as "dark" | "light") ?? "dark"
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true
      }}
    >
      <NuqsAdapter>
        <App />
      </NuqsAdapter>
    </BrowserRouter>
  </React.StrictMode>
);
